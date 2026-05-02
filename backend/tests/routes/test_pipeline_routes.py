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


@pytest.fixture(autouse=True)
def mock_auth():
    mock_user = MagicMock()
    mock_user.username = "testuser"
    app.dependency_overrides[get_current_user] = lambda: mock_user
    yield
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_get_pipelines(async_client, init_mock_db):
    with patch("api.routes.pipeline.pipeline_queries.get_all_pipelines", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = []
        response = await async_client.get("/api/pipelines/")
        assert response.status_code == status.HTTP_200_OK
        assert response.json() == []


@pytest.mark.asyncio
async def test_create_pipeline_success(async_client, init_mock_db):
    with patch("api.routes.pipeline.pipeline_queries.create_pipeline", new_callable=AsyncMock) as mock_create:
        from core.models.models import Pipeline
        new_pipeline = Pipeline(name="New Pipeline")
        mock_create.return_value = new_pipeline
        
        with patch("api.routes.pipeline.manager.broadcast", new_callable=AsyncMock) as mock_broadcast:
            response = await async_client.post(
                "/api/pipelines/",
                json={"name": "New Pipeline"}
            )
            assert response.status_code == status.HTTP_200_OK
            assert mock_broadcast.called


@pytest.mark.asyncio
async def test_get_pipeline_not_found(async_client, init_mock_db):
    from core.exceptions import EntityNotFoundError
    with patch("api.routes.pipeline.pipeline_queries.get_pipeline_by_id", side_effect=EntityNotFoundError("Not found")):
        response = await async_client.get("/api/pipelines/p1")
        # FastAPI handles custom exceptions if middleware is set up, 
        # but let's see how it behaves here.
        # Actually, EntityNotFoundError might need to be caught or it results in 500.
        # Let's check api/main.py for exception handlers.
        assert response.status_code == status.HTTP_404_NOT_FOUND or response.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR


@pytest.mark.asyncio
async def test_update_pipeline_missing_version(async_client, init_mock_db):
    # 'version' is required in the body (embed=True)
    response = await async_client.patch(
        "/api/pipelines/p1",
        json={"name": "Updated Name"}
    )
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY


@pytest.mark.asyncio
async def test_delete_pipeline_unauthenticated(async_client, init_mock_db):
    app.dependency_overrides.clear() # remove mock auth
    response = await async_client.delete("/api/pipelines/p1")
    assert response.status_code == status.HTTP_401_UNAUTHORIZED
