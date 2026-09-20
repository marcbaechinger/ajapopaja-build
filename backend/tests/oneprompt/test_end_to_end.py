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

"""End-to-end tests for the one-shot AI prompt framework.

These tests wire the *whole* backend path described in
``design/dd_one_shot_ai.md`` sections 3, 9 and 11 together against a mocked
Ollama client:

    WS ``quick_prompt``
      → WebSocket handler
      → data-provider hook (MongoDB task + pipeline lookup)
      → bundled ``task_elaborate_spec`` template render
      → Ollama (mocked)
      → response hook
      → WS ``quick_prompt_result`` / ``quick_prompt_error``
      → REST ``PATCH /api/tasks/{id}`` (the client's Accept write-back)

Unlike the focused unit tests, this module deliberately uses the real
:data:`api.oneprompt.registry.registry` (so the bundled template is exercised),
the real WebSocket handler registration and the real REST route.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any
from unittest.mock import AsyncMock

import pytest

from api.auth import get_current_user
from api.main import app
from api.oneprompt.context import (
    register_context_providers,
)
from api.oneprompt.hooks import clear_hooks, hooks, registered_hooks
from api.oneprompt.ollama_client import OllamaUnavailableError
from api.oneprompt.runner import (
    EVENT_ERROR,
    EVENT_RESULT,
    EVENT_START,
    EVENT_STREAM,
    STATUS_CANCELLED,
    STATUS_NOT_FOUND,
    STATUS_OK,
    STATUS_TIMEOUT,
    STATUS_UNAVAILABLE,
    OnePromptRunner,
)
from api.oneprompt.ws_handler import (
    QUICK_PROMPT,
    QUICK_PROMPT_CANCEL,
    register_oneprompt_handlers,
)
from api.websocket_manager import ConnectionManager
from core.models.models import Pipeline, Task

#: The bundled first use case.
PROMPT_ID = "task_elaborate_spec"

#: A syntactically valid ObjectId that is never present in the test database.
MISSING_TASK_ID = "0123456789abcdef01234567"


@pytest.fixture(autouse=True)
def isolated_hooks():
    """Give each test a clean hook registry with the bundled providers."""

    snapshot = registered_hooks()
    clear_hooks()
    register_context_providers()
    yield
    clear_hooks()
    hooks.update(snapshot)


class FakeOllama:
    """A configurable mocked Ollama client (no availability probe)."""

    def __init__(
        self,
        *,
        response: str = "# Expanded spec\n\nDetailed requirements.",
        chunks: list[str] | None = None,
        delay: float = 0.0,
        error: Exception | None = None,
    ) -> None:
        self.response = response
        self.chunks = list(chunks) if chunks is not None else ["# Expanded", " spec"]
        self.delay = delay
        self.error = error
        self.calls: list[dict[str, Any]] = []

    async def chat(
        self,
        *,
        model: str | None = None,
        messages: list[dict[str, Any]] | None = None,
        stream: bool = False,
        **kwargs: Any,
    ) -> Any:
        self.calls.append(
            {"model": model, "messages": messages, "stream": stream, **kwargs}
        )
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.error is not None:
            raise self.error
        if stream:

            async def _gen():
                for chunk in self.chunks:
                    yield {"message": {"content": chunk}}

            return _gen()
        return {"message": {"content": self.response}}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _sent(websocket: AsyncMock) -> list[dict[str, Any]]:
    return [json.loads(call.args[0]) for call in websocket.send_text.call_args_list]


def _messages(sent: list[dict[str, Any]], message_type: str) -> list[dict[str, Any]]:
    return [m for m in sent if m["type"] == message_type]


def _make_runner(
    manager: ConnectionManager, ollama: FakeOllama, **kwargs
) -> OnePromptRunner:
    runner = OnePromptRunner(ollama_client=ollama, **kwargs)
    register_oneprompt_handlers(manager=manager, runner=runner)
    return runner


async def _dispatch(
    manager: ConnectionManager, websocket: AsyncMock, message: dict[str, Any]
) -> None:
    await manager.handle_message(json.dumps(message), websocket)


async def _seed_task() -> tuple[Pipeline, Task]:
    pipeline = Pipeline(name="E2E Pipeline")
    await pipeline.insert()
    task = Task(
        title="Add telemetry",
        spec="- collect metrics\n- expose endpoint",
        pipeline_id=str(pipeline.id),
    )
    await task.insert()
    return pipeline, task


async def _start_elaborate(
    runner: OnePromptRunner,
    manager: ConnectionManager,
    websocket: AsyncMock,
    context: dict[str, Any],
    *,
    run_id: str,
    prompt_id: str = PROMPT_ID,
    extra: dict[str, Any] | None = None,
) -> Any:
    payload = {
        "runId": run_id,
        "promptId": prompt_id,
        "context": context,
    }
    if extra:
        payload.update(extra)
    await _dispatch(
        manager,
        websocket,
        {"type": QUICK_PROMPT, "id": run_id, "payload": payload},
    )
    run = runner.get_run(run_id)
    assert run is not None, f"run {run_id!r} was not registered"
    return run


# ---------------------------------------------------------------------------
# Happy path: click → quick_prompt → render → result → accept (PATCH)
# ---------------------------------------------------------------------------


async def test_full_path_renders_template_calls_ollama_and_accepts(
    init_mock_db, async_client
):
    """The complete Elaborate round-trip plus the accepted write-back."""

    pipeline, task = await _seed_task()

    fake = FakeOllama(response="# Expanded spec\n\n- metric A\n- metric B")
    manager = ConnectionManager()
    runner = _make_runner(manager, fake)
    websocket = AsyncMock()

    run_id = "e2e-run-happy"
    run = await _start_elaborate(
        runner,
        manager,
        websocket,
        {"taskId": str(task.id), "pipelineId": str(pipeline.id)},
        run_id=run_id,
    )
    await run

    # -- 2. The backend rendered the template and called Ollama. ------------
    assert run.status == STATUS_OK
    assert run.result == "# Expanded spec\n\n- metric A\n- metric B"
    assert len(fake.calls) == 1
    call = fake.calls[0]
    assert call["stream"] is False
    assert call["model"]  # resolved from the template / config
    prompt = call["messages"][0]["content"]
    assert "E2E Pipeline" in prompt
    assert "Add telemetry" in prompt
    assert "- collect metrics" in prompt

    # -- 3. quick_prompt_result comes back with the correlated runId. -------
    sent = _sent(websocket)
    starts = _messages(sent, EVENT_START)
    results = _messages(sent, EVENT_RESULT)
    assert len(starts) == 1
    assert len(results) == 1

    start = starts[0]
    assert start["id"] == run_id
    assert start["payload"]["runId"] == run_id
    assert start["payload"]["promptId"] == PROMPT_ID
    assert start["payload"]["status"] == "running"
    assert start["payload"]["context"] == {
        "taskId": str(task.id),
        "pipelineId": str(pipeline.id),
    }

    result = results[0]
    assert result["id"] == run_id
    assert result["payload"]["runId"] == run_id
    assert result["payload"]["promptId"] == PROMPT_ID
    # The context is enriched by the data provider before rendering, so the
    # echoed context is a superset of what the UI sent.
    assert result["payload"]["context"]["taskId"] == str(task.id)
    assert result["payload"]["context"]["pipelineId"] == str(pipeline.id)
    assert result["payload"]["context"]["pipeline_name"] == "E2E Pipeline"
    assert result["payload"]["context"]["task_title"] == "Add telemetry"
    assert result["payload"]["context"]["task_spec"] == task.spec
    assert result["payload"]["status"] == STATUS_OK
    assert result["payload"]["result"] == run.result
    assert result["payload"]["error"] is None

    # -- 4. Accept writes back through the normal PATCH /tasks/{id} route. ---
    app.dependency_overrides[get_current_user] = lambda: AsyncMock()
    try:
        response = await async_client.patch(
            f"/api/tasks/{task.id}",
            json={"version": task.version, "spec": run.result},
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["spec"] == run.result
    persisted = await Task.get(str(task.id))
    assert persisted is not None
    assert persisted.spec == run.result
    assert persisted.version == task.version + 1


async def test_streaming_run_relays_deltas_then_result(init_mock_db):
    pipeline, task = await _seed_task()
    fake = FakeOllama(chunks=["Hello", " world"])
    manager = ConnectionManager()
    runner = _make_runner(manager, fake)
    websocket = AsyncMock()

    run_id = "e2e-run-stream"
    run = await _start_elaborate(
        runner,
        manager,
        websocket,
        {"taskId": str(task.id), "pipelineId": str(pipeline.id)},
        run_id=run_id,
        extra={"stream": True},
    )
    await run

    assert run.status == STATUS_OK
    assert run.result == "Hello world"
    streams = _messages(_sent(websocket), EVENT_STREAM)
    assert [m["payload"]["delta"] for m in streams] == ["Hello", " world"]
    assert all(m["payload"]["runId"] == run_id for m in streams)
    assert _messages(_sent(websocket), EVENT_RESULT)[0]["payload"]["result"] == (
        "Hello world"
    )


async def test_multiple_runs_are_isolated(init_mock_db):
    pipeline, task = await _seed_task()
    fake = FakeOllama(response="expanded")
    manager = ConnectionManager()
    runner = _make_runner(manager, fake)
    websocket = AsyncMock()

    context = {"taskId": str(task.id), "pipelineId": str(pipeline.id)}
    first = await _start_elaborate(
        runner, manager, websocket, context, run_id="e2e-multi-1"
    )
    second = await _start_elaborate(
        runner, manager, websocket, context, run_id="e2e-multi-2"
    )
    await asyncio.gather(first.wait(), second.wait())

    assert first.status == STATUS_OK
    assert second.status == STATUS_OK
    results = _messages(_sent(websocket), EVENT_RESULT)
    assert {m["payload"]["runId"] for m in results} == {"e2e-multi-1", "e2e-multi-2"}


# ---------------------------------------------------------------------------
# not_found
# ---------------------------------------------------------------------------


async def test_unknown_prompt_id_reports_not_found(init_mock_db):
    """An unregistered ``promptId`` yields a ``not_found`` error, no crash."""

    fake = FakeOllama()
    manager = ConnectionManager()
    runner = _make_runner(manager, fake)
    websocket = AsyncMock()

    run_id = "e2e-run-unknown"
    run = await _start_elaborate(
        runner,
        manager,
        websocket,
        {"taskId": MISSING_TASK_ID},
        run_id=run_id,
        prompt_id="does-not-exist",
    )
    await run

    assert run.status == STATUS_NOT_FOUND
    assert fake.calls == []  # Ollama is never reached.
    errors = _messages(_sent(websocket), EVENT_ERROR)
    assert len(errors) == 1
    payload = errors[0]["payload"]
    assert payload["runId"] == run_id
    assert payload["promptId"] == "does-not-exist"
    assert payload["status"] == "not_found"
    assert "does-not-exist" in payload["error"]
    assert payload["result"] is None


async def test_missing_task_reports_not_found(init_mock_db):
    """The data provider rejects a context whose task no longer exists."""

    fake = FakeOllama()
    manager = ConnectionManager()
    runner = _make_runner(manager, fake)
    websocket = AsyncMock()

    run_id = "e2e-run-missing-task"
    run = await _start_elaborate(
        runner,
        manager,
        websocket,
        {"taskId": MISSING_TASK_ID, "pipelineId": MISSING_TASK_ID},
        run_id=run_id,
    )
    await run

    assert run.status == STATUS_NOT_FOUND
    assert fake.calls == []
    payload = _messages(_sent(websocket), EVENT_ERROR)[0]["payload"]
    assert payload["status"] == "not_found"
    assert MISSING_TASK_ID in payload["error"]


# ---------------------------------------------------------------------------
# unavailable
# ---------------------------------------------------------------------------


async def test_ollama_unavailable_reports_unavailable(init_mock_db):
    pipeline, task = await _seed_task()
    fake = FakeOllama(error=OllamaUnavailableError("Ollama is down"))
    manager = ConnectionManager()
    runner = _make_runner(manager, fake)
    websocket = AsyncMock()

    run_id = "e2e-run-unavailable"
    run = await _start_elaborate(
        runner,
        manager,
        websocket,
        {"taskId": str(task.id), "pipelineId": str(pipeline.id)},
        run_id=run_id,
    )
    await run

    assert run.status == STATUS_UNAVAILABLE
    payload = _messages(_sent(websocket), EVENT_ERROR)[0]["payload"]
    assert payload["status"] == "unavailable"
    assert payload["error"] == "Ollama is down"
    assert payload["result"] is None


async def test_connection_error_maps_to_unavailable(init_mock_db):
    pipeline, task = await _seed_task()
    fake = FakeOllama(error=ConnectionError("connection refused"))
    manager = ConnectionManager()
    runner = _make_runner(manager, fake)
    websocket = AsyncMock()

    run = await _start_elaborate(
        runner,
        manager,
        websocket,
        {"taskId": str(task.id), "pipelineId": str(pipeline.id)},
        run_id="e2e-run-conn",
    )
    await run

    assert run.status == STATUS_UNAVAILABLE
    payload = _messages(_sent(websocket), EVENT_ERROR)[0]["payload"]
    assert payload["status"] == "unavailable"
    assert "connection refused" in payload["error"]


# ---------------------------------------------------------------------------
# timeout
# ---------------------------------------------------------------------------


async def test_timeout_reports_timeout(init_mock_db):
    pipeline, task = await _seed_task()
    fake = FakeOllama(delay=1.0)
    manager = ConnectionManager()
    runner = _make_runner(manager, fake, default_timeout=0.05)
    websocket = AsyncMock()

    run_id = "e2e-run-timeout"
    run = await _start_elaborate(
        runner,
        manager,
        websocket,
        {"taskId": str(task.id), "pipelineId": str(pipeline.id)},
        run_id=run_id,
    )
    await run

    assert run.status == STATUS_TIMEOUT
    payload = _messages(_sent(websocket), EVENT_ERROR)[0]["payload"]
    assert payload["status"] == "timeout"
    assert payload["runId"] == run_id


# ---------------------------------------------------------------------------
# cancelled
# ---------------------------------------------------------------------------


async def test_cancel_reports_cancelled(init_mock_db):
    pipeline, task = await _seed_task()
    fake = FakeOllama(delay=5.0)
    manager = ConnectionManager()
    runner = _make_runner(manager, fake)
    websocket = AsyncMock()

    run_id = "e2e-run-cancel"
    run = await _start_elaborate(
        runner,
        manager,
        websocket,
        {"taskId": str(task.id), "pipelineId": str(pipeline.id)},
        run_id=run_id,
    )
    await asyncio.sleep(0)  # let the background task start

    await _dispatch(
        manager, websocket, {"type": QUICK_PROMPT_CANCEL, "payload": {"runId": run_id}}
    )
    await run

    assert run.status == STATUS_CANCELLED
    payload = _messages(_sent(websocket), EVENT_ERROR)[0]["payload"]
    assert payload["status"] == "cancelled"
    assert payload["runId"] == run_id
    assert "cancel" in payload["error"].lower()
