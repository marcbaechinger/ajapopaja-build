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

from api.assistant.tools.task_tools import delete_task
from api.websocket_manager import WSMessage
from core.exceptions import EntityNotFoundError
from core.models.models import Pipeline, Task


@pytest.mark.asyncio
async def test_delete_task_soft_deletes_and_bumps_version(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline")
    await pipeline.insert()

    task = Task(title="Duplicate Task", pipeline_id=str(pipeline.id))
    await task.insert()
    task_id = str(task.id)
    original_version = task.version

    with patch(
        "api.assistant.tools.task_tools.manager.broadcast", new_callable=AsyncMock
    ):
        result = await delete_task(task_id)

    assert result == {"status": "ok", "task_id": task_id}

    # The task is soft-deleted and its version incremented.
    deleted_task = await Task.get(task_id)
    assert deleted_task.deleted is True
    assert deleted_task.version == original_version + 1

    # Soft-deleted tasks are hidden from the default query.
    from core.queries import task as task_queries

    with pytest.raises(EntityNotFoundError):
        await task_queries.get_task_by_id(task_id)

    # ...but still retrievable when explicitly including deleted tasks.
    included = await task_queries.get_task_by_id(task_id, include_deleted=True)
    assert included.deleted is True


@pytest.mark.asyncio
async def test_delete_task_broadcasts_task_deleted(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline")
    await pipeline.insert()

    task = Task(title="Duplicate Task", pipeline_id=str(pipeline.id))
    await task.insert()
    task_id = str(task.id)
    pipeline_id = str(pipeline.id)

    with patch(
        "api.assistant.tools.task_tools.manager.broadcast", new_callable=AsyncMock
    ) as mock_broadcast:
        await delete_task(task_id)

    mock_broadcast.assert_awaited_once()
    message = mock_broadcast.await_args.args[0]
    assert isinstance(message, WSMessage)
    assert message.type == "TASK_DELETED"
    assert message.payload == {"task_id": task_id, "pipeline_id": pipeline_id}


@pytest.mark.asyncio
async def test_delete_task_not_found(init_mock_db):
    with patch(
        "api.assistant.tools.task_tools.manager.broadcast", new_callable=AsyncMock
    ) as mock_broadcast:
        result = await delete_task("69e2d04b3c5ec70ad0904437")

    assert "error" in result
    assert "Task with ID '69e2d04b3c5ec70ad0904437' not found" in result["error"]
    mock_broadcast.assert_not_awaited()
