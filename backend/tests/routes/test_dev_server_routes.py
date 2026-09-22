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
from core.models.models import Pipeline
from core.services.dev_process_manager import (
    DevProcessAlreadyRunningError,
    DevProcessManager,
    DevProcessNotFoundError,
)


@pytest.fixture(autouse=True)
def mock_auth():
    mock_user = MagicMock()
    mock_user.username = "testuser"
    app.dependency_overrides[get_current_user] = lambda: mock_user
    yield
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_dev_status(async_client, init_mock_db):
    with patch.object(
        DevProcessManager, "status", new_callable=AsyncMock
    ) as mock_status:
        mock_status.return_value = {
            "running": False,
            "pid": None,
            "exit_code": None,
            "port": 1224,
        }
        response = await async_client.get("/api/pipelines/p1/dev/status")
        assert response.status_code == status.HTTP_200_OK
        assert response.json() == {
            "running": False,
            "pid": None,
            "exit_code": None,
            "port": 1224,
        }


@pytest.mark.asyncio
async def test_dev_start_without_serve_commands(async_client, init_mock_db):
    pipeline = Pipeline(name="No serve")
    await pipeline.insert()

    response = await async_client.post(f"/api/pipelines/{pipeline.id}/dev/start")
    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "No serve commands" in response.json()["detail"]


@pytest.mark.asyncio
async def test_dev_start_pipeline_not_found(async_client, init_mock_db):
    response = await async_client.post("/api/pipelines/does-not-exist/dev/start")
    assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.asyncio
async def test_dev_start_uses_pipeline_serve_commands(async_client, init_mock_db):
    pipeline = Pipeline(name="Serve", serve_commands=[["sh", "-c", "sleep 30"]])
    await pipeline.insert()

    with patch.object(DevProcessManager, "start", new_callable=AsyncMock) as mock_start:
        mock_start.return_value = {
            "status": "started",
            "run_id": "abc",
            "pid": 42,
            "port": 1224,
        }
        response = await async_client.post(f"/api/pipelines/{pipeline.id}/dev/start")

    assert response.status_code == status.HTTP_200_OK
    assert response.json()["status"] == "started"
    assert response.json()["port"] == 1224
    mock_start.assert_awaited_once()
    args = mock_start.await_args.args
    assert args[0] == str(pipeline.id)
    assert args[1] == [["sh", "-c", "sleep 30"]]
    assert args[2] == "testuser"


@pytest.mark.asyncio
async def test_dev_start_conflict(async_client, init_mock_db):
    pipeline = Pipeline(name="Serve", serve_commands=[["sh", "-c", "sleep 30"]])
    await pipeline.insert()

    with patch.object(
        DevProcessManager,
        "start",
        new_callable=AsyncMock,
        side_effect=DevProcessAlreadyRunningError("already running"),
    ):
        response = await async_client.post(f"/api/pipelines/{pipeline.id}/dev/start")

    assert response.status_code == status.HTTP_409_CONFLICT
    assert "already running" in response.json()["detail"]


@pytest.mark.asyncio
async def test_dev_stop_success(async_client, init_mock_db):
    with patch.object(DevProcessManager, "stop", new_callable=AsyncMock) as mock_stop:
        mock_stop.return_value = {"status": "stopped", "running": False}
        response = await async_client.post("/api/pipelines/p1/dev/stop")

    assert response.status_code == status.HTTP_200_OK
    assert response.json()["status"] == "stopped"
    mock_stop.assert_awaited_once_with("p1")


@pytest.mark.asyncio
async def test_dev_stop_not_found(async_client, init_mock_db):
    with patch.object(
        DevProcessManager,
        "stop",
        new_callable=AsyncMock,
        side_effect=DevProcessNotFoundError("no process"),
    ):
        response = await async_client.post("/api/pipelines/p1/dev/stop")

    assert response.status_code == status.HTTP_404_NOT_FOUND
    assert "no process" in response.json()["detail"]


@pytest.mark.asyncio
async def test_dev_restart_stops_then_starts(async_client, init_mock_db):
    pipeline = Pipeline(name="Serve", serve_commands=[["sh", "-c", "sleep 30"]])
    await pipeline.insert()

    with (
        patch.object(DevProcessManager, "stop", new_callable=AsyncMock) as mock_stop,
        patch.object(DevProcessManager, "start", new_callable=AsyncMock) as mock_start,
    ):
        mock_start.return_value = {
            "status": "started",
            "run_id": "new",
            "pid": 7,
            "port": 1224,
        }
        response = await async_client.post(f"/api/pipelines/{pipeline.id}/dev/restart")

    assert response.status_code == status.HTTP_200_OK
    assert response.json()["port"] == 1224
    mock_stop.assert_awaited_once()
    mock_start.assert_awaited_once()
    start_args = mock_start.await_args.args
    assert start_args[0] == str(pipeline.id)
    assert start_args[2] == "testuser"
