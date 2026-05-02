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
from core.models.models import Pipeline, Task


@pytest.fixture(autouse=True)
def mock_auth():
    mock_user = MagicMock()
    mock_user.username = "testuser"
    app.dependency_overrides[get_current_user] = lambda: mock_user
    yield
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_trigger_docbot_success(async_client, init_mock_db):
    with patch(
        "api.routes.docbot.pipeline_queries.get_pipeline_by_id", new_callable=AsyncMock
    ) as mock_p_get:
        mock_p_get.return_value = Pipeline(name="P1")
        with patch(
            "api.routes.docbot.task_queries.get_task_by_id", new_callable=AsyncMock
        ) as mock_t_get:
            task = Task(title="T1", pipeline_id="p1", commit_hash="abc")
            # We need to set task.id to match the path param if we were using it in
            # queries, but here the mock returns it regardless.
            mock_t_get.return_value = task

            with patch(
                "api.routes.docbot.DocBotManager.process_completed_task",
                new_callable=AsyncMock,
            ) as mock_process:
                response = await async_client.post(
                    "/api/pipelines/p1/docbot/trigger/t1"
                )
                assert response.status_code == status.HTTP_200_OK
                assert mock_process.called


@pytest.mark.asyncio
async def test_trigger_docbot_no_commit(async_client, init_mock_db):
    with patch(
        "api.routes.docbot.pipeline_queries.get_pipeline_by_id", new_callable=AsyncMock
    ) as mock_p_get:
        mock_p_get.return_value = Pipeline(name="P1")
        with patch(
            "api.routes.docbot.task_queries.get_task_by_id", new_callable=AsyncMock
        ) as mock_t_get:
            task = Task(title="T1", pipeline_id="p1", commit_hash=None)
            mock_t_get.return_value = task

            response = await async_client.post("/api/pipelines/p1/docbot/trigger/t1")
            assert response.status_code == status.HTTP_400_BAD_REQUEST
            assert "commit hash" in response.json()["detail"]


@pytest.mark.asyncio
async def test_get_preview_not_found(async_client, init_mock_db):
    with patch("api.routes.docbot.get_preview") as mock_get:
        mock_get.return_value = None
        response = await async_client.get("/api/pipelines/p1/docbot/preview/t1")
        assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.asyncio
async def test_commit_docbot_change_success(async_client, init_mock_db):
    with patch("api.routes.docbot.get_preview") as mock_get:
        preview = MagicMock()
        preview.file_path = "some/path"
        preview.filename = "file.txt"
        mock_get.return_value = preview

        with patch(
            "api.routes.docbot.pipeline_queries.get_pipeline_by_id",
            new_callable=AsyncMock,
        ) as mock_p_get:
            pipeline = Pipeline(name="P1", workspace_path="p1")
            mock_p_get.return_value = pipeline

            with patch("core.utils.git_utils.get_repo") as mock_get_repo:
                mock_repo = MagicMock()
                mock_get_repo.return_value = mock_repo

                response = await async_client.post(
                    "/api/pipelines/p1/docbot/review/commit/t1",
                    json={"commit_msg": "docs improved"},
                )
                assert response.status_code == status.HTTP_200_OK
                assert mock_repo.git.add.called
                assert mock_repo.git.commit.called
