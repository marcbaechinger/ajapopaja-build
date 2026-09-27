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

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.auth import get_current_user
from core.models.models import Pipeline, Task

from .manager import (
    InteractiveSessionAlreadyActiveError,
    InteractiveSessionBusyError,
    InteractiveSessionNotSupportedError,
    NoActiveInteractiveSessionError,
    coderbot_manager,
)
from .session import read_session_history

router = APIRouter(
    prefix="/coderbot",
    tags=["coderbot"],
    dependencies=[Depends(get_current_user)],
)


class InteractiveMessageRequest(BaseModel):
    """Request body for sending a user message to an interactive session."""

    message: str


@router.get("/session")
async def get_coderbot_session():
    """Return the current (or last) CoderBot session so the UI can re-attach."""
    return coderbot_manager.get_active_session()


@router.get("/session/{task_id}/history")
async def get_coderbot_session_history(task_id: str):
    """Replay the persisted RPC events of a CoderBot session for a task.

    The session start time is deliberately not read back from the log files here.
    It is delivered (cheaply, straight from the in-memory manager) via the
    ``/coderbot/session`` endpoint for the active (or last) session, so history
    replay avoids the extra file scan that a start-time lookup would require.
    """
    events = read_session_history(task_id)
    return {"task_id": task_id, "events": events}


@router.post("/trigger/{task_id}")
async def trigger_coderbot(task_id: str):
    task = await Task.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # Note: enqueueing the session does NOT transition the task status. The
    # SCHEDULED|CREATED -> INPROGRESS transition (and its TASK_STATUS_UPDATED
    # broadcast) happens in CoderBotSession.run(), when execution actually starts.
    await coderbot_manager.process_task(task)
    return {"status": "success", "message": "CoderBot enqueued"}


@router.post("/stop/{task_id}")
async def stop_coderbot(task_id: str):
    stopped = coderbot_manager.stop_session(task_id)
    if not stopped:
        raise HTTPException(
            status_code=404, detail="Active session not found for this task"
        )
    return {"status": "success", "message": "CoderBot termination signaled"}


# ---------------------------------------------------------------------------
# Interactive Pi session (user-driven, long-lived, runs in the remote repo)
# ---------------------------------------------------------------------------


@router.get("/interactive/session")
async def get_interactive_session():
    """Return the active interactive session so the UI can re-attach, or null."""
    return coderbot_manager.get_interactive_session()


@router.post("/interactive/start/{pipeline_id}", status_code=202)
async def start_interactive_session(pipeline_id: str):
    """Start an interactive Pi session for a remote pipeline repository."""
    pipeline = await Pipeline.get(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    try:
        return await coderbot_manager.start_interactive_session(pipeline)
    except InteractiveSessionAlreadyActiveError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except InteractiveSessionNotSupportedError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/interactive/message", status_code=202)
async def send_interactive_message(request: InteractiveMessageRequest):
    """Send a user message to the active interactive session."""
    try:
        await coderbot_manager.send_interactive_message(request.message)
    except NoActiveInteractiveSessionError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except InteractiveSessionBusyError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return {"status": "success", "message": "Message sent"}


@router.post("/interactive/stop")
async def stop_interactive_session():
    """Stop the active interactive session."""
    stopped = await coderbot_manager.stop_interactive_session()
    if not stopped:
        raise HTTPException(status_code=404, detail="No active interactive session")
    return {"status": "success", "message": "Interactive session stopped"}
