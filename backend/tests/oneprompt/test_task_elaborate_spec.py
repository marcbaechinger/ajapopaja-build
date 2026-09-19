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

"""Integration tests for the bundled ``task_elaborate_spec`` use case.

These tests exercise the *whole* enrichment + rendering path required by the
task: a small context (``taskId``/``pipelineId``) sent by the frontend is
enriched from MongoDB by the data-provider hook and then rendered against the
bundled ``templates/task_elaborate_spec.prompt`` template. Unknown references
must fail with a clear, client-facing error rather than rendering ``$undefined``
placeholders.
"""

from __future__ import annotations

import pytest

from api.oneprompt.context import (
    TASK_ELABORATE_SPEC,
    ContextProviderError,
    load_task_and_pipeline,
    register_context_providers,
    reset_context_providers,
)
from api.oneprompt.hooks import (
    clear_hooks,
    get_hook,
    hooks,
    registered_hooks,
)
from api.oneprompt.registry import registry
from api.oneprompt.renderer import render_template
from core.models.models import Pipeline, Task


@pytest.fixture(autouse=True)
def isolated_hooks():
    """Keep the process-wide hook registry isolated and seed the provider."""

    snapshot = registered_hooks()
    clear_hooks()
    reset_context_providers()
    yield
    clear_hooks()
    hooks.update(snapshot)


async def _seed_pipeline_and_task(spec: str | None = None):
    pipeline = Pipeline(name="Elaboration Pipeline")
    await pipeline.insert()
    task = Task(
        title="Implement the feature",
        description="A longer description",
        spec=spec if spec is not None else "- point one\n- point two",
        pipeline_id=str(pipeline.id),
    )
    await task.insert()
    return task, pipeline


async def test_context_is_enriched_from_mongodb_and_rendered(init_mock_db):
    """Enrich a minimal context from MongoDB and render the bundled template."""

    task, pipeline = await _seed_pipeline_and_task()

    register_context_providers()
    hook = get_hook(TASK_ELABORATE_SPEC)
    assert hook.pre_render is load_task_and_pipeline

    enriched = await hook.run_pre_render(
        {"taskId": str(task.id), "pipelineId": str(pipeline.id)}
    )

    # The provider injected the authoritative values from MongoDB.
    assert enriched["pipeline_id"] == str(pipeline.id)
    assert enriched["pipeline_name"] == "Elaboration Pipeline"
    assert enriched["task_title"] == "Implement the feature"
    assert enriched["task_spec"] == "- point one\n- point two"

    template = registry.get(TASK_ELABORATE_SPEC)
    prompt = render_template(template, enriched)

    assert "Pipeline: Elaboration Pipeline (id " in prompt
    assert f"(id {pipeline.id})" in prompt
    assert "Task title: Implement the feature" in prompt
    assert '"""- point one\n- point two"""' in prompt
    assert "Rewrite and expand the specification above" in prompt
    # Every placeholder was resolved: no literal token is left behind.
    assert "$" not in prompt


async def test_enrichment_derives_pipeline_from_the_task(init_mock_db):
    """The pipeline id is optional; it is derived from the referenced task."""

    task, pipeline = await _seed_pipeline_and_task()

    enriched = await load_task_and_pipeline({"taskId": str(task.id)})

    assert enriched["pipeline_id"] == str(pipeline.id)
    assert enriched["pipelineId"] == str(pipeline.id)
    assert enriched["pipeline_name"] == "Elaboration Pipeline"


async def test_unknown_task_reference_raises_clear_error(init_mock_db):
    task, _pipeline = await _seed_pipeline_and_task()
    missing_id = "0" * len(str(task.id))

    with pytest.raises(ContextProviderError) as excinfo:
        await load_task_and_pipeline({"taskId": missing_id})

    assert excinfo.value.status == "not_found"
    assert "not found" in str(excinfo.value).lower()


async def test_unknown_pipeline_reference_raises_clear_error(init_mock_db):
    task, _pipeline = await _seed_pipeline_and_task()
    missing_pipeline_id = "0" * len(str(task.pipeline_id))

    with pytest.raises(ContextProviderError) as excinfo:
        await load_task_and_pipeline(
            {"taskId": str(task.id), "pipelineId": missing_pipeline_id}
        )

    assert excinfo.value.status == "not_found"
    assert "not found" in str(excinfo.value).lower()


async def test_missing_task_id_reference_raises_clear_error(init_mock_db):
    with pytest.raises(ContextProviderError) as excinfo:
        await load_task_and_pipeline({"pipelineId": "some-pipeline"})

    assert excinfo.value.status == "error"
    assert "task id" in str(excinfo.value)
