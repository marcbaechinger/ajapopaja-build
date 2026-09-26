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
import json
from unittest.mock import AsyncMock, patch

import pytest

from api.coderbot.pi_rpc_process import PiRpcProcess


class QueueStdout:
    """Readable stdout that blocks until a line is pushed."""

    def __init__(self):
        self._queue = asyncio.Queue()

    async def readline(self):
        return await self._queue.get()

    def push(self, line):
        self._queue.put_nowait(line)


class ListStdout:
    """Readable stdout that returns scripted lines and then EOF."""

    def __init__(self, lines):
        self._lines = list(lines)

    async def readline(self):
        if self._lines:
            return self._lines.pop(0)
        return b""


class FakeStdin:
    def __init__(self, on_write=None):
        self.data = []
        self.eof = False
        self.closed = False
        self._on_write = on_write

    def write(self, data):
        self.data.append(data)
        if self._on_write:
            self._on_write(data)

    async def drain(self):
        pass

    def can_write_eof(self):
        return True

    def write_eof(self):
        self.eof = True

    def close(self):
        self.closed = True

    def is_closing(self):
        return self.closed


class FakeProcess:
    def __init__(self, stdout=None, on_write=None):
        self.stdout = stdout or ListStdout([])
        self.stdin = FakeStdin(on_write=on_write)
        self.returncode = None
        self.terminated = False

    async def wait(self):
        self.returncode = 0
        return 0

    def terminate(self):
        self.terminated = True
        self.returncode = -15


class RecordingPiRpcProcess(PiRpcProcess):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.events = []

    async def _handle_event(self, event):
        self.events.append(event)


def make_loopback_process(overrides=None):
    """Return a fake process that answers each command with a response."""

    def on_write(data):
        command = json.loads(data.decode("utf-8"))
        response = {
            "id": command.get("id"),
            "type": "response",
            "command": command.get("type"),
            "success": True,
        }
        response.update((overrides or {}).get(command.get("type"), {}))
        proc.stdout.push((json.dumps(response) + "\n").encode("utf-8"))

    proc = FakeProcess(stdout=QueueStdout(), on_write=on_write)
    return proc


# ---------------------------------------------------------------------------
# Command / response correlation
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_send_command_correlates_matching_response():
    session = PiRpcProcess()
    session.process = make_loopback_process(
        overrides={"get_state": {"data": {"session": "s1"}}}
    )

    read_task = asyncio.create_task(session._read_loop())
    response = await session.send_command("get_state", {})

    assert response["success"] is True
    assert response["command"] == "get_state"
    assert response["data"] == {"session": "s1"}
    assert session._pending_commands == {}

    # The command must be a single UTF-8 JSON line terminating in LF.
    assert len(session.process.stdin.data) == 1
    raw = session.process.stdin.data[0]
    assert raw.endswith(b"\n")
    assert raw.count(b"\n") == 1
    command = json.loads(raw)
    assert command["type"] == "get_state"
    assert command["id"]

    session.process.stdout.push(b"")
    await read_task


@pytest.mark.asyncio
async def test_send_command_times_out_when_never_acked():
    session = PiRpcProcess(command_timeout=0.05)
    session.process = FakeProcess(stdout=QueueStdout())

    with pytest.raises(asyncio.TimeoutError):
        await session.send_command("prompt", {"message": "hello"})

    assert session._pending_commands == {}


@pytest.mark.asyncio
async def test_send_command_requires_running_process():
    session = PiRpcProcess()
    with pytest.raises(RuntimeError):
        await session.send_command("prompt", {"message": "hi"})


@pytest.mark.asyncio
async def test_prompt_sends_prompt_command():
    session = PiRpcProcess()
    session.process = make_loopback_process()

    read_task = asyncio.create_task(session._read_loop())
    response = await session.prompt("Hello there")

    assert response["success"] is True
    command = json.loads(session.process.stdin.data[0])
    assert command["type"] == "prompt"
    assert command["message"] == "Hello there"

    session.process.stdout.push(b"")
    await read_task


# ---------------------------------------------------------------------------
# Read loop
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_read_loop_ignores_malformed_lines_and_delegates_events():
    session = RecordingPiRpcProcess()
    session.process = FakeProcess(
        stdout=ListStdout(
            [
                b"this is not json\n",
                b'{"broken": \n',
                b"\n",
                (json.dumps({"type": "agent_start"}) + "\n").encode(),
                (
                    json.dumps(
                        {
                            "type": "message_update",
                            "assistantMessageEvent": {
                                "type": "text_delta",
                                "delta": "hi",
                            },
                        }
                    )
                    + "\n"
                ).encode(),
            ]
        )
    )

    await session._read_loop()

    assert session.events == [
        {"type": "agent_start"},
        {
            "type": "message_update",
            "assistantMessageEvent": {"type": "text_delta", "delta": "hi"},
        },
    ]


@pytest.mark.asyncio
async def test_read_loop_routes_response_to_pending_future():
    session = RecordingPiRpcProcess()
    session.process = FakeProcess(
        stdout=ListStdout(
            [
                (
                    json.dumps({"id": "req-1", "type": "response", "success": True})
                    + "\n"
                ).encode()
            ]
        )
    )
    future = asyncio.get_running_loop().create_future()
    session._pending_commands["req-1"] = future

    await session._read_loop()

    assert future.result()["id"] == "req-1"
    # Responses are not session events.
    assert session.events == []


@pytest.mark.asyncio
async def test_read_loop_fails_pending_commands_on_eof():
    session = RecordingPiRpcProcess()
    session.process = FakeProcess(stdout=ListStdout([]))
    future = asyncio.get_running_loop().create_future()
    session._pending_commands["req-1"] = future

    await session._read_loop()

    with pytest.raises(RuntimeError):
        future.result()


# ---------------------------------------------------------------------------
# Lifecycle / framing
# ---------------------------------------------------------------------------
@pytest.mark.asyncio
async def test_start_builds_expected_command():
    with patch(
        "api.coderbot.pi_rpc_process.asyncio.create_subprocess_exec",
        new_callable=AsyncMock,
    ) as mock_exec:
        mock_exec.return_value = FakeProcess()
        session = PiRpcProcess(model="custom:cloud", cwd="/work")

        process = await session.start()

        assert process is mock_exec.return_value
        mock_exec.assert_awaited_once_with(
            "pi",
            "--mode",
            "rpc",
            "--no-session",
            "--model",
            "custom:cloud",
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd="/work",
            limit=10 * 1024 * 1024,
        )


@pytest.mark.asyncio
async def test_start_omits_model_and_accepts_cwd_override():
    with patch(
        "api.coderbot.pi_rpc_process.asyncio.create_subprocess_exec",
        new_callable=AsyncMock,
    ) as mock_exec:
        mock_exec.return_value = FakeProcess()
        session = PiRpcProcess()

        await session.start(cwd="/sandbox")

        args = mock_exec.await_args.args
        assert args == ("pi", "--mode", "rpc", "--no-session")
        assert mock_exec.await_args.kwargs["cwd"] == "/sandbox"


@pytest.mark.asyncio
async def test_close_graceful_writes_eof():
    session = PiRpcProcess()
    session.process = FakeProcess()

    await session.close(graceful=True)

    assert session.process.stdin.eof is True
    assert session.process.terminated is False


@pytest.mark.asyncio
async def test_close_force_terminates():
    session = PiRpcProcess()
    session.process = FakeProcess()

    await session.close(graceful=False)

    assert session.process.terminated is True


def test_stop_terminates_process():
    session = PiRpcProcess()
    session.process = FakeProcess()

    session.stop()

    assert session.process.terminated is True
