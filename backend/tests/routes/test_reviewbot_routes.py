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

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from beanie import PydanticObjectId
from fastapi import status

from api.auth import get_current_user
from api.main import app
from core.models.models import Task


@pytest.fixture(autouse=True)
def mock_auth():
    mock_user = MagicMock()
    mock_user.username = "testuser"
    app.dependency_overrides[get_current_user] = lambda: mock_user
    yield
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_trigger_reviewbot_success(async_client, init_mock_db):
    with (
        patch(
            "api.reviewbot.router.pipeline_queries.get_pipeline_by_id",
            new_callable=AsyncMock,
        ) as mock_get_pipe,
        patch(
            "api.reviewbot.router.task_queries.get_task_by_id", new_callable=AsyncMock
        ) as mock_get_task,
        patch(
            "api.reviewbot.router.ReviewBotManager.process_completed_task",
            new_callable=AsyncMock,
        ) as mock_process,
    ):
        mock_get_pipe.return_value = MagicMock(id="p1")
        task = Task(pipeline_id="p1", title="Test", commit_hash="abc")
        mock_get_task.return_value = task

        response = await async_client.post("/api/pipelines/p1/reviewbot/trigger/t1")

        assert response.status_code == status.HTTP_200_OK
        assert response.json()["status"] == "success"
        mock_process.assert_called_once_with(task)


@pytest.mark.asyncio
async def test_delete_review_success(async_client, init_mock_db):
    with (
        patch(
            "api.reviewbot.router.task_queries.get_task_by_id", new_callable=AsyncMock
        ) as mock_get_task,
        patch(
            "api.reviewbot.router.manager.broadcast", new_callable=AsyncMock
        ) as mock_broadcast,
        patch("core.models.models.Task.save", new_callable=AsyncMock) as mock_save,
    ):
        task = Task(pipeline_id="p1", title="Test", review_md="# Review")
        task.id = PydanticObjectId()
        mock_get_task.return_value = task

        response = await async_client.delete("/api/pipelines/p1/reviewbot/review/t1")

        assert response.status_code == status.HTTP_200_OK
        assert task.review_md is None
        assert mock_save.called
        assert mock_broadcast.called

        # Verify websocket message
        call_args = mock_broadcast.call_args[0][0]
        assert call_args.type == "TASK_UPDATED"
        assert call_args.payload["id"] == str(task.id)
