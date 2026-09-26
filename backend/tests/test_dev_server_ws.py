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

"""Tests for the dev-process WebSocket bridge.

Covers handler registration, lifecycle broadcast wiring, and the per-subscription
log pump (start on subscribe, forward typed messages, cancel on unsubscribe, and
self-terminate on a send failure), using a mocked ``DevProcessManager.stream``.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from api import dev_server_ws
from api.dev_server_ws import (
    DEV_PROCESS_LOG,
    DEV_PROCESS_LOGS_SUBSCRIBE,
    DEV_PROCESS_LOGS_UNSUBSCRIBE,
    DEV_PROCESS_STARTED,
    DEV_PROCESS_STATUS,
    DEV_PROCESS_STREAM_END,
    register_dev_process_ws,
)
from api.websocket_manager import ConnectionManager
from core.services.dev_process_manager import DevProcessManager


@pytest.fixture(autouse=True)
def clean_dev_ws_state():
    """Resets pumps and manager state around every test."""
    dev_server_ws._pumps.clear()
    DevProcessManager.reset()
    yield
    for task in list(dev_server_ws._pumps.values()):
        task.cancel()
    dev_server_ws._pumps.clear()
    DevProcessManager.reset()


def _sent(websocket: AsyncMock) -> list[dict[str, Any]]:
    return [json.loads(call.args[0]) for call in websocket.send_text.call_args_list]


async def _dispatch(message: dict, websocket: AsyncMock, cm: ConnectionManager) -> None:
    await cm.handle_message(json.dumps(message), websocket)


def test_register_dev_process_ws_registers_handlers_and_sink():
    cm = ConnectionManager()
    returned = register_dev_process_ws(cm=cm)

    assert returned is cm
    assert DEV_PROCESS_LOGS_SUBSCRIBE in cm.handlers
    assert DEV_PROCESS_LOGS_UNSUBSCRIBE in cm.handlers
    assert DevProcessManager._event_sink is not None


async def test_lifecycle_sink_broadcasts_to_connection_manager():
    cm = ConnectionManager()
    register_dev_process_ws(cm=cm)
    sink = DevProcessManager._event_sink

    with patch.object(cm, "broadcast", new=AsyncMock()) as mock_broadcast:
        assert sink is not None
        await sink(DEV_PROCESS_STARTED, {"pipeline_id": "p1", "run_id": "r1"})

    mock_broadcast.assert_awaited_once()
    message = mock_broadcast.await_args.args[0]
    assert message.type == DEV_PROCESS_STARTED
    assert message.payload["pipeline_id"] == "p1"


async def test_subscribe_pump_forwards_typed_events():
    manager = DevProcessManager.instance()

    async def fake_stream(pipeline_id, run_id=None):
        yield {
            "type": "status",
            "run_id": "r1",
            "pid": 42,
            "user": "alice",
            "port": 1224,
            "status": "running",
            "started_at": 1.0,
            "commands": [["sh", "-c", "npm run dev"]],
        }
        yield {"type": "chunk", "seq": 0, "stream": "stdout", "text": "hello\n"}
        yield {"type": "chunk", "seq": 1, "stream": "stderr", "text": "warn\n"}
        yield {"type": "exit", "exit_code": 0}

    cm = ConnectionManager()
    register_dev_process_ws(cm=cm)
    websocket = AsyncMock()

    with patch.object(manager, "stream", new=fake_stream):
        await _dispatch(
            {
                "type": DEV_PROCESS_LOGS_SUBSCRIBE,
                "payload": {"pipeline_id": "p1", "run_id": "r1"},
            },
            websocket,
            cm,
        )
        task = dev_server_ws._pumps[(id(websocket), "p1")]
        await task

    messages = _sent(websocket)
    assert [m["type"] for m in messages] == [
        DEV_PROCESS_STATUS,
        DEV_PROCESS_LOG,
        DEV_PROCESS_LOG,
        DEV_PROCESS_STREAM_END,
    ]
    # Every message is tagged with the pipeline id.
    assert all(m["payload"]["pipeline_id"] == "p1" for m in messages)
    assert messages[0]["payload"]["pid"] == 42
    assert messages[1]["payload"]["text"] == "hello\n"
    assert messages[2]["payload"]["stream"] == "stderr"
    assert messages[3]["payload"]["exit_code"] == 0


async def test_pump_self_terminates_on_send_failure():
    manager = DevProcessManager.instance()
    sent: list[str] = []

    async def fake_stream(pipeline_id, run_id=None):
        yield {"type": "chunk", "seq": 0, "stream": "stdout", "text": "one"}
        yield {"type": "chunk", "seq": 1, "stream": "stdout", "text": "two"}
        yield {"type": "exit", "exit_code": 0}

    websocket = AsyncMock()

    async def send_text(data: str) -> None:
        sent.append(data)
        raise RuntimeError("client gone")

    websocket.send_text.side_effect = send_text

    with patch.object(manager, "stream", new=fake_stream):
        task = dev_server_ws._start_pump(websocket, "p1", None)
        await asyncio.wait_for(task, timeout=2)

    # The first send failed; the pump must have stopped before the second chunk.
    assert len(sent) == 1


async def test_unsubscribe_cancels_pump():
    manager = DevProcessManager.instance()
    started = asyncio.Event()

    async def fake_stream(pipeline_id, run_id=None):
        yield {"type": "status", "run_id": "r1", "pid": None, "status": "running"}
        started.set()
        await asyncio.Event().wait()
        yield {"type": "exit", "exit_code": None}  # pragma: no cover

    cm = ConnectionManager()
    register_dev_process_ws(cm=cm)
    websocket = AsyncMock()

    with patch.object(manager, "stream", new=fake_stream):
        await _dispatch(
            {
                "type": DEV_PROCESS_LOGS_SUBSCRIBE,
                "payload": {"pipeline_id": "p1"},
            },
            websocket,
            cm,
        )
        task = dev_server_ws._pumps[(id(websocket), "p1")]
        await asyncio.wait_for(started.wait(), timeout=2)

        await _dispatch(
            {
                "type": DEV_PROCESS_LOGS_UNSUBSCRIBE,
                "payload": {"pipeline_id": "p1"},
            },
            websocket,
            cm,
        )

        with pytest.raises(asyncio.CancelledError):
            await task

    assert (id(websocket), "p1") not in dev_server_ws._pumps


async def test_subscribe_without_pipeline_id_is_ignored():
    cm = ConnectionManager()
    register_dev_process_ws(cm=cm)
    websocket = AsyncMock()

    await _dispatch({"type": DEV_PROCESS_LOGS_SUBSCRIBE, "payload": {}}, websocket, cm)
    assert dev_server_ws._pumps == {}
