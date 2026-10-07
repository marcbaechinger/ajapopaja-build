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

from datetime import UTC, datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from api.auth import get_current_user
from api.websocket_manager import WSMessage, manager as ws_manager
from core.models.models import (
    PiSessionKind,
    PiSessionStatus,
    Pipeline,
    Task,
)

from .manager import (
    InteractiveSessionAlreadyActiveError,
    InteractiveSessionBusyError,
    InteractiveSessionNotSupportedError,
    NoActiveInteractiveSessionError,
    PiSessionNotFoundError,
    PiSessionNotResumableError,
    coderbot_manager,
)
from .pi_session_store import read_session_events
from .session import read_task_session_history

router = APIRouter(
    prefix="/coderbot",
    tags=["coderbot"],
    dependencies=[Depends(get_current_user)],
)


class InteractiveMessageRequest(BaseModel):
    """Request body for sending a user message to an interactive session."""

    message: str


class CreateSessionRequest(BaseModel):
    """Request body for creating a new durable Pi session."""

    pipeline_id: str
    kind: PiSessionKind = PiSessionKind.INTERACTIVE
    label: Optional[str] = None


class SessionMessageRequest(BaseModel):
    """Request body for sending a follow-up message to a session."""

    message: str


class UpdateSessionRequest(BaseModel):
    """Request body for updating the mutable fields of a session."""

    label: Optional[str] = None


class ResumeSessionRequest(BaseModel):
    """Optional follow-up instruction supplied while resuming a batch session."""

    message: Optional[str] = None


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
    events = await read_task_session_history(task_id)
    return {"task_id": task_id, "events": events}


@router.post("/trigger/{task_id}")
async def trigger_coderbot(task_id: str):
    task = await Task.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    # The SCHEDULED|CREATED -> INPROGRESS transition is performed while enqueueing
    # (CoderBotManager.process_task) so a queued task immediately leaves the
    # backlog. CoderBotSession.run() keeps the same transition as a fallback for
    # sessions started outside the manager.
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
# Durable Pi sessions
# ---------------------------------------------------------------------------


def _session_payload(record) -> dict:
    """Serialize a PiSession record for the API."""
    return record.model_dump(mode="json")


@router.get("/sessions")
async def list_sessions(
    kind: Optional[PiSessionKind] = Query(None),
    status: Optional[PiSessionStatus] = Query(None),
    pipeline_id: Optional[str] = Query(None),
):
    """List durable Pi sessions, newest first."""
    records = await coderbot_manager.list_sessions(
        kind=kind, status=status, pipeline_id=pipeline_id
    )
    return {"sessions": [_session_payload(record) for record in records]}


@router.post("/sessions", status_code=201)
async def create_session(request: CreateSessionRequest):
    """Create a new durable Pi session."""
    pipeline = await Pipeline.get(request.pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    if request.kind == PiSessionKind.CODERBOT:
        raise HTTPException(
            status_code=400,
            detail="Batch sessions are created by triggering a task.",
        )

    try:
        record = await coderbot_manager.create_interactive_session(pipeline)
    except InteractiveSessionAlreadyActiveError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except InteractiveSessionNotSupportedError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if request.label:
        record.label = request.label
        await record.save()
    return _session_payload(record)


async def _get_session_or_404(uid: str):
    record = await coderbot_manager.get_session(uid)
    if record is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return record


@router.get("/sessions/{uid}")
async def get_session(uid: str):
    """Return the details of a durable Pi session."""
    record = await _get_session_or_404(uid)
    return _session_payload(record)


@router.patch("/sessions/{uid}")
async def update_session(uid: str, request: UpdateSessionRequest):
    """Update the mutable fields (currently the label) of a session."""
    record = await _get_session_or_404(uid)
    if request.label is not None:
        record.label = request.label
    record.updated_at = datetime.now(UTC)
    await record.save()

    payload = _session_payload(record)
    await ws_manager.broadcast(WSMessage(type="SESSION_UPDATED", payload=payload))
    return payload


@router.post("/sessions/{uid}/pause")
async def pause_session(uid: str):
    """Persist and stop a session, keeping it resumable."""
    try:
        paused = await coderbot_manager.pause_session(uid)
    except PiSessionNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    if not paused:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"status": "success", "message": "Session paused"}


@router.post("/sessions/{uid}/resume")
async def resume_session(uid: str, request: Optional[ResumeSessionRequest] = None):
    """Respawn Pi with the session's stored native session file."""
    try:
        record = await coderbot_manager.resume_session(
            uid, message=request.message if request else None
        )
    except PiSessionNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PiSessionNotResumableError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _session_payload(record)


@router.post("/sessions/{uid}/message", status_code=202)
async def send_session_message(uid: str, request: SessionMessageRequest):
    """Send a follow-up prompt to a running session (or resume a batch one)."""
    try:
        await coderbot_manager.send_session_message(uid, request.message)
    except PiSessionNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except NoActiveInteractiveSessionError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except PiSessionNotResumableError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except InteractiveSessionBusyError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return {"status": "success", "message": "Message sent"}


@router.post("/sessions/{uid}/discard")
async def discard_session(uid: str):
    """Stop a session and release its workspace and Pi session file."""
    try:
        discarded = await coderbot_manager.discard_session(uid)
    except PiSessionNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    if not discarded:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"status": "success", "message": "Session discarded"}


@router.get("/sessions/{uid}/history")
async def get_session_history(uid: str):
    """Replay the persisted raw RPC events of a durable session."""
    return {"session_uid": uid, "events": read_session_events(uid)}


@router.get("/sessions/{uid}/messages")
async def get_session_messages(uid: str):
    """Return the final ``AgentMessage[]`` for a live session (best effort)."""
    handle = coderbot_manager._sessions.get(uid)
    session = handle.session if handle else None
    if session is None or getattr(session, "process", None) is None:
        return {"session_uid": uid, "messages": []}
    try:
        response = await session.send_command("get_messages")
    except Exception:
        return {"session_uid": uid, "messages": []}
    data = response.get("data", {}) if isinstance(response, dict) else {}
    messages = data.get("messages", []) if isinstance(data, dict) else []
    return {"session_uid": uid, "messages": messages}


# ---------------------------------------------------------------------------
# Interactive Pi session (legacy single-slot API)
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
