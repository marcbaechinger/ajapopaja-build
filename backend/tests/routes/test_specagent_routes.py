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
from api.specagent import cache as cache_mod
from api.specagent.cache import SpecProposal
from core.models.models import Task


@pytest.fixture(autouse=True)
def mock_auth():
    mock_user = MagicMock()
    mock_user.username = "testuser"
    app.dependency_overrides[get_current_user] = lambda: mock_user
    yield
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_trigger_specagent_success(async_client, init_mock_db):
    with (
        patch(
            "api.specagent.router.task_queries.get_task_by_id",
            new_callable=AsyncMock,
        ) as mock_get_task,
        patch(
            "api.specagent.router.SpecAgentManager.process_task",
            new_callable=AsyncMock,
        ) as mock_process,
    ):
        task = Task(pipeline_id="p1", title="Test", spec="- a rough idea")
        mock_get_task.return_value = task

        response = await async_client.post("/api/pipelines/p1/specagent/trigger/t1")

        assert response.status_code == status.HTTP_200_OK
        assert response.json()["status"] == "success"
        mock_process.assert_called_once_with(task)


@pytest.mark.asyncio
async def test_trigger_specagent_unknown_task(async_client, init_mock_db):
    with patch(
        "api.specagent.router.task_queries.get_task_by_id",
        new_callable=AsyncMock,
        return_value=None,
    ):
        response = await async_client.post("/api/pipelines/p1/specagent/trigger/t1")
        assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.asyncio
async def test_trigger_specagent_pipeline_mismatch(async_client, init_mock_db):
    with patch(
        "api.specagent.router.task_queries.get_task_by_id",
        new_callable=AsyncMock,
    ) as mock_get_task:
        mock_get_task.return_value = Task(
            pipeline_id="other", title="Test", spec="- a rough idea"
        )
        response = await async_client.post("/api/pipelines/p1/specagent/trigger/t1")
        assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.asyncio
async def test_trigger_specagent_missing_spec(async_client, init_mock_db):
    with patch(
        "api.specagent.router.task_queries.get_task_by_id",
        new_callable=AsyncMock,
    ) as mock_get_task:
        mock_get_task.return_value = Task(pipeline_id="p1", title="Test", spec=None)
        response = await async_client.post("/api/pipelines/p1/specagent/trigger/t1")
        assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.asyncio
async def test_get_and_delete_proposal(
    async_client, init_mock_db, tmp_path, monkeypatch
):
    monkeypatch.setattr(cache_mod, "CACHE_FILE", str(tmp_path / "proposals.json"))

    with patch("api.specagent.router.get_proposal", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = SpecProposal(
            task_id="t1",
            pipeline_id="p1",
            spec_md="# Elaborated",
            rationale="because",
        )
        response = await async_client.get("/api/pipelines/p1/specagent/proposal/t1")
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["spec_md"] == "# Elaborated"

    with patch(
        "api.specagent.router.get_proposal",
        new_callable=AsyncMock,
        return_value=None,
    ):
        response = await async_client.get("/api/pipelines/p1/specagent/proposal/t1")
        assert response.status_code == status.HTTP_404_NOT_FOUND

    with patch(
        "api.specagent.router.clear_proposal", new_callable=AsyncMock
    ) as mock_clear:
        response = await async_client.delete("/api/pipelines/p1/specagent/proposal/t1")
        assert response.status_code == status.HTTP_200_OK
        mock_clear.assert_called_once_with("t1")
