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

"""MongoDB-backed data providers for the one-shot AI prompt framework.

The frontend only sends a *small* context (typically just ``taskId`` and
``pipelineId``); the backend re-fetches the authoritative records from MongoDB
and enriches the context before rendering. This module provides that seam.

The first (and currently only) use case is ``task_elaborate_spec``: the
provider loads the task and its pipeline and injects ``pipeline_name``,
``pipeline_id``, ``task_title`` and ``task_spec`` into the context so the
bundled template (``templates/task_elaborate_spec.prompt``) can be rendered.

Data providers are ordinary :class:`~api.oneprompt.hooks.PromptHook`
``pre_render`` stages; they may raise
:class:`~api.oneprompt.hooks.PromptHookError` to reject a request (for example
when the referenced task or pipeline no longer exists).
"""

from __future__ import annotations

import inspect
import logging
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any, Optional

from core.exceptions import EntityNotFoundError
from core.queries.pipeline import get_pipeline_by_id
from core.queries.task import get_task_by_id

from api.oneprompt.hooks import (
    PromptHook,
    PromptHookError,
    register_hook,
    run_pre_render,
    unregister_hook,
)

logger = logging.getLogger(__name__)

__all__ = [
    "TASK_ELABORATE_SPEC",
    "ContextProvider",
    "ContextProviderError",
    "enrich_context",
    "load_task_and_pipeline",
    "provide_context",
    "provide_task_context",
    "register_context_providers",
    "reset_context_providers",
    "task_and_pipeline_provider",
    "unregister_context_providers",
]

#: Prompt id of the bundled first use case.
TASK_ELABORATE_SPEC = "task_elaborate_spec"

#: Accepted aliases for the identifiers in the incoming context. The frontend
#: sends camelCase, while template placeholders and internal code use
#: snake_case, so both spellings are understood.
_TASK_ID_KEYS = ("task_id", "taskId")
_PIPELINE_ID_KEYS = ("pipeline_id", "pipelineId")


class ContextProviderError(PromptHookError):
    """Raised when a data provider cannot enrich the context.

    Subclasses :class:`~api.oneprompt.hooks.PromptHookError` so the runner can
    turn it into a ``quick_prompt_error`` message. ``status`` defaults to
    ``"error"`` and is set to ``"not_found"`` when the referenced entity does
    not exist.
    """

    status = "error"


def _first_present(context: Mapping[str, Any], *keys: str) -> Optional[Any]:
    """Return the first non-empty value among ``keys`` in ``context``."""

    for key in keys:
        if key in context:
            value = context[key]
            if value is not None and value != "":
                return value
    return None


async def load_task_and_pipeline(context: Any) -> dict:
    """Enrich ``context`` with the referenced task and pipeline.

    The context must contain a task id (``task_id`` or ``taskId``). The
    pipeline id (``pipeline_id`` / ``pipelineId``) is optional and derived from
    the task when omitted.

    Injected keys:

    * ``task_id`` / ``taskId`` — normalised task id,
    * ``pipeline_id`` / ``pipelineId`` — normalised pipeline id,
    * ``pipeline_name`` — the pipeline's display name,
    * ``task_title`` — the task title,
    * ``task_spec`` — the task spec (empty string when unset),
    * ``task_description`` — the task description (empty string when unset).

    Raises:
        ContextProviderError: If the context is not a mapping, has no task id,
            or the task/pipeline cannot be found.
    """

    if not isinstance(context, Mapping):
        raise ContextProviderError(
            f"One-shot prompt context must be a mapping, got {type(context).__name__}."
        )

    task_id = _first_present(context, *_TASK_ID_KEYS)
    if task_id is None:
        raise ContextProviderError(
            "One-shot prompt context is missing a task id "
            "(expected 'taskId' or 'task_id')."
        )
    task_id = str(task_id)

    pipeline_id = _first_present(context, *_PIPELINE_ID_KEYS)

    try:
        task = await get_task_by_id(task_id)
    except EntityNotFoundError as exc:
        raise ContextProviderError(
            f"Task {task_id!r} was not found.",
            status="not_found",
        ) from exc
    except Exception as exc:  # pragma: no cover - defensive
        raise ContextProviderError(f"Could not load task {task_id!r}: {exc}") from exc

    if pipeline_id is None:
        pipeline_id = task.pipeline_id
    pipeline_id = str(pipeline_id)

    try:
        pipeline = await get_pipeline_by_id(pipeline_id)
    except EntityNotFoundError as exc:
        raise ContextProviderError(
            f"Pipeline {pipeline_id!r} was not found.",
            status="not_found",
        ) from exc
    except Exception as exc:  # pragma: no cover - defensive
        raise ContextProviderError(
            f"Could not load pipeline {pipeline_id!r}: {exc}"
        ) from exc

    enriched = dict(context)
    enriched.update(
        {
            "task_id": str(task.id),
            "taskId": str(task.id),
            "pipeline_id": str(pipeline.id),
            "pipelineId": str(pipeline.id),
            "pipeline_name": pipeline.name,
            "task_title": task.title,
            "task_spec": task.spec or "",
            "task_description": task.description or "",
        }
    )
    return enriched


# Natural aliases for the same provider.
task_and_pipeline_provider = load_task_and_pipeline
provide_task_context = load_task_and_pipeline
enrich_context = load_task_and_pipeline


@dataclass
class ContextProvider:
    """A named data provider that can register itself as a hook stage.

    This is a thin convenience wrapper around :func:`load_task_and_pipeline`
    style callables for callers that prefer an object-oriented style::

        provider = ContextProvider(
            name="task_pipeline",
            provide=load_task_and_pipeline,
            prompt_ids=("task_elaborate_spec",),
        )
        provider.register()
    """

    name: str
    provide: Callable[[Any], Any]
    prompt_ids: Iterable[str] = field(default_factory=lambda: (TASK_ELABORATE_SPEC,))

    async def __call__(self, context: Any) -> Any:
        """Run the provider, awaiting it when necessary."""

        result = self.provide(context)
        if inspect.isawaitable(result):
            return await result
        return result

    def register(self) -> "ContextProvider":
        """Register this provider as a ``pre_render`` hook for its prompt ids."""

        for prompt_id in self.prompt_ids:
            register_hook(
                prompt_id,
                PromptHook(pre_render=self.provide),
            )
        return self

    def unregister(self) -> None:
        """Remove this provider's hooks from the registry."""

        for prompt_id in self.prompt_ids:
            unregister_hook(prompt_id)


#: The prompt ids that ship with a default data provider.
DEFAULT_CONTEXT_PROMPTS: tuple[str, ...] = (TASK_ELABORATE_SPEC,)


def register_context_providers(
    prompt_ids: Iterable[str] = DEFAULT_CONTEXT_PROMPTS,
) -> list[PromptHook]:
    """Register the built-in data providers for ``prompt_ids``.

    Registers :func:`load_task_and_pipeline` as the ``pre_render`` stage of a
    :class:`PromptHook` for each prompt id. Returns the registered hooks.
    """

    registered: list[PromptHook] = []
    for prompt_id in prompt_ids:
        hook = PromptHook(pre_render=load_task_and_pipeline)
        register_hook(prompt_id, hook)
        registered.append(hook)
    return registered


def unregister_context_providers(
    prompt_ids: Iterable[str] = DEFAULT_CONTEXT_PROMPTS,
) -> None:
    """Remove the built-in data providers for ``prompt_ids``."""

    for prompt_id in prompt_ids:
        unregister_hook(prompt_id)


async def provide_context(prompt_id: str, context: Any) -> dict:
    """Run the registered data provider for ``prompt_id``.

    Convenience wrapper over the hook registry: resolves the hook for
    ``prompt_id`` and runs its ``pre_render`` stage. Unknown prompt ids fall
    back to the no-op hook and return the context unchanged.
    """

    return await run_pre_render(prompt_id, context)


#: Alias used by callers/tests that want to restore the default state.
reset_context_providers = register_context_providers


def _install_default_providers() -> None:
    """Register the bundled use case's provider on import.

    The first use case (``task_elaborate_spec``) needs the task/pipeline
    enrichment out of the box; later prompts can register their own providers
    explicitly. Registration is skipped when a hook is already present so that
    importing the module never clobbers an explicitly registered hook.
    """

    from api.oneprompt.hooks import has_hook

    for prompt_id in DEFAULT_CONTEXT_PROMPTS:
        if not has_hook(prompt_id):
            register_hook(
                prompt_id,
                PromptHook(pre_render=load_task_and_pipeline),
            )


_install_default_providers()
