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

"""Tests for the one-shot prompt hook registry."""

from __future__ import annotations

import asyncio

import pytest

from api.oneprompt.hooks import (
    DEFAULT_HOOK,
    NOOP_HOOK,
    HookError,
    PromptHook,
    PromptHookError,
    PromptRejectedError,
    apply_post_render,
    apply_post_response,
    apply_pre_render,
    clear_hooks,
    get_hook,
    has_hook,
    hook_for,
    hooks,
    register_hook,
    registered_hooks,
    run_post_render,
    run_post_response,
    run_pre_render,
    unregister_hook,
)


@pytest.fixture(autouse=True)
def clean_registry():
    """Keep the process-wide registry isolated between tests."""

    snapshot = registered_hooks()
    clear_hooks()
    yield
    clear_hooks()
    hooks.update(snapshot)


# ---------------------------------------------------------------------------
# Default no-op hook
# ---------------------------------------------------------------------------


def test_get_hook_returns_default_noop_for_unknown_id():
    hook = get_hook("does-not-exist")

    assert hook is NOOP_HOOK
    assert DEFAULT_HOOK is NOOP_HOOK
    assert hook == PromptHook()
    assert hook.pre_render is None
    assert hook.post_render is None
    assert hook.post_response is None


async def test_noop_hook_is_identity():
    hook = get_hook("does-not-exist")
    context = {"task_id": "t1"}

    assert await hook.run_pre_render(context) is context
    assert await hook.run_post_render("prompt", context) == "prompt"
    marker = object()
    assert await hook.run_post_response(marker, context) is marker


def test_hook_for_is_an_alias_for_get_hook():
    assert hook_for is get_hook


# ---------------------------------------------------------------------------
# pre_render stage
# ---------------------------------------------------------------------------


async def test_pre_render_transforms_context():
    register_hook(
        "prompt", PromptHook(pre_render=lambda context: {**context, "extra": 1})
    )

    result = await run_pre_render("prompt", {"base": True})

    assert result == {"base": True, "extra": 1}


async def test_pre_render_supports_async_hooks():
    async def enrich(context):
        await asyncio.sleep(0)
        return {**context, "async": True}

    register_hook("prompt", PromptHook(pre_render=enrich))

    assert await run_pre_render("prompt", {}) == {"async": True}


async def test_pre_render_none_keeps_context():
    register_hook("prompt", PromptHook(pre_render=lambda context: None))

    assert await run_pre_render("prompt", {"a": 1}) == {"a": 1}


def test_pre_render_stage_is_directly_callable_for_sync_hooks():
    hook = PromptHook(pre_render=lambda context: {**context, "x": 2})

    assert hook.pre_render({"x": 1}) == {"x": 2}


# ---------------------------------------------------------------------------
# post_render stage
# ---------------------------------------------------------------------------


async def test_post_render_transforms_prompt():
    register_hook(
        "prompt",
        PromptHook(post_render=lambda prompt, context: f"[{context['name']}] {prompt}"),
    )

    result = await run_post_render("prompt", "Hello", {"name": "Ada"})

    assert result == "[Ada] Hello"


async def test_post_render_supports_async_hooks():
    async def decorate(prompt, context):
        await asyncio.sleep(0)
        return prompt.upper()

    register_hook("prompt", PromptHook(post_render=decorate))

    assert await run_post_render("prompt", "hello", {}) == "HELLO"


async def test_post_render_none_keeps_prompt():
    register_hook("prompt", PromptHook(post_render=lambda prompt, context: None))

    assert await run_post_render("prompt", "hello", {}) == "hello"


# ---------------------------------------------------------------------------
# post_response stage
# ---------------------------------------------------------------------------


async def test_post_response_transforms_output():
    register_hook(
        "prompt",
        PromptHook(post_response=lambda output, context: output["content"].strip()),
    )

    result = await run_post_response("prompt", {"content": "  answer  "}, {})

    assert result == "answer"


async def test_post_response_supports_async_hooks():
    async def extract(output, context):
        await asyncio.sleep(0)
        return output["text"]

    register_hook("prompt", PromptHook(post_response=extract))

    assert await run_post_response("prompt", {"text": "x"}, {}) == "x"


async def test_post_response_can_return_none():
    register_hook("prompt", PromptHook(post_response=lambda output, context: None))

    assert await run_post_response("prompt", "raw", {}) is None


# ---------------------------------------------------------------------------
# Reject path
# ---------------------------------------------------------------------------


async def test_hook_can_reject_in_pre_render():
    def reject(context):
        raise PromptRejectedError("spec must not be empty")

    register_hook("prompt", PromptHook(pre_render=reject))

    with pytest.raises(PromptRejectedError) as excinfo:
        await run_pre_render("prompt", {"task_id": "t1"})

    assert "spec must not be empty" in str(excinfo.value)
    assert excinfo.value.status == "error"


async def test_hook_can_reject_in_post_render():
    def reject(prompt, context):
        raise PromptHookError("prompt looks unsafe")

    register_hook("prompt", PromptHook(post_render=reject))

    with pytest.raises(PromptHookError):
        await run_post_render("prompt", "rendered", {})


async def test_hook_can_reject_in_post_response():
    def reject(output, context):
        raise PromptRejectedError("model returned an empty response")

    register_hook("prompt", PromptHook(post_response=reject))

    with pytest.raises(PromptRejectedError):
        await run_post_response("prompt", "", {})


def test_reject_error_status_can_be_overridden():
    error = PromptHookError(
        "pipeline gone", status="not_found", prompt_id="task_elaborate_spec"
    )

    assert str(error) == "pipeline gone"
    assert error.status == "not_found"
    assert error.prompt_id == "task_elaborate_spec"


def test_hook_error_subclasses_prompt_error():
    from api.oneprompt.registry import PromptError

    assert issubclass(PromptHookError, PromptError)
    assert HookError is PromptHookError


# ---------------------------------------------------------------------------
# Registry behaviour
# ---------------------------------------------------------------------------


def test_register_hook_instance_and_get():
    hook = PromptHook(pre_render=lambda context: context)
    returned = register_hook("prompt", hook)

    assert returned is hook
    assert get_hook("prompt") is hook
    assert has_hook("prompt")
    assert "prompt" in hooks
    assert registered_hooks() == {"prompt": hook}


def test_register_hook_with_individual_stages():
    async def pre(context):
        return context

    def post(prompt, context):
        return prompt

    hook = register_hook("prompt", pre_render=pre, post_render=post)

    assert isinstance(hook, PromptHook)
    assert hook.pre_render is pre
    assert hook.post_render is post
    assert hook.post_response is None
    assert get_hook("prompt") is hook


async def test_register_hook_with_no_stages_executes_as_noop():
    hook = register_hook("prompt")

    assert hook.pre_render is None
    context = {"a": 1}
    assert await hook.run_pre_render(context) is context
    assert await hook.run_post_render("p", context) == "p"
    marker = object()
    assert await hook.run_post_response(marker, context) is marker


def test_register_hook_replace_false():
    register_hook("prompt", PromptHook())

    with pytest.raises(PromptHookError):
        register_hook("prompt", PromptHook(), replace=False)


def test_register_hook_rejects_bad_arguments():
    with pytest.raises(TypeError):
        register_hook("prompt", "not-a-hook")

    with pytest.raises(TypeError):
        register_hook("prompt", PromptHook(), pre_render=lambda context: context)

    with pytest.raises(ValueError):
        register_hook("", PromptHook())


def test_unregister_hook():
    hook = register_hook("prompt", PromptHook())

    assert unregister_hook("prompt") is hook
    assert not has_hook("prompt")
    assert get_hook("prompt") is NOOP_HOOK
    assert unregister_hook("prompt") is None


def test_registered_hooks_is_a_copy():
    register_hook("prompt", PromptHook())

    snapshot = registered_hooks()
    snapshot.clear()

    assert has_hook("prompt")


# ---------------------------------------------------------------------------
# Module-level helpers accept a hook object as well as an id
# ---------------------------------------------------------------------------


async def test_run_helpers_accept_a_hook_instance():
    hook = PromptHook(
        pre_render=lambda context: {**context, "pre": True},
        post_render=lambda prompt, context: prompt + "!",
        post_response=lambda output, context: output.upper(),
    )

    assert await run_pre_render(hook, {}) == {"pre": True}
    assert await run_post_render(hook, "hi", {}) == "hi!"
    assert await run_post_response(hook, "hi", {}) == "HI"


def test_apply_aliases():
    assert apply_pre_render is run_pre_render
    assert apply_post_render is run_post_render
    assert apply_post_response is run_post_response
