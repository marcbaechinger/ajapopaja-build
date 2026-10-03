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

"""Orchestration for the one-shot AI prompt framework.

:class:`OnePromptRunner` executes the pipeline described in
``design/dd_one_shot_ai.md`` sections 3 and 4.1:

    pre-hook → render → post-render hook → Ollama → post-response hook → send

A run is identified by its ``runId`` and tracked in an in-flight map so it can
be streamed, cancelled or timed out. The request path is fire-and-forget:
:meth:`OnePromptRunner.start` schedules the work with
:func:`asyncio.create_task` and returns immediately, while
:meth:`OnePromptRunner.execute` / :meth:`OnePromptRunner.run` await the full
pipeline (handy for tests and for callers that want the terminal payload).

The runner emits the structured lifecycle events defined by the WebSocket
protocol:

* ``quick_prompt_start``    — the request was accepted,
* ``quick_prompt_rendered`` — the final rendered prompt (optional),
* ``quick_prompt_stream``   — a streamed token/delta (optional),
* ``quick_prompt_result``   — terminal success payload,
* ``quick_prompt_error``    — terminal error payload
  (``status`` ∈ ``error``, ``not_found``, ``unavailable``, ``cancelled``,
  ``timeout``).

The destination is a ``sender`` callback. It may be:

* an async (or sync) callable taking the full message dict
  ``{"type": ..., "id": ..., "payload": ...}``, or
* an async (or sync) callable taking ``(message_type, payload)``.

The runner inspects the callback signature and dispatches accordingly, so both
styles work without an adapter.
"""

from __future__ import annotations

import asyncio
import inspect
import logging
import time
import uuid
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass, field
from typing import Any, Optional, Union

from core import config

from api.ollama_utils import is_ollama_available
from api.oneprompt.hooks import (
    PromptHook,
    get_hook,
    run_post_render,
    run_post_response,
    run_pre_render,
)
from api.oneprompt.ollama_client import (
    OllamaClient,
    OllamaUnavailableError,
)
from api.oneprompt.registry import (
    PromptError,
    PromptRegistry,
    get_registry,
)
from api.oneprompt.renderer import render_template

logger = logging.getLogger(__name__)

__all__ = [
    "DEFAULT_TIMEOUT",
    "EVENT_RENDERED",
    "EVENT_RESULT",
    "EVENT_START",
    "EVENT_STREAM",
    "EVENT_ERROR",
    "OnePromptRunner",
    "PromptRun",
    "PromptRunStatus",
    "STATUS_CANCELLED",
    "STATUS_ERROR",
    "STATUS_NOT_FOUND",
    "STATUS_OK",
    "STATUS_RUNNING",
    "STATUS_TIMEOUT",
    "STATUS_UNAVAILABLE",
    "Sender",
    "dispatch_message",
    "extract_content",
    "get_runner",
    "runner",
]

#: Default per-run deadline in seconds (overridable per template/run).
DEFAULT_TIMEOUT = 60.0

#: Lifecycle status values (mirror the WebSocket ``status`` field).
STATUS_RUNNING = "running"
STATUS_OK = "ok"
STATUS_ERROR = "error"
STATUS_CANCELLED = "cancelled"
STATUS_TIMEOUT = "timeout"
STATUS_UNAVAILABLE = "unavailable"
STATUS_NOT_FOUND = "not_found"

#: WebSocket message types emitted by the runner.
EVENT_START = "quick_prompt_start"
EVENT_RENDERED = "quick_prompt_rendered"
EVENT_STREAM = "quick_prompt_stream"
EVENT_RESULT = "quick_prompt_result"
EVENT_ERROR = "quick_prompt_error"

#: A sender receives either a full message dict or ``(type, payload)``.
Sender = Callable[..., Any]


def _new_run_id() -> str:
    """Generate a fresh run id (a UUID string)."""

    return str(uuid.uuid4())


def _maybe_await(value: Any) -> Awaitable[Any]:
    """Wrap ``value`` so it can always be awaited."""

    async def _resolve() -> Any:
        if inspect.isawaitable(value):
            return await value
        return value

    return _resolve()


def _sender_arity(sender: Sender) -> int:
    """Best-effort count of positional parameters accepted by ``sender``."""

    try:
        signature = inspect.signature(sender)
    except (TypeError, ValueError):  # pragma: no cover - builtins etc.
        return 1

    count = 0
    for parameter in signature.parameters.values():
        if parameter.kind in (
            inspect.Parameter.POSITIONAL_ONLY,
            inspect.Parameter.POSITIONAL_OR_KEYWORD,
        ):
            count += 1
        elif parameter.kind is inspect.Parameter.VAR_POSITIONAL:
            # ``*args`` means it can accept any number; prefer the one-arg form.
            return 1
    return count


async def dispatch_message(
    sender: Optional[Sender], message: Mapping[str, Any]
) -> None:
    """Send ``message`` through ``sender`` (sync or async).

    ``sender`` may accept the whole message dict or ``(type, payload)``; both
    shapes are supported. A ``None`` sender is a no-op.
    """

    if sender is None:
        return

    if _sender_arity(sender) >= 2:
        result = sender(message.get("type", ""), message.get("payload", {}))
    else:
        result = sender(dict(message))

    if inspect.isawaitable(result):
        await result


def extract_content(response: Any) -> str:
    """Extract the textual content from an Ollama response or stream chunk.

    Handles the shapes returned by ``ollama.AsyncClient`` (pydantic objects and
    plain dicts), including ``chat`` (``message.content``), ``generate``
    (``response``) and generic ``content``/``text``/``output`` mappings.
    """

    if response is None:
        return ""
    if isinstance(response, str):
        return response
    if isinstance(response, (bytes, bytearray)):
        return response.decode("utf-8", errors="replace")

    if isinstance(response, Mapping):
        message = response.get("message")
        if isinstance(message, Mapping):
            content = message.get("content")
            if content is not None:
                return str(content)
        elif isinstance(message, str):
            return message
        for key in ("response", "content", "text", "output"):
            if key in response and response[key] is not None:
                return str(response[key])
        return ""

    # Attribute based (pydantic) responses.
    message = getattr(response, "message", None)
    if message is not None:
        if isinstance(message, Mapping):
            content = message.get("content")
        else:
            content = getattr(message, "content", None)
        if content is not None:
            return str(content)
        if isinstance(message, str):
            return message

    for attribute in ("response", "content", "text", "output"):
        value = getattr(response, attribute, None)
        if value is not None:
            return str(value)

    model_dump = getattr(response, "model_dump", None)
    if callable(model_dump):
        try:
            return extract_content(model_dump())
        except Exception:  # pragma: no cover - defensive
            return ""

    return ""


def _coerce_timeout(value: Any) -> Optional[float]:
    """Coerce a timeout value to a positive float, or ``None``."""

    if value is None:
        return None
    try:
        timeout = float(value)
    except (TypeError, ValueError):
        return None
    if timeout <= 0:
        return None
    return timeout


@dataclass
class PromptRun:
    """State of a single one-shot execution, keyed by ``runId``."""

    run_id: str
    prompt_id: str
    context: dict[str, Any] = field(default_factory=dict)
    status: str = STATUS_RUNNING
    stream: bool = False
    timeout: float = DEFAULT_TIMEOUT
    prompt: Optional[str] = None
    result: Any = None
    error: Optional[str] = None
    meta: dict[str, Any] = field(default_factory=dict)
    task: Optional[asyncio.Task] = None
    sender: Optional[Sender] = None
    created_at: float = field(default_factory=time.monotonic)
    finished_at: Optional[float] = None

    # -- introspection helpers ----------------------------------------
    @property
    def runId(self) -> str:  # noqa: N802 - mirror the protocol field name
        return self.run_id

    @property
    def promptId(self) -> str:  # noqa: N802 - mirror the protocol field name
        return self.prompt_id

    @property
    def is_running(self) -> bool:
        return self.status == STATUS_RUNNING and not self.is_done

    @property
    def is_done(self) -> bool:
        return self.status != STATUS_RUNNING

    @property
    def elapsed(self) -> float:
        end = self.finished_at if self.finished_at is not None else time.monotonic()
        return max(0.0, end - self.created_at)

    @property
    def cancelled(self) -> bool:
        return self.status == STATUS_CANCELLED

    def to_payload(self, *, include_result: bool = True) -> dict[str, Any]:
        """Build the terminal ``quick_prompt_result``/``error`` payload."""

        payload: dict[str, Any] = {
            "runId": self.run_id,
            "promptId": self.prompt_id,
            "context": self.context,
            "status": self.status,
            "meta": self.meta,
        }
        if self.status == STATUS_OK:
            payload["result"] = self.result
            payload["error"] = None
        else:
            payload["error"] = self.error
            payload["result"] = self.result if include_result else None
        return payload

    async def wait(self) -> "PromptRun":
        """Wait for the background task (if any) and return this run."""

        if self.task is not None:
            try:
                await self.task
            except asyncio.CancelledError:  # pragma: no cover - defensive
                pass
        return self

    def __await__(self):
        return self.wait().__await__()


class OnePromptRunner:
    """Orchestrates one-shot prompt runs.

    Args:
        registry: :class:`~api.oneprompt.registry.PromptRegistry` used to
            resolve templates. Defaults to the process-wide registry.
        ollama_client: Ollama client. Any object exposing an async
            ``chat(model=..., messages=..., stream=...)`` works; defaults to a
            configured :class:`~api.oneprompt.ollama_client.OllamaClient`.
        sender / send: Default callback used to emit lifecycle messages.
        default_timeout: Default per-run deadline (seconds).
        streaming: Default streaming flag for new runs.
        emit_rendered: Whether to broadcast the ``quick_prompt_rendered`` event
            (disabled by default; it is always logged).
        check_availability: When ``True`` the runner asks the client to verify
            Ollama before calling it. Disabled by default because the client
            wrapper already performs the check; enable it for a runner-level
            early/consistent error.
    """

    def __init__(
        self,
        registry: Optional[PromptRegistry] = None,
        ollama_client: Any = None,
        *,
        client: Any = None,
        sender: Optional[Sender] = None,
        send: Optional[Sender] = None,
        default_timeout: float = DEFAULT_TIMEOUT,
        timeout: Optional[float] = None,
        streaming: bool = False,
        emit_rendered: bool = False,
        check_availability: Optional[bool] = None,
    ) -> None:
        self.registry = registry if registry is not None else get_registry()
        self.ollama_client = ollama_client or client or OllamaClient()
        self.sender = sender or send
        self.default_timeout = (
            _coerce_timeout(timeout if timeout is not None else default_timeout)
            or DEFAULT_TIMEOUT
        )
        self.streaming = streaming
        self.emit_rendered = emit_rendered
        self.check_availability = check_availability
        self._runs: dict[str, PromptRun] = {}

    # ------------------------------------------------------------------
    # In-flight tracking
    # ------------------------------------------------------------------
    @property
    def runs(self) -> dict[str, PromptRun]:
        """A shallow copy of the ``runId -> PromptRun`` map."""

        return dict(self._runs)

    @property
    def in_flight(self) -> dict[str, PromptRun]:
        """The currently running runs, keyed by ``runId``."""

        return {
            run_id: run
            for run_id, run in self._runs.items()
            if run.status == STATUS_RUNNING
        }

    @property
    def active_runs(self) -> dict[str, PromptRun]:
        """Alias for :attr:`in_flight`."""

        return self.in_flight

    def get_run(self, run_id: str) -> Optional[PromptRun]:
        """Return the tracked run for ``run_id`` (or ``None``)."""

        return self._runs.get(run_id)

    def is_running(self, run_id: str) -> bool:
        run = self._runs.get(run_id)
        return bool(run and run.status == STATUS_RUNNING)

    def cleanup(self, *, keep_finished: bool = True) -> None:
        """Drop finished runs from the tracking map (``keep_finished=False``)."""

        if keep_finished:
            return
        self._runs = {
            run_id: run
            for run_id, run in self._runs.items()
            if run.status == STATUS_RUNNING
        }

    def __contains__(self, run_id: object) -> bool:
        return run_id in self._runs

    def __len__(self) -> int:
        return len(self._runs)

    # ------------------------------------------------------------------
    # Creating / scheduling runs
    # ------------------------------------------------------------------
    def create_run(
        self,
        prompt_id: str,
        context: Optional[Mapping[str, Any]] = None,
        *,
        run_id: Optional[str] = None,
        runId: Optional[str] = None,  # noqa: N803 - protocol spelling
        stream: Optional[bool] = None,
        timeout: Optional[float] = None,
        sender: Optional[Sender] = None,
        send: Optional[Sender] = None,
        metadata: Optional[Mapping[str, Any]] = None,
        hook: Optional[PromptHook] = None,
    ) -> PromptRun:
        """Create and register a run without executing it."""

        resolved_id = run_id or runId or _new_run_id()
        resolved_timeout = _coerce_timeout(timeout)
        if resolved_timeout is None:
            resolved_timeout = self._template_timeout(prompt_id) or self.default_timeout
        run = PromptRun(
            run_id=resolved_id,
            prompt_id=prompt_id,
            context=dict(context or {}),
            status=STATUS_RUNNING,
            stream=self.streaming if stream is None else bool(stream),
            timeout=resolved_timeout,
            sender=sender or send or self.sender,
            meta=dict(metadata or {}),
        )
        run.meta.setdefault("promptId", prompt_id)
        run.meta.setdefault("stream", run.stream)
        if hook is not None:
            run.meta["_hook"] = hook
        self._runs[resolved_id] = run
        return run

    def _template_timeout(self, prompt_id: str) -> Optional[float]:
        """Return the per-template timeout from front-matter metadata (or None)."""

        try:
            template = self.registry.get(prompt_id)
        except PromptError:
            return None
        metadata = getattr(template, "metadata", None) or {}
        return _coerce_timeout(metadata.get("timeout"))

    def start(
        self,
        prompt_id: str,
        context: Optional[Mapping[str, Any]] = None,
        **kwargs: Any,
    ) -> PromptRun:
        """Schedule a run with :func:`asyncio.create_task` and return it.

        The request path returns immediately; progress and the terminal payload
        are delivered through the configured ``sender``.
        """

        run = self.create_run(prompt_id, context, **kwargs)
        run.task = asyncio.create_task(self._execute(run))
        return run

    # ``start_run``/``dispatch``/``submit`` are natural synonyms for the
    # fire-and-forget entry point.
    start_run = start
    dispatch = start
    submit = start
    schedule = start

    # ------------------------------------------------------------------
    # Awaitable entry points
    # ------------------------------------------------------------------
    async def execute(
        self,
        run_or_prompt_id: Union[PromptRun, str],
        context: Optional[Mapping[str, Any]] = None,
        **kwargs: Any,
    ) -> PromptRun:
        """Run the full pipeline and return the finished :class:`PromptRun`.

        Accepts either an existing :class:`PromptRun` or a ``prompt_id`` (in
        which case a new run is created).
        """

        if isinstance(run_or_prompt_id, PromptRun):
            run = run_or_prompt_id
            self._runs.setdefault(run.run_id, run)
        else:
            run = self.create_run(run_or_prompt_id, context, **kwargs)
        await self._execute(run)
        return run

    async def run(
        self,
        prompt_id: Union[PromptRun, str],
        context: Optional[Mapping[str, Any]] = None,
        **kwargs: Any,
    ) -> PromptRun:
        """Alias for :meth:`execute` (awaits the full pipeline)."""

        return await self.execute(prompt_id, context, **kwargs)

    # ------------------------------------------------------------------
    # Cancellation / streaming control
    # ------------------------------------------------------------------
    def cancel(self, run_id: str) -> bool:
        """Cancel the in-flight run ``run_id``.

        Returns ``True`` when a running task was cancelled, ``False`` when the
        run is unknown or already finished.
        """

        run = self._runs.get(run_id)
        if run is None or run.status != STATUS_RUNNING:
            return False
        run.status = STATUS_CANCELLED
        if run.task is not None and not run.task.done():
            run.task.cancel()
        return True

    async def cancel_run(self, run_id: str) -> bool:
        """Async variant of :meth:`cancel` that also waits for the task."""

        run = self._runs.get(run_id)
        cancelled = self.cancel(run_id)
        if run is not None and run.task is not None:
            try:
                await run.task
            except asyncio.CancelledError:  # pragma: no cover - defensive
                pass
        return cancelled

    # Cancellation vocabulary used by the WebSocket message type.
    quick_prompt_cancel = cancel
    handle_cancel = cancel

    def set_streaming(self, run_id: str, enabled: bool) -> bool:
        """Toggle token streaming for an in-flight run."""

        run = self._runs.get(run_id)
        if run is None or run.status != STATUS_RUNNING:
            return False
        run.stream = bool(enabled)
        run.meta["stream"] = run.stream
        return True

    # ``quick_prompt_stream_cmd`` vocabulary.
    handle_stream_cmd = set_streaming

    def accept(self, run_id: str, payload: Any = None) -> bool:
        """Record that the client accepted a run's result (optional)."""

        run = self._runs.get(run_id)
        if run is None:
            return False
        run.meta["accepted"] = True
        if payload is not None:
            run.meta["acceptedPayload"] = payload
        return True

    def reject(self, run_id: str) -> bool:
        """Record that the client rejected a run's result (optional)."""

        run = self._runs.get(run_id)
        if run is None:
            return False
        run.meta["rejected"] = True
        return True

    handle_accept = accept
    handle_reject = reject

    def handle_quick_prompt(
        self, payload: Mapping[str, Any], **kwargs: Any
    ) -> PromptRun:
        """Handle a ``quick_prompt`` payload and schedule the run.

        Payload shape: ``{runId, promptId, context}`` (see
        ``design/dd_one_shot_ai.md`` section 5).
        """

        run_id = payload.get("runId") or payload.get("run_id")
        prompt_id = payload.get("promptId") or payload.get("prompt_id")
        context = payload.get("context") or {}
        stream = payload.get("stream")
        timeout = payload.get("timeout")
        if not prompt_id:
            raise ValueError("quick_prompt payload is missing 'promptId'.")
        return self.start(
            str(prompt_id),
            context,
            run_id=str(run_id) if run_id else None,
            stream=stream,
            timeout=timeout,
            **kwargs,
        )

    # ------------------------------------------------------------------
    # Core pipeline
    # ------------------------------------------------------------------
    async def _execute(self, run: PromptRun) -> PromptRun:
        """Execute ``run`` and emit the terminal event. Never raises."""

        await self._emit_start(run)
        try:
            result = await self._run_with_timeout(run)
        except asyncio.CancelledError:
            await self._finish_error(
                run, STATUS_CANCELLED, "The one-shot prompt was cancelled."
            )
        except asyncio.TimeoutError:
            await self._finish_error(
                run,
                STATUS_TIMEOUT,
                f"The one-shot prompt timed out after {run.timeout:g}s.",
            )
        except OllamaUnavailableError as exc:
            await self._finish_error(run, STATUS_UNAVAILABLE, str(exc))
        except PromptError as exc:
            await self._finish_error(
                run, getattr(exc, "status", STATUS_ERROR), str(exc)
            )
        except (ConnectionError, OSError) as exc:
            # Connection failures are surfaced as "unavailable" so the UI can
            # show a friendly message (design section 9).
            await self._finish_error(
                run,
                STATUS_UNAVAILABLE,
                f"Could not reach Ollama: {exc}",
            )
        except Exception as exc:  # pragma: no cover - defensive
            logger.exception("One-shot prompt %s failed.", run.run_id)
            await self._finish_error(run, STATUS_ERROR, str(exc))
        else:
            await self._finish_result(run, result)
        finally:
            run.finished_at = time.monotonic()
        return run

    async def _run_with_timeout(self, run: PromptRun) -> Any:
        """Run the pipeline under the per-run timeout."""

        if run.timeout and run.timeout > 0:
            return await asyncio.wait_for(self._pipeline(run), timeout=run.timeout)
        return await self._pipeline(run)

    async def _pipeline(self, run: PromptRun) -> Any:
        """The transformation pipeline for a single run."""

        if self.check_availability is not False:
            await self._ensure_available()

        hook = run.meta.get("_hook") or self._get_hook(run.prompt_id)

        # 1. pre-render hook (data provider / validation).
        context = await run_pre_render(hook, run.context)
        run.context = dict(context) if isinstance(context, Mapping) else context

        # 2. resolve + render the template.
        template = self.registry.get(run.prompt_id)
        prompt = render_template(template, run.context)
        run.prompt = prompt

        # 3. post-render hook.
        prompt = await run_post_render(hook, prompt, run.context)
        run.prompt = prompt
        await self._emit_rendered(run)

        # 4. call Ollama, optionally streaming.
        model = self._resolve_model(template, run.context)
        run.meta["model"] = model

        if run.stream:
            raw = await self._stream_ollama(run, prompt, model, hook)
        else:
            raw = await self._chat_ollama(run, prompt, model)

        # 5. post-response hook.
        return await run_post_response(hook, raw, run.context)

    def _get_hook(self, prompt_id: str) -> PromptHook:
        """Resolve the hook for ``prompt_id`` (overridable in tests)."""

        return get_hook(prompt_id)

    async def _ensure_available(self) -> None:
        """Runner-level availability check.

        The client wrapper normally performs this check itself (see
        :class:`~api.oneprompt.ollama_client.OllamaClient`). The runner offers
        an optional early check:

        * ``check_availability=False`` — never check here,
        * ``check_availability=True``  — always check (falling back to the
          module-level :func:`api.ollama_utils.is_ollama_available` when the
          client does not implement a check),
        * ``check_availability=None``  — check only when the client exposes an
          ``ensure_available``/``is_available`` method (never using the global
          cached health check for duck-typed/mocked clients).
        """

        if self.check_availability is False:
            return

        client = self.ollama_client
        ensure = getattr(client, "ensure_available", None)
        if callable(ensure):
            await _maybe_await(ensure())
            return
        is_available = getattr(client, "is_available", None)
        if callable(is_available):
            available = await _maybe_await(is_available())
            if not available:
                raise OllamaUnavailableError()
            return
        if self.check_availability:
            available = await is_ollama_available()
            if not available:
                raise OllamaUnavailableError()

    async def _invoke_chat(self, **kwargs: Any) -> Any:
        """Call the Ollama client's ``chat`` and normalise the result.

        Supports clients whose ``chat`` is a coroutine (the standard
        ``ollama.AsyncClient`` shape) as well as plain functions returning an
        async iterator directly.
        """

        result = self.ollama_client.chat(**kwargs)
        if inspect.isawaitable(result):
            result = await result
        return result

    async def _chat_ollama(self, run: PromptRun, prompt: str, model: str) -> str:
        """Perform a non-streaming chat call and return the raw output."""

        response = await self._invoke_chat(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            stream=False,
        )
        return extract_content(response)

    async def _stream_ollama(
        self, run: PromptRun, prompt: str, model: str, hook: PromptHook
    ) -> str:
        """Perform a streaming chat call, emitting each delta.

        Returns the accumulated raw output (before the post-response hook is
        applied to the full result).
        """

        response = await self._invoke_chat(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            stream=True,
        )

        chunks: list[str] = []
        async for chunk in response:
            delta = extract_content(chunk)
            if not delta:
                continue
            chunks.append(delta)
            # Design section 4.1: the response hook applies to streamed chunks
            # too, so an interception/transformation is honoured live.
            if hook.post_response is not None:
                delta = await run_post_response(hook, delta, run.context)
            await self._emit_stream(run, delta)
        return "".join(chunks)

    def _resolve_model(self, template: Any, context: Mapping[str, Any]) -> str:
        """Resolve the model from the template metadata (default config)."""

        raw = getattr(template, "model", None) or ""
        if raw:
            try:
                resolved = render_template(str(raw), context).strip()
            except PromptError:
                resolved = ""
            if resolved:
                return resolved
        return config.ONE_PROMPT_OLLAMA_MODEL

    # ------------------------------------------------------------------
    # Event emission
    # ------------------------------------------------------------------
    def _message(self, message_type: str, payload: dict[str, Any]) -> dict[str, Any]:
        return {
            "type": message_type,
            "id": payload.get("runId", ""),
            "payload": payload,
        }

    async def _emit(
        self,
        run: PromptRun,
        message_type: str,
        payload: dict[str, Any],
    ) -> None:
        sender = run.sender or self.sender
        message = self._message(message_type, payload)
        try:
            await dispatch_message(sender, message)
        except Exception:  # pragma: no cover - a broken sender must not fail a run
            logger.exception("Failed to emit %s for run %s.", message_type, run.run_id)

    async def _emit_start(self, run: PromptRun) -> None:
        await self._emit(
            run,
            EVENT_START,
            {
                "runId": run.run_id,
                "promptId": run.prompt_id,
                "context": run.context,
                "status": STATUS_RUNNING,
            },
        )

    async def _emit_rendered(self, run: PromptRun) -> None:
        logger.debug(
            "One-shot prompt %s (%s) rendered: %s",
            run.run_id,
            run.prompt_id,
            run.prompt,
        )
        if not self.emit_rendered:
            return
        await self._emit(
            run,
            EVENT_RENDERED,
            {
                "runId": run.run_id,
                "promptId": run.prompt_id,
                "prompt": run.prompt,
                "context": run.context,
            },
        )

    async def _emit_stream(self, run: PromptRun, delta: Any) -> None:
        await self._emit(
            run,
            EVENT_STREAM,
            {
                "runId": run.run_id,
                "promptId": run.prompt_id,
                "delta": delta,
                "context": run.context,
            },
        )

    async def _finish_result(self, run: PromptRun, result: Any) -> None:
        run.status = STATUS_OK
        run.result = result
        run.error = None
        run.meta["elapsed"] = run.elapsed
        await self._emit(run, EVENT_RESULT, run.to_payload())

    async def _finish_error(self, run: PromptRun, status: str, error: str) -> None:
        run.status = status
        run.error = error
        run.meta["elapsed"] = run.elapsed
        await self._emit(run, EVENT_ERROR, run.to_payload())

    # ------------------------------------------------------------------
    # Shutdown
    # ------------------------------------------------------------------
    async def shutdown(self) -> None:
        """Cancel every in-flight run (used on application shutdown)."""

        for run_id in list(self.in_flight):
            await self.cancel_run(run_id)

    close = shutdown


#: Process-wide default runner (lazily configured, no sender).
runner: OnePromptRunner = OnePromptRunner()


def get_runner() -> OnePromptRunner:
    """Return the process-wide :data:`runner`."""

    return runner


#: Alias for callers that prefer the explicit ``one_prompt_runner`` name.
one_prompt_runner = runner


#: Enum-like namespace for callers that prefer grouped status constants.
class PromptRunStatus:
    RUNNING = STATUS_RUNNING
    OK = STATUS_OK
    ERROR = STATUS_ERROR
    CANCELLED = STATUS_CANCELLED
    TIMEOUT = STATUS_TIMEOUT
    UNAVAILABLE = STATUS_UNAVAILABLE
    NOT_FOUND = STATUS_NOT_FOUND
