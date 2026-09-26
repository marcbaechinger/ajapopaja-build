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
from unittest.mock import AsyncMock

import pytest

from api.coderbot.pi_rpc_process import PiRpcProcess
from api.coderbot.session import InteractivePiSession


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
