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

"""Tests for the one-shot prompt Ollama client wrapper."""

from __future__ import annotations

from typing import Any

import pytest

from api.oneprompt import ollama_client as ollama_client_module
from api.oneprompt.ollama_client import (
    DEFAULT_UNAVAILABLE_MESSAGE,
    OLLAMA_UNAVAILABLE_MESSAGE,
    OllamaClient,
    OllamaClientError,
    OllamaUnavailableError,
    build_headers,
    create_client,
)


class _FakeAsyncClient:
    """Minimal stand-in for :class:`ollama.AsyncClient`."""

    def __init__(self) -> None:
        self.chat_calls: list[dict[str, Any]] = []
        self.generate_calls: list[dict[str, Any]] = []
        self.list_calls = 0
        self.chat_response: Any = {"message": {"content": "hello"}}
        self.generate_response: Any = {"response": "world"}

    async def chat(self, **kwargs: Any) -> Any:
        self.chat_calls.append(kwargs)
        return self.chat_response

    async def generate(self, **kwargs: Any) -> Any:
        self.generate_calls.append(kwargs)
        return self.generate_response

    async def list(self) -> Any:
        self.list_calls += 1
        return {"models": []}


@pytest.fixture
def available(monkeypatch):
    """Make ``is_ollama_available`` resolve to ``True``."""

    async def _available() -> bool:
        return True

    monkeypatch.setattr(ollama_client_module, "is_ollama_available", _available)


@pytest.fixture
def unavailable(monkeypatch):
    """Make ``is_ollama_available`` resolve to ``False``."""

    async def _unavailable() -> bool:
        return False

    monkeypatch.setattr(ollama_client_module, "is_ollama_available", _unavailable)


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


def test_defaults_come_from_config():
    client = OllamaClient()

    from core import config

    assert client.model == config.OLLAMA_MODEL
    assert client.host == config.OLLAMA_HOST
    assert client.api_key == config.OLLAMA_API_KEY


def test_explicit_configuration_overrides_defaults():
    client = OllamaClient(model="my-model", host="http://example:1234", api_key="key")

    assert client.model == "my-model"
    assert client.host == "http://example:1234"
    assert client.api_key == "key"


def test_build_headers_adds_bearer_token():
    assert build_headers(None) == {}
    assert build_headers("") == {}
    assert build_headers("secret") == {"Authorization": "Bearer secret"}


def test_create_client_uses_host_and_key(monkeypatch):
    captured: dict[str, Any] = {}

    class _Factory:
        def __init__(self, **kwargs: Any) -> None:
            captured.update(kwargs)

    monkeypatch.setattr(ollama_client_module.ollama, "AsyncClient", _Factory)

    create_client("http://host:1", "abc")

    assert captured["host"] == "http://host:1"
    assert captured["headers"] == {"Authorization": "Bearer abc"}


def test_injected_client_is_used_verbatim():
    fake = _FakeAsyncClient()
    client = OllamaClient(client=fake)

    assert client.client is fake


# ---------------------------------------------------------------------------
# Availability
# ---------------------------------------------------------------------------


async def test_is_available_delegates_to_health_check(available):
    assert await OllamaClient(client=_FakeAsyncClient()).is_available() is True


async def test_is_available_returns_false_when_unreachable(unavailable):
    assert await OllamaClient(client=_FakeAsyncClient()).is_available() is False


async def test_is_available_swallows_errors(monkeypatch):
    async def _boom() -> bool:
        raise RuntimeError("nope")

    monkeypatch.setattr(ollama_client_module, "is_ollama_available", _boom)

    assert await OllamaClient(client=_FakeAsyncClient()).is_available() is False


async def test_chat_raises_friendly_error_when_unavailable(unavailable):
    client = OllamaClient(client=_FakeAsyncClient())

    with pytest.raises(OllamaUnavailableError) as excinfo:
        await client.chat("hi")

    assert excinfo.value.status == "unavailable"
    assert str(excinfo.value) == DEFAULT_UNAVAILABLE_MESSAGE
    assert OLLAMA_UNAVAILABLE_MESSAGE == DEFAULT_UNAVAILABLE_MESSAGE
    assert isinstance(excinfo.value, OllamaClientError)


async def test_chat_skips_check_when_disabled(unavailable):
    fake = _FakeAsyncClient()
    client = OllamaClient(client=fake, check_availability=False)

    response = await client.chat("hi")

    assert response == {"message": {"content": "hello"}}


# ---------------------------------------------------------------------------
# chat / generate delegation
# ---------------------------------------------------------------------------


async def test_chat_wraps_prompt_in_a_user_message(available):
    fake = _FakeAsyncClient()
    client = OllamaClient(client=fake, model="default-model")

    response = await client.chat("expand this")

    assert response == {"message": {"content": "hello"}}
    assert fake.chat_calls == [
        {
            "model": "default-model",
            "messages": [{"role": "user", "content": "expand this"}],
            "stream": False,
        }
    ]


async def test_chat_accepts_messages_and_model_override(available):
    fake = _FakeAsyncClient()
    client = OllamaClient(client=fake)

    messages = [{"role": "system", "content": "sys"}]
    await client.chat(messages=messages, model="other-model", stream=True)

    assert fake.chat_calls[0]["model"] == "other-model"
    assert fake.chat_calls[0]["messages"] == messages
    assert fake.chat_calls[0]["stream"] is True


async def test_generate_delegates(available):
    fake = _FakeAsyncClient()
    client = OllamaClient(client=fake, model="m")

    response = await client.generate("prompt", stream=False)

    assert response == {"response": "world"}
    assert fake.generate_calls == [{"model": "m", "prompt": "prompt", "stream": False}]


async def test_list_delegates(available):
    fake = _FakeAsyncClient()
    client = OllamaClient(client=fake)

    await client.list()

    assert fake.list_calls == 1
