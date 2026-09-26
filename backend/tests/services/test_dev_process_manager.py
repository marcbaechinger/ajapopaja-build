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

"""Unit tests for the :class:`DevProcessManager` service.

These tests exercise the real subprocess lifecycle using short-lived shell
commands against a temporary workspace, without touching the database (the
workspace resolution is patched).
"""

import asyncio
import os
from unittest.mock import AsyncMock, patch

import pytest

from core import config
from core.services.dev_process_manager import (
    DevProcessAlreadyRunningError,
    DevProcessError,
    DevProcessManager,
    DevProcessNotFoundError,
    ProcessLogBuffer,
)


@pytest.fixture(autouse=True)
async def reset_manager():
    """Ensures a clean manager (and no leaked processes) around every test."""
    DevProcessManager.reset()
    yield
    await DevProcessManager.instance().stop_all()
    DevProcessManager.reset()


def _patch_workspace(manager: DevProcessManager, workspace: str):
    return patch.object(
        manager, "_resolve_workspace", new=AsyncMock(return_value=workspace)
    )


async def test_start_status_stop(tmp_path):
    manager = DevProcessManager.instance()
    with _patch_workspace(manager, str(tmp_path)):
        started = await manager.start("p1", [["sh", "-c", "sleep 30"]])

    assert started["status"] == "started"
    assert started["pipeline_id"] == "p1"
    assert started["run_id"]
    assert isinstance(started["pid"], int)

    status = await manager.status("p1")
    assert status["running"] is True
    assert status["status"] == "running"
    assert status["pid"] == started["pid"]
    assert status["exit_code"] is None
    assert status["run_id"] == started["run_id"]

    stopped = await manager.stop("p1")
    assert stopped["status"] == "stopped"
    assert stopped["running"] is False

    # Stop clears the tracked state.
    after = await manager.status("p1")
    assert after["running"] is False
    assert after["status"] == "not_started"
    assert after["pid"] is None


async def test_start_twice_is_rejected(tmp_path):
    manager = DevProcessManager.instance()
    with _patch_workspace(manager, str(tmp_path)):
        await manager.start("p1", [["sh", "-c", "sleep 30"]])
        with pytest.raises(DevProcessAlreadyRunningError):
            await manager.start("p1", [["sh", "-c", "sleep 30"]])


async def test_concurrent_start_only_one_wins(tmp_path):
    manager = DevProcessManager.instance()
    with _patch_workspace(manager, str(tmp_path)):
        results = await asyncio.gather(
            manager.start("p1", [["sh", "-c", "sleep 30"]]),
            manager.start("p1", [["sh", "-c", "sleep 30"]]),
            return_exceptions=True,
        )

    errors = [r for r in results if isinstance(r, Exception)]
    assert len(errors) == 1
    assert isinstance(errors[0], DevProcessAlreadyRunningError)


async def test_start_without_commands_is_rejected():
    manager = DevProcessManager.instance()
    with pytest.raises(DevProcessError):
        await manager.start("p1", [])


async def test_stop_without_process_raises():
    manager = DevProcessManager.instance()
    with pytest.raises(DevProcessNotFoundError):
        await manager.stop("p1")


async def test_exit_code_and_output_are_captured(tmp_path):
    manager = DevProcessManager.instance()
    with _patch_workspace(manager, str(tmp_path)):
        await manager.start("p1", [["sh", "-c", "echo hello; exit 7"]])

    info = manager._processes["p1"]
    await asyncio.wait_for(info.task, timeout=5)

    status = await manager.status("p1")
    assert status["running"] is False
    assert status["status"] == "stopped"
    assert status["exit_code"] == 7
    assert "hello" in info.stdout


async def test_start_after_finish_is_allowed(tmp_path):
    manager = DevProcessManager.instance()
    with _patch_workspace(manager, str(tmp_path)):
        await manager.start("p1", [["sh", "-c", "exit 0"]])
        info = manager._processes["p1"]
        await asyncio.wait_for(info.task, timeout=5)

        # Previous process finished, so a new one may be started.
        restarted = await manager.start("p1", [["sh", "-c", "sleep 30"]])
        assert restarted["status"] == "started"
        await manager.stop("p1")


async def test_dev_server_port_is_injected_into_child_env(tmp_path):
    manager = DevProcessManager.instance()
    with _patch_workspace(manager, str(tmp_path)):
        started = await manager.start(
            "p1", [["sh", "-c", "echo $DEV_SERVER_PORT; echo $PORT"]]
        )

    info = manager._processes["p1"]
    await asyncio.wait_for(info.task, timeout=5)

    expected = str(config.DEV_SERVER_PORT)
    assert info.stdout.split() == [expected, expected]
    assert started["port"] == config.DEV_SERVER_PORT


async def test_port_is_included_in_start_and_status(tmp_path):
    manager = DevProcessManager.instance()
    before = await manager.status("p1")
    assert before["port"] == config.DEV_SERVER_PORT

    with _patch_workspace(manager, str(tmp_path)):
        started = await manager.start("p1", [["sh", "-c", "sleep 30"]])
    assert started["port"] == config.DEV_SERVER_PORT

    status = await manager.status("p1")
    assert status["port"] == config.DEV_SERVER_PORT
    await manager.stop("p1")


async def test_parent_environment_is_not_mutated(tmp_path):
    manager = DevProcessManager.instance()
    parent_port = os.environ.get("PORT")
    parent_dev_port = os.environ.get("DEV_SERVER_PORT")

    with _patch_workspace(manager, str(tmp_path)):
        await manager.start("p1", [["sh", "-c", "exit 0"]])
        info = manager._processes["p1"]
        await asyncio.wait_for(info.task, timeout=5)

    assert os.environ.get("PORT") == parent_port
    assert os.environ.get("DEV_SERVER_PORT") == parent_dev_port


# ---------------------------------------------------------------------------
# ProcessLogBuffer
# ---------------------------------------------------------------------------


def test_log_buffer_snapshot_returns_ordered_newer_chunks():
    buffer = ProcessLogBuffer(max_chunks=10)
    buffer.append("stdout", "a")
    buffer.append("stderr", "b")
    buffer.append("stdout", "c")

    assert [c.text for c in buffer.snapshot(0)] == ["a", "b", "c"]
    assert [c.text for c in buffer.snapshot(2)] == ["c"]
    assert buffer.next_seq == 3
    assert [c.seq for c in buffer.snapshot(0)] == [0, 1, 2]


def test_log_buffer_eviction_advances_base_seq():
    buffer = ProcessLogBuffer(max_chunks=3)
    for text in "abcd":
        buffer.append("stdout", text)

    # 'a' (seq 0) was evicted when 'd' was appended.
    assert buffer.base_seq == 1
    assert [c.text for c in buffer.snapshot(0)] == ["b", "c", "d"]
    assert [c.text for c in buffer.snapshot(2)] == ["c", "d"]


async def test_log_buffer_wait_for_data_returns_promptly():
    buffer = ProcessLogBuffer()
    assert await buffer.wait_for_data(0.01) is False

    buffer.append("stdout", "x")
    assert await buffer.wait_for_data(0.1) is True


# ---------------------------------------------------------------------------
# Incremental capture, stream() and the event sink
# ---------------------------------------------------------------------------


async def test_output_is_observable_before_exit(tmp_path):
    manager = DevProcessManager.instance()
    with _patch_workspace(manager, str(tmp_path)):
        await manager.start("p1", [["sh", "-c", "echo early; sleep 30"]])

    info = manager._processes["p1"]
    for _ in range(200):
        if info.buffer.snapshot(0):
            break
        await asyncio.sleep(0.01)

    assert not info.task.done()
    captured = "".join(c.text for c in info.buffer.snapshot(0))
    assert "early" in captured
    await manager.stop("p1")


async def test_stream_yields_status_chunk_exit(tmp_path):
    manager = DevProcessManager.instance()
    with _patch_workspace(manager, str(tmp_path)):
        await manager.start("p1", [["sh", "-c", "echo hello"]])

    info = manager._processes["p1"]
    await asyncio.wait_for(info.task, timeout=5)

    events = [event async for event in manager.stream("p1", info.run_id)]
    assert events[0]["type"] == "status"
    assert events[0]["run_id"] == info.run_id
    chunks = [e for e in events if e["type"] == "chunk"]
    assert any("hello" in c["text"] for c in chunks)
    assert events[-1] == {"type": "exit", "exit_code": 0}


async def test_stream_run_id_mismatch_yields_terminal_event_only(tmp_path):
    manager = DevProcessManager.instance()
    with _patch_workspace(manager, str(tmp_path)):
        await manager.start("p1", [["sh", "-c", "echo hi"]])
    info = manager._processes["p1"]
    await asyncio.wait_for(info.task, timeout=5)

    events = [event async for event in manager.stream("p1", "other-run")]
    assert events == [{"type": "exit", "exit_code": None}]


async def test_stream_unknown_pipeline_yields_terminal_event_only():
    manager = DevProcessManager.instance()
    events = [event async for event in manager.stream("missing")]
    assert events == [{"type": "exit", "exit_code": None}]


async def test_user_and_started_at_are_captured(tmp_path):
    manager = DevProcessManager.instance()
    with _patch_workspace(manager, str(tmp_path)):
        started = await manager.start("p1", [["sh", "-c", "sleep 30"]], user="bob")

    assert started["user"] == "bob"
    assert started["started_at"] > 0

    status = await manager.status("p1")
    assert status["user"] == "bob"
    assert status["started_at"] == started["started_at"]
    await manager.stop("p1")

    not_started = await manager.status("p2")
    assert not_started["user"] == ""
    assert not_started["started_at"] is None


async def test_event_sink_is_invoked_on_start_and_exit(tmp_path):
    events: list = []

    async def sink(event_type, payload):
        events.append((event_type, payload))

    DevProcessManager.set_event_sink(sink)
    manager = DevProcessManager.instance()
    with _patch_workspace(manager, str(tmp_path)):
        await manager.start("p1", [["sh", "-c", "echo hi"]], user="alice")

    info = manager._processes["p1"]
    await asyncio.wait_for(info.task, timeout=5)
    # allow the finally-block emit to complete
    await asyncio.sleep(0)

    by_type = dict(events)
    assert "DEV_PROCESS_STARTED" in by_type
    assert "DEV_PROCESS_EXITED" in by_type
    assert by_type["DEV_PROCESS_STARTED"]["user"] == "alice"
    assert by_type["DEV_PROCESS_STARTED"]["pipeline_id"] == "p1"
    assert by_type["DEV_PROCESS_EXITED"]["exit_code"] == 0


async def test_failing_event_sink_is_swallowed(tmp_path):
    async def bad_sink(event_type, payload):
        raise RuntimeError("boom")

    DevProcessManager.set_event_sink(bad_sink)
    manager = DevProcessManager.instance()
    with _patch_workspace(manager, str(tmp_path)):
        await manager.start("p1", [["sh", "-c", "echo hi"]])

    info = manager._processes["p1"]
    await asyncio.wait_for(info.task, timeout=5)
    assert info.exit_code == 0
    assert info.status == "exited"


async def test_status_reports_failed_after_nonzero_exit(tmp_path):
    manager = DevProcessManager.instance()
    with _patch_workspace(manager, str(tmp_path)):
        await manager.start("p1", [["sh", "-c", "exit 3"]])

    info = manager._processes["p1"]
    await asyncio.wait_for(info.task, timeout=5)
    assert info.status == "failed"
    assert info.exit_code == 3
    assert "hello" not in info.stdout
