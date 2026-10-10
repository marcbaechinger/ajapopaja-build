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

import pytest

from core.models.models import Task, TaskStatus
from core.queries import task as task_queries


async def _make_task(model: str | None = None) -> Task:
    task = Task(
        title="Model Task",
        pipeline_id="pid",
        status=TaskStatus.CREATED,
        suggested_model=model,
    )
    await task.insert()
    return task


@pytest.mark.asyncio
async def test_update_task_details_sets_suggested_model(init_mock_db):
    task = await _make_task()

    updated = await task_queries.update_task_details(
        str(task.id), task.version, suggested_model="gpt-oss:120"
    )

    assert updated.suggested_model == "gpt-oss:120"
    assert (await task_queries.get_task_by_id(str(task.id))).suggested_model == (
        "gpt-oss:120"
    )


@pytest.mark.asyncio
async def test_update_task_details_clears_suggested_model_with_null(init_mock_db):
    """An explicit ``None`` must clear a stored model pin (#unset bug)."""
    task = await _make_task("gpt-oss:120")

    updated = await task_queries.update_task_details(
        str(task.id), task.version, suggested_model=None
    )

    assert updated.suggested_model is None
    assert (await task_queries.get_task_by_id(str(task.id))).suggested_model is None


@pytest.mark.asyncio
async def test_update_task_details_clears_suggested_model_with_blank(init_mock_db):
    """A blank string is normalized to ``None`` (clears the pin)."""
    task = await _make_task("gpt-oss:120")

    updated = await task_queries.update_task_details(
        str(task.id), task.version, suggested_model="   "
    )

    assert updated.suggested_model is None


@pytest.mark.asyncio
async def test_update_task_details_keeps_suggested_model_when_omitted(init_mock_db):
    """Omitting the field leaves the stored model pin untouched."""
    task = await _make_task("gpt-oss:120")

    updated = await task_queries.update_task_details(
        str(task.id), task.version, description="new description"
    )

    assert updated.suggested_model == "gpt-oss:120"
