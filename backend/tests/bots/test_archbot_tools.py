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

from unittest.mock import AsyncMock, patch

import pytest

from api.archbot.tools import save_design_doc
from core.models.models import Pipeline, Task


@pytest.mark.asyncio
async def test_save_design_doc_success(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline")
    await pipeline.save()

    task = Task(title="Test Task", pipeline_id=str(pipeline.id), spec="Test Spec")
    await task.save()

    pipeline_id = str(pipeline.id)
    task_id = str(task.id)
    design_doc = "# Design Doc\n\nProposed changes..."

    with patch(
        "api.archbot.tools.manager.broadcast", new_callable=AsyncMock
    ) as mock_broadcast:
        result = await save_design_doc(pipeline_id, task_id, design_doc)

        assert "Successfully saved design document" in result

        # Verify task updated in DB
        updated_task = await Task.get(task.id)
        assert updated_task.design_doc == design_doc

        # Verify WebSocket message
        mock_broadcast.assert_called_once()
        msg = mock_broadcast.call_args[0][0]
        assert msg.type == "ARCHBOT_COMPLETED"
        assert msg.payload["task_id"] == task_id


@pytest.mark.asyncio
async def test_save_design_doc_task_not_found(init_mock_db):
    result = await save_design_doc(
        "pipeline_id", "69f6bc17f62e0871e8903596", "Design doc"
    )
    assert "Task with ID 69f6bc17f62e0871e8903596 not found" in result


@pytest.mark.asyncio
async def test_save_design_doc_invalid_input(init_mock_db):
    result = await save_design_doc("p", "t", None)
    assert "Error: design_doc_md must be a string" in result

    result = await save_design_doc("p", "t", "   ")
    assert "Error: design_doc_md cannot be empty" in result
