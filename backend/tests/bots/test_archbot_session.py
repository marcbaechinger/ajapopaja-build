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


@pytest.mark.asyncio
async def test_archbot_session_events(init_mock_db):
    from unittest.mock import AsyncMock, patch

    pipeline = Pipeline(name="Test Pipeline")
    await pipeline.save()
    task = Task(title="Test Task", pipeline_id=str(pipeline.id))
    await task.save()

    session = ArchBotSession(pipeline_id=str(pipeline.id), task_id=str(task.id))

    with patch(
        "api.archbot.session.manager.broadcast", new_callable=AsyncMock
    ) as mock_broadcast:
        # Test bot_started
        await session.on_event("bot_started")
        mock_broadcast.assert_called_once()
        msg = mock_broadcast.call_args[0][0]
        assert msg.type == "ARCHBOT_STARTED"

        mock_broadcast.reset_mock()

        # Test bot_completed
        await session.on_event("bot_completed")
        mock_broadcast.assert_called_once()
        msg = mock_broadcast.call_args[0][0]
        assert msg.type == "ARCHBOT_COMPLETED"
        # Now it should contain the task object (or at least have 'id')
        assert "id" in msg.payload or "task_id" in msg.payload


@pytest.mark.asyncio
async def test_archbot_session_default_flag_is_false(init_mock_db):
    session = ArchBotSession(pipeline_id="p", task_id="t")
    # A brand-new session never starts with an existing design doc.
    assert session._has_existing_design_doc is False
    assert session.user_prompt is None


@pytest.mark.asyncio
async def test_archbot_session_system_instruction_variants(init_mock_db):
    session = ArchBotSession(pipeline_id="p", task_id="t")

    # Without an existing design doc we use the create/creation variant.
    create_instr = session.get_system_instruction()
    assert "create a clear, concise" in create_instr
    assert "update an existing" not in create_instr

    # Once the session knows it is iterating, it must switch to the update variant.
    session._has_existing_design_doc = True
    update_instr = session.get_system_instruction()
    assert "update an existing" in update_instr
    assert "The whole\nthing!" in update_instr


@pytest.mark.asyncio
async def test_archbot_session_initial_prompt_with_existing_design_doc(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline")
    await pipeline.save()
    task = Task(
        title="Test Task",
        pipeline_id=str(pipeline.id),
        spec="Test Spec",
        description="Some description",
        design_doc="# Existing Design Doc\n\nSome content already present.",
    )
    await task.save()

    session = ArchBotSession(pipeline_id=str(pipeline.id), task_id=str(task.id))
    prompt = await session.get_initial_prompt()

    # The prompt must ask to update the existing doc rather than create a new one.
    assert "Please update the existing design document" in prompt
    assert "Test Task" in prompt
    assert "Some description" in prompt
    assert "# Existing Design Doc" in prompt
    # The session must now know it is iterating on an existing design doc.
    assert session._has_existing_design_doc is True
    # And the overridden (update) system instruction must be in history.
    assert "update an existing" in session.history[0]["content"]


@pytest.mark.asyncio
async def test_archbot_session_initial_prompt_defaults_with_existing_doc(init_mock_db):
    """When description/spec are missing they should fall back to a placeholder."""
    pipeline = Pipeline(name="Test Pipeline")
    await pipeline.save()
    task = Task(
        title="Test Task",
        pipeline_id=str(pipeline.id),
        design_doc="# Existing",
    )
    await task.save()

    session = ArchBotSession(pipeline_id=str(pipeline.id), task_id=str(task.id))
    prompt = await session.get_initial_prompt()

    assert "No description provided." in prompt
    assert "No spec provided." in prompt


@pytest.mark.asyncio
async def test_archbot_session_user_prompt_appended_to_prompt(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline")
    await pipeline.save()
    task = Task(
        title="Test Task",
        pipeline_id=str(pipeline.id),
        design_doc="# Existing",
    )
    await task.save()

    session = ArchBotSession(
        pipeline_id=str(pipeline.id),
        task_id=str(task.id),
        user_prompt="Please make it more detailed.",
    )
    assert session.user_prompt == "Please make it more detailed."

    prompt = await session.get_initial_prompt()
    assert "Address the following comments:" in prompt
    assert "Please make it more detailed." in prompt


@pytest.mark.asyncio
async def test_archbot_session_user_prompt_ignored_for_new_doc(init_mock_db):
    """User comments only make sense when iterating on an existing design doc."""
    pipeline = Pipeline(name="Test Pipeline")
    await pipeline.save()
    task = Task(title="Test Task", pipeline_id=str(pipeline.id))
    await task.save()

    session = ArchBotSession(
        pipeline_id=str(pipeline.id),
        task_id=str(task.id),
        user_prompt="Please make it more detailed.",
    )
    prompt = await session.get_initial_prompt()

    # No existing design doc -> creation prompt; comments are not injected.
    assert "Please create a design document" in prompt
    assert "Please make it more detailed." not in prompt
    assert session._has_existing_design_doc is False


@pytest.mark.asyncio
async def test_archbot_session_terminal_tool(init_mock_db):
    session = ArchBotSession(pipeline_id="p", task_id="t")
    assert session.is_terminal_tool("save_design_doc") is True
    assert session.is_terminal_tool("grep") is False


@pytest.mark.asyncio
async def test_archbot_session_completed_broadcasts_full_task(init_mock_db):
    from unittest.mock import AsyncMock, patch

    pipeline = Pipeline(name="Test Pipeline")
    await pipeline.save()
    task = Task(
        title="Test Task",
        pipeline_id=str(pipeline.id),
        design_doc="# Latest Design Doc",
    )
    await task.save()

    session = ArchBotSession(pipeline_id=str(pipeline.id), task_id=str(task.id))

    with patch(
        "api.archbot.session.manager.broadcast", new_callable=AsyncMock
    ) as mock_broadcast:
        await session.on_event("bot_completed")
        mock_broadcast.assert_called_once()
        msg = mock_broadcast.call_args[0][0]
        assert msg.type == "ARCHBOT_COMPLETED"
        # The payload must carry the fresh task data (design doc included).
        assert msg.payload["title"] == "Test Task"
        assert msg.payload["design_doc"] == "# Latest Design Doc"


@pytest.mark.asyncio
async def test_archbot_session_completed_fallback_when_task_missing(init_mock_db):
    from unittest.mock import AsyncMock, patch

    session = ArchBotSession(pipeline_id="p", task_id="missing_task")

    with patch(
        "api.archbot.session.task_queries.get_task_by_id",
        new_callable=AsyncMock,
        return_value=None,
    ), patch(
        "api.archbot.session.manager.broadcast", new_callable=AsyncMock
    ) as mock_broadcast:
        await session.on_event("bot_completed")
        mock_broadcast.assert_called_once()
        msg = mock_broadcast.call_args[0][0]
        assert msg.type == "ARCHBOT_COMPLETED"
        assert msg.payload["pipeline_id"] == "p"
        assert msg.payload["task_id"] == "missing_task"
