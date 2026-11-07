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

from api.specagent.session import SpecAgentSession
from core.models.models import Pipeline, Task


@pytest.mark.asyncio
async def test_specagent_session_init(init_mock_db):
    session = SpecAgentSession(pipeline_id="p1", task_id="t1")
    assert session.pipeline_id == "p1"
    assert session.task_id == "t1"
    assert session.bot_type == "specagent"
    assert session.use_sandbox is False
    assert session.requested_by is None
    assert "system" in [m["role"] for m in session.history]


@pytest.mark.asyncio
async def test_specagent_session_stores_requested_by(init_mock_db):
    session = SpecAgentSession(pipeline_id="p1", task_id="t1", requested_by="alice")
    assert session.requested_by == "alice"


@pytest.mark.asyncio
async def test_specagent_session_initial_prompt(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline")
    await pipeline.save()
    task = Task(
        title="Test Task",
        description="A rough idea",
        pipeline_id=str(pipeline.id),
        spec="- do a thing",
    )
    await task.save()

    session = SpecAgentSession(pipeline_id=str(pipeline.id), task_id=str(task.id))
    prompt = await session.get_initial_prompt()

    assert "Test Task" in prompt
    assert "A rough idea" in prompt
    assert "- do a thing" in prompt
    # The prompt must ask the bot to explore the codebase first.
    assert "exploring the codebase" in prompt
    assert "save_elaborated_spec" in prompt


@pytest.mark.asyncio
async def test_specagent_session_initial_prompt_defaults(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline")
    await pipeline.save()
    task = Task(title="Test Task", pipeline_id=str(pipeline.id))
    await task.save()

    session = SpecAgentSession(pipeline_id=str(pipeline.id), task_id=str(task.id))
    prompt = await session.get_initial_prompt()
    assert "No description provided." in prompt
    assert "No spec provided." in prompt


@pytest.mark.asyncio
async def test_specagent_session_tools(init_mock_db):
    session = SpecAgentSession(pipeline_id="p", task_id="t")
    tool_names = [t.name for t in session.get_tools()]
    for expected in (
        "save_elaborated_spec",
        "grep",
        "find",
        "tree",
        "list_project_structure",
        "read_source_file",
        "git_log",
        "git_show_commit",
        "git_status",
        "git_blame",
        "git_diff",
        "get_task",
        "list_tasks",
    ):
        assert expected in tool_names


@pytest.mark.asyncio
async def test_specagent_session_terminal_tool(init_mock_db):
    session = SpecAgentSession(pipeline_id="p", task_id="t")
    assert session.is_terminal_tool("save_elaborated_spec") is True
    assert session.is_terminal_tool("grep") is False


@pytest.mark.asyncio
async def test_specagent_session_events(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline")
    await pipeline.save()
    task = Task(title="Test Task", pipeline_id=str(pipeline.id))
    await task.save()

    session = SpecAgentSession(pipeline_id=str(pipeline.id), task_id=str(task.id))

    with patch(
        "api.specagent.session.manager.broadcast", new_callable=AsyncMock
    ) as mock_broadcast:
        await session.on_event("bot_started")
        msg = mock_broadcast.call_args[0][0]
        assert msg.type == "SPECAGENT_STARTED"
        assert msg.payload["task_id"] == str(task.id)

        mock_broadcast.reset_mock()

        await session.on_event("bot_completed")
        msg = mock_broadcast.call_args[0][0]
        assert msg.type == "SPECAGENT_COMPLETED"
        assert msg.payload["title"] == "Test Task"


@pytest.mark.asyncio
async def test_specagent_session_completed_fallback_when_task_missing():
    session = SpecAgentSession(pipeline_id="p", task_id="missing_task")

    with (
        patch(
            "api.specagent.session.task_queries.get_task_by_id",
            new_callable=AsyncMock,
            return_value=None,
        ),
        patch(
            "api.specagent.session.manager.broadcast", new_callable=AsyncMock
        ) as mock_broadcast,
    ):
        await session.on_event("bot_completed")
        msg = mock_broadcast.call_args[0][0]
        assert msg.type == "SPECAGENT_COMPLETED"
        assert msg.payload["pipeline_id"] == "p"
        assert msg.payload["task_id"] == "missing_task"


@pytest.mark.asyncio
async def test_specagent_system_instruction_is_requirements_focused(init_mock_db):
    session = SpecAgentSession(pipeline_id="p", task_id="t")
    instruction = session.get_system_instruction()
    assert "Requirements Clarifier" in instruction
    assert "Acceptance criteria" in instruction
    assert "not an implementer" in instruction.lower()
