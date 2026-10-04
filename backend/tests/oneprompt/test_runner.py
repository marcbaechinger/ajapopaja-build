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

"""Tests for the one-shot prompt runner (mocked Ollama client)."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from typing import Any

import pytest

from api.oneprompt.hooks import (
    PromptHook,
    clear_hooks,
    hooks,
    register_hook,
    registered_hooks,
)
from api.oneprompt.ollama_client import OllamaUnavailableError
from api.oneprompt.registry import PromptRegistry
from api.oneprompt.runner import (
    EVENT_ERROR,
    EVENT_RENDERED,
    EVENT_RESULT,
    EVENT_START,
    EVENT_STREAM,
    STATUS_CANCELLED,
    STATUS_NOT_FOUND,
    STATUS_OK,
    STATUS_TIMEOUT,
    STATUS_UNAVAILABLE,
    OnePromptRunner,
    PromptRun,
    dispatch_message,
    extract_content,
)

# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def clean_registry():
    """Keep the process-wide hook registry isolated between tests."""

    snapshot = registered_hooks()
    clear_hooks()
    yield
    clear_hooks()
    hooks.update(snapshot)


def _write_template(tmp_path, prompt_id="greet", body="Hello ${name}", **meta):
    metadata = {"id": prompt_id, "title": prompt_id, **meta}
    front_matter = "\n".join(f"{key}: {value}" for key, value in metadata.items())
    path = tmp_path / f"{prompt_id}.prompt"
    path.write_text(f"---\n{front_matter}\n---\n{body}\n", encoding="utf-8")
    return path


def _registry(tmp_path, **kwargs) -> PromptRegistry:
    _write_template(tmp_path, **kwargs)
    return PromptRegistry(tmp_path)


class FakeOllama:
    """A configurable mocked Ollama client."""

    def __init__(
        self,
        *,
        response: str = "expanded result",
        chunks: list[str] | None = None,
        delay: float = 0.0,
        error: Exception | None = None,
    ) -> None:
        self.response = response
        self.chunks = list(chunks) if chunks is not None else ["Hel", "lo"]
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


def _messages(sent: list[dict[str, Any]], message_type: str):
    return [m for m in sent if m["type"] == message_type]


# ---------------------------------------------------------------------------
# extract_content
# ---------------------------------------------------------------------------


def test_extract_content_from_chat_dict():
    assert extract_content({"message": {"content": "hi"}}) == "hi"


def test_extract_content_from_generate_dict():
    assert extract_content({"response": "hi"}) == "hi"


def test_extract_content_from_object():
    response = SimpleNamespace(message=SimpleNamespace(content="hi"))
    assert extract_content(response) == "hi"


def test_extract_content_from_string_and_none():
    assert extract_content("plain") == "plain"
    assert extract_content(None) == ""


def test_extract_content_from_pydantic_like():
    class _Model:
        def model_dump(self):
            return {"message": {"content": "dumped"}}

    assert extract_content(_Model()) == "dumped"


# ---------------------------------------------------------------------------
# dispatch_message supports both sender shapes
# ---------------------------------------------------------------------------


async def test_dispatch_message_single_arg_sender():
    sent: list[Any] = []

    await dispatch_message(sent.append, {"type": "t", "payload": {"a": 1}})

    assert sent == [{"type": "t", "payload": {"a": 1}}]


async def test_dispatch_message_two_arg_sender():
    sent: list[Any] = []

    async def sender(message_type, payload):
        sent.append((message_type, payload))

    await dispatch_message(sender, {"type": "t", "payload": {"a": 1}})

    assert sent == [("t", {"a": 1})]


# ---------------------------------------------------------------------------
# Happy path / runId correlation
# ---------------------------------------------------------------------------


async def test_run_correlates_run_id_and_emits_result(tmp_path):
    sent: list[dict[str, Any]] = []
    runner = OnePromptRunner(
        registry=_registry(tmp_path),
        ollama_client=FakeOllama(response="expanded result"),
        sender=sent.append,
    )

    run = await runner.run("greet", {"name": "Ada"}, run_id="run-1")

    assert isinstance(run, PromptRun)
    assert run.status == STATUS_OK
    assert run.result == "expanded result"
    assert run.run_id == "run-1"
    assert runner.get_run("run-1") is run

    starts = _messages(sent, EVENT_START)
    assert starts and starts[0]["payload"]["runId"] == "run-1"

    results = _messages(sent, EVENT_RESULT)
    assert len(results) == 1
    message = results[0]
    assert message["id"] == "run-1"
    assert message["payload"]["runId"] == "run-1"
    assert message["payload"]["promptId"] == "greet"
    assert message["payload"]["result"] == "expanded result"
    assert message["payload"]["error"] is None
    assert message["payload"]["status"] == "ok"


async def test_rendered_prompt_is_sent_to_ollama(tmp_path):
    fake = FakeOllama()
    runner = OnePromptRunner(registry=_registry(tmp_path), ollama_client=fake)

    await runner.run("greet", {"name": "Ada"})

    assert fake.calls[0]["messages"] == [{"role": "user", "content": "Hello Ada"}]
    assert fake.calls[0]["model"]


async def test_default_model_falls_back_to_template(tmp_path):
    fake = FakeOllama()
    runner = OnePromptRunner(
        registry=_registry(tmp_path, model="my-custom-model"),
        ollama_client=fake,
    )

    await runner.run("greet", {"name": "Ada"})

    assert fake.calls[0]["model"] == "my-custom-model"


async def test_model_falls_back_to_one_prompt_config(tmp_path, monkeypatch):
    from core import config

    monkeypatch.setattr(config, "ONE_PROMPT_OLLAMA_MODEL", "one-shot-config-model")
    fake = FakeOllama()
    runner = OnePromptRunner(registry=_registry(tmp_path), ollama_client=fake)

    await runner.run("greet", {"name": "Ada"})

    assert fake.calls[0]["model"] == "one-shot-config-model"


async def test_context_model_takes_precedence_over_template(tmp_path):
    fake = FakeOllama()
    runner = OnePromptRunner(
        registry=_registry(tmp_path, model="template-model"),
        ollama_client=fake,
    )

    await runner.run("greet", {"name": "Ada", "model": "pipeline-model"})

    assert fake.calls[0]["model"] == "pipeline-model"


async def test_blank_context_model_falls_back_to_template(tmp_path):
    fake = FakeOllama()
    runner = OnePromptRunner(
        registry=_registry(tmp_path, model="template-model"),
        ollama_client=fake,
    )

    await runner.run("greet", {"name": "Ada", "model": "   "})

    assert fake.calls[0]["model"] == "template-model"


async def test_emit_rendered_event_is_optional(tmp_path):
    sent: list[dict[str, Any]] = []
    runner = OnePromptRunner(
        registry=_registry(tmp_path),
        ollama_client=FakeOllama(),
        sender=sent.append,
        emit_rendered=True,
    )

    await runner.run("greet", {"name": "Ada"})

    rendered = _messages(sent, EVENT_RENDERED)
    assert len(rendered) == 1
    assert rendered[0]["payload"]["prompt"] == "Hello Ada"


async def test_emit_rendered_disabled_by_default(tmp_path):
    sent: list[dict[str, Any]] = []
    runner = OnePromptRunner(
        registry=_registry(tmp_path),
        ollama_client=FakeOllama(),
        sender=sent.append,
    )

    await runner.run("greet", {"name": "Ada"})

    assert _messages(sent, EVENT_RENDERED) == []


# ---------------------------------------------------------------------------
# Fire-and-forget scheduling
# ---------------------------------------------------------------------------


async def test_start_returns_immediately(tmp_path):
    sent: list[dict[str, Any]] = []
    runner = OnePromptRunner(
        registry=_registry(tmp_path),
        ollama_client=FakeOllama(delay=0.2),
        sender=sent.append,
    )

    run = runner.start("greet", {"name": "Ada"}, run_id="run-2")

    assert run.status == "running"
    assert run.task is not None
    assert isinstance(run.task, asyncio.Task)
    # The request path returned before the model produced a result.
    assert _messages(sent, EVENT_RESULT) == []

    await run

    assert run.status == STATUS_OK
    assert _messages(sent, EVENT_RESULT)


async def test_handle_quick_prompt_payload(tmp_path):
    sent: list[dict[str, Any]] = []
    runner = OnePromptRunner(
        registry=_registry(tmp_path),
        ollama_client=FakeOllama(response="ok"),
        sender=sent.append,
    )

    run = runner.handle_quick_prompt(
        {
            "runId": "run-3",
            "promptId": "greet",
            "context": {"name": "Ada"},
        }
    )
    await run

    assert run.status == STATUS_OK
    assert _messages(sent, EVENT_RESULT)[0]["payload"]["runId"] == "run-3"


def test_handle_quick_prompt_requires_prompt_id(tmp_path):
    runner = OnePromptRunner(registry=_registry(tmp_path), ollama_client=FakeOllama())

    with pytest.raises(ValueError):
        runner.handle_quick_prompt({"runId": "x"})


# ---------------------------------------------------------------------------
# Streaming
# ---------------------------------------------------------------------------


async def test_streaming_emits_each_delta(tmp_path):
    sent: list[dict[str, Any]] = []
    runner = OnePromptRunner(
        registry=_registry(tmp_path),
        ollama_client=FakeOllama(chunks=["Hel", "lo", " world"]),
        sender=sent.append,
    )

    run = await runner.run("greet", {"name": "Ada"}, run_id="run-s", stream=True)

    deltas = [m["payload"]["delta"] for m in _messages(sent, EVENT_STREAM)]
    assert deltas == ["Hel", "lo", " world"]
    assert run.status == STATUS_OK
    assert run.result == "Hello world"
    assert all(m["payload"]["runId"] == "run-s" for m in _messages(sent, EVENT_STREAM))


async def test_streaming_flag_can_default_to_true(tmp_path):
    sent: list[dict[str, Any]] = []
    runner = OnePromptRunner(
        registry=_registry(tmp_path),
        ollama_client=FakeOllama(chunks=["a", "b"]),
        sender=sent.append,
        streaming=True,
    )

    run = await runner.run("greet", {"name": "Ada"})

    assert run.stream is True
    assert run.result == "ab"
    assert len(_messages(sent, EVENT_STREAM)) == 2


async def test_set_streaming_toggles_in_flight_run(tmp_path):
    runner = OnePromptRunner(registry=_registry(tmp_path), ollama_client=FakeOllama())
    run = runner.create_run("greet", {"name": "Ada"})

    assert runner.set_streaming(run.run_id, True) is True
    assert run.stream is True
    assert runner.set_streaming("missing", True) is False


# ---------------------------------------------------------------------------
# Cancellation
# ---------------------------------------------------------------------------


async def test_cancel_in_flight_run(tmp_path):
    sent: list[dict[str, Any]] = []
    runner = OnePromptRunner(
        registry=_registry(tmp_path),
        ollama_client=FakeOllama(delay=5.0),
        sender=sent.append,
    )
    run = runner.start("greet", {"name": "Ada"}, run_id="run-cancel")
    await asyncio.sleep(0)  # let the task start

    assert runner.cancel("run-cancel") is True
    await run

    assert run.status == STATUS_CANCELLED
    errors = _messages(sent, EVENT_ERROR)
    assert len(errors) == 1
    assert errors[0]["payload"]["status"] == "cancelled"
    assert errors[0]["payload"]["runId"] == "run-cancel"
    assert "cancel" in errors[0]["payload"]["error"].lower()


async def test_cancel_unknown_run_returns_false(tmp_path):
    runner = OnePromptRunner(registry=_registry(tmp_path), ollama_client=FakeOllama())

    assert runner.cancel("does-not-exist") is False


async def test_cancel_run_awaits_the_task(tmp_path):
    runner = OnePromptRunner(
        registry=_registry(tmp_path),
        ollama_client=FakeOllama(delay=5.0),
        sender=lambda message: None,
    )
    run = runner.start("greet", {"name": "Ada"}, run_id="run-cancel-2")
    await asyncio.sleep(0)

    assert await runner.cancel_run("run-cancel-2") is True
    assert run.status == STATUS_CANCELLED


# ---------------------------------------------------------------------------
# Timeout
# ---------------------------------------------------------------------------


async def test_run_times_out(tmp_path):
    sent: list[dict[str, Any]] = []
    runner = OnePromptRunner(
        registry=_registry(tmp_path),
        ollama_client=FakeOllama(delay=1.0),
        sender=sent.append,
        default_timeout=0.05,
    )

    run = await runner.run("greet", {"name": "Ada"}, run_id="run-timeout")

    assert run.status == STATUS_TIMEOUT
    errors = _messages(sent, EVENT_ERROR)
    assert errors and errors[0]["payload"]["status"] == "timeout"
    assert errors[0]["payload"]["runId"] == "run-timeout"


async def test_per_template_timeout_is_honoured(tmp_path):
    runner = OnePromptRunner(
        registry=_registry(tmp_path, timeout=0.05),
        ollama_client=FakeOllama(delay=1.0),
        default_timeout=60.0,
    )

    run = await runner.run("greet", {"name": "Ada"})

    assert run.status == STATUS_TIMEOUT


async def test_explicit_timeout_overrides_template(tmp_path):
    runner = OnePromptRunner(
        registry=_registry(tmp_path, timeout=60.0),
        ollama_client=FakeOllama(delay=1.0),
    )

    run = await runner.run("greet", {"name": "Ada"}, timeout=0.05)

    assert run.status == STATUS_TIMEOUT


# ---------------------------------------------------------------------------
# Bundled template integration
# ---------------------------------------------------------------------------


async def test_task_elaborate_spec_integration(init_mock_db):
    """The runner renders and executes the bundled template end-to-end."""

    from api.oneprompt.context import register_context_providers
    from core.models.models import Pipeline, Task

    register_context_providers()
    pipeline = Pipeline(name="Integration Pipeline")
    await pipeline.insert()
    task = Task(title="Add feature", spec="- do a thing", pipeline_id=str(pipeline.id))
    await task.insert()

    sent: list[dict[str, Any]] = []
    fake = FakeOllama(response="Expanded spec markdown")
    runner = OnePromptRunner(ollama_client=fake, sender=sent.append)

    run = await runner.run(
        "task_elaborate_spec",
        {"taskId": str(task.id), "pipelineId": str(pipeline.id)},
        run_id="run-int",
    )

    assert run.status == STATUS_OK
    prompt = fake.calls[0]["messages"][0]["content"]
    assert "Integration Pipeline" in prompt
    assert "Add feature" in prompt
    assert "- do a thing" in prompt
    assert run.result == "Expanded spec markdown"
    result = _messages(sent, EVENT_RESULT)[0]["payload"]
    assert result["runId"] == "run-int"
    assert result["promptId"] == "task_elaborate_spec"


# ---------------------------------------------------------------------------
# Hooks
# ---------------------------------------------------------------------------


async def test_hooks_run_in_order(tmp_path):
    register_hook(
        "greet",
        PromptHook(
            pre_render=lambda context: {
                **context,
                "name": context["name"].upper(),
            },
            post_render=lambda prompt, context: prompt + "!",
            post_response=lambda output, context: output.strip().upper(),
        ),
    )
    fake = FakeOllama(response="  hooked  ")
    runner = OnePromptRunner(registry=_registry(tmp_path), ollama_client=fake)

    run = await runner.run("greet", {"name": "ada"})

    assert fake.calls[0]["messages"][0]["content"] == "Hello ADA!"
    assert run.result == "HOOKED"


async def test_pre_render_hook_can_reject(tmp_path):
    from api.oneprompt.hooks import PromptRejectedError

    def reject(context):
        raise PromptRejectedError("missing name", status="not_found")

    register_hook("greet", PromptHook(pre_render=reject))
    runner = OnePromptRunner(registry=_registry(tmp_path), ollama_client=FakeOllama())

    run = await runner.run("greet", {})

    assert run.status == STATUS_NOT_FOUND
    assert run.error == "missing name"


async def test_streaming_applies_post_response_hook_to_chunks(tmp_path):
    sent: list[dict[str, Any]] = []
    register_hook(
        "greet", PromptHook(post_response=lambda output, context: output.upper())
    )
    runner = OnePromptRunner(
        registry=_registry(tmp_path),
        ollama_client=FakeOllama(chunks=["a", "b"]),
        sender=sent.append,
    )

    run = await runner.run("greet", {"name": "ada"}, stream=True)

    deltas = [m["payload"]["delta"] for m in _messages(sent, EVENT_STREAM)]
    assert deltas == ["A", "B"]
    # The final result is the hook applied once to the accumulated raw output.
    assert run.result == "AB"


# ---------------------------------------------------------------------------
# Error handling
# ---------------------------------------------------------------------------


async def test_unknown_prompt_id_reports_not_found(tmp_path):
    sent: list[dict[str, Any]] = []
    runner = OnePromptRunner(
        registry=PromptRegistry(tmp_path),  # empty registry
        ollama_client=FakeOllama(),
        sender=sent.append,
    )

    run = await runner.run("does-not-exist", {})

    assert run.status == STATUS_NOT_FOUND
    errors = _messages(sent, EVENT_ERROR)
    assert errors and errors[0]["payload"]["status"] == "not_found"
    assert "does-not-exist" in errors[0]["payload"]["error"]


async def test_missing_render_key_reports_error(tmp_path):
    runner = OnePromptRunner(
        registry=_registry(tmp_path),
        ollama_client=FakeOllama(),
    )

    run = await runner.run("greet", {})  # missing ${name}

    assert run.status == "error"
    assert "name" in run.error


async def test_ollama_unavailable_is_reported(tmp_path):
    sent: list[dict[str, Any]] = []
    runner = OnePromptRunner(
        registry=_registry(tmp_path),
        ollama_client=FakeOllama(error=OllamaUnavailableError("no ollama")),
        sender=sent.append,
    )

    run = await runner.run("greet", {"name": "Ada"})

    assert run.status == STATUS_UNAVAILABLE
    errors = _messages(sent, EVENT_ERROR)
    assert errors and errors[0]["payload"]["status"] == "unavailable"
    assert errors[0]["payload"]["error"] == "no ollama"


async def test_connection_error_maps_to_unavailable(tmp_path):
    runner = OnePromptRunner(
        registry=_registry(tmp_path),
        ollama_client=FakeOllama(error=ConnectionError("refused")),
    )

    run = await runner.run("greet", {"name": "Ada"})

    assert run.status == STATUS_UNAVAILABLE


async def test_sender_failure_does_not_fail_the_run(tmp_path):
    def broken_sender(message):
        raise RuntimeError("sender is down")

    runner = OnePromptRunner(
        registry=_registry(tmp_path),
        ollama_client=FakeOllama(response="ok"),
        sender=broken_sender,
    )

    run = await runner.run("greet", {"name": "Ada"})

    assert run.status == STATUS_OK
    assert run.result == "ok"


# ---------------------------------------------------------------------------
# In-flight tracking
# ---------------------------------------------------------------------------


async def test_in_flight_tracking(tmp_path):
    runner = OnePromptRunner(
        registry=_registry(tmp_path),
        ollama_client=FakeOllama(delay=0.1),
    )
    run = runner.start("greet", {"name": "Ada"}, run_id="run-track")

    assert "run-track" in runner
    assert runner.is_running("run-track")
    assert "run-track" in runner.in_flight
    assert runner.get_run("run-track") is run

    await run

    assert not runner.is_running("run-track")
    assert "run-track" not in runner.in_flight
    # Finished runs remain queryable until cleaned up.
    assert runner.get_run("run-track") is run

    runner.cleanup(keep_finished=False)
    assert runner.get_run("run-track") is None
