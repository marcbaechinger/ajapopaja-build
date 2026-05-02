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
from fastapi.testclient import TestClient

from api.auth import get_current_user
from api.docbot.cache import DocBotPreview, set_preview
from api.main import app

client = TestClient(app)


# Mock auth
async def mock_get_current_user():
    return {"sub": "test_user"}


app.dependency_overrides[get_current_user] = mock_get_current_user


@pytest.mark.asyncio
async def test_commit_docbot_change_repro():
    pipeline_id = "test_pipeline"
    task_id = "test_task"

    # Mock cache storage
    test_cache = {}

    with (
        patch("api.docbot.cache._load_cache", side_effect=lambda: test_cache),
        patch(
            "api.docbot.cache._save_cache", side_effect=lambda c: test_cache.update(c)
        ),
        patch(
            "api.routes.docbot.pipeline_queries.get_pipeline_by_id",
            new_callable=AsyncMock,
        ) as mock_get_pipeline,
        patch("api.routes.docbot.git_utils.get_repo") as mock_get_repo,
    ):
        preview = DocBotPreview(
            task_id=task_id,
            pipeline_id=pipeline_id,
            diff="some diff",
            commit_msg="test commit",
            file_path="/tmp/test.md",
            filename="test.md",
        )

        # Set preview
        await set_preview(task_id, preview)
        assert task_id in test_cache

        mock_pipeline = MagicMock()
        mock_pipeline.workspace_abs_path = "/tmp"
        mock_get_pipeline.return_value = mock_pipeline

        mock_repo = MagicMock()
        mock_get_repo.return_value = mock_repo

        # Call the commit endpoint
        response = client.post(
            f"/api/pipelines/{pipeline_id}/docbot/review/commit/{task_id}",
            json={"commit_msg": "New commit message"},
        )

        assert response.status_code == 200
        assert response.json()["status"] == "success"

        # Verify preview was cleared
        assert task_id not in test_cache


@pytest.mark.asyncio
async def test_commit_docbot_change_404_repro():
    pipeline_id = "test_pipeline"
    task_id = "missing_task"

    # Mock empty cache
    with patch("api.docbot.cache._load_cache", return_value={}):
        response = client.post(
            f"/api/pipelines/{pipeline_id}/docbot/review/commit/{task_id}",
            json={"commit_msg": "New commit message"},
        )

        assert response.status_code == 404
        assert response.json()["detail"] == "Preview not found for this task."
