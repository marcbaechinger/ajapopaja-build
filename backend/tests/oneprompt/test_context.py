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

"""Tests for the one-shot prompt MongoDB context data providers."""

from __future__ import annotations

import pytest

from api.oneprompt.context import (
    TASK_ELABORATE_SPEC,
    ContextProvider,
    ContextProviderError,
    enrich_context,
    load_task_and_pipeline,
    provide_context,
    provide_task_context,
    register_context_providers,
    reset_context_providers,
    task_and_pipeline_provider,
    unregister_context_providers,
)
from api.oneprompt.hooks import (
    NOOP_HOOK,
    clear_hooks,
    get_hook,
    hooks,
    registered_hooks,
)
from core.models.models import Pipeline, Task


@pytest.fixture(autouse=True)
def clean_registry():
    """Keep the process-wide hook registry isolated between tests."""

    snapshot = registered_hooks()
    clear_hooks()
    yield
    clear_hooks()
    hooks.update(snapshot)


async def _seed_task(spec: str | None = "- do a thing"):
    pipeline = Pipeline(name="Test Pipeline")
    await pipeline.insert()
    task = Task(
        title="Add the feature",
        description="A longer description",
        spec=spec,
        pipeline_id=str(pipeline.id),
    )
    await task.insert()
    return task, pipeline


# ---------------------------------------------------------------------------
# Enrichment
# ---------------------------------------------------------------------------


async def test_load_task_and_pipeline_enriches_context(init_mock_db):
    task, pipeline = await _seed_task()

    enriched = await load_task_and_pipeline(
        {"task_id": str(task.id), "pipeline_id": str(pipeline.id)}
    )

    assert enriched["task_id"] == str(task.id)
    assert enriched["taskId"] == str(task.id)
    assert enriched["pipeline_id"] == str(pipeline.id)
    assert enriched["pipelineId"] == str(pipeline.id)
    assert enriched["pipeline_name"] == "Test Pipeline"
    assert enriched["task_title"] == "Add the feature"
    assert enriched["task_spec"] == "- do a thing"
    assert enriched["task_description"] == "A longer description"


async def test_enrichment_accepts_camel_case_keys(init_mock_db):
    task, _pipeline = await _seed_task()

    enriched = await load_task_and_pipeline({"taskId": str(task.id)})

    assert enriched["pipeline_name"] == "Test Pipeline"
    assert enriched["pipeline_id"] == str(task.pipeline_id)
    assert enriched["task_spec"] == "- do a thing"


async def test_pipeline_id_is_derived_from_the_task(init_mock_db):
    task, pipeline = await _seed_task()

    enriched = await load_task_and_pipeline({"task_id": str(task.id)})

    assert enriched["pipeline_id"] == str(pipeline.id)
    assert enriched["pipelineId"] == str(pipeline.id)


async def test_existing_context_is_preserved(init_mock_db):
    task, _pipeline = await _seed_task()

    enriched = await load_task_and_pipeline(
        {"task_id": str(task.id), "runId": "run-1", "extra": 42}
    )

    assert enriched["runId"] == "run-1"
    assert enriched["extra"] == 42


async def test_none_spec_becomes_empty_string(init_mock_db):
    task, _pipeline = await _seed_task(spec=None)

    enriched = await load_task_and_pipeline({"task_id": str(task.id)})

    assert enriched["task_spec"] == ""


async def test_provider_aliases_point_at_the_same_function():
    assert task_and_pipeline_provider is load_task_and_pipeline
    assert provide_task_context is load_task_and_pipeline
    assert enrich_context is load_task_and_pipeline


# ---------------------------------------------------------------------------
# Failure / reject path
# ---------------------------------------------------------------------------


async def test_missing_task_id_is_rejected(init_mock_db):
    with pytest.raises(ContextProviderError) as excinfo:
        await load_task_and_pipeline({"pipeline_id": "p1"})

    assert "task id" in str(excinfo.value)
    assert excinfo.value.status == "error"


async def test_non_mapping_context_is_rejected(init_mock_db):
    with pytest.raises(ContextProviderError):
        await load_task_and_pipeline(["not", "a", "mapping"])  # type: ignore[arg-type]


async def test_unknown_task_reports_not_found(init_mock_db):
    with pytest.raises(ContextProviderError) as excinfo:
        await load_task_and_pipeline({"task_id": "000000000000000000000000"})

    assert excinfo.value.status == "not_found"
    assert "not found" in str(excinfo.value).lower()


async def test_unknown_pipeline_reports_not_found(init_mock_db):
    task, _pipeline = await _seed_task()
    # Store a pipeline id that does not resolve to an existing pipeline.
    task.pipeline_id = "000000000000000000000000"
    await task.save()

    with pytest.raises(ContextProviderError) as excinfo:
        await load_task_and_pipeline({"task_id": str(task.id)})

    assert excinfo.value.status == "not_found"


# ---------------------------------------------------------------------------
# Registration as a hook
# ---------------------------------------------------------------------------


async def test_register_context_providers_registers_the_pre_render_hook(init_mock_db):
    register_context_providers()

    hook = get_hook(TASK_ELABORATE_SPEC)

    assert hook is not NOOP_HOOK
    assert hook.pre_render is load_task_and_pipeline


async def test_registered_hook_enriches_context_end_to_end(init_mock_db):
    register_context_providers()
    task, _pipeline = await _seed_task()

    hook = get_hook(TASK_ELABORATE_SPEC)
    enriched = await hook.run_pre_render({"taskId": str(task.id)})

    assert enriched["task_title"] == "Add the feature"
    assert enriched["pipeline_name"] == "Test Pipeline"


async def test_unregister_context_providers(init_mock_db):
    register_context_providers()
    assert get_hook(TASK_ELABORATE_SPEC) is not NOOP_HOOK

    unregister_context_providers()

    assert get_hook(TASK_ELABORATE_SPEC) is NOOP_HOOK


async def test_reset_context_providers_restores_default(init_mock_db):
    unregister_context_providers()
    reset_context_providers()

    assert get_hook(TASK_ELABORATE_SPEC).pre_render is load_task_and_pipeline


async def test_context_provider_class_registers_and_runs(init_mock_db):
    task, _pipeline = await _seed_task()
    provider = ContextProvider(
        name="task_pipeline",
        provide=load_task_and_pipeline,
        prompt_ids=(TASK_ELABORATE_SPEC,),
    )

    provider.register()

    assert get_hook(TASK_ELABORATE_SPEC).pre_render is load_task_and_pipeline
    enriched = await provider({"taskId": str(task.id)})
    assert enriched["task_title"] == "Add the feature"

    provider.unregister()
    assert get_hook(TASK_ELABORATE_SPEC) is NOOP_HOOK


async def test_provide_context_dispatches_to_the_registered_provider(init_mock_db):
    register_context_providers()
    task, _pipeline = await _seed_task()

    enriched = await provide_context(TASK_ELABORATE_SPEC, {"taskId": str(task.id)})

    assert enriched["task_title"] == "Add the feature"
    assert enriched["pipeline_name"] == "Test Pipeline"


async def test_provide_context_for_unknown_prompt_is_a_noop(init_mock_db):
    context = {"taskId": "unused"}

    assert await provide_context("unknown_prompt", context) is context
