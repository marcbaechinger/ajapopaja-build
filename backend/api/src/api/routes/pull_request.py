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
import os
import sys
import tempfile
from datetime import UTC, datetime
from typing import List, Optional

import git
from enum import Enum
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.auth import get_current_user
from api.git_hosting.gitea import GiteaApiError, GiteaClient
from core import config
from core.models.models import (
    Pipeline,
    PullRequest,
    PullRequestStatus,
    Task,
    TaskStatus,
)
from core.queries import task as task_queries
from core.utils import git_utils

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/pull_requests",
    tags=["pull_requests"],
    dependencies=[Depends(get_current_user)],
)


class FailureStrategy(str, Enum):
    REVERT = "revert"
    KEEP = "keep"


class AcceptPullRequestRequest(BaseModel):
    commit_message: Optional[str] = None
    failure_strategy: FailureStrategy = FailureStrategy.REVERT


# =============================================================================
# Validation Functions
# =============================================================================


def validate_pull_request_exists(pr_id: str, pr: Optional[PullRequest]) -> PullRequest:
    """Validate that the pull request exists."""
    if not pr:
        logger.warning(f"Pull Request {pr_id} not found")
        raise HTTPException(status_code=404, detail="Pull Request not found")
    return pr


def validate_pull_request_status(pr: PullRequest) -> None:
    """Validate that the pull request is in OPEN status."""
    if pr.status != PullRequestStatus.OPEN:
        logger.warning(f"Pull Request {pr.id} is not open (status: {pr.status})")
        raise HTTPException(status_code=400, detail="Pull Request is not open")


def validate_pipeline(workspace_path: Optional[str]) -> str:
    """Validate that the pipeline workspace exists and return the path."""
    if not workspace_path:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    return workspace_path


def validate_patch(patch: Optional[str]) -> str:
    """Validate that the patch is not empty and normalize it."""
    if not patch or not patch.strip():
        raise HTTPException(status_code=400, detail="Pull Request has an empty patch")
    if not patch.endswith("\n"):
        patch = patch + "\n"
    return patch


async def validate_workspace_clean(repo: git.Repo, workspace_path: str) -> None:
    """Validate that the workspace is clean before applying changes."""
    if repo.is_dirty(untracked_files=True):
        logger.warning(f"Workspace {workspace_path} is not clean. Aborting patch.")
        raise HTTPException(
            status_code=400,
            detail="Workspace has unstaged or untracked changes. Please clean it before accepting.",
        )


# =============================================================================
# Git Operations Functions
# =============================================================================


async def apply_patch(repo: git.Repo, pr: PullRequest) -> None:
    """Apply the patch to the repository using git apply."""
    patch_content = validate_patch(pr.patch)

    with tempfile.NamedTemporaryFile(mode="w", suffix=".patch", delete=False) as f:
        f.write(patch_content)
        patch_path = f.name

    try:
        logger.info(f"Patch length: {len(pr.patch)} characters")
        logger.debug(f"Executing git apply with patch at {patch_path}")
        repo.git.apply("--3way", patch_path)
        logger.info(f"Successfully applied patch for PR {pr.id}")
    except git.exc.GitCommandError as e:
        logger.error(f"Git operation failed for PR {pr.id}: {e.stderr}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Git operation failed: {e.stderr}")
    finally:
        if os.path.exists(patch_path):
            os.remove(patch_path)


def _get_ruff_binary() -> str:
    """Return the path to the ruff binary in the current Python environment.

    The app runs from the backend venv (e.g. /app/backend/.venv), so ruff is
    available next to the running interpreter. We invoke it directly rather than
    via `uv run ruff` because the workspace being formatted is a mounted host
    directory that is not itself a uv project.
    """
    return os.path.join(os.path.dirname(sys.executable), "ruff")


async def format_workspace(workspace_path: str) -> None:
    """Run ruff formatting on the workspace."""
    try:
        ruff_bin = _get_ruff_binary()
        logger.info(f"Formatting workspace with ruff: {workspace_path}")
        for ruff_cmd in [["format", "."], ["check", "--fix", "."]]:
            proc = await asyncio.create_subprocess_exec(
                ruff_bin,
                *ruff_cmd,
                cwd=workspace_path,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()
            if proc.returncode != 0:
                logger.warning(
                    f"Ruff {ruff_cmd[0]} returned {proc.returncode}: {stderr.decode()}"
                )
    except Exception as e:
        logger.warning(f"Failed to run ruff formatting: {e}")


def commit_changes(repo: git.Repo, pr: PullRequest, commit_message: str) -> str:
    """Commit the changes to the repository and return the commit hash."""
    repo.git.add(A=True)
    # If the patch was already applied and committed in a prior attempt (e.g. a
    # previous push failed and the PR stayed OPEN), there is nothing new to
    # commit. Return the existing HEAD so acceptance can proceed idempotently.
    if not repo.index.diff(repo.head.commit):
        logger.info(f"No changes to commit for PR {pr.id}; using existing HEAD")
        return repo.head.commit.hexsha
    # Use --no-verify to bypass pre-commit hooks that might fail in the server environment
    # Provide a git identity via env vars when none is configured (e.g. in Docker).
    repo.git.commit(
        "-m", commit_message, "--no-verify", env=git_utils.ensure_git_identity(repo)
    )
    new_commit_hash = repo.head.commit.hexsha
    logger.info(
        f"Successfully committed changes for PR {pr.id} (hash: {new_commit_hash})"
    )
    return new_commit_hash


# =============================================================================
# Database Update Functions
# =============================================================================


async def update_pull_request_status(
    pr: PullRequest, status: PullRequestStatus, remote_pr_url: Optional[str] = None
) -> None:
    """Update the pull request status and optionally persist the external PR URL."""
    pr.status = status
    pr.remote_pr_url = remote_pr_url
    await pr.save()


async def update_task_status(
    task: Task, new_commit_hash: str, summary: str, pr_id: str
) -> None:
    """Update the task status to IMPLEMENTED with commit information."""
    if task:
        logger.info(f"Updating status for task {task.id} to IMPLEMENTED")
        task.commit_hash = new_commit_hash
        task.completion_info = summary
        await task_queries.transition_task(
            str(task.id), TaskStatus.IMPLEMENTED, actor="user", task=task
        )


async def keep_task_pending_review(
    task: Task, new_commit_hash: str, summary: str, remote_pr_url: str
) -> None:
    """Mark the task as pending external review (Gitea-PR mode).

    The task stays in PULL_REQUEST_AVAILABLE so the user knows work is awaiting
    external review. Commit and PR URL are recorded for later automation.
    """
    if task:
        logger.info(
            f"Keeping task {task.id} in PULL_REQUEST_AVAILABLE "
            "awaiting external review"
        )
        task.commit_hash = new_commit_hash
        task.completion_info = summary
        task.review_md = remote_pr_url
        task.updated_at = datetime.now(UTC)
        await task.save()


# =============================================================================
# Helper Functions
# =============================================================================


def build_commit_message(
    request: Optional[AcceptPullRequestRequest], pr: PullRequest
) -> str:
    """Build the commit message from request or pull request summary."""
    return (request.commit_message if request else None) or pr.summary


# =============================================================================
# Remote Pull Request Submission (Gitea)
# =============================================================================


def _is_gitea_pr_mode(pipeline: Pipeline) -> bool:
    """Whether the remote PR should be submitted as a Gitea PR instead of
    being applied directly. Local pipelines always use the direct path."""
    return bool(
        pipeline.repo_uri and config.REMOTE_PR_MODE == "gitea_pr"
    )


async def _submit_as_gitea_pr(repo, pipeline, pr, commit_message: str) -> str:
    """Push a feature branch and create a Gitea pull request for review.

    The patch has already been applied and committed on the default branch. The
    feature branch is branched off that state (carrying the changes along), the
    commit is idempotently reused, and the branch is pushed. Returns the Gitea
    PR web URL.
    """
    base = git_utils.current_default_branch(repo)
    git_utils.ensure_feature_branch(repo, pr.branch_name)
    commit_changes(repo, pr, commit_message)
    git_utils.push_branch_with_auth(repo, pipeline, pr.branch_name)

    base_url, owner, repo_name = git_utils.resolve_gitea_repo(pipeline.repo_uri)
    token = pipeline.repo_token or config.GIT_PUSH_TOKEN
    client = GiteaClient(base_url, token)
    try:
        return await client.create_pull_request(
            owner,
            repo_name,
            head=pr.branch_name,
            base=base,
            title=pr.summary,
            body=pr.summary,
        )
    finally:
        await client.aclose()


# =============================================================================
# Route Handlers
# =============================================================================


@router.get("/pipeline/{pipeline_id}", response_model=List[PullRequest])
async def get_pipeline_pull_requests(pipeline_id: str):
    return await PullRequest.find(PullRequest.pipeline_id == pipeline_id).to_list()


@router.get("/task/{task_id}", response_model=Optional[PullRequest])
async def get_task_pull_request(task_id: str):
    # Try to find the most recent OPEN pull request
    pr = (
        await PullRequest.find(
            PullRequest.task_id == task_id, PullRequest.status == PullRequestStatus.OPEN
        )
        .sort("-created_at")
        .first_or_none()
    )

    if not pr:
        # Fallback to the most recent PR of any status
        pr = (
            await PullRequest.find(PullRequest.task_id == task_id)
            .sort("-created_at")
            .first_or_none()
        )

    return pr


@router.get("/{pr_id}", response_model=PullRequest)
async def get_pull_request(pr_id: str):
    pr = await PullRequest.get(pr_id)
    if not pr:
        raise HTTPException(status_code=404, detail="Pull Request not found")
    return pr


@router.post("/{pr_id}/accept")
async def accept_pull_request(
    pr_id: str, request: Optional[AcceptPullRequestRequest] = None
):
    """Accept a pull request by validating inputs, applying changes, and updating records."""
    logger.info(f"Accepting Pull Request {pr_id}")
    strategy = request.failure_strategy if request else FailureStrategy.REVERT

    try:
        # Step 1: Validate inputs
        pr = validate_pull_request_exists(pr_id, await PullRequest.get(pr_id))
        validate_pull_request_status(pr)

        pipeline = await Pipeline.get(pr.pipeline_id)
        workspace_path = validate_pipeline(
            str(pipeline.workspace_abs_path)
            if pipeline and pipeline.workspace_abs_path
            else None
        )

        # Step 2: Apply changes to workspace
        logger.info(f"Applying patch to workspace: {workspace_path}")
        repo = git_utils.get_repo(workspace_path)
        await validate_workspace_clean(repo, workspace_path)

        try:
            await apply_patch(repo, pr)
            await format_workspace(workspace_path)

            # Step 3: Commit changes
            commit_message = build_commit_message(request, pr)
            new_commit_hash = commit_changes(repo, pr, commit_message)

            # Step 3b: Submit to the remote repo. In gitea_pr mode we push a
            # feature branch and create a Gitea pull request instead of merging.
            gitea_pr = _is_gitea_pr_mode(pipeline)
            remote_pr_url: Optional[str] = None
            if gitea_pr:
                remote_pr_url = await _submit_as_gitea_pr(
                    repo, pipeline, pr, commit_message
                )
            elif pipeline.repo_uri:
                git_utils.push_with_auth(repo, pipeline)

        except GiteaApiError as e:
            logger.error(
                f"Gitea PR submission failed for {pr_id}: {e}", exc_info=True
            )
            raise HTTPException(
                status_code=502,
                detail=f"Failed to create Gitea pull request: {e}",
            )
        except Exception:
            if strategy == FailureStrategy.REVERT:
                logger.warning(
                    f"Failure during PR acceptance for {pr_id}. Strategy is REVERT. "
                    "Resetting workspace."
                )
                try:
                    repo.git.reset("--hard", "HEAD")
                    repo.git.clean("-fd")
                except Exception as reset_err:
                    logger.error(f"Failed to reset workspace: {reset_err}")
            else:
                logger.info(
                    f"Failure during PR acceptance for {pr_id}. Strategy is KEEP. "
                    "Leaving workspace as is."
                )
            raise

        # Step 4: Update records. In gitea_pr mode the change is not merged, so
        # the task stays in PULL_REQUEST_AVAILABLE awaiting external review.
        task = await Task.get(pr.task_id)
        if gitea_pr:
            await update_pull_request_status(
                pr, PullRequestStatus.SUBMITTED, remote_pr_url=remote_pr_url
            )
            await keep_task_pending_review(
                task, new_commit_hash, pr.summary, remote_pr_url
            )
            return {
                "status": "success",
                "message": "Pull Request submitted for review",
                "remote_pr_url": remote_pr_url,
            }

        await update_pull_request_status(pr, PullRequestStatus.ACCEPTED)
        await update_task_status(task, new_commit_hash, pr.summary, pr_id)

        return {
            "status": "success",
            "message": "Pull Request accepted, applied, and committed",
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(
            f"Unexpected error in accept_pull_request for PR {pr_id}: {e}",
            exc_info=True,
        )
        raise HTTPException(status_code=500, detail=f"Error applying patch: {str(e)}")


@router.post("/{pr_id}/reject")
async def reject_pull_request(pr_id: str):
    pr = await PullRequest.get(pr_id)
    if not pr:
        raise HTTPException(status_code=404, detail="Pull Request not found")

    pr.status = PullRequestStatus.REJECTED
    await pr.save()

    task = await Task.get(pr.task_id)
    if task and task.status == TaskStatus.PULL_REQUEST_AVAILABLE:
        logger.info(f"Updating status for task {pr.task_id} to CREATED")
        await task_queries.transition_task(
            str(task.id), TaskStatus.CREATED, actor="user"
        )
    return {"status": "success", "message": "Pull Request rejected"}
