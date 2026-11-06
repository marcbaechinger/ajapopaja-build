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

from core.exceptions import EntityNotFoundError
from core.models.models import Pipeline, Task
from core.queries.task import create_task, get_tasks_by_pipeline


@pytest.mark.asyncio
async def test_create_task_with_nonexistent_pipeline(init_mock_db):
    pipeline_id = "000000000000000000000000"
    task = Task(title="Orphaned Task", pipeline_id=pipeline_id)

    with pytest.raises(EntityNotFoundError, match="Pipeline with ID"):
        await create_task(pipeline_id, task)

    assert await Task.find(Task.pipeline_id == pipeline_id).count() == 0


@pytest.mark.asyncio
async def test_create_task_with_deleted_pipeline(init_mock_db):
    pipeline = Pipeline(name="Deleted Pipeline", deleted=True)
    await pipeline.insert()
    pipeline_id = str(pipeline.id)
    task = Task(title="Orphaned Task", pipeline_id=pipeline_id)

    with pytest.raises(EntityNotFoundError, match="Pipeline with ID"):
        await create_task(pipeline_id, task)

    assert await Task.find(Task.pipeline_id == pipeline_id).count() == 0


@pytest.mark.asyncio
async def test_create_task_with_existing_pipeline(init_mock_db):
    pipeline = Pipeline(name="Valid Pipeline")
    await pipeline.insert()
    pipeline_id = str(pipeline.id)
    task = Task(title="Valid Task", pipeline_id=pipeline_id)

    created = await create_task(pipeline_id, task)

    assert created.pipeline_id == pipeline_id
    assert created.version == 1
    stored = await get_tasks_by_pipeline(pipeline_id)
    assert [str(t.id) for t in stored] == [str(created.id)]
