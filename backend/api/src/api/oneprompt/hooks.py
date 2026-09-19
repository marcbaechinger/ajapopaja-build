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

"""Hook registry for the one-shot AI prompt framework.

A :class:`PromptHook` bundles up to three optional stages that are applied
around a one-shot prompt execution (see ``design/dd_one_shot_ai.md`` §4.1):

``pre_render(context) -> dict``
    Enrich and/or validate the context *before* the template is rendered. Data
    providers such as the ones in :mod:`api.oneprompt.context` live here.

``post_render(prompt, context) -> str``
    Transform the rendered prompt before it is handed to the model.

``post_response(raw_output, context) -> Any``
    Transform the raw model output into the payload that is sent to the client.

All three stages are optional. They may be synchronous or asynchronous; the
``run_*`` / ``apply_*`` helpers accept both and await the result when needed.

A hook can **reject** a request by raising :class:`PromptHookError` (or the
:class:`PromptRejectedError` alias). The exception carries a ``status``
attribute mirroring the terminal status field of the ``quick_prompt_error``
WebSocket message so it can be returned to the client verbatim.
"""

from __future__ import annotations

import inspect
import logging
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any, Optional, Union

from api.oneprompt.registry import PromptError

logger = logging.getLogger(__name__)

__all__ = [
    "DEFAULT_HOOK",
    "HookError",
    "HookRejectedError",
    "NOOP_HOOK",
    "PostRenderStage",
    "PostResponseStage",
    "PreRenderStage",
    "PromptContext",
    "PromptHook",
    "PromptHookError",
    "PromptHookRejectedError",
    "PromptRejectedError",
    "RequestRejectedError",
    "apply_post_render",
    "apply_post_response",
    "apply_pre_render",
    "clear_hooks",
    "get_hook",
    "has_hook",
    "hook_for",
    "hooks",
    "register_hook",
    "registered_hooks",
    "run_post_render",
    "run_post_response",
    "run_pre_render",
    "unregister_hook",
]

#: A context object is a free-form mapping (``dict[str, Any]``).
PromptContext = Mapping[str, Any]

#: ``pre_render(context) -> dict``
PreRenderStage = Callable[[Any], Any]
#: ``post_render(prompt, context) -> str``
PostRenderStage = Callable[[Any, Any], Any]
#: ``post_response(raw_output, context) -> Any``
PostResponseStage = Callable[[Any, Any], Any]


class PromptHookError(PromptError):
    """Base class for errors raised by a :class:`PromptHook`.

    Raising this (or a subclass) from any stage rejects the request. The clear
    message is surfaced to the client as the ``quick_prompt_error`` payload.

    Args:
        message: Human-readable reason for the rejection.
        status: Optional terminal status (``"error"`` by default). One of
            ``"error"``, ``"not_found"``, ``"unavailable"``, ``"cancelled"`` or
            ``"timeout"`` (see the design document, section 5).
        prompt_id: Optional prompt id the hook was registered for, useful for
            logging/trace correlation.
    """

    status = "error"

    def __init__(
        self,
        message: str,
        *,
        status: Optional[str] = None,
        prompt_id: Optional[str] = None,
    ) -> None:
        self.prompt_id = prompt_id
        if status is not None:
            self.status = status
        super().__init__(message)


class PromptRejectedError(PromptHookError):
    """Raised by a hook to reject a one-shot request.

    Behaves exactly like :class:`PromptHookError`; it exists as a separate
    type so callers/tests can express the intent ("this request was rejected")
    without inspecting the message.
    """

    status = "error"


async def _maybe_await(value: Any) -> Any:
    """Await ``value`` when it is awaitable, otherwise return it as-is."""

    if inspect.isawaitable(value):
        return await value
    return value


@dataclass
class PromptHook:
    """A set of optional transformation stages for a one-shot prompt.

    Every stage is optional. When a stage is not provided it is treated as a
    no-op by the ``run_*`` helpers, so the hook is always safe to execute.

    The stage callables are stored verbatim, which means synchronous hooks can
    also be invoked directly (``hook.pre_render(context)``) while asynchronous
    hooks should go through :meth:`run_pre_render` (or the module-level
    :func:`run_pre_render`) so they are awaited.
    """

    pre_render: Optional[PreRenderStage] = None
    post_render: Optional[PostRenderStage] = None
    post_response: Optional[PostResponseStage] = None

    async def run_pre_render(self, context: Any) -> Any:
        """Run the ``pre_render`` stage (sync or async).

        Returns the context unchanged when no stage is configured. A stage
        that returns ``None`` is treated as "unchanged" so in-place mutating
        hooks keep working.
        """

        if self.pre_render is None:
            return context
        result = await _maybe_await(self.pre_render(context))
        return context if result is None else result

    async def run_post_render(self, prompt: Any, context: Any) -> Any:
        """Run the ``post_render`` stage (sync or async)."""

        if self.post_render is None:
            return prompt
        result = await _maybe_await(self.post_render(prompt, context))
        return prompt if result is None else result

    async def run_post_response(self, raw_output: Any, context: Any) -> Any:
        """Run the ``post_response`` stage (sync or async).

        Unlike the other stages a ``None`` return value is preserved: a hook
        may legitimately decide to drop the model output.
        """

        if self.post_response is None:
            return raw_output
        return await _maybe_await(self.post_response(raw_output, context))


#: Default no-op hook returned by :func:`get_hook` for unknown prompt ids.
#: All stages are ``None``; the ``run_*`` helpers treat them as identity, so an
#: empty :class:`PromptHook` behaves as a no-op.
NOOP_HOOK = PromptHook()

#: Backwards/forwards compatible alias for :data:`NOOP_HOOK`.
DEFAULT_HOOK = NOOP_HOOK

#: Process-wide registry mapping ``promptId -> PromptHook``.
hooks: dict[str, PromptHook] = {}


def register_hook(
    prompt_id: str,
    hook: Optional[PromptHook] = None,
    *,
    pre_render: Optional[PreRenderStage] = None,
    post_render: Optional[PostRenderStage] = None,
    post_response: Optional[PostResponseStage] = None,
    replace: bool = True,
) -> PromptHook:
    """Register a :class:`PromptHook` for ``prompt_id``.

    Can be called either with a ready-made hook::

        register_hook("task_elaborate_spec", PromptHook(pre_render=enrich))

    or with individual stages::

        register_hook("task_elaborate_spec", pre_render=enrich)

    Args:
        prompt_id: The prompt id the hook applies to.
        hook: An existing :class:`PromptHook`, or ``None`` when the stages are
            passed as keyword arguments.
        pre_render / post_render / post_response: Stage callables used to build
            a hook when ``hook`` is not supplied.
        replace: When ``False`` and a hook is already registered, raise a
            :class:`PromptHookError` instead of overwriting it.

    Returns:
        The hook that was registered.
    """

    if hook is not None and not isinstance(hook, PromptHook):
        raise TypeError(
            f"hook must be a PromptHook instance, got {type(hook).__name__}"
        )

    if hook is not None and any(
        stage is not None for stage in (pre_render, post_render, post_response)
    ):
        raise TypeError(
            "Pass either a PromptHook instance or individual stage callables, not both."
        )

    if not prompt_id:
        raise ValueError("prompt_id must be a non-empty string")

    if hook is None:
        hook = PromptHook(
            pre_render=pre_render,
            post_render=post_render,
            post_response=post_response,
        )

    if not replace and prompt_id in hooks:
        raise PromptHookError(
            f"A hook is already registered for prompt {prompt_id!r}.",
            prompt_id=prompt_id,
        )

    hooks[prompt_id] = hook
    logger.debug("Registered one-shot prompt hook for %r.", prompt_id)
    return hook


def get_hook(prompt_id: str) -> PromptHook:
    """Return the hook registered for ``prompt_id``.

    Unknown prompt ids yield :data:`NOOP_HOOK` so callers never have to guard
    against ``None``.
    """

    return hooks.get(prompt_id, NOOP_HOOK)


# `hook_for` is a natural synonym used by some callers.
hook_for = get_hook


def unregister_hook(prompt_id: str) -> Optional[PromptHook]:
    """Remove and return the hook registered for ``prompt_id`` (if any)."""

    return hooks.pop(prompt_id, None)


def clear_hooks() -> None:
    """Remove every registered hook (mainly useful in tests)."""

    hooks.clear()


def has_hook(prompt_id: str) -> bool:
    """Whether a concrete hook (not the no-op default) is registered."""

    return prompt_id in hooks


def registered_hooks() -> dict[str, PromptHook]:
    """A shallow copy of the ``promptId -> PromptHook`` registry."""

    return dict(hooks)


def _resolve(hook: Union[str, PromptHook]) -> PromptHook:
    """Resolve a prompt id or a :class:`PromptHook` to a hook instance."""

    if isinstance(hook, PromptHook):
        return hook
    return get_hook(str(hook))


async def run_pre_render(hook: Union[str, PromptHook], context: Any) -> Any:
    """Run the ``pre_render`` stage of ``hook`` (a prompt id or hook)."""

    return await _resolve(hook).run_pre_render(context)


async def run_post_render(
    hook: Union[str, PromptHook], prompt: Any, context: Any
) -> Any:
    """Run the ``post_render`` stage of ``hook`` (a prompt id or hook)."""

    return await _resolve(hook).run_post_render(prompt, context)


async def run_post_response(
    hook: Union[str, PromptHook], raw_output: Any, context: Any
) -> Any:
    """Run the ``post_response`` stage of ``hook`` (a prompt id or hook)."""

    return await _resolve(hook).run_post_response(raw_output, context)


# Design-document vocabulary: hooks "apply" their transformations.
apply_pre_render = run_pre_render
apply_post_render = run_post_render
apply_post_response = run_post_response


# Common aliases for the rejection error, so callers can pick the spelling
# that reads best in their context.
HookError = PromptHookError
HookRejectedError = PromptRejectedError
PromptHookRejectedError = PromptRejectedError
RequestRejectedError = PromptRejectedError
