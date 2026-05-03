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

from unittest.mock import MagicMock, patch

import pytest

from api.coderbot.session import CoderBotSession
from core.models.models import Pipeline, Task


@pytest.mark.asyncio
async def test_coderbot_session_initialization(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline", workspace_path="test")
    await pipeline.insert()

    task = Task(
        title="Test Task",
        pipeline_id=str(pipeline.id),
        design_doc="Design",
        spec="Spec",
    )
    await task.insert()

    session = CoderBotSession(pipeline_id=str(pipeline.id), task_id=str(task.id))

    with patch("api.coderbot.session.SandboxGitHelper") as mock_helper_cls:
        mock_helper = MagicMock()
        mock_helper_cls.return_value = mock_helper

        prompt = await session.get_initial_prompt()

        mock_helper_cls.assert_called_once()
        mock_helper.setup_sandbox.assert_called_once()
        assert "Test Task" in prompt
        assert "Design" in prompt
        assert "Spec" in prompt


@pytest.mark.asyncio
async def test_coderbot_session_terminal_tool():
    session = CoderBotSession(pipeline_id="p1", task_id="t1")
    assert session.is_terminal_tool("task_completed") is True
    assert session.is_terminal_tool("read_source_file") is False
