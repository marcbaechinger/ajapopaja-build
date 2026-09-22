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

"""WebSocket bridge that streams the dev-process log to the frontend.

This module lives in the ``api`` layer (the ``core`` layer never imports from
``api``) and multiplexes the ``dev_process_*`` message family over the shared
``/ws/{client_id}`` :class:`~api.websocket_manager.ConnectionManager`:

* ``DEV_PROCESS_STARTED`` / ``DEV_PROCESS_EXITED`` are low-frequency lifecycle
  broadcasts sent to **all** connected clients so the running-process indicator
  stays in sync everywhere.
* ``DEV_PROCESS_STATUS`` / ``DEV_PROCESS_LOG`` / ``DEV_PROCESS_STREAM_END`` are
  high-frequency messages sent only to the client that explicitly subscribed via
  ``dev_process_logs_subscribe`` (the ``ProcessIoView``). Each subscription runs
  a small pump bound to the requesting WebSocket, replaying the buffered history
  before tailing.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, Optional, Tuple

from fastapi import WebSocket

from api.websocket_manager import ConnectionManager, WSMessage
from api.websocket_manager import manager as default_manager
from core.services.dev_process_manager import DevProcessManager

logger = logging.getLogger(__name__)

__all__ = [
    "DEV_PROCESS_EXITED",
    "DEV_PROCESS_LOG",
    "DEV_PROCESS_LOGS_SUBSCRIBE",
    "DEV_PROCESS_LOGS_UNSUBSCRIBE",
    "DEV_PROCESS_STARTED",
    "DEV_PROCESS_STATUS",
    "DEV_PROCESS_STREAM_END",
    "handle_dev_process_logs_subscribe",
    "handle_dev_process_logs_unsubscribe",
    "register_dev_process_ws",
]

# -- Message types ---------------------------------------------------------

# Lifecycle broadcasts (server -> all clients).
DEV_PROCESS_STARTED = "DEV_PROCESS_STARTED"
DEV_PROCESS_EXITED = "DEV_PROCESS_EXITED"

# Per-subscription stream messages (server -> subscriber).
DEV_PROCESS_STATUS = "DEV_PROCESS_STATUS"
DEV_PROCESS_LOG = "DEV_PROCESS_LOG"
DEV_PROCESS_STREAM_END = "DEV_PROCESS_STREAM_END"

# Client -> server.
DEV_PROCESS_LOGS_SUBSCRIBE = "dev_process_logs_subscribe"
DEV_PROCESS_LOGS_UNSUBSCRIBE = "dev_process_logs_unsubscribe"

_EVENT_TYPE_MAP = {
    "status": DEV_PROCESS_STATUS,
    "chunk": DEV_PROCESS_LOG,
    "exit": DEV_PROCESS_STREAM_END,
}

# (id(websocket), pipeline_id) -> asyncio.Task
_pumps: Dict[Tuple[int, str], asyncio.Task] = {}


def _pump_key(websocket: WebSocket, pipeline_id: str) -> Tuple[int, str]:
    return (id(websocket), pipeline_id)


def _start_pump(
    websocket: WebSocket, pipeline_id: str, run_id: Optional[str]
) -> asyncio.Task:
    """Starts (replacing any existing) log pump for this socket + pipeline."""
    key = _pump_key(websocket, pipeline_id)
    existing = _pumps.get(key)
    if existing is not None and not existing.done():
        existing.cancel()

    task = asyncio.create_task(_pump_logs(websocket, pipeline_id, run_id))
    _pumps[key] = task

    def _cleanup(_: asyncio.Task) -> None:
        if _pumps.get(key) is task:
            _pumps.pop(key, None)

    task.add_done_callback(_cleanup)
    return task


def _stop_pump(websocket: WebSocket, pipeline_id: str) -> None:
    """Cancels the log pump for this socket + pipeline (if any)."""
    key = _pump_key(websocket, pipeline_id)
    task = _pumps.pop(key, None)
    if task is not None and not task.done():
        task.cancel()


async def _pump_logs(
    websocket: WebSocket, pipeline_id: str, run_id: Optional[str]
) -> None:
    """Forwards one process's stream events to the requesting socket.

    The pump self-terminates when the client goes away (a send failure) or when
    the stream reaches its terminal ``exit`` event.
    """
    manager = DevProcessManager.instance()
    try:
        async for event in manager.stream(pipeline_id, run_id):
            message_type = _EVENT_TYPE_MAP.get(event.get("type"))
            if message_type is None:
                continue
            payload = {**event, "pipeline_id": pipeline_id}
            try:
                await websocket.send_text(
                    WSMessage(type=message_type, payload=payload).model_dump_json()
                )
            except Exception:  # noqa: BLE001 - client gone -> stop pumping
                logger.debug(
                    "Dev-process log pump for %s stopped: client disconnected.",
                    pipeline_id,
                )
                return
    except asyncio.CancelledError:
        raise
    except Exception:  # noqa: BLE001 - never let a pump crash the loop
        logger.warning(
            "Dev-process log pump for %s failed.", pipeline_id, exc_info=True
        )


async def handle_dev_process_logs_subscribe(
    message: WSMessage, websocket: WebSocket
) -> None:
    """Handles ``dev_process_logs_subscribe``: starts the log pump."""
    payload: Dict[str, Any] = dict(message.payload or {})
    pipeline_id = payload.get("pipeline_id")
    if not pipeline_id:
        return
    run_id = payload.get("run_id")
    _start_pump(websocket, str(pipeline_id), run_id)


async def handle_dev_process_logs_unsubscribe(
    message: WSMessage, websocket: WebSocket
) -> None:
    """Handles ``dev_process_logs_unsubscribe``: cancels the log pump."""
    payload: Dict[str, Any] = dict(message.payload or {})
    pipeline_id = payload.get("pipeline_id")
    if not pipeline_id:
        return
    _stop_pump(websocket, str(pipeline_id))


def register_dev_process_ws(
    cm: Optional[ConnectionManager] = None,
) -> ConnectionManager:
    """Wires the manager lifecycle sink and the subscribe handlers into ``cm``.

    Args:
        cm: Connection manager to register with. Defaults to the process-wide
            :data:`api.websocket_manager.manager`.

    Returns:
        The manager the handlers were registered on.
    """
    cm = cm if cm is not None else default_manager

    async def _broadcast_sink(event_type: str, payload: dict) -> None:
        await cm.broadcast(WSMessage(type=event_type, payload=payload))

    DevProcessManager.set_event_sink(_broadcast_sink)
    cm.register_handler(DEV_PROCESS_LOGS_SUBSCRIBE, handle_dev_process_logs_subscribe)
    cm.register_handler(
        DEV_PROCESS_LOGS_UNSUBSCRIBE, handle_dev_process_logs_unsubscribe
    )
    logger.debug("Registered dev-process WebSocket handlers.")
    return cm
