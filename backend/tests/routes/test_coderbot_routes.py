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

from api.auth import get_current_user
from api.main import app


@pytest.mark.asyncio
async def test_trigger_coderbot_unauthenticated(async_client, init_mock_db):
    response = await async_client.post("/api/coderbot/trigger/task_123")
    assert response.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.asyncio
async def test_trigger_coderbot_authenticated(async_client, init_mock_db):
    mock_user = AsyncMock()
    mock_user.username = "testuser"

    app.dependency_overrides[get_current_user] = lambda: mock_user

    try:
        with patch(
            "api.coderbot.router.Task.get", new_callable=AsyncMock
        ) as mock_get_task:
            mock_task = AsyncMock()
            mock_task.id = "task_123"
            mock_task.pipeline_id = "pipe_123"
            mock_get_task.return_value = mock_task

            with patch(
                "api.coderbot.router.coderbot_manager.process_task",
                new_callable=AsyncMock,
            ) as mock_process:
                response = await async_client.post("/api/coderbot/trigger/task_123")
                assert response.status_code == status.HTTP_200_OK
                assert response.json()["status"] == "success"
                mock_process.assert_called_once_with(mock_task)
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_stop_coderbot_unauthenticated(async_client, init_mock_db):
    response = await async_client.post("/api/coderbot/stop/task_123")
    assert response.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.asyncio
async def test_stop_coderbot_authenticated(async_client, init_mock_db):
    mock_user = AsyncMock()
    mock_user.username = "testuser"

    app.dependency_overrides[get_current_user] = lambda: mock_user

    try:
        with patch("api.coderbot.router.coderbot_manager.stop_session") as mock_stop:
            mock_stop.return_value = True
            response = await async_client.post("/api/coderbot/stop/task_123")
            assert response.status_code == status.HTTP_200_OK
            assert response.json()["status"] == "success"
            mock_stop.assert_called_once_with("task_123")
    finally:
        app.dependency_overrides.clear()
