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
from core.models.models import Pipeline, Task

@pytest.mark.asyncio
async def test_pipeline_version_default(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline")
    assert pipeline.version == 1

@pytest.mark.asyncio
async def test_task_version_default(init_mock_db):
    task = Task(title="Test Task", pipeline_id="123")
    assert task.version == 1

@pytest.mark.asyncio
async def test_task_design_doc(init_mock_db):
    task = Task(title="Test Task", pipeline_id="123", design_doc="This is a design doc.")
    await task.insert()
    
    saved_task = await Task.get(task.id)
    assert saved_task.design_doc == "This is a design doc."

@pytest.mark.asyncio
async def test_pipeline_save_version(init_mock_db):
    pipeline = Pipeline(name="Versioned Pipeline")
    await pipeline.insert()
    assert pipeline.version == 1
    
    pipeline.name = "Updated Name"
    await pipeline.save()
    assert pipeline.version == 1  # Standard save doesn't auto-increment yet
