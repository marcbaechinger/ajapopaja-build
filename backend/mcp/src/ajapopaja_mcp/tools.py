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

import asyncio
import logging
import re
from typing import Any, Dict, List, Optional

from api.docbot.manager import DocBotManager
from api.websocket_manager import manager
from core.db import init_db
from core.exceptions import EntityNotFoundError, VersionMismatchError
from core.models.models import TaskStatus
from core.queries import task as task_queries


def _is_valid_id(id_str: str) -> bool:
    """Checks if a string is a valid 24-character hexadecimal ID."""
    return bool(re.match(r"^[0-9a-fA-F]{24}$", id_str))


async def notify_api(task_id: str):
    """Notifies the API that a task has changed via WebSocket manager directly."""
    try:
        await manager.notify_task_update(task_id)
    except Exception as e:
        logging.error(f"Failed to notify API for task {task_id}: {e}")


async def get_next_task(pipeline_id: str) -> Dict[str, Any]:
    """
    Fetches the first available scheduled task in a pipeline and marks it inprogress.

    IMPORTANT: If 'want_design_doc' is True, you MUST provide a design proposal using
    'update_task_design_doc' before implementing and completing the task.
    The task will automatically move to 'proposed' status once the design_doc is set.
    Once you have submitted the design, you should stop working on this task.
    You can then call 'get_next_task' again to pick up the next available task
    (which might be this one again once it has been approved and moved back to 'scheduled').

    Args:
        pipeline_id: The ID of the pipeline to pull from.

    Returns:
        A dictionary containing task details (id, title, description, design_doc, spec, want_design_doc, design_doc_ready, version).
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


async def complete_task(
    task_id: str, commit_hash: str, completion_info: str, version: int
) -> str:
    """
    Finalizes a task implementation.

    IMPORTANT: If 'want_design_doc' was True for this task, a 'design_doc' must have been
    provided and approved by the user before calling this tool.

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
        task = await task_queries.complete_task(
            task_id=task_id,
            version=version,
            commit_hash=commit_hash,
            completion_info=completion_info,
            actor="mcp",
        )

        await notify_api(task_id)

        # Trigger DocBot in the background
        asyncio.create_task(DocBotManager.process_completed_task(task))

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
