# Copyright 2026 Marc Baechinger
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import logging
import re
from typing import Any, Dict, List, Optional

import git

from api.git_hosting.gitea import GiteaApiError
from api.git_hosting.pull_requests import create_pipeline_pull_request
from api.websocket_manager import WSMessage, manager
from core.db import init_db
from core.exceptions import EntityNotFoundError, VersionMismatchError
from core.models.models import Task, TaskStatus
from core.queries import pipeline as pipeline_queries
from core.queries import task as task_queries
from core.utils import git_utils


def _is_valid_id(id_str: str) -> bool:
    """Checks if a string is a valid 24-character hexadecimal ID."""
    return bool(re.match(r"^[0-9a-fA-F]{24}$", id_str))


async def notify_api(task_id: str):
    """Notifies the API that a task has changed via WebSocket manager directly."""
    try:
        await manager.notify_task_update(task_id)
    except Exception as e:
        logging.error(f"Failed to notify API for task {task_id}: {e}")


async def notify_task_created(task: Task):
    """Broadcasts a ``TASK_CREATED`` message from the server process.

    Mirrors the REST ``create_task`` handler so the pipeline UI updates live
    when a task is created through the MCP server. Delivery is best-effort:
    a failure to broadcast never fails the tool.
    """
    try:
        await manager.broadcast(
            WSMessage(type="TASK_CREATED", payload=task.model_dump(mode="json"))
        )
    except Exception as e:
        logging.error(f"Failed to broadcast TASK_CREATED for task {task.id}: {e}")


async def create_task(
    pipeline_id: str,
    title: str,
    spec: Optional[str] = None,
    design_doc: Optional[str] = None,
    description: Optional[str] = None,
    want_design_doc: bool = False,
    status: str = "created",
    order: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Creates a new task in a pipeline.

    The task is created through the same core query layer as the REST API
    (``core.queries.task.create_task``) and a ``TASK_CREATED`` WebSocket message
    is broadcast from the server process so the pipeline UI updates live.

    Args:
        pipeline_id: The 24-char hex ID of the target pipeline.
        title: The task title.
        spec: Optional Markdown specification.
        design_doc: Optional Markdown design document.
        description: Optional task description.
        want_design_doc: Whether the task requires an approved design document
            before implementation (default: False).
        status: Target initial status. Must be a valid task status (default:
            'created'). New tasks typically start as 'created' or 'scheduled'.
        order: Optional priority/position (lower sorts first).

    Returns:
        A dictionary with the created task's details, or an ``error`` entry.
    """
    if not _is_valid_id(pipeline_id):
        return {
            "error": (
                f"Invalid pipeline_id '{pipeline_id}'. Must be a 24-char hex string."
            )
        }

    if not title or not title.strip():
        return {"error": "title cannot be empty."}

    try:
        task_status = TaskStatus(status)
    except ValueError:
        valid_statuses = [s.value for s in TaskStatus]
        return {
            "error": (
                f"Invalid status '{status}'. Valid statuses are: "
                f"{', '.join(valid_statuses)}"
            )
        }

    await init_db()

    task_kwargs: Dict[str, Any] = {
        "pipeline_id": pipeline_id,
        "title": title,
        "spec": spec,
        "design_doc": design_doc,
        "description": description,
        "want_design_doc": want_design_doc,
        "status": task_status,
    }
    if order is not None:
        task_kwargs["order"] = order

    task = Task(**task_kwargs)

    try:
        new_task = await task_queries.create_task(pipeline_id, task, actor="mcp")
    except Exception as e:
        return {"error": f"An unexpected error occurred: {str(e)}"}

    await notify_task_created(new_task)

    return {
        "id": str(new_task.id),
        "pipeline_id": new_task.pipeline_id,
        "title": new_task.title,
        "description": new_task.description or "",
        "status": new_task.status,
        "type": new_task.type,
        "spec": new_task.spec or "",
        "design_doc": new_task.design_doc or "",
        "want_design_doc": new_task.want_design_doc,
        "order": new_task.order,
        "version": new_task.version,
        "created_at": (
            new_task.created_at.isoformat() if new_task.created_at else None
        ),
        "updated_at": (
            new_task.updated_at.isoformat() if new_task.updated_at else None
        ),
    }


async def get_next_task(pipeline_id: str) -> Dict[str, Any]:
    """
    Fetches the first available scheduled task in a pipeline and marks it inprogress.

    IMPORTANT: If 'want_design_doc' is True, you MUST provide a design proposal using
    'update_task_design_doc' before implementing and completing the task.
    The task will automatically move to 'proposed' status once the design_doc is set.
    Once you have submitted the design, you should stop working on this task.
    You can then call 'get_next_task' again to pick up the next available task
    (which might be this one again once it has been approved and moved back to
    'scheduled').

    Args:
        pipeline_id: The ID of the pipeline to pull from.

    Returns:
        A dictionary containing task details (id, title, description, design_doc,
        spec, want_design_doc, design_doc_ready, version).
    """
    if not _is_valid_id(pipeline_id):
        return {
            "error": (
                f"Invalid pipeline_id '{pipeline_id}'. Must be a 24-char hex string."
            )
        }

    await init_db()
    task = await task_queries.get_next_task(pipeline_id, actor="mcp")

    if task:
        await notify_api(str(task.id))
        return {
            "id": str(task.id),
            "title": task.title,
            "description": task.description or "",
            "design_doc": task.design_doc or "",
            "spec": task.spec or "",
            "want_design_doc": task.want_design_doc,
            "design_doc_ready": task.want_design_doc and bool(task.design_doc),
            "version": task.version,
        }

    return {"error": "No scheduled tasks found in this pipeline."}


async def update_task_design_doc(task_id: str, design_doc: str, version: int) -> str:
    """
    Updates the design document field for a specific task.
    This also automatically moves tasks to 'proposed' if 'want_design_doc' is True.

    If 'want_design_doc' is True, you should stop working on this task and can call
    'get_next_task' to see if there is any other scheduled task to pick up.

    If 'want_design_doc' is False implementation can directly continue.

    Args:
        task_id: The target task ID.
        design_doc: The Markdown-formatted design document.
        version: Current version for optimistic concurrency control (OCC).
    """
    if not _is_valid_id(task_id):
        return f"Error: Invalid task_id '{task_id}'. Must be a 24-char hex string."

    if not design_doc or not design_doc.strip():
        return "Error: design_doc cannot be empty."

    await init_db()
    try:
        await task_queries.update_task_details(
            task_id=task_id, version=version, design_doc=design_doc
        )
        await notify_api(task_id)
        return f"Design document for task {task_id} updated successfully."
    except EntityNotFoundError as e:
        return f"Error: {str(e)}"
    except VersionMismatchError as e:
        return (
            f"Error: {str(e)}. Please fetch the task again to get the latest version."
        )
    except Exception as e:
        return f"An unexpected error occurred: {str(e)}"


async def update_task_spec(task_id: str, spec: str, version: int) -> str:
    """
    Updates the specification field for a specific task.

    Args:
        task_id: The target task ID.
        spec: The new specification text.
        version: Current version for optimistic concurrency control (OCC).
    """
    if not _is_valid_id(task_id):
        return f"Error: Invalid task_id '{task_id}'. Must be a 24-char hex string."

    if not spec or not spec.strip():
        return "Error: spec cannot be empty."

    await init_db()
    try:
        await task_queries.update_task_details(
            task_id=task_id, version=version, spec=spec
        )
        await notify_api(task_id)
        return f"Specification for task {task_id} updated successfully."
    except EntityNotFoundError as e:
        return f"Error: {str(e)}"
    except VersionMismatchError as e:
        return (
            f"Error: {str(e)}. Please fetch the task again to get the latest version."
        )
    except Exception as e:
        return f"An unexpected error occurred: {str(e)}"


async def complete_task(
    task_id: str, commit_hash: str, completion_info: str, version: int
) -> str:
    """
    Finalizes a task implementation.

    IMPORTANT: If 'want_design_doc' was True for this task, a 'design_doc' must have
    been provided and approved by the user before calling this tool.

    Args:
        task_id: The target task ID.
        commit_hash: The full hash of the git commit containing the work.
        completion_info: A brief summary of what was accomplished.
        version: Current version for OCC.
    """
    if not _is_valid_id(task_id):
        return f"Error: Invalid task_id '{task_id}'. Must be a 24-char hex string."

    if not commit_hash or not re.match(r"^[0-9a-fA-F]{7,40}$", commit_hash):
        return (
            f"Error: Invalid commit hash '{commit_hash}'. "
            "Must be a valid 7-40 character hexadecimal string."
        )

    if not completion_info or not completion_info.strip():
        return "Error: completion_info cannot be empty."

    await init_db()
    try:
        # Fetch repo for pipeline
        try:
            repo = await git_utils.get_repo_for_pipeline_by_task(task_id)
        except EntityNotFoundError as e:
            return f"Error: {str(e)}"

        # Validate commit hash exists in repo
        if not git_utils.validate_commit_hash(repo, commit_hash):
            return (
                f"Error: Commit hash '{commit_hash}' not found in the repository "
                f"at {repo.working_dir}. Please provide a valid commit hash."
            )

        task = await task_queries.complete_task(
            task_id=task_id,
            version=version,
            commit_hash=commit_hash,
            completion_info=completion_info,
            actor="mcp",
        )

        await notify_api(task_id)

        status_msg = f"Task {task_id} completed successfully."
        if task.verification and not task.verification.get("success"):
            status_msg += (
                " WARNING: Verification failed. "
                f"Errors: {', '.join(task.verification.get('errors', []))}. "
                "A follow-up system task has been created."
            )

        return status_msg
    except EntityNotFoundError as e:
        return f"Error: {str(e)}"
    except VersionMismatchError as e:
        return (
            f"Error: {str(e)}. Please fetch the task again to get the latest version."
        )
    except Exception as e:
        return f"An unexpected error occurred: {str(e)}"


async def create_pull_request(
    pipeline_id: str,
    title: str,
    body: str = "",
    task_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Pushes the current branch of the pipeline's repo (if needed) and opens a
    Gitea pull request against the default branch. Optionally links the PR to a
    task and records it as SUBMITTED.

    The working tree must be clean (commit your work first). When the current
    branch is the default branch, a new ``pi/<task_id>`` (or
    ``pi/<short-sha>``) branch is created at HEAD *without* checking it out, so
    your working tree is left untouched. The Gitea token stays server-side.

    Args:
        pipeline_id: The 24-char hex pipeline ID.
        title: PR title.
        body: PR description (Markdown).
        task_id: Optional task to link and mark submitted.
    """
    if not _is_valid_id(pipeline_id):
        return {
            "error": (
                f"Invalid pipeline_id '{pipeline_id}'. Must be a 24-char hex string."
            )
        }

    if task_id is not None and not _is_valid_id(task_id):
        return {"error": f"Invalid task_id '{task_id}'. Must be a 24-char hex string."}

    if not title or not title.strip():
        return {"error": "title cannot be empty."}

    await init_db()

    try:
        pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    except EntityNotFoundError as e:
        return {"error": str(e)}

    if not pipeline.repo_uri:
        return {
            "error": (
                "Pipeline has no remote repo_uri configured; pull requests can "
                "only be created for remote pipelines."
            )
        }

    if not pipeline.workspace_abs_path:
        return {"error": f"Workspace path not found for pipeline {pipeline_id}."}

    try:
        # Open the existing clone read-only. Deliberately avoid
        # ``ensure_repo_cloned`` which may ``git reset --hard`` the live
        # interactive checkout and destroy uncommitted work.
        repo = git_utils.get_repo(str(pipeline.workspace_abs_path))
    except (git.exc.InvalidGitRepositoryError, git.exc.NoSuchPathError) as e:
        return {"error": f"Git repository not found for pipeline {pipeline_id}: {e}"}

    try:
        head = repo.active_branch.name
    except TypeError:
        return {
            "error": (
                "Repository is in detached HEAD state; check out a branch before "
                "creating a pull request."
            )
        }

    base = git_utils.current_default_branch(repo)

    if repo.is_dirty(untracked_files=True):
        return {
            "error": (
                "Working tree has uncommitted or untracked changes. Commit them "
                "before creating a pull request."
            )
        }

    linked_task = None
    if task_id is not None:
        try:
            linked_task = await task_queries.get_task_by_id(task_id)
        except EntityNotFoundError as e:
            return {"error": str(e)}

    if head == base:
        branch = f"pi/{task_id}" if task_id else f"pi/{repo.head.commit.hexsha[:7]}"
        git_utils.create_branch_at_head(repo, branch)
        head = branch

    commit_hash = repo.head.commit.hexsha

    try:
        pr_url = await create_pipeline_pull_request(
            pipeline, repo, head=head, base=base, title=title, body=body
        )
    except GiteaApiError as e:
        return {
            "error": f"Failed to create Gitea pull request: {e}",
            "status_code": e.status_code,
            "detail": e.detail,
        }
    except Exception as e:
        return {"error": f"An unexpected error occurred: {str(e)}"}

    task_status: Optional[str] = None
    if linked_task is not None:
        linked_task.commit_hash = commit_hash
        linked_task.review_md = pr_url
        try:
            # SUBMITTED is only legal from PULL_REQUEST_AVAILABLE. Keep the PR
            # and the recorded hashes even when the transition is not allowed
            # (e.g. the task is still INPROGRESS).
            await task_queries.transition_task(
                str(linked_task.id),
                TaskStatus.SUBMITTED,
                actor="mcp",
                task=linked_task,
            )
        except ValueError:
            await linked_task.save()
        task_status = (
            linked_task.status.value
            if isinstance(linked_task.status, TaskStatus)
            else str(linked_task.status)
        )
        await notify_api(task_id)

    return {
        "status": "created",
        "pr_url": pr_url,
        "branch": head,
        "base": base,
        "commit_hash": commit_hash,
        "pipeline_id": pipeline_id,
        "task_id": task_id,
        "task_status": task_status,
    }


async def search_tasks(
    keywords: Optional[str] = None,
    statuses: Optional[List[str]] = None,
    pipeline_id: Optional[str] = None,
    page: int = 0,
    limit: int = 10,
) -> Dict[str, Any]:
    """
    Search for tasks based on keywords, statuses, or pipeline.

    Args:
        keywords: Optional search keywords (matches title, spec, design_doc).
        statuses: Optional list of statuses to filter by.
        pipeline_id: Optional pipeline ID to filter by.
        page: Page number for pagination (0-based).
        limit: Maximum number of tasks to return (default: 10).
    """
    if pipeline_id and not _is_valid_id(pipeline_id):
        return {
            "error": (
                f"Invalid pipeline_id '{pipeline_id}'. Must be a 24-char hex string."
            )
        }

    if page < 0:
        return {"error": "page must be greater than or equal to 0."}
    if limit <= 0:
        return {"error": "limit must be greater than 0."}

    await init_db()
    try:
        # Convert string statuses to TaskStatus enum if provided
        status_enums = None
        if statuses:
            try:
                status_enums = [TaskStatus(s) for s in statuses]
            except ValueError:
                valid_statuses = [s.value for s in TaskStatus]
                return {
                    "error": (
                        "Invalid status provided. Valid statuses are: "
                        f"{', '.join(valid_statuses)}"
                    )
                }

        tasks, total_count = await task_queries.search_tasks(
            keywords=keywords,
            statuses=status_enums,
            pipeline_id=pipeline_id,
            page=page,
            limit=limit,
        )

        MAX_LEN = 300
        summaries = []
        for t in tasks:
            spec = t.spec or ""
            if len(spec) > MAX_LEN:
                spec = spec[:MAX_LEN] + "...[truncated]"

            summaries.append(
                {
                    "id": str(t.id),
                    "title": t.title,
                    "status": t.status,
                    "spec": spec,
                    "version": t.version,
                }
            )

        return {
            "tasks": summaries,
            "total_count": total_count,
            "page": page,
            "limit": limit,
        }
    except Exception as e:
        return {"error": str(e)}


async def get_task_details(task_id: str) -> Dict[str, Any]:
    """
    Retrieves full details for a task, including spec, design, and history.

    Args:
        task_id: The target task ID.
    """
    if not _is_valid_id(task_id):
        return {"error": f"Invalid task_id '{task_id}'. Must be a 24-char hex string."}

    await init_db()
    try:
        task = await task_queries.get_task_by_id(task_id)
        return {
            "id": str(task.id),
            "pipeline_id": task.pipeline_id,
            "title": task.title,
            "description": task.description or "",
            "status": task.status,
            "type": task.type,
            "spec": task.spec or "",
            "design_doc": task.design_doc or "",
            "want_design_doc": task.want_design_doc,
            "version": task.version,
            "commit_hash": task.commit_hash or "",
            "completion_info": task.completion_info or "",
            "verification": task.verification,
            "history": [h.model_dump() for h in task.history],
            "created_at": task.created_at.isoformat(),
            "updated_at": task.updated_at.isoformat(),
        }
    except EntityNotFoundError as e:
        return {"error": str(e)}


async def get_task_status(task_id: str) -> Dict[str, Any]:
    """
    Retrieves current status and verification results for a task.

    Args:
        task_id: The target task ID.
    """
    if not _is_valid_id(task_id):
        return {"error": f"Invalid task_id '{task_id}'. Must be a 24-char hex string."}

    await init_db()
    try:
        task = await task_queries.get_task_by_id(task_id)
        return {
            "id": str(task.id),
            "status": task.status,
            "version": task.version,
            "verification": task.verification,
        }
    except EntityNotFoundError as e:
        return {"error": str(e)}
