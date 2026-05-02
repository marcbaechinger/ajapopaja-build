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
from fastapi import status

from core.models.models import Task, TaskStatus


@pytest.mark.asyncio
async def test_search_tasks(async_client, init_mock_db):
    from api.auth import get_current_user
    from api.main import app

    app.dependency_overrides[get_current_user] = lambda: AsyncMock()
    try:
        with patch(
            "api.routes.task.task_queries.search_tasks", new_callable=AsyncMock
        ) as mock_search:
            mock_search.return_value = ([], 0)
            response = await async_client.get(
                "/api/tasks/search?keywords=test&statuses=created&statuses=scheduled"
            )
            assert response.status_code == status.HTTP_200_OK
            assert response.json() == {"tasks": [], "total_count": 0}
            mock_search.assert_called_once_with(
                keywords="test",
                statuses=[TaskStatus.CREATED, TaskStatus.SCHEDULED],
                pipeline_id=None,
                page=0,
                limit=20,
            )
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_get_task_by_id(async_client, init_mock_db):
    from api.auth import get_current_user
    from api.main import app

    app.dependency_overrides[get_current_user] = lambda: AsyncMock()
    try:
        with patch(
            "api.routes.task.task_queries.get_task_by_id", new_callable=AsyncMock
        ) as mock_get:
            task = Task(title="Fix Bug", pipeline_id="p1", status=TaskStatus.CREATED)
            mock_get.return_value = task
            response = await async_client.get("/api/tasks/t1")
            assert response.status_code == status.HTTP_200_OK
            assert response.json()["title"] == "Fix Bug"
    finally:
        app.dependency_overrides.clear()
