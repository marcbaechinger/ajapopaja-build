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
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from api.auth import get_current_user
from api.git_hosting.branch_notifier import PrStateNotifier
from api.git_hosting.pr_poller import reconcile_pipeline_pull_requests
from api.git_hosting.pull_requests import ensure_pr_state_webhook_best_effort
from api.websocket_manager import WSMessage, manager
from core.exceptions import EntityNotFoundError
from core.models.models import (
    BuildArtifactSpec,
    GitLogEntry,
    GitStatusInfo,
    Pipeline,
    PipelineStatus,
    User,
)
from core.queries import pipeline as pipeline_queries
from core.queries import task as task_queries
from core.services.model_resolver import list_coderbot_models, list_ollama_models
from core.utils import git_utils

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/pipelines", tags=["pipelines"])


class PipelineUpdateRequest(BaseModel):
    """PATCH body for a pipeline, including the per-use-case model overrides.

    A Pydantic request model (rather than individual ``Body`` params) is used so
    an explicitly ``null`` model override can be distinguished from an omitted
    one and therefore clear the stored override.
    """

    version: int
    name: Optional[str] = None
    status: Optional[PipelineStatus] = None
    workspace_path: Optional[str] = None
    repo_uri: Optional[str] = None
    repo_username: Optional[str] = None
    repo_token: Optional[str] = None
    doc_root: Optional[str] = None
    test_commands: Optional[List[List[str]]] = None
    lint_commands: Optional[List[List[str]]] = None
    serve_commands: Optional[List[List[str]]] = None
    build_commands: Optional[List[List[str]]] = None
    build_artifact: Optional[BuildArtifactSpec] = None
    ollama_model: Optional[str] = None
    one_prompt_model: Optional[str] = None
    assistant_model: Optional[str] = None
    archbot_model: Optional[str] = None
    reviewbot_model: Optional[str] = None
    docbot_model: Optional[str] = None
    specagent_model: Optional[str] = None
    coderbot_model: Optional[str] = None


class ModelOptionsResponse(BaseModel):
    """Select-list data for the pipeline model configuration dialog."""

    ollama: List[str] = Field(default_factory=list)
    coderbot: List[str] = Field(default_factory=list)
    error: Optional[str] = None


@router.get("/", response_model=List[Pipeline])
async def get_pipelines(
    include_deleted: bool = False, current_user: User = Depends(get_current_user)
):
    return await pipeline_queries.get_all_pipelines(include_deleted)


@router.post("/", response_model=Pipeline)
async def create_pipeline(
    pipeline: Pipeline, current_user: User = Depends(get_current_user)
):
    pipeline_queries.validate_pipeline_input(pipeline)
    new_pipeline = await pipeline_queries.create_pipeline(pipeline)
    await manager.broadcast(
        WSMessage(type="PIPELINE_CREATED", payload=new_pipeline.model_dump(mode="json"))
    )
    # Best-effort: register the Gitea PR-state webhook for remote pipelines so
    # a later merge/reject can be reconciled back to local state. Never blocks
    # pipeline creation on webhook registration failure.
    await ensure_pr_state_webhook_best_effort(new_pipeline)
    return new_pipeline


@router.get("/{pipeline_id}", response_model=Pipeline)
async def get_pipeline(
    pipeline_id: str,
    include_deleted: bool = False,
    current_user: User = Depends(get_current_user),
):
    return await pipeline_queries.get_pipeline_by_id(pipeline_id, include_deleted)


@router.patch("/{pipeline_id}", response_model=Pipeline)
async def update_pipeline(
    pipeline_id: str,
    request: PipelineUpdateRequest,
    current_user: User = Depends(get_current_user),
):
    # Only forward fields the client actually sent so a partial PATCH does not
    # clear unrelated values (while an explicit ``null`` still clears a model
    # override).
    provided = request.model_dump(exclude_unset=True)
    version = provided.pop("version")
    updated_pipeline = await pipeline_queries.update_pipeline(
        pipeline_id, version, **provided
    )

    await manager.broadcast(
        WSMessage(
            type="PIPELINE_UPDATED", payload=updated_pipeline.model_dump(mode="json")
        )
    )
    return updated_pipeline


@router.get("/{pipeline_id}/model-options", response_model=ModelOptionsResponse)
async def get_model_options(
    pipeline_id: str,
    current_user: User = Depends(get_current_user),
):
    """Return the select-list model options for the pipeline edit dialog.

    ``ollama`` lists the tags reported by the configured Ollama server and
    ``coderbot`` the pi-agent model ids from ``models.json``. Both catalog
    helpers degrade to an empty list instead of raising so the dialog still
    renders.
    """
    try:
        ollama_models = await list_ollama_models()
    except Exception as exc:  # pragma: no cover - the helper never raises
        return ModelOptionsResponse(error=f"Failed to list Ollama models: {exc}")

    try:
        coderbot_models = list_coderbot_models()
    except Exception as exc:  # pragma: no cover - the helper never raises
        return ModelOptionsResponse(
            ollama=ollama_models,
            error=f"Failed to list CoderBot models: {exc}",
        )

    return ModelOptionsResponse(ollama=ollama_models, coderbot=coderbot_models)


@router.delete("/{pipeline_id}")
async def delete_pipeline(
    pipeline_id: str, current_user: User = Depends(get_current_user)
):
    await pipeline_queries.delete_pipeline(pipeline_id)
    await manager.broadcast(
        WSMessage(type="PIPELINE_DELETED", payload={"pipeline_id": pipeline_id})
    )
    return {"status": "ok"}


@router.post("/{pipeline_id}/run/lint", response_model=dict)
async def run_lint(
    pipeline_id: str,
    current_user: User = Depends(get_current_user),
):
    """Run the configured lint commands for a pipeline asynchronously.

    When the pipeline has no lint commands defined, returns a ``no_commands``
    status immediately. Otherwise the command sequence is dispatched via the
    shared ``CommandRunner`` in a background task (so the call returns promptly)
    and the aggregate result is reported back through the registered completion
    handler when it finishes.
    """
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    commands = [c for c in (pipeline.lint_commands or []) if isinstance(c, list) and c]
    return await _run_pipeline_commands(pipeline_id, commands, kind="lint")


@router.post("/{pipeline_id}/run/build", response_model=dict)
async def run_build(
    pipeline_id: str,
    current_user: User = Depends(get_current_user),
):
    """Run the configured build commands for a pipeline asynchronously.

    When the pipeline has no build commands defined, returns a ``no_commands``
    status immediately. Otherwise the command sequence is dispatched via the
    shared ``CommandRunner`` in a background task (so the call returns promptly)
    and the aggregate result is reported back through the registered completion
    handler when it finishes.
    """
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    commands = [c for c in (pipeline.build_commands or []) if isinstance(c, list) and c]
    return await _run_pipeline_commands(pipeline_id, commands, kind="build")


@router.post("/{pipeline_id}/run/test", response_model=dict)
async def run_test(
    pipeline_id: str,
    current_user: User = Depends(get_current_user),
):
    """Run the configured test commands for a pipeline asynchronously.

    When the pipeline has no test commands defined, returns a ``no_commands``
    status immediately. Otherwise the command sequence is dispatched via the
    shared ``CommandRunner`` in a background task (so the call returns promptly)
    and the aggregate result is reported back through the registered completion
    handler when it finishes.
    """
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    commands = [c for c in (pipeline.test_commands or []) if isinstance(c, list) and c]
    return await _run_pipeline_commands(pipeline_id, commands, kind="test")


async def _run_pipeline_commands(
    pipeline_id: str, commands: List[List[str]], kind: str = "build"
) -> Dict:
    """Dispatches a command sequence for a pipeline via the shared CommandRunner.

    Returns immediately with a ``started`` status and a ``run_id``; the result
    is delivered asynchronously through the runner's completion handler. Build
    runs additionally broadcast a ``BUILD_RUN_COMPLETED`` WebSocket message so
    REST-initiated builds report their result to the UI. When ``commands`` is
    empty, returns a ``no_commands`` status.
    """
    if not commands:
        return {
            "status": "no_commands",
            "pipeline_id": pipeline_id,
        }

    import asyncio
    import uuid

    from api.assistant.tools.command_runner import CommandRunner

    # Resolve the workspace working directory (cloning remote repos on first
    # use). Commands run against the pipeline workspace.
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    _, _repo = await git_utils.get_pipeline_and_repo(pipeline_id)
    workspace_path = str(pipeline.workspace_abs_path)

    run_id = uuid.uuid4().hex

    if kind == "build":

        async def _broadcast_build_completed(
            results: Dict, _tool_ref: Optional[Dict] = None
        ) -> None:
            await manager.broadcast(
                WSMessage(
                    type="BUILD_RUN_COMPLETED",
                    payload={
                        "run_id": results.get("run_id", run_id),
                        "passed": results.get("passed"),
                        "commands": results.get("commands", []),
                        "error": results.get("error"),
                    },
                )
            )

        CommandRunner.register_on_complete(run_id, _broadcast_build_completed)

    asyncio.create_task(CommandRunner.dispatch(run_id, commands, workspace_path))

    return {
        "status": "started",
        "run_id": run_id,
        "message": f"Command run for pipeline {pipeline_id} started; "
        "result will be reported when complete.",
    }


@router.get("/{pipeline_id}/stats/daily")
async def get_daily_pipeline_stats(
    pipeline_id: str, current_user: User = Depends(get_current_user)
):
    return await task_queries.get_daily_stats(pipeline_id)


@router.post("/{pipeline_id}/drop_top_commit", response_model=dict)
async def drop_top_commit(
    pipeline_id: str,
    current_user: User = Depends(get_current_user),
):
    """Drop the topmost local commit that has not been pushed to the remote."""
    msg = await git_utils.drop_top_commit(pipeline_id)
    return {"status": "ok", "message": msg}


@router.post("/{pipeline_id}/pull_requests/sync", response_model=dict)
async def sync_pipeline_pull_requests(
    pipeline_id: str,
    current_user: User = Depends(get_current_user),
):
    """Force an outbound reconciliation of this pipeline's Gitea PR state.

    Webhook delivery is not durable, so a merge/reject on Gitea can be missed
    while the backend restarts or when a hook is misconfigured. This endpoint
    lets a user pull the current remote state on demand and mirror it onto the
    local ``PullRequest``/``Task`` records. It reuses the same notifier/poller
    code path as the background reconciler and only acts on ``SUBMITTED`` PRs,
    so it is safe to call repeatedly.

    Returns a JSON summary (``up_to_date`` and a per-PR ``reconciled`` list) or
    a clear status such as ``busy`` / ``already_running`` / ``sync_failed``
    instead of a 500 when the reconciliation could not proceed.
    """
    notifier = PrStateNotifier()
    try:
        result = await reconcile_pipeline_pull_requests(notifier, pipeline_id)
    except Exception as exc:
        logger.error(
            "On-demand PR sync failed for pipeline %s: %s",
            pipeline_id,
            exc,
            exc_info=True,
        )
        return {
            "status": "sync_failed",
            "up_to_date": False,
            "reconciled": [],
        }

    if result.get("status") == "not_found":
        raise HTTPException(status_code=404, detail="Pipeline not found")
    return result


@router.post("/{pipeline_id}/pull", response_model=dict)
async def pull_pipeline(
    pipeline_id: str,
    current_user: User = Depends(get_current_user),
):
    """Pull the latest changes from the remote origin into the working tree."""
    msg = await git_utils.pull(pipeline_id)
    return {"status": "ok", "message": msg}


class CommitDiff(BaseModel):
    commit_hash: str
    patch: str
    subject: Optional[str] = None
    message: Optional[str] = None
    author: Optional[str] = None
    created_at: Optional[str] = None


@router.get("/{pipeline_id}/commits/{commit_hash}/diff", response_model=CommitDiff)
async def get_commit_diff(
    pipeline_id: str,
    commit_hash: str,
    current_user: User = Depends(get_current_user),
):
    """Return the diff of a single commit so the UI can render it in a dialog."""
    return await git_utils.get_commit_diff(pipeline_id, commit_hash)


class GitLogResponse(BaseModel):
    commits: List[GitLogEntry] = Field(default_factory=list)
    total: int = 0
    error: Optional[str] = None


@router.get("/{pipeline_id}/git-status", response_model=GitStatusInfo)
async def get_pipeline_git_status(
    pipeline_id: str,
    current_user: User = Depends(get_current_user),
):
    """Return the pipeline repository's working-tree and remote-sync status.

    This is a read-only endpoint: it never fetches, pulls or modifies the
    repository. Git failures are reported through the ``error`` field so the
    dialog can render a clear message instead of crashing.
    """
    try:
        return await git_utils.get_pipeline_git_status(pipeline_id)
    except EntityNotFoundError:
        raise
    except Exception as e:
        return GitStatusInfo(error=f"Failed to read repository status: {e}")


@router.get("/{pipeline_id}/git-log", response_model=GitLogResponse)
async def get_pipeline_git_log(
    pipeline_id: str,
    limit: int = 50,
    offset: int = 0,
    current_user: User = Depends(get_current_user),
):
    """Return the pipeline repository's compact Git log (read-only).

    ``limit``/``offset`` page through the history; ``total`` reports the total
    number of commits on the branch so the client can render pagination. A
    repository without commits yields an empty list and ``total=0``. Git
    failures are reported through the ``error`` field.
    """
    try:
        commits = await git_utils.get_pipeline_git_log(pipeline_id, limit, offset)
        total = await git_utils.get_pipeline_git_log_total(pipeline_id)
        return GitLogResponse(commits=commits, total=total)
    except EntityNotFoundError:
        raise
    except Exception as e:
        return GitLogResponse(error=f"Failed to read repository history: {e}")
