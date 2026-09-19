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

"""WebSocket handlers for the one-shot AI prompt framework.

This module wires the ``quick_prompt_*`` message types described in
``design/dd_one_shot_ai.md`` section 5 into the shared
:class:`~api.websocket_manager.ConnectionManager`. All messages reuse the
existing :class:`~api.websocket_manager.WSMessage` model (``type``, ``id``,
``payload``).

Outbound (client → server):

* ``quick_prompt``             — start a one-shot run,
* ``quick_prompt_stream_cmd``  — toggle token streaming for a run,
* ``quick_prompt_cancel``      — cancel an in-flight run,
* ``quick_prompt_accept``      — record that the client accepted a result,
* ``quick_prompt_reject``      — record that the client rejected a result.

Inbound (server → client) — produced by the
:class:`~api.oneprompt.runner.OnePromptRunner` and relayed to the originating
WebSocket through the sender built here:

* ``quick_prompt_start``,
* ``quick_prompt_rendered``,
* ``quick_prompt_stream``,
* ``quick_prompt_result``,
* ``quick_prompt_error``.

The request path is fire-and-forget: :func:`handle_quick_prompt` schedules the
run on the runner (via :meth:`OnePromptRunner.handle_quick_prompt`) and the
runner emits the lifecycle events asynchronously through the WebSocket sender.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from functools import partial
from typing import Any, Optional

from fastapi import WebSocket

from api.oneprompt.registry import PromptRegistry
from api.oneprompt.registry import registry as default_registry
from api.oneprompt.runner import (
    EVENT_ERROR,
    EVENT_RENDERED,
    EVENT_RESULT,
    EVENT_START,
    EVENT_STREAM,
    STATUS_ERROR,
    OnePromptRunner,
    get_runner,
)
from api.websocket_manager import ConnectionManager, WSMessage
from api.websocket_manager import manager as default_manager

logger = logging.getLogger(__name__)

__all__ = [
    "INBOUND_MESSAGE_TYPES",
    "OUTBOUND_MESSAGE_TYPES",
    "QUICK_PROMPT",
    "QUICK_PROMPT_ACCEPT",
    "QUICK_PROMPT_CANCEL",
    "QUICK_PROMPT_REJECT",
    "QUICK_PROMPT_STREAM_CMD",
    "handle_quick_prompt",
    "handle_quick_prompt_accept",
    "handle_quick_prompt_cancel",
    "handle_quick_prompt_reject",
    "handle_quick_prompt_stream_cmd",
    "initialize_oneprompt",
    "register_oneprompt_handlers",
    "send_oneprompt_message",
]

# -- Message types ---------------------------------------------------------

QUICK_PROMPT = "quick_prompt"
QUICK_PROMPT_STREAM_CMD = "quick_prompt_stream_cmd"
QUICK_PROMPT_CANCEL = "quick_prompt_cancel"
QUICK_PROMPT_ACCEPT = "quick_prompt_accept"
QUICK_PROMPT_REJECT = "quick_prompt_reject"

#: Outbound (client → server) message types handled by this module.
OUTBOUND_MESSAGE_TYPES = (
    QUICK_PROMPT,
    QUICK_PROMPT_STREAM_CMD,
    QUICK_PROMPT_CANCEL,
    QUICK_PROMPT_ACCEPT,
    QUICK_PROMPT_REJECT,
)

#: Inbound (server → client) message types emitted by the runner.
INBOUND_MESSAGE_TYPES = (
    EVENT_START,
    EVENT_RENDERED,
    EVENT_STREAM,
    EVENT_RESULT,
    EVENT_ERROR,
)


# -- Helpers ---------------------------------------------------------------


def _payload(message: WSMessage) -> dict[str, Any]:
    """Return the message payload as a plain ``dict`` (never ``None``)."""

    payload = message.payload
    if isinstance(payload, Mapping):
        return dict(payload)
    return {}


def _run_id(message: WSMessage, payload: Mapping[str, Any]) -> str:
    """Resolve the run id from the payload, falling back to the message id."""

    run_id = payload.get("runId") or payload.get("run_id") or message.id
    return str(run_id) if run_id else ""


async def send_oneprompt_message(
    websocket: WebSocket,
    message_type: str,
    payload: dict[str, Any],
    *,
    message_id: str = "",
) -> None:
    """Send a single ``quick_prompt_*`` message over ``websocket``."""

    await websocket.send_text(
        WSMessage(type=message_type, id=message_id, payload=payload).model_dump_json()
    )


def _make_sender(websocket: WebSocket):
    """Build the runner sender callback bound to ``websocket``.

    The runner emits ``{"type", "id", "payload"}`` mappings; they are forwarded
    verbatim to the originating client as :class:`WSMessage` JSON.
    """

    async def _send(message: Any) -> None:
        if isinstance(message, Mapping):
            message_type = str(message.get("type", ""))
            message_id = str(message.get("id", "") or "")
            payload = message.get("payload", {})
        else:  # pragma: no cover - defensive, runner always sends mappings
            message_type = ""
            message_id = ""
            payload = message
        await send_oneprompt_message(
            websocket, message_type, payload, message_id=message_id
        )

    return _send


# -- Handlers --------------------------------------------------------------


async def handle_quick_prompt(
    message: WSMessage,
    websocket: WebSocket,
    runner: Optional[OnePromptRunner] = None,
) -> None:
    """Handle an inbound ``quick_prompt`` request (fire-and-forget).

    Schedules the run on ``runner`` (defaults to the process-wide runner) with a
    sender bound to ``websocket`` so the ``quick_prompt_start`` /
    ``quick_prompt_result`` / ``quick_prompt_error`` lifecycle messages reach the
    requesting client.
    """

    runner = runner if runner is not None else get_runner()
    payload = _payload(message)
    run_id = _run_id(message, payload)
    prompt_id = str(payload.get("promptId") or payload.get("prompt_id") or "")
    context = payload.get("context")
    if not isinstance(context, Mapping):
        context = {}

    sender = _make_sender(websocket)
    try:
        runner.handle_quick_prompt(payload, sender=sender)
    except Exception as exc:  # noqa: BLE001 - malformed requests must not crash
        logger.warning("Rejected quick_prompt request %s: %s", run_id, exc)
        error_payload = {
            "runId": run_id,
            "promptId": prompt_id,
            "context": context,
            "error": str(exc),
            "status": getattr(exc, "status", STATUS_ERROR),
            "meta": {},
            "result": None,
        }
        await send_oneprompt_message(
            websocket, EVENT_ERROR, error_payload, message_id=run_id
        )


async def handle_quick_prompt_stream_cmd(
    message: WSMessage,
    websocket: WebSocket,
    runner: Optional[OnePromptRunner] = None,
) -> None:
    """Handle a ``quick_prompt_stream_cmd`` request: ``{runId, enable}``."""

    runner = runner if runner is not None else get_runner()
    payload = _payload(message)
    run_id = _run_id(message, payload)
    enabled = payload.get("enable")
    if enabled is None:
        enabled = payload.get("stream", True)
    runner.set_streaming(run_id, bool(enabled))


async def handle_quick_prompt_cancel(
    message: WSMessage,
    websocket: WebSocket,
    runner: Optional[OnePromptRunner] = None,
) -> None:
    """Handle a ``quick_prompt_cancel`` request: ``{runId}``.

    The runner cancels the underlying asyncio task and emits a terminal
    ``quick_prompt_error`` (``status="cancelled"``) through the sender.
    """

    runner = runner if runner is not None else get_runner()
    payload = _payload(message)
    runner.cancel(_run_id(message, payload))


async def handle_quick_prompt_accept(
    message: WSMessage,
    websocket: WebSocket,
    runner: Optional[OnePromptRunner] = None,
) -> None:
    """Handle a ``quick_prompt_accept`` request: ``{runId, payload}``."""

    runner = runner if runner is not None else get_runner()
    payload = _payload(message)
    runner.accept(_run_id(message, payload), payload.get("payload"))


async def handle_quick_prompt_reject(
    message: WSMessage,
    websocket: WebSocket,
    runner: Optional[OnePromptRunner] = None,
) -> None:
    """Handle a ``quick_prompt_reject`` request: ``{runId}``."""

    runner = runner if runner is not None else get_runner()
    payload = _payload(message)
    runner.reject(_run_id(message, payload))


# -- Wiring ----------------------------------------------------------------


def register_oneprompt_handlers(
    manager: Optional[ConnectionManager] = None,
    runner: Optional[OnePromptRunner] = None,
) -> ConnectionManager:
    """Register every ``quick_prompt_*`` handler on ``manager``.

    Args:
        manager: The connection manager to register with. Defaults to the
            process-wide :data:`api.websocket_manager.manager`.
        runner: Optional runner the handlers are bound to. Defaults to the
            process-wide runner resolved lazily on each message, so swapping
            the global runner (e.g. in tests) is honoured.

    Returns:
        The manager the handlers were registered on.
    """

    manager = manager if manager is not None else default_manager

    handlers = {
        QUICK_PROMPT: handle_quick_prompt,
        QUICK_PROMPT_STREAM_CMD: handle_quick_prompt_stream_cmd,
        QUICK_PROMPT_CANCEL: handle_quick_prompt_cancel,
        QUICK_PROMPT_ACCEPT: handle_quick_prompt_accept,
        QUICK_PROMPT_REJECT: handle_quick_prompt_reject,
    }

    for message_type, handler in handlers.items():
        if runner is not None:
            manager.register_handler(message_type, partial(handler, runner=runner))
        else:
            manager.register_handler(message_type, handler)

    logger.debug("Registered one-shot prompt WebSocket handlers.")
    return manager


def initialize_oneprompt(
    registry: Optional[PromptRegistry] = None,
) -> dict[str, Any]:
    """(Re)scan the template directory and load the prompt registry.

    Called on application startup (next to the handler registration) so a
    template dropped into the directory is picked up without a restart in
    development and the bundled templates are guaranteed to be loaded.

    Args:
        registry: Registry to reload. Defaults to the process-wide registry.

    Returns:
        The ``promptId -> PromptTemplate`` mapping that was loaded.
    """

    registry = registry if registry is not None else default_registry
    templates = registry.reload()
    logger.info(
        "Loaded %d one-shot prompt template(s) from %s.",
        len(templates),
        registry.templates_dir,
    )
    return templates
