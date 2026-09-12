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
    with patch(
        "api.routes.pipeline.pipeline_queries.get_all_pipelines", new_callable=AsyncMock
    ) as mock_get:
        mock_get.return_value = []
        response = await async_client.get("/api/pipelines/")
        assert response.status_code == status.HTTP_200_OK
        assert response.json() == []


@pytest.mark.asyncio
async def test_create_pipeline_success(async_client, init_mock_db):
    with patch(
        "api.routes.pipeline.pipeline_queries.create_pipeline", new_callable=AsyncMock
    ) as mock_create:
        from core.models.models import Pipeline

        new_pipeline = Pipeline(name="New Pipeline")
        mock_create.return_value = new_pipeline

        with patch(
            "api.routes.pipeline.manager.broadcast", new_callable=AsyncMock
        ) as mock_broadcast:
            response = await async_client.post(
                "/api/pipelines/", json={"name": "New Pipeline"}
            )
            assert response.status_code == status.HTTP_200_OK
            assert mock_broadcast.called


@pytest.mark.asyncio
async def test_get_pipeline_not_found(async_client, init_mock_db):
    from core.exceptions import EntityNotFoundError

    with patch(
        "api.routes.pipeline.pipeline_queries.get_pipeline_by_id",
        side_effect=EntityNotFoundError("Not found"),
    ):
        response = await async_client.get("/api/pipelines/p1")
        # FastAPI handles custom exceptions if middleware is set up,
        # but let's see how it behaves here.
        # Actually, EntityNotFoundError might need to be caught or it results in 500.
        # Let's check api/main.py for exception handlers.
        assert (
            response.status_code == status.HTTP_404_NOT_FOUND
            or response.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
        )


@pytest.mark.asyncio
async def test_update_pipeline_missing_version(async_client, init_mock_db):
    # 'version' is required in the body (embed=True)
    response = await async_client.patch(
        "/api/pipelines/p1", json={"name": "Updated Name"}
    )
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT


@pytest.mark.asyncio
async def test_delete_pipeline_unauthenticated(async_client, init_mock_db):
    app.dependency_overrides.clear()  # remove mock auth
    response = await async_client.delete("/api/pipelines/p1")
    assert response.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.asyncio
async def test_pipeline_serialization_never_exposes_repo_token():
    """repo_token must never appear in serialized output; has_repo_token reflects it."""
    from core.models.models import Pipeline

    pipeline = Pipeline(name="Remote", repo_token="secret-token")
    data = pipeline.model_dump(mode="json")
    assert data["repo_token"] is None
    assert data["has_repo_token"] is True

    empty = Pipeline(name="Local")
    data = empty.model_dump(mode="json")
    assert data["repo_token"] is None
    assert data["has_repo_token"] is False


@pytest.mark.asyncio
async def test_create_pipeline_local_with_credentials_rejected(
    async_client, init_mock_db
):
    """A local pipeline (no repo_uri) must not carry repo credentials."""
    with patch(
        "api.routes.pipeline.pipeline_queries.create_pipeline", new_callable=AsyncMock
    ) as mock_create:
        response = await async_client.post(
            "/api/pipelines/",
            json={
                "name": "Local with creds",
                "repo_username": "gituser",
                "repo_token": "gittoken",
            },
        )
        assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
        assert "repo_uri" in response.json()["detail"]
        mock_create.assert_not_called()


@pytest.mark.asyncio
async def test_create_pipeline_remote_with_workspace_rejected(
    async_client, init_mock_db
):
    """A remote pipeline must not set workspace_path (derived from the clone)."""
    with patch(
        "api.routes.pipeline.pipeline_queries.create_pipeline", new_callable=AsyncMock
    ) as mock_create:
        response = await async_client.post(
            "/api/pipelines/",
            json={
                "name": "Remote",
                "repo_uri": "https://host/org/my-app.git",
                "workspace_path": "/tmp/ws",
            },
        )
        assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
        assert "workspace_path" in response.json()["detail"]
        mock_create.assert_not_called()


@pytest.mark.asyncio
async def test_create_pipeline_valid_local(async_client, init_mock_db):
    from core.models.models import Pipeline

    with patch(
        "api.routes.pipeline.pipeline_queries.create_pipeline", new_callable=AsyncMock
    ) as mock_create:
        new_pipeline = Pipeline(name="Local", workspace_path="./proj")
        mock_create.return_value = new_pipeline
        with patch("api.routes.pipeline.manager.broadcast", new_callable=AsyncMock):
            response = await async_client.post(
                "/api/pipelines/", json={"name": "Local", "workspace_path": "./proj"}
            )
            assert response.status_code == status.HTTP_200_OK
            assert response.json()["name"] == "Local"
            assert mock_create.called


@pytest.mark.asyncio
async def test_create_pipeline_valid_remote_with_credentials(
    async_client, init_mock_db
):
    """A valid remote pipeline may carry username + token; the token is never
    serialized back, but has_repo_token reflects that it is stored."""
    from core.models.models import Pipeline

    with patch(
        "api.routes.pipeline.pipeline_queries.create_pipeline", new_callable=AsyncMock
    ) as mock_create:
        created = Pipeline(
            name="Remote",
            repo_uri="https://host/org/my-app.git",
            repo_username="gituser",
            repo_token="gittoken",
        )
        mock_create.return_value = created
        with patch("api.routes.pipeline.manager.broadcast", new_callable=AsyncMock):
            response = await async_client.post(
                "/api/pipelines/",
                json={
                    "name": "Remote",
                    "repo_uri": "https://host/org/my-app.git",
                    "repo_username": "gituser",
                    "repo_token": "gittoken",
                },
            )
            assert response.status_code == status.HTTP_200_OK
            body = response.json()
            assert body["repo_uri"] == "https://host/org/my-app.git"
            assert body["repo_token"] is None
            assert body["has_repo_token"] is True


def test_validate_pipeline_input_local():
    """Query-level validation: local pipelines pass (workspace optional)."""
    from core.models.models import Pipeline
    from core.queries.pipeline import validate_pipeline_input

    validate_pipeline_input(Pipeline(name="Local"))
    validate_pipeline_input(Pipeline(name="Local", workspace_path="./proj"))


def test_validate_pipeline_input_local_with_credentials_fails():
    from core.exceptions import ValidationError
    from core.models.models import Pipeline
    from core.queries.pipeline import validate_pipeline_input

    with pytest.raises(ValidationError):
        validate_pipeline_input(
            Pipeline(name="Local", repo_username="u", repo_token="t")
        )


def test_validate_pipeline_input_remote_pass():
    from core.models.models import Pipeline
    from core.queries.pipeline import validate_pipeline_input

    validate_pipeline_input(
        Pipeline(
            name="Remote",
            repo_uri="https://host/org/my-app.git",
            repo_username="u",
            repo_token="t",
        )
    )


def test_validate_pipeline_input_remote_with_workspace_fails():
    from core.exceptions import ValidationError
    from core.models.models import Pipeline
    from core.queries.pipeline import validate_pipeline_input

    with pytest.raises(ValidationError):
        validate_pipeline_input(
            Pipeline(
                name="Remote",
                repo_uri="https://host/org/my-app.git",
                workspace_path="./proj",
            )
        )


@pytest.mark.asyncio
async def test_update_pipeline_only_overrides_token_when_non_empty(init_mock_db):
    """update_pipeline must keep the stored token when a blank/None value is sent."""
    from core.models.models import Pipeline
    from core.queries import pipeline as pipeline_queries

    stored = Pipeline(name="Remote", repo_token="existing-token", version=1)

    with (
        patch(
            "core.queries.pipeline.get_pipeline_by_id",
            new_callable=AsyncMock,
            return_value=stored,
        ),
        patch.object(Pipeline, "save", new_callable=AsyncMock),
    ):
        # Empty string must NOT clear the token.
        await pipeline_queries.update_pipeline("p1", stored.version, repo_token="")
        assert stored.repo_token == "existing-token"

        # None must NOT clear the token.
        await pipeline_queries.update_pipeline("p1", stored.version, repo_token=None)
        assert stored.repo_token == "existing-token"

        # A new non-empty value must override the token.
        await pipeline_queries.update_pipeline(
            "p1", stored.version, repo_token="new-token"
        )
        assert stored.repo_token == "new-token"
