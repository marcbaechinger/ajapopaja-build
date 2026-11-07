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

"""REST endpoints that manage the background dev process of a pipeline.

The router is a thin HTTP layer: all process logic lives in
:class:`core.services.dev_process_manager.DevProcessManager`, so agent tools
and other modules can drive the same process through the service API.
"""

from fastapi import APIRouter, Depends, HTTPException, status

from api.assistant.tools.command_runner import run_command_sequence
from api.auth import get_current_user
from core.exceptions import EntityNotFoundError
from core.models.models import PullRequest, PullRequestStatus, User
from core.queries import pipeline as pipeline_queries
from core.services.dev_process_manager import (
    DevProcessAlreadyRunningError,
    DevProcessError,
    DevProcessManager,
    DevProcessNotFoundError,
)
from core.utils import git_utils

router = APIRouter(prefix="/pipelines/{pipeline_id}/dev", tags=["dev"])

# Pull-request-scoped dev-server start endpoint. It uses a different prefix
# because it is keyed by both a pipeline and one of its pull requests.
pr_dev_router = APIRouter(tags=["dev"])


@router.get("/status", response_model=dict)
async def dev_status(pipeline_id: str, current_user: User = Depends(get_current_user)):
    """Return the status of the pipeline's dev process.

    The response includes ``port`` (the container port the dev server is
    expected to listen on, published to the host via docker-compose),
    ``phase`` (the raw manager phase) and ``build_commands_configured`` so the
    dialog can decide whether a rebuild is possible.
    """
    result = await DevProcessManager.instance().status(pipeline_id)
    try:
        pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    except EntityNotFoundError:
        # Preserve the historical behaviour of the status endpoint: a missing
        # pipeline is not an error here, it simply has no build commands.
        result["build_commands_configured"] = False
    else:
        result["build_commands_configured"] = bool(
            [c for c in (pipeline.build_commands or []) if isinstance(c, list) and c]
        )
    return result


@router.post("/start", response_model=dict)
async def dev_start(pipeline_id: str, current_user: User = Depends(get_current_user)):
    """Start the pipeline's dev process using its ``serve_commands``.

    The child process receives ``DEV_SERVER_PORT``/``PORT`` so it binds to the
    published dev-server port; the response includes that ``port``.
    """
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    commands = pipeline.serve_commands or []
    if not commands:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No serve commands configured",
        )
    try:
        return await DevProcessManager.instance().start(
            pipeline_id, commands, current_user.username
        )
    except DevProcessAlreadyRunningError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    except DevProcessError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


async def _stop_and_start_on_default(pipeline_id: str, username: str):
    """Stop any running dev process and start it on the default branch.

    The default branch is the pipeline's own workspace: for remote pipelines
    ``start`` resolves and fast-forwards that checkout to ``origin``'s default
    branch, and for local pipelines it is the workspace the pipeline already
    points at. Shared by ``restart`` and ``default-branch``.
    """
    manager = DevProcessManager.instance()
    try:
        await manager.stop(pipeline_id)
    except DevProcessNotFoundError:
        # Nothing running: the start below behaves like a fresh start.
        pass

    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    commands = pipeline.serve_commands or []
    if not commands:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No serve commands configured",
        )
    try:
        return await manager.start(pipeline_id, commands, username)
    except DevProcessAlreadyRunningError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    except DevProcessError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/rebuild", response_model=dict)
async def dev_rebuild(pipeline_id: str, current_user: User = Depends(get_current_user)):
    """Rebuild and restart the dev process in its current workspace.

    The pipeline's configured ``build_commands`` run in the exact workspace of
    the currently tracked process (which may be a pull-request worktree or a
    retained sandbox), then the original serve commands are restarted there.
    """
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    build_commands = [
        c for c in (pipeline.build_commands or []) if isinstance(c, list) and c
    ]
    if not build_commands:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No build commands configured",
        )
    try:
        return await DevProcessManager.instance().rebuild(
            pipeline_id, build_commands, current_user.username
        )
    except DevProcessNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except DevProcessAlreadyRunningError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    except DevProcessError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/restart", response_model=dict)
async def dev_restart(pipeline_id: str, current_user: User = Depends(get_current_user)):
    """Restart the pipeline's dev process (stop then start).

    The response includes the published dev-server ``port``.
    """
    return await _stop_and_start_on_default(pipeline_id, current_user.username)


@router.post("/default-branch", response_model=dict)
async def dev_default_branch(
    pipeline_id: str, current_user: User = Depends(get_current_user)
):
    """Transition the dev process back onto the pipeline's default branch.

    Useful when the server is running on a pull-request branch: this stops the
    PR-scoped process and starts the pipeline's ``serve_commands`` in the
    default workspace again. The response includes the published dev-server
    ``port``.
    """
    return await _stop_and_start_on_default(pipeline_id, current_user.username)


@router.post("/stop", response_model=dict)
async def dev_stop(pipeline_id: str, current_user: User = Depends(get_current_user)):
    """Stop the pipeline's dev process."""
    try:
        return await DevProcessManager.instance().stop(pipeline_id)
    except DevProcessNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))


@pr_dev_router.post(
    "/pipelines/{pipeline_id}/pull_requests/{pr_id}/dev/start",
    response_model=dict,
)
async def dev_start_on_pr(
    pipeline_id: str,
    pr_id: str,
    current_user: User = Depends(get_current_user),
):
    """Start the pipeline's dev process on top of a pull request's branch.

    The PR's code is resolved into a working directory (retained sandbox,
    existing feature branch or patch fallback), the pipeline's ``build_commands``
    are run there, and then the pipeline's ``serve_commands`` are started with
    that directory as the working directory. A start always tears down any
    currently-running dev process for the pipeline first (switch semantics).
    """
    pr = await PullRequest.get(pr_id)
    if not pr:
        raise HTTPException(status_code=404, detail="Pull Request not found")
    if pr.pipeline_id != pipeline_id:
        raise HTTPException(
            status_code=404,
            detail="Pull Request not found for this pipeline",
        )
    if pr.status not in (PullRequestStatus.OPEN, PullRequestStatus.SUBMITTED):
        raise HTTPException(
            status_code=400,
            detail=(
                "Dev server can only be started on OPEN or SUBMITTED pull requests"
            ),
        )

    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    commands = pipeline.serve_commands or []
    if not commands:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No serve commands configured",
        )

    workspace, target = await git_utils.resolve_pr_workspace(pipeline, pr)

    # Build the freshly materialised checkout before serving. A failed build
    # aborts the start (422) and leaves any previous server running.
    build_commands = [
        c for c in (pipeline.build_commands or []) if isinstance(c, list) and c
    ]
    if build_commands:
        build_result = await run_command_sequence(
            build_commands, workspace, kind="build"
        )
        if not build_result.get("passed", True):
            output = "\n".join(
                f"{c['cmd']}: exit {c['exit_code']}\n{c.get('output_tail', '')}"
                for c in build_result.get("commands", [])
            )
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=f"Build failed:\n{output}",
            )

    manager = DevProcessManager.instance()
    try:
        await manager.stop(pipeline_id)
    except DevProcessNotFoundError:
        # Nothing running: a PR-scoped start behaves like a fresh start.
        pass

    try:
        return await manager.start(
            pipeline_id,
            commands,
            current_user.username,
            workspace=workspace,
            target=target,
            task_id=str(pr.task_id),
        )
    except DevProcessAlreadyRunningError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    except DevProcessError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
