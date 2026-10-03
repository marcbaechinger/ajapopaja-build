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

"""Thin Ollama client wrapper for the one-shot AI prompt framework.

The runner never talks to :class:`ollama.AsyncClient` directly; it goes through
:class:`OllamaClient`. The wrapper:

* reuses the shared Ollama configuration (:data:`core.config.OLLAMA_HOST` and
  :data:`core.config.OLLAMA_API_KEY`) while defaulting to the one-shot model
  (:data:`core.config.ONE_PROMPT_OLLAMA_MODEL`) so a one-shot prompt is
  authenticated and addressed exactly like the rest of the application (see
  :class:`api.assistant.session.AssistantSession`),
* performs the same ``Bearer`` header construction as the assistant/bots,
* checks :func:`api.ollama_utils.is_ollama_available` and raises a friendly
  :class:`OllamaUnavailableError` (``status="unavailable"``) instead of letting
  an opaque connection error bubble up, and
* normalises prompt/message handling for both ``chat`` and ``generate``.

Everything is injectable for tests: pass ``client=`` a mocked
``ollama.AsyncClient`` and no network access is attempted.
"""

from __future__ import annotations

import inspect
import logging
from typing import Any, Optional

import ollama

from core import config

from api.ollama_utils import is_ollama_available

logger = logging.getLogger(__name__)

__all__ = [
    "DEFAULT_UNAVAILABLE_MESSAGE",
    "OLLAMA_UNAVAILABLE_MESSAGE",
    "OllamaClient",
    "OllamaClientError",
    "OllamaError",
    "OllamaUnavailableError",
    "build_headers",
    "create_client",
    "create_ollama_client",
    "default_client",
    "get_ollama_client",
]

#: Human readable message sent to the client when Ollama cannot be reached.
DEFAULT_UNAVAILABLE_MESSAGE = (
    "Ollama is not available. Please make sure the Ollama server is running, "
    "reachable and correctly configured, then try again."
)

#: Alias kept for callers that prefer the shouting constant style.
OLLAMA_UNAVAILABLE_MESSAGE = DEFAULT_UNAVAILABLE_MESSAGE


class OllamaClientError(Exception):
    """Base class for errors raised by :class:`OllamaClient`.

    ``status`` mirrors the terminal ``status`` field used by the
    ``quick_prompt_error`` WebSocket message (see ``design/dd_one_shot_ai.md``
    section 5) so the runner can map an exception straight onto a payload.
    """

    status = "error"


class OllamaUnavailableError(OllamaClientError):
    """Raised when Ollama is not reachable/responsive.

    Carries ``status="unavailable"`` and a friendly message suitable for
    display in the UI.
    """

    status = "unavailable"

    def __init__(self, message: str = DEFAULT_UNAVAILABLE_MESSAGE) -> None:
        super().__init__(message)


#: Backwards/forwards compatible alias for the base error.
OllamaError = OllamaClientError


def build_headers(api_key: Optional[str]) -> dict[str, str]:
    """Build the HTTP headers used for the Ollama client.

    Mirrors :class:`api.assistant.session.AssistantSession`: the API key (when
    configured) is sent as a ``Bearer`` token.
    """

    headers: dict[str, str] = {}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    return headers


def create_client(
    host: Optional[str] = None,
    api_key: Optional[str] = None,
    **kwargs: Any,
) -> "ollama.AsyncClient":
    """Create a configured :class:`ollama.AsyncClient`."""

    return ollama.AsyncClient(
        host=host or config.OLLAMA_HOST,
        headers=build_headers(config.OLLAMA_API_KEY if api_key is None else api_key),
        **kwargs,
    )


def _as_messages(
    prompt: Optional[str],
    messages: Optional[list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    """Return an Ollama ``messages`` list from a prompt and/or messages."""

    if messages is not None:
        return list(messages)
    return [{"role": "user", "content": prompt or ""}]


class OllamaClient:
    """A thin, configuration-aware wrapper over :class:`ollama.AsyncClient`.

    Args:
        model: Model to use by default. Falls back to
            :data:`core.config.ONE_PROMPT_OLLAMA_MODEL` (which itself defaults
            to :data:`core.config.OLLAMA_MODEL`).
        host: Ollama host. Falls back to :data:`core.config.OLLAMA_HOST`.
        api_key: Optional API key. Falls back to
            :data:`core.config.OLLAMA_API_KEY`.
        client: An already constructed ``ollama.AsyncClient`` (or any object
            exposing the same ``chat``/``generate``/``list`` coroutines). When
            omitted the client is created lazily on first use.
        check_availability: When ``True`` (default) every ``chat``/``generate``
            first consults :func:`api.ollama_utils.is_ollama_available`. Set to
            ``False`` to skip the health check (useful when the underlying
            client is mocked).
    """

    def __init__(
        self,
        model: Optional[str] = None,
        host: Optional[str] = None,
        api_key: Optional[str] = None,
        *,
        client: Any = None,
        check_availability: bool = True,
        unavailable_message: str = DEFAULT_UNAVAILABLE_MESSAGE,
    ) -> None:
        self.model = model or config.ONE_PROMPT_OLLAMA_MODEL
        self.host = host or config.OLLAMA_HOST
        self.api_key = config.OLLAMA_API_KEY if api_key is None else api_key
        self.check_availability = check_availability
        self.unavailable_message = unavailable_message
        self._client = client

    # ------------------------------------------------------------------
    # Underlying client
    # ------------------------------------------------------------------
    @property
    def client(self) -> Any:
        """The underlying ``ollama.AsyncClient`` (created lazily)."""

        if self._client is None:
            self._client = create_client(self.host, self.api_key)
        return self._client

    def create_client(self, **kwargs: Any) -> Any:
        """Alias for :attr:`client` construction, useful in tests."""

        return create_client(self.host, self.api_key, **kwargs)

    # ------------------------------------------------------------------
    # Availability
    # ------------------------------------------------------------------
    async def is_available(self) -> bool:
        """Return whether Ollama is reachable (never raises)."""

        try:
            return bool(await is_ollama_available())
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("Ollama availability check failed: %s", exc)
            return False

    async def ensure_available(self) -> None:
        """Raise :class:`OllamaUnavailableError` when Ollama is unreachable."""

        if not self.check_availability:
            return
        if not await self.is_available():
            raise OllamaUnavailableError(self.unavailable_message)

    # ------------------------------------------------------------------
    # Chat / generate
    # ------------------------------------------------------------------
    async def chat(
        self,
        prompt: Optional[str] = None,
        *,
        model: Optional[str] = None,
        messages: Optional[list[dict[str, Any]]] = None,
        stream: bool = False,
        think: Optional[bool] = None,
        **options: Any,
    ) -> Any:
        """Send a chat request to Ollama.

        Accepts either a plain ``prompt`` string (wrapped into a single ``user``
        message) or an explicit ``messages`` list. ``model`` defaults to the
        instance model.
        """

        await self.ensure_available()

        kwargs: dict[str, Any] = {
            "model": model or self.model,
            "messages": _as_messages(prompt, messages),
            "stream": stream,
        }
        if think is not None:
            kwargs["think"] = think
        kwargs.update(options)

        return await self.client.chat(**kwargs)

    async def generate(
        self,
        prompt: str = "",
        *,
        model: Optional[str] = None,
        stream: bool = False,
        **options: Any,
    ) -> Any:
        """Send a completion request to Ollama."""

        await self.ensure_available()

        kwargs: dict[str, Any] = {
            "model": model or self.model,
            "prompt": prompt,
            "stream": stream,
        }
        kwargs.update(options)

        return await self.client.generate(**kwargs)

    async def list(self) -> Any:
        """List the models available on the Ollama server."""

        return await self.client.list()

    async def aclose(self) -> None:
        """Close the underlying client when it supports closing."""

        client = self._client
        if client is None:
            return
        for name in ("aclose", "close"):
            closer = getattr(client, name, None)
            if callable(closer):
                result = closer()
                if inspect.isawaitable(result):
                    await result
                return


#: Natural alias used by callers that prefer the ``Ollama`` prefix.
Ollama = OllamaClient


def default_client() -> OllamaClient:
    """Return a new :class:`OllamaClient` using the global configuration."""

    return OllamaClient()


def create_ollama_client(
    model: Optional[str] = None,
    host: Optional[str] = None,
    api_key: Optional[str] = None,
    **kwargs: Any,
) -> OllamaClient:
    """Create a configured :class:`OllamaClient` wrapper."""

    return OllamaClient(model=model, host=host, api_key=api_key, **kwargs)


# ``get_ollama_client`` is the vocabulary used by callers that treat the
# wrapper as a factory.
get_ollama_client = create_ollama_client
