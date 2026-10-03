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

"""Tests for the ``session_generate_title`` one-shot use case.

Covers the pure extractor, the response normaliser, the MongoDB data provider
and the full runner path with a mocked Ollama client.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock

import pytest

from api.auth import get_current_user
from api.coderbot.session_title import (
    SESSION_GENERATE_TITLE,
    extract_first_user_prompt,
    normalize_title,
    provide_session_title_context,
    register_session_title_hooks,
    unregister_session_title_hooks,
)
from api.main import app
from api.oneprompt.context import ContextProviderError
from api.oneprompt.hooks import (
    clear_hooks,
    get_hook,
    hooks,
    registered_hooks,
)
from api.oneprompt.registry import registry
from api.oneprompt.renderer import render_template
from api.oneprompt.runner import (
    STATUS_ERROR,
    STATUS_NOT_FOUND,
    STATUS_OK,
    OnePromptRunner,
)
from api.oneprompt.ws_handler import QUICK_PROMPT, register_oneprompt_handlers
from api.websocket_manager import ConnectionManager
from core import config
from core.models.models import PiSession, PiSessionKind, PiSessionStatus

# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def isolated_hooks():
    """Keep the process-wide hook registry isolated between tests."""

    snapshot = registered_hooks()
    clear_hooks()
    yield
    clear_hooks()
    hooks.update(snapshot)


class FakeOllama:
    """A minimal mocked Ollama client (returns a fixed title)."""

    def __init__(self, *, response: str = "Fix the flaky auth test") -> None:
        self.response = response
        self.calls: list[dict[str, Any]] = []

    async def chat(self, *, model=None, messages=None, stream=False, **kwargs):
        self.calls.append({"model": model, "messages": messages, "stream": stream})
        return {"message": {"content": self.response}}


def _write_events(root: Path, uid: str, events: list[dict]) -> None:
    path = root / uid / "events.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as handle:
        for event in events:
            handle.write(json.dumps({"type": "pi_rpc_event", "event": event}) + "\n")


# ---------------------------------------------------------------------------
# extract_first_user_prompt
# ---------------------------------------------------------------------------


def test_extract_from_agent_end_with_string_content():
    events = [
        {"type": "agent_start"},
        {
            "type": "agent_end",
            "messages": [
                {"role": "user", "content": "Please fix the parser"},
                {"role": "assistant", "content": "Sure"},
            ],
        },
    ]
    assert extract_first_user_prompt(events) == "Please fix the parser"


def test_extract_from_agent_end_with_block_content():
    events = [
        {
            "type": "agent_end",
            "messages": [
                {
                    "role": "user",
                    "content": [{"type": "text", "text": "Refactor the store"}],
                }
            ],
        }
    ]
    assert extract_first_user_prompt(events) == "Refactor the store"


def test_extract_from_message_start_and_end_envelopes():
    events = [
        {"type": "message_start", "message": {"role": "assistant", "content": "hi"}},
        {
            "type": "message_end",
            "message": {
                "role": "user",
                "content": [{"type": "text", "text": "Add a health endpoint"}],
            },
        },
    ]
    assert extract_first_user_prompt(events) == "Add a health endpoint"


def test_extract_returns_the_first_user_message_in_order():
    events = [
        {"type": "agent_end", "messages": [{"role": "user", "content": "first"}]},
        {"type": "message_end", "message": {"role": "user", "content": "second"}},
    ]
    assert extract_first_user_prompt(events) == "first"


def test_extract_returns_none_without_a_user_message():
    events = [
        {"type": "agent_start"},
        {"type": "agent_end", "messages": [{"role": "assistant", "content": "hi"}]},
    ]
    assert extract_first_user_prompt(events) is None


def test_extract_ignores_unknown_shapes():
    assert extract_first_user_prompt(None) is None
    assert extract_first_user_prompt("not a list") is None
    assert extract_first_user_prompt([None, 42, {"type": "message_end"}]) is None


# ---------------------------------------------------------------------------
# normalize_title
# ---------------------------------------------------------------------------


def test_normalize_strips_code_fences_and_quotes():
    assert (
        normalize_title('```\n"Title: Fix the auth test"\n```', 80)
        == "Fix the auth test"
    )


def test_normalize_strips_title_prefix_case_insensitively():
    assert normalize_title("Session title: Improve the UI", 80) == "Improve the UI"


def test_normalize_collapses_newlines():
    assert normalize_title("Line one\nline   two", 80) == "Line one line two"


def test_normalize_truncates_to_the_max_length_on_a_word_boundary():
    title = normalize_title("word " * 40, 80)
    assert len(title) <= 80
    assert not title.endswith(" ")
    assert title.startswith("word word")


def test_normalize_empty_is_rejected():
    with pytest.raises(ContextProviderError):
        normalize_title("   ", 80)


def test_normalize_uses_the_config_default():
    long_title = "a" * (config.SESSION_TITLE_MAX_LENGTH + 50)
    assert len(normalize_title(long_title)) <= config.SESSION_TITLE_MAX_LENGTH


# ---------------------------------------------------------------------------
# provide_session_title_context
# ---------------------------------------------------------------------------


async def test_provider_enriches_the_context(init_mock_db, tmp_path, monkeypatch):
    monkeypatch.setattr(config, "PI_SESSIONS_ROOT", tmp_path)
    monkeypatch.setattr(config, "PI_SESSION_EVENT_LOG_ENABLED", True)

    record = PiSession(
        uid="s-provider",
        kind=PiSessionKind.INTERACTIVE,
        status=PiSessionStatus.PAUSED,
        pipeline_id="p1",
    )
    await record.insert()
    _write_events(
        tmp_path,
        "s-provider",
        [{"type": "agent_end", "messages": [{"role": "user", "content": "Hello"}]}],
    )

    enriched = await provide_session_title_context({"sessionUid": "s-provider"})

    assert enriched["session_uid"] == "s-provider"
    assert enriched["sessionUid"] == "s-provider"
    assert enriched["first_user_prompt"] == "Hello"
    assert enriched["max_title_length"] == config.SESSION_TITLE_MAX_LENGTH


async def test_provider_unknown_session_is_not_found(init_mock_db):
    with pytest.raises(ContextProviderError) as excinfo:
        await provide_session_title_context({"sessionUid": "missing-session"})
    assert excinfo.value.status == "not_found"


async def test_provider_missing_uid_is_rejected(init_mock_db):
    with pytest.raises(ContextProviderError) as excinfo:
        await provide_session_title_context({})
    assert excinfo.value.status == "error"


async def test_provider_without_prompt_is_not_found(
    init_mock_db, tmp_path, monkeypatch
):
    monkeypatch.setattr(config, "PI_SESSIONS_ROOT", tmp_path)
    monkeypatch.setattr(config, "PI_SESSION_EVENT_LOG_ENABLED", True)

    record = PiSession(
        uid="s-empty",
        kind=PiSessionKind.INTERACTIVE,
        status=PiSessionStatus.PAUSED,
        pipeline_id="p1",
    )
    await record.insert()

    with pytest.raises(ContextProviderError) as excinfo:
        await provide_session_title_context({"session_uid": "s-empty"})
    assert excinfo.value.status == "not_found"


# ---------------------------------------------------------------------------
# Templates / hooks / runner integration
# ---------------------------------------------------------------------------


def test_template_is_discovered_and_renders():
    template = registry.get(SESSION_GENERATE_TITLE)
    prompt = render_template(
        template,
        {
            "first_user_prompt": "Fix the flaky test",
            "max_title_length": 80,
        },
    )
    assert "Fix the flaky test" in prompt
    assert "80" in prompt
    assert "$" not in prompt


def test_register_session_title_hooks_registers_provider_and_normaliser():
    hook = register_session_title_hooks()
    assert hook is get_hook(SESSION_GENERATE_TITLE)
    assert hook.pre_render is provide_session_title_context
    assert hook.post_response is not None

    unregister_session_title_hooks()
    from api.oneprompt.hooks import NOOP_HOOK

    assert get_hook(SESSION_GENERATE_TITLE) is NOOP_HOOK


async def test_runner_executes_session_generate_title(
    init_mock_db, tmp_path, monkeypatch
):
    monkeypatch.setattr(config, "PI_SESSIONS_ROOT", tmp_path)
    monkeypatch.setattr(config, "PI_SESSION_EVENT_LOG_ENABLED", True)

    record = PiSession(
        uid="s-runner",
        kind=PiSessionKind.INTERACTIVE,
        status=PiSessionStatus.PAUSED,
        pipeline_id="p1",
    )
    await record.insert()
    _write_events(
        tmp_path,
        "s-runner",
        [
            {
                "type": "message_end",
                "message": {
                    "role": "user",
                    "content": [{"type": "text", "text": "Make the title nice"}],
                },
            }
        ],
    )

    register_session_title_hooks()
    fake = FakeOllama(response="```\nTitle: Nice session title\n```")
    runner = OnePromptRunner(ollama_client=fake)

    run = await runner.run(SESSION_GENERATE_TITLE, {"sessionUid": "s-runner"})

    assert run.status == STATUS_OK
    assert run.result == "Nice session title"
    sent_prompt = fake.calls[0]["messages"][0]["content"]
    assert "Make the title nice" in sent_prompt
    assert "$" not in sent_prompt
    assert len(run.result) <= config.SESSION_TITLE_MAX_LENGTH


async def test_runner_reports_not_found_for_missing_session(init_mock_db):
    register_session_title_hooks()
    runner = OnePromptRunner(ollama_client=FakeOllama())

    run = await runner.run(SESSION_GENERATE_TITLE, {"sessionUid": "nope"})

    assert run.status == STATUS_NOT_FOUND


async def test_runner_rejects_empty_model_title(init_mock_db, tmp_path, monkeypatch):
    monkeypatch.setattr(config, "PI_SESSIONS_ROOT", tmp_path)
    monkeypatch.setattr(config, "PI_SESSION_EVENT_LOG_ENABLED", True)

    record = PiSession(
        uid="s-empty-title",
        kind=PiSessionKind.INTERACTIVE,
        status=PiSessionStatus.PAUSED,
        pipeline_id="p1",
    )
    await record.insert()
    _write_events(
        tmp_path,
        "s-empty-title",
        [{"type": "agent_end", "messages": [{"role": "user", "content": "Hi"}]}],
    )

    register_session_title_hooks()
    runner = OnePromptRunner(ollama_client=FakeOllama(response="   "))

    run = await runner.run(SESSION_GENERATE_TITLE, {"sessionUid": "s-empty-title"})

    assert run.status == STATUS_ERROR


# ---------------------------------------------------------------------------
# End-to-end: WS quick_prompt -> result -> PATCH persists the accepted label
# ---------------------------------------------------------------------------


def _sent_messages(websocket: AsyncMock) -> list[dict]:
    return [json.loads(call.args[0]) for call in websocket.send_text.call_args_list]


async def test_end_to_end_generates_and_persists_title(
    init_mock_db, async_client, tmp_path, monkeypatch
):
    monkeypatch.setattr(config, "PI_SESSIONS_ROOT", tmp_path)
    monkeypatch.setattr(config, "PI_SESSION_EVENT_LOG_ENABLED", True)

    record = PiSession(
        uid="s-e2e",
        kind=PiSessionKind.INTERACTIVE,
        status=PiSessionStatus.PAUSED,
        pipeline_id="p1",
    )
    await record.insert()
    _write_events(
        tmp_path,
        "s-e2e",
        [
            {
                "type": "agent_end",
                "messages": [{"role": "user", "content": "Add a login page"}],
            }
        ],
    )

    register_session_title_hooks()
    fake = FakeOllama(response='"Add a login page"')
    manager = ConnectionManager()
    runner = OnePromptRunner(ollama_client=fake)
    register_oneprompt_handlers(manager=manager, runner=runner)
    websocket = AsyncMock()

    run_id = "run-session-title-e2e"
    await manager.handle_message(
        json.dumps(
            {
                "type": QUICK_PROMPT,
                "id": run_id,
                "payload": {
                    "runId": run_id,
                    "promptId": SESSION_GENERATE_TITLE,
                    "context": {"sessionUid": "s-e2e"},
                },
            }
        ),
        websocket,
    )

    run = runner.get_run(run_id)
    assert run is not None
    await run

    assert run.status == STATUS_OK
    assert run.result == "Add a login page"
    assert "Add a login page" in fake.calls[0]["messages"][0]["content"]

    results = [
        m for m in _sent_messages(websocket) if m["type"] == "quick_prompt_result"
    ]
    assert len(results) == 1
    assert results[0]["payload"]["result"] == "Add a login page"

    # Accepting the suggestion writes back through the existing PATCH route.
    app.dependency_overrides[get_current_user] = lambda: AsyncMock()
    try:
        response = await async_client.patch(
            "/api/coderbot/sessions/s-e2e", json={"label": run.result}
        )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["label"] == "Add a login page"
    reloaded = await PiSession.find_one(PiSession.uid == "s-e2e")
    assert reloaded is not None
    assert reloaded.label == "Add a login page"
