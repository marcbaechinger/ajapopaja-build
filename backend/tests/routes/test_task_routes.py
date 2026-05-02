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
from fastapi import status

from api.auth import get_current_user
from api.main import app
from core.models.models import Task, TaskStatus


@pytest.fixture(autouse=True)
def mock_auth():
    mock_user = MagicMock()
    mock_user.username = "testuser"
    app.dependency_overrides[get_current_user] = lambda: mock_user
    yield
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_get_task_success(async_client, init_mock_db):
    with patch("api.routes.task.task_queries.get_task_by_id", new_callable=AsyncMock) as mock_get:
        task = Task(title="Test Task", pipeline_id="p1")
        mock_get.return_value = task
        response = await async_client.get("/api/tasks/t1")
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["title"] == "Test Task"


@pytest.mark.asyncio
async def test_update_task_status_missing_params(async_client, init_mock_db):
    response = await async_client.patch(
        "/api/tasks/t1/status",
        json={"status": "scheduled"} # missing version
    )
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT


@pytest.mark.asyncio
async def test_complete_task_success(async_client, init_mock_db):
    with patch("api.routes.task.task_queries.complete_task", new_callable=AsyncMock) as mock_complete:
        task = Task(title="Done", pipeline_id="p1", status=TaskStatus.IMPLEMENTED)
        mock_complete.return_value = task
        
        with patch("api.routes.task.manager.broadcast", new_callable=AsyncMock) as mock_broadcast:
            response = await async_client.post(
                "/api/tasks/t1/complete",
                json={
                    "version": 1,
                    "commit_hash": "abc",
                    "completion_info": "finished"
                }
            )
            assert response.status_code == status.HTTP_200_OK
            assert mock_broadcast.called


@pytest.mark.asyncio
async def test_get_next_task_no_auth_required(async_client, init_mock_db):
    # This endpoint doesn't have get_current_user dependency
    with patch("api.routes.task.task_queries.get_next_task", new_callable=AsyncMock) as mock_next:
        mock_next.return_value = None
        response = await async_client.post("/api/pipelines/p1/tasks/next")
        assert response.status_code == status.HTTP_200_OK


@pytest.mark.asyncio
async def test_search_tasks_with_query_params(async_client, init_mock_db):
    with patch("api.routes.task.task_queries.search_tasks", new_callable=AsyncMock) as mock_search:
        mock_search.return_value = ([], 0)
        response = await async_client.get("/api/tasks/search?keywords=test&statuses=created&statuses=scheduled")
        assert response.status_code == status.HTTP_200_OK
        mock_search.assert_called_once_with(
            keywords="test",
            statuses=[TaskStatus.CREATED, TaskStatus.SCHEDULED],
            pipeline_id=None,
            page=0,
            limit=20
        )
