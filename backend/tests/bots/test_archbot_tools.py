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


from unittest.mock import MagicMock

import pytest

from api.archbot.tools import save_design_doc
from api.bot.conversation import ConversationTurn
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

    result = await save_design_doc(pipeline_id, task_id, design_doc)

    assert "Successfully saved design document" in result

    # Verify task updated in DB
    updated_task = await Task.get(task.id)
    assert updated_task.design_doc == design_doc


@pytest.mark.asyncio
async def test_save_design_doc_task_not_found(init_mock_db):
    result = await save_design_doc(
        "pipeline_id", "69f6bc17f62e0871e8903596", "# Design doc\n\nContent"
    )
    assert "Task with ID 69f6bc17f62e0871e8903596 not found" in result


@pytest.mark.asyncio
async def test_save_design_doc_invalid_input(init_mock_db):
    result = await save_design_doc("p", "t", None)
    assert "Error: design_doc_md must be a string" in result

    result = await save_design_doc("p", "t", "   ")
    assert "Error: design_doc_md cannot be empty" in result


@pytest.mark.asyncio
async def test_save_design_doc_with_execution_report(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline")
    await pipeline.save()

    task = Task(title="Test Task", pipeline_id=str(pipeline.id), spec="Test Spec")
    await task.save()

    pipeline_id = str(pipeline.id)
    task_id = str(task.id)
    design_doc = "# Design Doc\n\nProposed changes..."

    # Mock session
    mock_session = MagicMock()
    mock_session.get_summary_stats.return_value = {
        "total_turns": 10,
        "num_tool_calls": 5,
        "success_rate": 0.8,
        "finished_via_terminal_tool": True,
        "reached_turn_warning": False,
    }
    mock_session.conversation_log = [
        ConversationTurn(
            turn_id=1,
            role="tool",
            content="{}",
            tool_name="list_project_structure",
            success=True,
        )
    ]

    result = await save_design_doc(
        pipeline_id, task_id, design_doc, session=mock_session
    )

    assert "Successfully saved design document" in result

    # Verify task updated in DB and contains the report
    updated_task = await Task.get(task.id)
    assert design_doc in updated_task.design_doc
    assert "### 🤖 Execution Report" in updated_task.design_doc
    assert "- **Status**: ✅ Complete" in updated_task.design_doc
    assert "- **Turns**: 10" in updated_task.design_doc
    assert "- **Tool Success Rate**: 80%" in updated_task.design_doc
