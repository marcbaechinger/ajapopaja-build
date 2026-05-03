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

from api.archbot.session import ArchBotSession
from core.models.models import Pipeline, Task


@pytest.mark.asyncio
async def test_archbot_session_init(init_mock_db):
    session = ArchBotSession(pipeline_id="p1", task_id="t1")
    assert session.pipeline_id == "p1"
    assert session.task_id == "t1"
    assert "system" in [m["role"] for m in session.history]


@pytest.mark.asyncio
async def test_archbot_session_initial_prompt(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline")
    await pipeline.save()
    task = Task(title="Test Task", pipeline_id=str(pipeline.id), spec="Test Spec")
    await task.save()

    session = ArchBotSession(pipeline_id=str(pipeline.id), task_id=str(task.id))
    prompt = await session.get_initial_prompt()

    assert "Test Task" in prompt
    assert "Test Spec" in prompt


@pytest.mark.asyncio
async def test_archbot_session_tools(init_mock_db):
    session = ArchBotSession(pipeline_id="p", task_id="t")
    tools = session.get_tools()
    tool_names = [t.name for t in tools]
    assert "save_design_doc" in tool_names
    assert "grep" in tool_names
    assert "read_source_file" in tool_names
