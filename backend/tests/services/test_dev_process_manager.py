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
