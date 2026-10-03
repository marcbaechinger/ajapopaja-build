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

import asyncio
from unittest.mock import AsyncMock, patch

import pytest

from api.coderbot.pi_rpc_process import PiRpcProcess
from api.coderbot.session import InteractivePiSession
from api.websocket_manager import WSMessage


class FakeStdin:
    def __init__(self):
        self.eof = False

    def write(self, data):
        pass

    async def drain(self):
        pass

    def can_write_eof(self):
        return True

    def write_eof(self):
        self.eof = True

    def close(self):
        self.eof = True

    def is_closing(self):
        return self.eof


class FakeProcess:
    def __init__(self):
        self.stdin = FakeStdin()
        self.stdout = None
        self.returncode = None

    async def wait(self):
        return 0

    def terminate(self):
        self.returncode = -15


def text_delta(delta):
    return {
        "type": "message_update",
        "assistantMessageEvent": {"type": "text_delta", "delta": delta},
    }


def test_interactive_session_is_a_pi_rpc_process():
    assert issubclass(InteractivePiSession, PiRpcProcess)


@pytest.mark.asyncio
async def test_handle_event_queues_text_and_settled():
    session = InteractivePiSession()

    await session._handle_event(text_delta("Hello"))
    await session._handle_event(text_delta(" world"))
    await session._handle_event({"type": "agent_settled"})

    assert await session._queue.get() == "Hello"
    assert await session._queue.get() == " world"
    assert await session._queue.get() == {"type": "settled"}


@pytest.mark.asyncio
async def test_handle_event_ignores_unrelated_events():
    session = InteractivePiSession()

    await session._handle_event({"type": "agent_end", "messages": []})
    await session._handle_event({"type": "agent_start"})

    assert session._queue.empty()


@pytest.mark.asyncio
async def test_agent_settled_does_not_close_stdin():
    session = InteractivePiSession()
    session.process = FakeProcess()

    await session._handle_event({"type": "agent_settled"})

    assert session.process.stdin.eof is False


@pytest.mark.asyncio
async def test_send_user_message_streams_until_settled():
    session = InteractivePiSession()
    session.prompt = AsyncMock(
        return_value={"success": True, "data": {"disposition": "started"}}
    )

    async def feed():
        await session._handle_event(text_delta("Hel"))
        await session._handle_event(text_delta("lo"))
        await session._handle_event({"type": "agent_settled"})

    asyncio.create_task(feed())

    chunks = [chunk async for chunk in session.send_user_message("Hi")]

    assert chunks == ["Hel", "lo"]
    session.prompt.assert_awaited_once_with("Hi")


@pytest.mark.asyncio
async def test_send_user_message_supports_multiple_turns():
    session = InteractivePiSession()
    session.prompt = AsyncMock(
        side_effect=[
            {"success": True, "data": {"disposition": "started"}},
            {"success": True, "data": {"disposition": "started"}},
        ]
    )

    async def feed(text):
        await session._handle_event(text_delta(text))
        await session._handle_event({"type": "agent_settled"})

    asyncio.create_task(feed("first"))
    first = [chunk async for chunk in session.send_user_message("one")]

    asyncio.create_task(feed("second"))
    second = [chunk async for chunk in session.send_user_message("two")]

    assert first == ["first"]
    assert second == ["second"]
    assert session.prompt.await_count == 2


@pytest.mark.asyncio
async def test_send_user_message_returns_without_waiting_when_handled():
    session = InteractivePiSession()
    session.prompt = AsyncMock(
        return_value={"success": True, "data": {"disposition": "handled"}}
    )

    chunks = [chunk async for chunk in session.send_user_message("slash command")]

    assert chunks == []


@pytest.mark.asyncio
async def test_send_user_message_yields_nothing_on_failed_ack():
    session = InteractivePiSession()
    session.prompt = AsyncMock(
        return_value={"success": False, "error": "Model not found."}
    )

    chunks = [chunk async for chunk in session.send_user_message("Hi")]

    assert chunks == []


@pytest.mark.asyncio
async def test_broadcast_rpc_emits_interactive_rpc_event():
    session = InteractivePiSession(pipeline_id="p1")
    with patch(
        "api.coderbot.session.ws_manager.broadcast", new_callable=AsyncMock
    ) as mock_broadcast:
        await session._broadcast_rpc({"type": "agent_settled"})

    mock_broadcast.assert_awaited_once()
    msg = mock_broadcast.await_args.args[0]
    assert isinstance(msg, WSMessage)
    assert msg.type == "INTERACTIVE_RPC_EVENT"
    assert msg.payload["pipeline_id"] == "p1"
    assert msg.payload["bot_type"] == "interactive"
    assert msg.payload["event"] == {"type": "agent_settled"}


@pytest.mark.asyncio
async def test_broadcast_rpc_is_skipped_without_pipeline_id():
    session = InteractivePiSession()
    with patch(
        "api.coderbot.session.ws_manager.broadcast", new_callable=AsyncMock
    ) as mock_broadcast:
        await session._broadcast_rpc({"type": "agent_settled"})

    mock_broadcast.assert_not_awaited()


@pytest.mark.asyncio
async def test_start_interactive_broadcasts_started_and_records_start_time():
    session = InteractivePiSession(pipeline_id="p1")
    session.start = AsyncMock(return_value=FakeProcess())
    with patch(
        "api.coderbot.session.ws_manager.broadcast", new_callable=AsyncMock
    ) as mock_broadcast:
        await session.start_interactive(cwd="/tmp/repo")

    assert session.start_time is not None
    session.start.assert_awaited_once_with(cwd="/tmp/repo")
    started = [
        c.args[0]
        for c in mock_broadcast.await_args_list
        if c.args[0].type == "INTERACTIVE_STARTED"
    ]
    assert started
    assert started[0].payload["pipeline_id"] == "p1"
    assert started[0].payload["bot_type"] == "interactive"
    assert started[0].payload["start_time"] == session.start_time.isoformat()


@pytest.mark.asyncio
async def test_stop_broadcasts_interactive_stopped():
    session = InteractivePiSession(pipeline_id="p1")
    session.process = FakeProcess()
    with patch(
        "api.coderbot.session.ws_manager.broadcast", new_callable=AsyncMock
    ) as mock_broadcast:
        await session.stop()

    assert session.process.returncode == -15
    stopped = [c.args[0] for c in mock_broadcast.await_args_list]
    assert any(m.type == "INTERACTIVE_STOPPED" for m in stopped)


@pytest.mark.asyncio
async def test_stop_broadcasts_only_once():
    session = InteractivePiSession(pipeline_id="p1")
    session.process = FakeProcess()
    with patch(
        "api.coderbot.session.ws_manager.broadcast", new_callable=AsyncMock
    ) as mock_broadcast:
        await session.stop()
        await session.close(graceful=False)

    stopped = [
        c.args[0]
        for c in mock_broadcast.await_args_list
        if c.args[0].type == "INTERACTIVE_STOPPED"
    ]
    assert len(stopped) == 1


@pytest.mark.asyncio
async def test_close_broadcasts_interactive_stopped():
    session = InteractivePiSession(pipeline_id="p1")
    session.process = FakeProcess()
    with patch(
        "api.coderbot.session.ws_manager.broadcast", new_callable=AsyncMock
    ) as mock_broadcast:
        await session.close()

    stopped = [
        c.args[0]
        for c in mock_broadcast.await_args_list
        if c.args[0].type == "INTERACTIVE_STOPPED"
    ]
    assert len(stopped) == 1


@pytest.mark.asyncio
async def test_lifecycle_broadcasts_skipped_without_pipeline_id():
    session = InteractivePiSession()
    session.process = FakeProcess()
    with patch(
        "api.coderbot.session.ws_manager.broadcast", new_callable=AsyncMock
    ) as mock_broadcast:
        await session._broadcast_started()
        await session.stop()

    mock_broadcast.assert_not_awaited()


@pytest.mark.asyncio
async def test_handle_event_broadcasts_rpc_and_queues():
    session = InteractivePiSession(pipeline_id="p1")
    with patch(
        "api.coderbot.session.ws_manager.broadcast", new_callable=AsyncMock
    ) as mock_broadcast:
        await session._handle_event(text_delta("Hello"))

    rpc = [
        c.args[0]
        for c in mock_broadcast.await_args_list
        if c.args[0].type == "INTERACTIVE_RPC_EVENT"
    ]
    assert len(rpc) == 1
    assert await session._queue.get() == "Hello"


# ---------------------------------------------------------------------------
# System instruction
# ---------------------------------------------------------------------------
def test_build_command_appends_system_instruction():
    """The interactive process must receive the scope/skill instruction once,
    via ``--append-system-prompt``, before any user turn."""
    session = InteractivePiSession(pipeline_id="pipe-uid-123")

    cmd = session.build_command()

    assert cmd[:3] == ["pi", "--mode", "rpc"]
    assert "--no-session" not in cmd
    assert cmd.count("--append-system-prompt") == 1
    instruction = cmd[cmd.index("--append-system-prompt") + 1]

    # Repository scope.
    assert "Repository Scope" in instruction
    assert "MUST" in instruction
    assert "read, search or edit" in instruction
    assert "outside" in instruction

    # Search scope.
    assert "Search Scope" in instruction
    assert "grep" in instruction
    assert "rg" in instruction
    assert "find" in instruction
    assert "filesystem root" in instruction
    assert "home directory" in instruction

    # Ajapopaja skill.
    assert "ajapopaja" in instruction
    assert "get-task <pipeline_id>" in instruction
    assert "get-task-details <task_id>" in instruction
    assert "search-tasks" in instruction
    assert "update-task-design-doc" in instruction
    assert "complete-task" in instruction
    assert "SKILL.md" in instruction

    # Skill location: the project-local staged skill is named explicitly so the
    # agent reads it directly instead of searching the filesystem for SKILL.md.
    assert ".pi/skills/ajapopaja/SKILL.md" in instruction
    assert "~/.pi/agent/skills/" in instruction
    assert "not a Pi skill location" in instruction
    assert "searching the filesystem" in instruction

    # Pipeline UID, clearly highlighted and usable for get-task.
    assert "Pipeline UID" in instruction
    assert "pipe-uid-123" in instruction
    assert "get-task pipe-uid-123" in instruction


def test_build_command_keeps_model_and_adds_instruction():
    session = InteractivePiSession(model="custom:cloud", pipeline_id="p1")

    cmd = session.build_command()

    assert cmd == [
        "pi",
        "--mode",
        "rpc",
        "--model",
        "custom:cloud",
        "--append-system-prompt",
        session._build_system_instruction(),
    ]


def test_system_instruction_without_pipeline_uid():
    """A session started without a pipeline id still gets the instruction."""
    instruction = InteractivePiSession()._build_system_instruction()

    assert "Repository Scope" in instruction
    assert "Pipeline UID" in instruction


@pytest.mark.asyncio
async def test_start_interactive_spawns_pi_with_system_instruction():
    session = InteractivePiSession(pipeline_id="pipe-42")
    with (
        patch(
            "api.coderbot.pi_rpc_process.asyncio.create_subprocess_exec",
            new_callable=AsyncMock,
        ) as mock_exec,
        patch("api.coderbot.pi_rpc_process.PiSkillStager"),
    ):
        mock_exec.return_value = FakeProcess()

        await session.start_interactive(cwd="/tmp/repo")

    args = mock_exec.await_args.args
    assert "--append-system-prompt" in args
    instruction = args[args.index("--append-system-prompt") + 1]
    assert "Repository Scope" in instruction
    assert "ajapopaja" in instruction
    assert "pipe-42" in instruction
