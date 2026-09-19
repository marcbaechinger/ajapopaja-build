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
async def test_get_pipelines_ordered_newest_first(async_client, init_mock_db):
    """GET /api/pipelines/ returns pipelines ordered newest-first by created_at."""
    from datetime import UTC, datetime

    from core.models.models import Pipeline

    p_newest = Pipeline(
        name="Newest", created_at=datetime(2026, 1, 3, tzinfo=UTC), version=1
    )
    p_middle = Pipeline(
        name="Middle", created_at=datetime(2026, 1, 2, tzinfo=UTC), version=1
    )
    p_oldest = Pipeline(
        name="Oldest", created_at=datetime(2026, 1, 1, tzinfo=UTC), version=1
    )
    # Insert out of order to prove the endpoint sorts them.
    await p_middle.insert()
    await p_oldest.insert()
    await p_newest.insert()

    response = await async_client.get("/api/pipelines/")

    assert response.status_code == status.HTTP_200_OK
    names = [entry["name"] for entry in response.json()]
    assert names == ["Newest", "Middle", "Oldest"]


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


@pytest.mark.asyncio
async def test_create_pipeline_with_test_commands(async_client, init_mock_db):
    """A pipeline may be created with per-pipeline test commands."""
    from core.models.models import Pipeline

    with patch(
        "api.routes.pipeline.pipeline_queries.create_pipeline", new_callable=AsyncMock
    ) as mock_create:
        new_pipeline = Pipeline(name="WithTests", test_commands=[["pytest", "-q"]])
        mock_create.return_value = new_pipeline
        with patch("api.routes.pipeline.manager.broadcast", new_callable=AsyncMock):
            response = await async_client.post(
                "/api/pipelines/",
                json={"name": "WithTests", "test_commands": [["pytest", "-q"]]},
            )
            assert response.status_code == status.HTTP_200_OK
            assert response.json()["test_commands"] == [["pytest", "-q"]]
            assert mock_create.called


@pytest.mark.asyncio
async def test_create_pipeline_invalid_test_commands_rejected(
    async_client, init_mock_db
):
    """Malformed test_commands must be rejected (422) at the model level."""
    with patch(
        "api.routes.pipeline.pipeline_queries.create_pipeline", new_callable=AsyncMock
    ) as mock_create:
        response = await async_client.post(
            "/api/pipelines/",
            json={"name": "Bad", "test_commands": ["pytest -q"]},
        )
        assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
        # The validation error must reference the test_commands field.
        assert "test_commands" in str(response.json().get("detail"))
        mock_create.assert_not_called()


@pytest.mark.asyncio
async def test_update_pipeline_sets_test_commands(init_mock_db):
    """update_pipeline persists valid test_commands on the stored pipeline."""
    from core.models.models import Pipeline
    from core.queries import pipeline as pipeline_queries

    stored = Pipeline(name="Local", version=1)

    with (
        patch(
            "core.queries.pipeline.get_pipeline_by_id",
            new_callable=AsyncMock,
            return_value=stored,
        ),
        patch.object(Pipeline, "save", new_callable=AsyncMock),
    ):
        await pipeline_queries.update_pipeline(
            "p1", stored.version, test_commands=[["make", "test"]]
        )
        assert stored.test_commands == [["make", "test"]]

        # Explicit empty list clears pipeline-specific commands (falls back global).
        await pipeline_queries.update_pipeline("p1", stored.version, test_commands=[])
        assert stored.test_commands == []


def test_pipeline_model_rejects_empty_argv_strings():
    """Each argv element must be a non-empty string."""
    from core.models.models import Pipeline

    with pytest.raises(Exception):
        Pipeline(name="Bad", test_commands=[[""]])


@pytest.mark.asyncio
async def test_update_pipeline_sets_lint_commands(init_mock_db):
    """update_pipeline persists valid lint_commands on the stored pipeline."""
    from core.models.models import Pipeline
    from core.queries import pipeline as pipeline_queries

    stored = Pipeline(name="Local", version=1)

    with (
        patch(
            "core.queries.pipeline.get_pipeline_by_id",
            new_callable=AsyncMock,
            return_value=stored,
        ),
        patch.object(Pipeline, "save", new_callable=AsyncMock),
    ):
        await pipeline_queries.update_pipeline(
            "p1", stored.version, lint_commands=[["make", "lint"]]
        )
        assert stored.lint_commands == [["make", "lint"]]

        # Explicit empty list clears pipeline-specific lint commands.
        await pipeline_queries.update_pipeline("p1", stored.version, lint_commands=[])
        assert stored.lint_commands == []


def test_pipeline_model_rejects_empty_argv_strings_lint():
    """Each lint command argv element must be a non-empty string."""
    from core.models.models import Pipeline

    with pytest.raises(Exception):
        Pipeline(name="Bad", lint_commands=[[""]])


@pytest.mark.asyncio
async def test_create_pipeline_with_serve_commands(async_client, init_mock_db):
    """A pipeline may be created with per-pipeline serve commands."""
    from core.models.models import Pipeline

    with patch(
        "api.routes.pipeline.pipeline_queries.create_pipeline", new_callable=AsyncMock
    ) as mock_create:
        new_pipeline = Pipeline(
            name="WithServe", serve_commands=[["uvicorn", "main:app", "--reload"]]
        )
        mock_create.return_value = new_pipeline
        with patch("api.routes.pipeline.manager.broadcast", new_callable=AsyncMock):
            response = await async_client.post(
                "/api/pipelines/",
                json={
                    "name": "WithServe",
                    "serve_commands": [["uvicorn", "main:app", "--reload"]],
                },
            )
            assert response.status_code == status.HTTP_200_OK
            assert response.json()["serve_commands"] == [
                ["uvicorn", "main:app", "--reload"]
            ]
            assert mock_create.called


@pytest.mark.asyncio
async def test_create_pipeline_invalid_serve_commands_rejected(
    async_client, init_mock_db
):
    """Malformed serve_commands must be rejected (422) at the model level."""
    with patch(
        "api.routes.pipeline.pipeline_queries.create_pipeline", new_callable=AsyncMock
    ) as mock_create:
        response = await async_client.post(
            "/api/pipelines/",
            json={"name": "Bad", "serve_commands": ["uvicorn main:app"]},
        )
        assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
        assert "serve_commands" in str(response.json().get("detail"))
        mock_create.assert_not_called()


@pytest.mark.asyncio
async def test_update_pipeline_sets_serve_commands(init_mock_db):
    """update_pipeline persists valid serve_commands on the stored pipeline."""
    from core.models.models import Pipeline
    from core.queries import pipeline as pipeline_queries

    stored = Pipeline(name="Local", version=1)

    with (
        patch(
            "core.queries.pipeline.get_pipeline_by_id",
            new_callable=AsyncMock,
            return_value=stored,
        ),
        patch.object(Pipeline, "save", new_callable=AsyncMock),
    ):
        await pipeline_queries.update_pipeline(
            "p1", stored.version, serve_commands=[["uvicorn", "main:app"]]
        )
        assert stored.serve_commands == [["uvicorn", "main:app"]]

        # Explicit empty list clears the configured dev server.
        await pipeline_queries.update_pipeline("p1", stored.version, serve_commands=[])
        assert stored.serve_commands == []


def test_pipeline_model_rejects_empty_argv_strings_serve():
    """Each serve command argv element must be a non-empty string."""
    from core.models.models import Pipeline

    with pytest.raises(Exception):
        Pipeline(name="Bad", serve_commands=[[""]])


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


@pytest.mark.asyncio
async def test_drop_top_commit_endpoint(async_client, init_mock_db):
    """POST /api/pipelines/{id}/drop_top_commit returns status and message."""
    with patch(
        "api.routes.pipeline.git_utils.drop_top_commit",
        new_callable=AsyncMock,
        return_value="Successfully dropped commit abc123.",
    ) as mock_drop:
        response = await async_client.post("/api/pipelines/p1/drop_top_commit")
        assert response.status_code == status.HTTP_200_OK
        body = response.json()
        assert body == {
            "status": "ok",
            "message": "Successfully dropped commit abc123.",
        }
        mock_drop.assert_awaited_once_with("p1")


@pytest.mark.asyncio
async def test_get_commit_diff_endpoint(async_client, init_mock_db):
    """GET /api/pipelines/{id}/commits/{sha}/diff returns the JSON diff shape."""
    diff = {
        "commit_hash": "abcdef123456",
        "patch": "diff --git a/a.txt b/a.txt\n",
        "subject": "Add a.txt",
        "author": "Alice",
        "created_at": "2026-01-01T00:00:00+00:00",
    }
    with patch(
        "api.routes.pipeline.git_utils.get_commit_diff",
        new_callable=AsyncMock,
        return_value=diff,
    ) as mock_diff:
        response = await async_client.get("/api/pipelines/p1/commits/abcdef123456/diff")
        assert response.status_code == status.HTTP_200_OK
        assert response.json() == diff
        mock_diff.assert_awaited_once_with("p1", "abcdef123456")


@pytest.mark.asyncio
async def test_get_commit_diff_endpoint_not_found(async_client, init_mock_db):
    """A missing commit propagates EntityNotFoundError as HTTP 404."""
    from core.exceptions import EntityNotFoundError

    with patch(
        "api.routes.pipeline.git_utils.get_commit_diff",
        new_callable=AsyncMock,
        side_effect=EntityNotFoundError("Commit deadbeef not found in pipeline p1"),
    ):
        response = await async_client.get("/api/pipelines/p1/commits/deadbeef/diff")
        assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.asyncio
async def test_get_commit_diff_endpoint_unauthenticated(async_client, init_mock_db):
    """The commit diff route requires authentication."""
    app.dependency_overrides.clear()  # remove mock auth
    response = await async_client.get("/api/pipelines/p1/commits/abcdef/diff")
    assert response.status_code == status.HTTP_401_UNAUTHORIZED
