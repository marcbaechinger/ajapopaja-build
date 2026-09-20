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

from api.auth import get_current_user
from core.models.models import User
from core.queries import pipeline as pipeline_queries
from core.services.dev_process_manager import (
    DevProcessAlreadyRunningError,
    DevProcessError,
    DevProcessManager,
    DevProcessNotFoundError,
)

router = APIRouter(prefix="/pipelines/{pipeline_id}/dev", tags=["dev"])


@router.get("/status", response_model=dict)
async def dev_status(pipeline_id: str, current_user: User = Depends(get_current_user)):
    """Return the status of the pipeline's dev process.

    The response includes ``port`` (the container port the dev server is
    expected to listen on, published to the host via docker-compose).
    """
    return await DevProcessManager.instance().status(pipeline_id)


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
        return await DevProcessManager.instance().start(pipeline_id, commands)
    except DevProcessAlreadyRunningError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    except DevProcessError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/restart", response_model=dict)
async def dev_restart(pipeline_id: str, current_user: User = Depends(get_current_user)):
    """Restart the pipeline's dev process (stop then start).

    The response includes the published dev-server ``port``.
    """
    manager = DevProcessManager.instance()
    try:
        await manager.stop(pipeline_id)
    except DevProcessNotFoundError:
        # Nothing running: restart behaves like start.
        pass

    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    commands = pipeline.serve_commands or []
    if not commands:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No serve commands configured",
        )
    try:
        return await manager.start(pipeline_id, commands)
    except DevProcessAlreadyRunningError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    except DevProcessError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/stop", response_model=dict)
async def dev_stop(pipeline_id: str, current_user: User = Depends(get_current_user)):
    """Stop the pipeline's dev process."""
    try:
        return await DevProcessManager.instance().stop(pipeline_id)
    except DevProcessNotFoundError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
