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
import re
import sys
import tempfile
from typing import List, Optional

import git
from enum import Enum
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from beanie.operators import In

from api.auth import get_current_user
from api.coderbot.manager import coderbot_manager
from api.git_hosting.gitea import GiteaApiError
from api.git_hosting.pull_requests import create_pipeline_pull_request
from api.websocket_manager import WSMessage, manager as ws_manager
from core import config
from core.models.models import (
    PiSession,
    Pipeline,
    PullRequest,
    PullRequestKind,
    PullRequestStatus,
    Task,
    TaskStatus,
)
from core.queries import pi_session as pi_session_queries
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
    # When true, accept even though an older pull request for the same pipeline
    # is still open (chained PRs form a sequence and are normally accepted in
    # creation order).
    force: bool = False


class IteratePullRequestRequest(BaseModel):
    comments: str
    session_uid: Optional[str] = None


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


async def find_older_open_pull_request(pr: PullRequest) -> Optional[PullRequest]:
    """Return the oldest still-pending PR of the same pipeline created before ``pr``.

    Ordered branch chaining makes pull requests a linear sequence; applying
    their deltas out of order can still conflict (line-by-line patching is
    inherently order-sensitive). This lookup lets the accept endpoint warn the
    caller before that happens. Returns ``None`` when there is no older pending
    PR.

    Both ``OPEN`` and ``SUBMITTED`` count as pending: a ``SUBMITTED`` PR is a
    Gitea pull request awaiting external review and is still a valid chaining
    predecessor that has not yet landed.
    """
    if not pr.pipeline_id or pr.created_at is None:
        return None
    return (
        await PullRequest.find(
            PullRequest.pipeline_id == pr.pipeline_id,
            In(
                PullRequest.status,
                [PullRequestStatus.OPEN, PullRequestStatus.SUBMITTED],
            ),
            PullRequest.id != pr.id,
            PullRequest.created_at < pr.created_at,
        )
        .sort("created_at")
        .first_or_none()
    )


async def find_rejected_predecessor_pr(pr: PullRequest) -> Optional[PullRequest]:
    """Return the rejected predecessor PR a chained PR is stacked on top of.

    A chained PR's patch is a delta relative to its predecessor's commit. When
    that predecessor was rejected (locally or by a remote Gitea close) the
    delta has no valid base to apply onto, so acceptance must be blocked rather
    than silently producing a partial ``git apply --3way``. Returns ``None``
    when the PR is not chained, the predecessor cannot be resolved, or the
    predecessor PR was not rejected.
    """
    if not pr.pi_session_uid:
        return None
    try:
        session = await PiSession.find_one(PiSession.uid == pr.pi_session_uid)
    except Exception:
        return None
    if session is None or not session.chained_from_session_uid:
        return None
    try:
        predecessor = await PiSession.find_one(
            PiSession.uid == session.chained_from_session_uid
        )
    except Exception:
        return None
    if predecessor is None:
        return None
    for pr_id in predecessor.pull_request_ids or []:
        if not pr_id:
            continue
        try:
            candidate = await PullRequest.get(pr_id)
        except Exception:
            candidate = None
        if candidate is not None and candidate.status == PullRequestStatus.REJECTED:
            return candidate
    return None


async def _resolve_chained_start_point(
    repo: git.Repo, pr: PullRequest
) -> Optional[str]:
    """Return the local branch a chained PR's feature branch must start from.

    A chained PR's patch is a diff relative to its predecessor's commit, so it
    must be applied on top of the predecessor's accepted work. In Gitea-PR mode
    the predecessor's accepted commit lives on its local feature branch (the
    default branch is deliberately kept clean), so return that branch when it is
    present. Returns ``None`` for non-chained PRs or when the predecessor branch
    is not available locally; callers then fall back to the default branch.
    """
    try:
        branch = await pi_session_queries.find_chained_predecessor_branch(
            pr.pi_session_uid
        )
    except Exception:
        logger.debug(
            "Failed to resolve chained start point for PR %s", pr.id, exc_info=True
        )
        return None
    if not branch:
        return None
    try:
        if branch in {b.name for b in repo.branches}:
            logger.info(
                "Chained PR %s will start from predecessor branch %s",
                pr.id,
                branch,
            )
            return branch
    except git.exc.GitCommandError:
        pass
    logger.warning(
        "Chained PR %s predecessor branch %s not found locally; falling back "
        "to the default branch",
        pr.id,
        branch,
    )
    return None


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


VERIFIED_HEAD_RE = re.compile(r"(Verified commit \(HEAD\): `)[0-9a-fA-F]{7,64}(`)")


def retarget_verified_commit_hash(summary: str, new_commit_hash: str) -> str:
    """Point the ``Verified commit (HEAD)`` line of a PR summary at the commit
    that actually landed in the repository.

    CoderBot records the hash of the temporary commit it created inside its
    isolated sandbox in the verification section of the PR summary. That hash
    only exists in the sandbox and is deleted with it; when the PR is later
    accepted the patch is re-applied and committed in the workspace, which
    produces a different, real commit hash. This helper rewrites the summary
    (replacing the transient sandbox hash) so a human can find the exact commit
    that was merged and correlate it with ``git log``. If the summary does not
    contain such a line (e.g. older PRs), it is returned unchanged.

    Args:
        summary: The PR summary text.
        new_commit_hash: The hash of the commit that actually got created in the
            repository when the PR was accepted.

    Returns:
        The summary with the ``Verified commit (HEAD)`` hash replaced, or the
        original summary when no verification line is present.
    """
    if not summary:
        return summary
    return VERIFIED_HEAD_RE.sub(rf"\g<1>{new_commit_hash}\g<2>", summary, count=1)


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
    task: Task, new_commit_hash: str, summary: str, pr: PullRequest
) -> None:
    """Mark the task as IMPLEMENTED after accepting an implementation PR.

    Documentation pull requests must not overwrite the implementation metadata
    stored on the task; their commit and URL live on the ``PullRequest``.
    """
    if task:
        logger.info(f"Updating status for task {task.id} to IMPLEMENTED")
        if pr.kind == PullRequestKind.IMPLEMENTATION:
            task.commit_hash = new_commit_hash
            task.completion_info = summary
        await task_queries.transition_task(
            str(task.id), TaskStatus.IMPLEMENTED, actor="user", task=task
        )


async def keep_task_pending_review(
    task: Task,
    new_commit_hash: str,
    summary: str,
    remote_pr_url: str,
    pr: PullRequest,
) -> None:
    """Mark the task as submitted for external review (Gitea-PR mode).

    The task transitions to SUBMITTED so it is considered completed by the UI
    and completed-tasks query, but kept distinct from IMPLEMENTED since only
    external review remains. For implementation PRs the commit and PR URL are
    recorded on the task for later automation; documentation PRs keep those
    fields untouched (their metadata is stored on the pull request).
    """
    if task:
        logger.info(f"Marking task {task.id} as SUBMITTED awaiting external review")
        if pr.kind == PullRequestKind.IMPLEMENTATION:
            task.commit_hash = new_commit_hash
            task.completion_info = summary
            task.review_md = remote_pr_url
        await task_queries.transition_task(
            str(task.id), TaskStatus.SUBMITTED, actor="user", task=task
        )


# =============================================================================
# Helper Functions
# =============================================================================


def build_commit_message(
    request: Optional[AcceptPullRequestRequest], pr: PullRequest
) -> str:
    """Build the commit message from the request, PR subject, or PR summary.

    The subject carries the title of the Task that was implemented, which is
    the desired commit message for the change. Documentation PRs may not have
    a subject (or older PRs may have an empty one), so fall back to the first
    non-empty summary line and finally to a stable PR-specific title. This also
    keeps quick accept (no request body) working and guarantees a non-empty
    Gitea PR title.
    """
    msg = (request.commit_message if request else None) or pr.subject
    if not msg and pr.summary:
        msg = next(
            (line.strip() for line in pr.summary.splitlines() if line.strip()),
            "",
        )
    return msg or f"Pull request {pr.id}"


# =============================================================================
# Remote Pull Request Submission (Gitea)
# =============================================================================


def _is_gitea_pr_mode(pipeline: Pipeline) -> bool:
    """Whether the remote PR should be submitted as a Gitea PR instead of
    being applied directly. Local pipelines always use the direct path."""
    return bool(pipeline.repo_uri and config.REMOTE_PR_MODE == "gitea_pr")


def resolve_apply_mode(pipeline: Optional[Pipeline]) -> str:
    """Classify how accepting this pull request will apply the change.

    Returns one of:
      * ``"merge"``  -- applied directly in the local workspace/repo (no remote)
      * ``"push"``   -- committed to the cloned repo and pushed to the remote
      * ``"submit"`` -- committed to the cloned repo and sent as a pull request

    Local pipelines (no ``repo_uri``) always use the direct merge path; remote
    pipelines use the global ``REMOTE_PR_MODE`` to decide between push and
    submitting a pull request.
    """
    if not pipeline or not pipeline.repo_uri:
        return "merge"
    if config.REMOTE_PR_MODE == "gitea_pr":
        return "submit"
    return "push"


async def _resolve_pipeline(pipeline_id: Optional[str]) -> Optional[Pipeline]:
    """Fetch a pipeline by id, returning None when it cannot be resolved.

    ``pipeline_id`` is stored on the PullRequest as a string, which may not be a
    valid ``PydanticObjectId`` in every context (e.g. test fixtures). Guard
    against validation/lookup errors so a single PR read never fails simply
    because its owning pipeline cannot be fetched.
    """
    if not pipeline_id:
        return None
    try:
        return await Pipeline.get(pipeline_id)
    except Exception as e:
        logger.warning(f"Could not resolve pipeline {pipeline_id} for apply mode: {e}")
        return None


async def _resolve_apply_mode(pipeline_id: Optional[str]) -> str:
    """Resolve the apply mode for a pull request's pipeline, defaulting to
    ``merge`` when the pipeline cannot be determined."""
    return resolve_apply_mode(await _resolve_pipeline(pipeline_id))


async def _submit_as_gitea_pr(repo, pipeline, pr, commit_message: str) -> str:
    """Push a feature branch and create a Gitea pull request for review.

    The patch has already been applied and committed on the default branch. The
    feature branch is branched off that state (carrying the changes along) and
    pushed. Returns the Gitea PR web URL.
    """
    base = git_utils.current_default_branch(repo)
    pr.base_branch = base
    git_utils.ensure_feature_branch(repo, pr.branch_name)
    try:
        return await create_pipeline_pull_request(
            pipeline,
            repo,
            head=pr.branch_name,
            base=base,
            title=commit_message,
            body=pr.summary or "",
        )
    finally:
        # Restore workspace to default branch
        try:
            repo.git.checkout(base)
        except Exception as e:
            logger.warning(f"Failed to switch back to base branch {base}: {e}")


# =============================================================================
# Route Handlers
# =============================================================================


@router.get("/pipeline/{pipeline_id}", response_model=List[PullRequest])
async def get_pipeline_pull_requests(pipeline_id: str):
    prs = await PullRequest.find(PullRequest.pipeline_id == pipeline_id).to_list()
    apply_mode = await _resolve_apply_mode(pipeline_id)
    for pr in prs:
        pr.apply_mode = apply_mode
    return prs


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

    if pr:
        pr.apply_mode = await _resolve_apply_mode(pr.pipeline_id)
    return pr


@router.get("/{pr_id}", response_model=PullRequest)
async def get_pull_request(pr_id: str):
    pr = await PullRequest.get(pr_id)
    if not pr:
        raise HTTPException(status_code=404, detail="Pull Request not found")
    pr.apply_mode = await _resolve_apply_mode(pr.pipeline_id)
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

        # Step 1b: Chained PRs must be accepted in creation order. Warn (409)
        # when an older PR of the same pipeline is still pending unless the
        # caller explicitly forces the out-of-order acceptance.
        if not (request.force if request else False):
            older = await find_older_open_pull_request(pr)
            if older is not None:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "An older pull request for this pipeline is still open "
                        f"(PR {older.id}). Accept it first, or retry with "
                        "force=true to accept this one out of order."
                    ),
                )

        # Step 1c: A chained PR whose predecessor was rejected (locally or by a
        # remote Gitea close) has no valid base for its delta patch. Block it
        # rather than silently applying a partial ``git apply --3way``.
        rejected_predecessor = await find_rejected_predecessor_pr(pr)
        if rejected_predecessor is not None:
            raise HTTPException(
                status_code=409,
                detail=(
                    "This pull request is chained on a rejected predecessor "
                    f"(PR {rejected_predecessor.id}). Re-chain or rework the "
                    "task before accepting it."
                ),
            )

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

        gitea_pr = _is_gitea_pr_mode(pipeline)

        # In Gitea-PR mode the change is committed onto the feature branch, not
        # the default branch. Rejection never reverts the default branch, so
        # committing there would leak rejected work into later CoderBot sessions
        # (which fall back to branching from the default branch when there is no
        # OPEN predecessor to chain onto). Branch off the clean default branch
        # before applying the patch.
        default_branch: Optional[str] = None
        if gitea_pr:
            default_branch = git_utils.current_default_branch(repo)
            # A chained PR's patch is a delta against its predecessor's commit.
            # Stack its branch on the predecessor's accepted feature branch when
            # one exists; otherwise branch off the clean default branch.
            start_point = await _resolve_chained_start_point(repo, pr)
            git_utils.ensure_feature_branch(
                repo, pr.branch_name, start_point=start_point
            )

        try:
            await apply_patch(repo, pr)
            await format_workspace(workspace_path)

            # Step 3: Commit changes
            commit_message = build_commit_message(request, pr)
            new_commit_hash = commit_changes(repo, pr, commit_message)

            # The pull request carries the commit that was actually accepted,
            # independently of the task (documentation PRs must not overwrite
            # the task's implementation commit).
            pr.commit_hash = new_commit_hash

            # CoderBot wrote the verification section of the summary at PR
            # creation time using the hash of its temporary sandbox commit. That
            # hash does not exist in the repository (the patch is re-applied here
            # as a brand-new commit with a different hash), so point the
            # "Verified commit (HEAD)" line at the commit that really landed.
            pr.summary = retarget_verified_commit_hash(pr.summary, new_commit_hash)

            # Step 3b: Submit to the remote repo. In gitea_pr mode we push a
            # feature branch and create a Gitea pull request instead of merging.
            remote_pr_url: Optional[str] = None
            if gitea_pr:
                remote_pr_url = await _submit_as_gitea_pr(
                    repo, pipeline, pr, commit_message
                )
            elif pipeline.repo_uri:
                git_utils.push_with_auth(repo, pipeline)

        except GiteaApiError as e:
            logger.error(f"Gitea PR submission failed for {pr_id}: {e}", exc_info=True)
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
                    # We may have branched onto the feature branch (gitea_pr
                    # mode); restore the default branch before resetting so the
                    # workspace is left on its clean default branch.
                    if default_branch:
                        repo.git.checkout(default_branch)
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
                task, new_commit_hash, pr.summary, remote_pr_url, pr
            )
            await git_utils.remove_pr_worktree(pipeline, pr)
            return {
                "status": "success",
                "message": "Pull Request submitted for review",
                "remote_pr_url": remote_pr_url,
            }

        await update_pull_request_status(pr, PullRequestStatus.ACCEPTED)
        await update_task_status(task, new_commit_hash, pr.summary, pr)
        try:
            await git_utils.sweep_completed_pull_requests(pipeline)
        except Exception as cleanup_error:
            # Cleanup is best-effort: the acceptance has already succeeded and
            # must not be turned into an HTTP 500 by a Gitea/git failure.
            logger.warning(
                "Failed to clean up completed pull requests for pipeline %s "
                "after accepting PR %s: %s",
                getattr(pipeline, "id", None),
                pr_id,
                cleanup_error,
            )

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


@router.post("/{pr_id}/iterate")
async def iterate_pull_request(pr_id: str, request: IteratePullRequestRequest):
    """Enqueue a CoderBot session to iterate on an OPEN pull request.

    Validates the PR exists and is OPEN, requires non-empty review comments, then
    hands off to the CoderBot manager which re-runs the agent on a fresh branch
    with the current PR patch applied as unstaged changes. The task status is
    unchanged (it stays PULL_REQUEST_AVAILABLE); only the PR content is updated
    when the session completes."""
    pr = validate_pull_request_exists(pr_id, await PullRequest.get(pr_id))
    validate_pull_request_status(pr)  # only OPEN PRs can be iterated

    comments = (request.comments or "").strip()
    if not comments:
        raise HTTPException(status_code=400, detail="Comments are required to iterate")

    if request.session_uid:
        # Continue the original batch session with its full context instead of
        # starting a fresh iteration run.
        try:
            await coderbot_manager.resume_session(
                request.session_uid, message=comments
            )
        except Exception as e:
            raise HTTPException(status_code=404, detail=str(e))
        return {
            "status": "success",
            "message": "PullRequest iteration enqueued on session",
        }

    await coderbot_manager.process_pr_iteration(pr, comments)
    return {"status": "success", "message": "PullRequest iteration enqueued"}


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
        updated_task = await task_queries.transition_task(
            str(task.id), TaskStatus.CREATED, actor="user"
        )
        # Broadcast the status change so connected clients move the task out of
        # PULL_REQUEST_AVAILABLE and back into the backlog. Without this the
        # transition only exists in the backend and TaskItem stays stale.
        await ws_manager.broadcast(
            WSMessage(
                type="TASK_STATUS_UPDATED",
                payload=updated_task.model_dump(mode="json"),
            )
        )
    try:
        pipeline = await Pipeline.get(pr.pipeline_id)
        if pipeline is not None:
            await git_utils.sweep_completed_pull_requests(pipeline)
    except Exception as e:
        # Cleanup is best-effort and must not fail the rejection request.
        logger.warning(
            "Failed to clean up completed pull requests for rejected PR %s: %s",
            pr.id,
            e,
        )
    return {"status": "success", "message": "Pull Request rejected"}
