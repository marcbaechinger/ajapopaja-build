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
from unittest.mock import MagicMock

import pytest

from api.coderbot.manager import CoderBotManager


@pytest.mark.asyncio
async def test_stop_session_active():
    manager = CoderBotManager()

    # Mock session
    mock_session = MagicMock()
    mock_session.task_id = "test_task"
    mock_session.run = asyncio.Future()
    mock_session.run.set_result(None)

    manager._active_session = mock_session

    stopped = manager.stop_session("test_task")

    assert stopped is True
    mock_session.stop.assert_called_once()


@pytest.mark.asyncio
async def test_stop_session_inactive():
    manager = CoderBotManager()

    # No active session
    stopped = manager.stop_session("test_task")
    assert stopped is False

    # Active session with different task_id
    mock_session = MagicMock()
    mock_session.task_id = "other_task"
    manager._active_session = mock_session

    stopped = manager.stop_session("test_task")
    assert stopped is False
    mock_session.stop.assert_not_called()


@pytest.mark.asyncio
async def test_manager_tracks_active_session():
    manager = CoderBotManager()

    class MockSession:
        def __init__(self, task_id):
            self.task_id = task_id
            self.pipeline_id = "p1"
            self.stop_called = False
            self.started_event = asyncio.Event()

        async def run(self):
            self.started_event.set()
            # Simulate running
            await asyncio.sleep(0.5)

        def stop(self):
            self.stop_called = True

    session = MockSession("test_task")

    # Use patch to prevent real CoderBotSession instantiation in process_task
    # or just manually enqueue since we want to test the queue processing logic
    await manager._queue.put(session)

    worker_task = asyncio.create_task(manager._process_queue())

    await session.started_event.wait()

    # Ensure it's tracked as active
    assert manager._active_session == session

    # Stop it
    stopped = manager.stop_session("test_task")
    assert stopped is True
    assert session.stop_called is True

    # Cleanup
    worker_task.cancel()
    try:
        await worker_task
    except asyncio.CancelledError:
        pass
