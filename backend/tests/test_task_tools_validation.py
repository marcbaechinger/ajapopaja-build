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
from api.assistant.tools.task_tools import create_task, list_tasks
from core.models.models import Pipeline
from core.exceptions import EntityNotFoundError

@pytest.mark.asyncio
async def test_create_task_pipeline_validation(init_mock_db):
    # Test with non-existent pipeline ID
    result = await create_task(pipeline_id="69e2d04b3c5ec70ad0904437", title="Test Task")
    assert "error" in result
    assert "Pipeline with ID '69e2d04b3c5ec70ad0904437' not found" in result["error"]

    # Test with existent pipeline ID
    pipeline = Pipeline(name="Valid Pipeline")
    await pipeline.insert()
    pipeline_id = str(pipeline.id)
    
    result = await create_task(pipeline_id=pipeline_id, title="Valid Task")
    assert result["title"] == "Valid Task"
    assert result["pipeline_id"] == pipeline_id

@pytest.mark.asyncio
async def test_list_tasks_pipeline_validation(init_mock_db):
    # Test with non-existent pipeline ID
    result = await list_tasks(pipeline_id="69e2d04b3c5ec70ad0904437")
    assert "error" in result
    assert "Pipeline with ID '69e2d04b3c5ec70ad0904437' not found" in result["error"]

    # Test with existent pipeline ID
    pipeline = Pipeline(name="Valid Pipeline")
    await pipeline.insert()
    pipeline_id = str(pipeline.id)
    
    result = await list_tasks(pipeline_id=pipeline_id)
    assert "tasks" in result
    assert result["total_tasks"] == 0
