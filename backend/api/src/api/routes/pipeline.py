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

from typing import Dict, List, Optional

from fastapi import APIRouter, Body, Depends
from pydantic import BaseModel, Field

from api.auth import get_current_user
from api.websocket_manager import WSMessage, manager
from core.exceptions import EntityNotFoundError
from core.models.models import (
    GitLogEntry,
    GitStatusInfo,
    Pipeline,
    PipelineStatus,
    User,
)
from core.queries import pipeline as pipeline_queries
from core.queries import task as task_queries
from core.utils import git_utils

router = APIRouter(prefix="/pipelines", tags=["pipelines"])


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
    version: int = Body(..., embed=True),
    name: Optional[str] = Body(None, embed=True),
    status: Optional[PipelineStatus] = Body(None, embed=True),
    workspace_path: Optional[str] = Body(None, embed=True),
    repo_uri: Optional[str] = Body(None, embed=True),
    repo_username: Optional[str] = Body(None, embed=True),
    repo_token: Optional[str] = Body(None, embed=True),
    doc_root: Optional[str] = Body(None, embed=True),
    test_commands: Optional[List[List[str]]] = Body(None, embed=True),
    lint_commands: Optional[List[List[str]]] = Body(None, embed=True),
    serve_commands: Optional[List[List[str]]] = Body(None, embed=True),
    build_commands: Optional[List[List[str]]] = Body(None, embed=True),
    current_user: User = Depends(get_current_user),
):
    updated_pipeline = await pipeline_queries.update_pipeline(
        pipeline_id,
        version,
        name=name,
        status=status,
        workspace_path=workspace_path,
        repo_uri=repo_uri,
        repo_username=repo_username,
        repo_token=repo_token,
        doc_root=doc_root,
        test_commands=test_commands,
        lint_commands=lint_commands,
        serve_commands=serve_commands,
        build_commands=build_commands,
    )

    await manager.broadcast(
        WSMessage(
            type="PIPELINE_UPDATED", payload=updated_pipeline.model_dump(mode="json")
        )
    )
    return updated_pipeline


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
    return await _run_pipeline_commands(pipeline_id, commands)


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
    return await _run_pipeline_commands(pipeline_id, commands)


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
    return await _run_pipeline_commands(pipeline_id, commands)


async def _run_pipeline_commands(pipeline_id: str, commands: List[List[str]]) -> Dict:
    """Dispatches a command sequence for a pipeline via the shared CommandRunner.

    Returns immediately with a ``started`` status and a ``run_id``; the result
    is delivered asynchronously through the runner's completion handler. When
    ``commands`` is empty, returns a ``no_commands`` status.
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


class CommitDiff(BaseModel):
    commit_hash: str
    patch: str
    subject: Optional[str] = None
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
    current_user: User = Depends(get_current_user),
):
    """Return the pipeline repository's compact Git log (read-only).

    A repository without commits yields an empty list. Git failures are
    reported through the ``error`` field.
    """
    try:
        commits = await git_utils.get_pipeline_git_log(pipeline_id, limit)
        return GitLogResponse(commits=commits)
    except EntityNotFoundError:
        raise
    except Exception as e:
        return GitLogResponse(error=f"Failed to read repository history: {e}")
