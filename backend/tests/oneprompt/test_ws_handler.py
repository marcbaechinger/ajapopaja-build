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

"""Tests for the one-shot prompt WebSocket handlers.

Covers the routing of every outbound ``quick_prompt_*`` message type and the
shape of the inbound lifecycle payloads emitted through the WebSocket sender.
"""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock

from api.oneprompt.registry import PromptRegistry
from api.oneprompt.runner import (
    EVENT_ERROR,
    EVENT_RESULT,
    EVENT_START,
    STATUS_OK,
    OnePromptRunner,
)
from api.oneprompt.ws_handler import (
    INBOUND_MESSAGE_TYPES,
    OUTBOUND_MESSAGE_TYPES,
    QUICK_PROMPT,
    QUICK_PROMPT_ACCEPT,
    QUICK_PROMPT_CANCEL,
    QUICK_PROMPT_REJECT,
    QUICK_PROMPT_STREAM_CMD,
    initialize_oneprompt,
    register_oneprompt_handlers,
)
from api.websocket_manager import ConnectionManager

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _write_template(tmp_path, prompt_id="greet", body="Hello ${name}", **meta):
    metadata = {"id": prompt_id, "title": prompt_id, **meta}
    front_matter = "\n".join(f"{key}: {value}" for key, value in metadata.items())
    path = tmp_path / f"{prompt_id}.prompt"
    path.write_text(f"---\n{front_matter}\n---\n{body}\n", encoding="utf-8")
    return path


class FakeOllama:
    """Minimal mocked Ollama client (no availability check)."""

    def __init__(self, response: str = "expanded result") -> None:
        self.response = response
        self.calls: list[dict[str, Any]] = []

    async def chat(self, *, model=None, messages=None, stream=False, **kwargs):
        self.calls.append({"model": model, "messages": messages, "stream": stream})
        if stream:

            async def _gen():
                yield {"message": {"content": "Hello"}}

            return _gen()
        return {"message": {"content": self.response}}


class FakeRunner:
    """Records the runner methods invoked by the registered handlers."""

    def __init__(self) -> None:
        self.calls: list[tuple] = []

    def handle_quick_prompt(self, payload, **kwargs):
        self.calls.append(("handle_quick_prompt", payload, kwargs))
        return None

    def set_streaming(self, run_id, enabled):
        self.calls.append(("set_streaming", run_id, enabled))
        return True

    def cancel(self, run_id):
        self.calls.append(("cancel", run_id))
        return True

    def accept(self, run_id, payload=None):
        self.calls.append(("accept", run_id, payload))
        return True

    def reject(self, run_id):
        self.calls.append(("reject", run_id))
        return True


async def _dispatch(
    manager: ConnectionManager, websocket: AsyncMock, message: dict
) -> None:
    await manager.handle_message(json.dumps(message), websocket)


def _sent(websocket: AsyncMock) -> list[dict[str, Any]]:
    return [json.loads(call.args[0]) for call in websocket.send_text.call_args_list]


# ---------------------------------------------------------------------------
# Registration & routing
# ---------------------------------------------------------------------------


def test_register_oneprompt_handlers_registers_all_outbound_types():
    manager = ConnectionManager()
    register_oneprompt_handlers(manager=manager, runner=FakeRunner())

    for message_type in OUTBOUND_MESSAGE_TYPES:
        assert message_type in manager.handlers

    assert set(OUTBOUND_MESSAGE_TYPES) == {
        QUICK_PROMPT,
        QUICK_PROMPT_STREAM_CMD,
        QUICK_PROMPT_CANCEL,
        QUICK_PROMPT_ACCEPT,
        QUICK_PROMPT_REJECT,
    }


def test_inbound_message_types_match_the_protocol():
    assert set(INBOUND_MESSAGE_TYPES) == {
        "quick_prompt_start",
        "quick_prompt_rendered",
        "quick_prompt_stream",
        "quick_prompt_result",
        "quick_prompt_error",
    }


async def test_quick_prompt_routes_to_runner_with_sender():
    manager = ConnectionManager()
    runner = FakeRunner()
    websocket = AsyncMock()
    register_oneprompt_handlers(manager=manager, runner=runner)

    await _dispatch(
        manager,
        websocket,
        {
            "type": QUICK_PROMPT,
            "id": "run-1",
            "payload": {
                "runId": "run-1",
                "promptId": "greet",
                "context": {"name": "Ada"},
            },
        },
    )

    assert len(runner.calls) == 1
    name, payload, kwargs = runner.calls[0]
    assert name == "handle_quick_prompt"
    assert payload["runId"] == "run-1"
    assert payload["promptId"] == "greet"
    assert payload["context"] == {"name": "Ada"}
    # The handler binds a sender to the originating websocket.
    assert callable(kwargs["sender"])


async def test_stream_cmd_routes_to_set_streaming():
    manager = ConnectionManager()
    runner = FakeRunner()
    register_oneprompt_handlers(manager=manager, runner=runner)

    await _dispatch(
        manager,
        AsyncMock(),
        {
            "type": QUICK_PROMPT_STREAM_CMD,
            "payload": {"runId": "run-1", "enable": True},
        },
    )

    assert runner.calls == [("set_streaming", "run-1", True)]


async def test_stream_cmd_defaults_to_enable():
    manager = ConnectionManager()
    runner = FakeRunner()
    register_oneprompt_handlers(manager=manager, runner=runner)

    await _dispatch(
        manager,
        AsyncMock(),
        {"type": QUICK_PROMPT_STREAM_CMD, "payload": {"runId": "run-1"}},
    )

    assert runner.calls == [("set_streaming", "run-1", True)]


async def test_cancel_routes_to_runner():
    manager = ConnectionManager()
    runner = FakeRunner()
    register_oneprompt_handlers(manager=manager, runner=runner)

    await _dispatch(
        manager,
        AsyncMock(),
        {"type": QUICK_PROMPT_CANCEL, "payload": {"runId": "run-2"}},
    )

    assert runner.calls == [("cancel", "run-2")]


async def test_accept_routes_and_forwards_nested_payload():
    manager = ConnectionManager()
    runner = FakeRunner()
    register_oneprompt_handlers(manager=manager, runner=runner)

    await _dispatch(
        manager,
        AsyncMock(),
        {
            "type": QUICK_PROMPT_ACCEPT,
            "payload": {"runId": "run-3", "payload": {"spec": "new spec"}},
        },
    )

    assert runner.calls == [("accept", "run-3", {"spec": "new spec"})]


async def test_reject_routes_to_runner():
    manager = ConnectionManager()
    runner = FakeRunner()
    register_oneprompt_handlers(manager=manager, runner=runner)

    await _dispatch(
        manager,
        AsyncMock(),
        {"type": QUICK_PROMPT_REJECT, "payload": {"runId": "run-4"}},
    )

    assert runner.calls == [("reject", "run-4")]


async def test_run_id_falls_back_to_message_id():
    manager = ConnectionManager()
    runner = FakeRunner()
    register_oneprompt_handlers(manager=manager, runner=runner)

    await _dispatch(
        manager,
        AsyncMock(),
        {
            "type": QUICK_PROMPT_CANCEL,
            "id": "message-id-7",
            "payload": {},
        },
    )

    assert runner.calls == [("cancel", "message-id-7")]


# ---------------------------------------------------------------------------
# Emitted payload shapes (real runner end-to-end)
# ---------------------------------------------------------------------------


async def test_quick_prompt_emits_start_and_result_payloads(tmp_path):
    _write_template(tmp_path, prompt_id="greet", body="Hello ${name}")
    runner = OnePromptRunner(
        registry=PromptRegistry(tmp_path),
        ollama_client=FakeOllama(response="expanded result"),
    )
    manager = ConnectionManager()
    websocket = AsyncMock()
    register_oneprompt_handlers(manager=manager, runner=runner)

    await _dispatch(
        manager,
        websocket,
        {
            "type": QUICK_PROMPT,
            "id": "run-1",
            "payload": {
                "runId": "run-1",
                "promptId": "greet",
                "context": {"name": "Ada"},
            },
        },
    )

    # The run was scheduled asynchronously; await it before inspecting output.
    run = runner.get_run("run-1")
    assert run is not None
    await run

    messages = _sent(websocket)
    starts = [m for m in messages if m["type"] == EVENT_START]
    results = [m for m in messages if m["type"] == EVENT_RESULT]
    assert len(starts) == 1
    assert len(results) == 1

    start = starts[0]
    assert start["id"] == "run-1"
    assert start["payload"] == {
        "runId": "run-1",
        "promptId": "greet",
        "context": {"name": "Ada"},
        "status": "running",
    }

    result = results[0]
    assert result["id"] == "run-1"
    assert result["payload"]["runId"] == "run-1"
    assert result["payload"]["promptId"] == "greet"
    assert result["payload"]["context"] == {"name": "Ada"}
    assert result["payload"]["status"] == STATUS_OK
    assert result["payload"]["result"] == "expanded result"
    assert result["payload"]["error"] is None
    assert "meta" in result["payload"]


async def test_streaming_payloads_are_relayed(tmp_path):
    _write_template(tmp_path, prompt_id="greet", body="Hello ${name}")
    runner = OnePromptRunner(
        registry=PromptRegistry(tmp_path),
        ollama_client=FakeOllama(),
    )
    manager = ConnectionManager()
    websocket = AsyncMock()
    register_oneprompt_handlers(manager=manager, runner=runner)

    await _dispatch(
        manager,
        websocket,
        {
            "type": QUICK_PROMPT,
            "payload": {
                "runId": "run-stream",
                "promptId": "greet",
                "context": {"name": "Ada"},
                "stream": True,
            },
        },
    )

    run = runner.get_run("run-stream")
    await run

    streams = [m for m in _sent(websocket) if m["type"] == "quick_prompt_stream"]
    assert streams
    assert streams[0]["id"] == "run-stream"
    assert streams[0]["payload"]["runId"] == "run-stream"
    assert streams[0]["payload"]["promptId"] == "greet"
    assert streams[0]["payload"]["delta"] == "Hello"


async def test_unknown_prompt_id_emits_not_found_error_payload(tmp_path):
    runner = OnePromptRunner(
        registry=PromptRegistry(tmp_path),  # empty registry
        ollama_client=FakeOllama(),
    )
    manager = ConnectionManager()
    websocket = AsyncMock()
    register_oneprompt_handlers(manager=manager, runner=runner)

    await _dispatch(
        manager,
        websocket,
        {
            "type": QUICK_PROMPT,
            "id": "run-404",
            "payload": {
                "runId": "run-404",
                "promptId": "does-not-exist",
                "context": {"taskId": "t1"},
            },
        },
    )

    run = runner.get_run("run-404")
    await run

    errors = [m for m in _sent(websocket) if m["type"] == EVENT_ERROR]
    assert len(errors) == 1
    error = errors[0]
    assert error["id"] == "run-404"
    payload = error["payload"]
    assert payload["runId"] == "run-404"
    assert payload["promptId"] == "does-not-exist"
    assert payload["status"] == "not_found"
    assert payload["context"] == {"taskId": "t1"}
    assert "does-not-exist" in payload["error"]
    assert payload["result"] is None
    assert "meta" in payload


async def test_missing_prompt_id_emits_synchronous_error_payload(tmp_path):
    runner = OnePromptRunner(
        registry=PromptRegistry(tmp_path),
        ollama_client=FakeOllama(),
    )
    manager = ConnectionManager()
    websocket = AsyncMock()
    register_oneprompt_handlers(manager=manager, runner=runner)

    await _dispatch(
        manager,
        websocket,
        {
            "type": QUICK_PROMPT,
            "id": "run-bad",
            "payload": {"runId": "run-bad", "context": {"taskId": "t1"}},
        },
    )

    errors = [m for m in _sent(websocket) if m["type"] == EVENT_ERROR]
    assert len(errors) == 1
    payload = errors[0]["payload"]
    assert errors[0]["id"] == "run-bad"
    assert payload["runId"] == "run-bad"
    assert payload["promptId"] == ""
    assert payload["status"] == "error"
    assert payload["context"] == {"taskId": "t1"}
    assert "promptId" in payload["error"]
    assert payload["result"] is None


# ---------------------------------------------------------------------------
# Registry initialisation
# ---------------------------------------------------------------------------


def test_initialize_oneprompt_scans_template_directory(tmp_path):
    _write_template(tmp_path, prompt_id="greet", body="Hello ${name}")
    registry = PromptRegistry(tmp_path, auto_discover=False)

    templates = initialize_oneprompt(registry=registry)

    assert "greet" in templates
    assert registry.has("greet")


def test_initialize_oneprompt_loads_bundled_templates():
    registry = PromptRegistry(auto_discover=False)

    templates = initialize_oneprompt(registry=registry)

    assert "session_generate_title" in templates
