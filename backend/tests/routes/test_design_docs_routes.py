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
from core.exceptions import EntityNotFoundError, ValidationError
from core.models.models import DesignDocContent, DesignDocInfo, Pipeline


@pytest.fixture(autouse=True)
def mock_auth():
    mock_user = MagicMock()
    mock_user.username = "testuser"
    app.dependency_overrides[get_current_user] = lambda: mock_user
    yield
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_list_design_docs(async_client, init_mock_db):
    pipeline = Pipeline(name="Project")
    documents = [
        DesignDocInfo(
            path="dd_architecture.md",
            title="Architecture",
            size=12,
            snippet="…architecture…",
        )
    ]
    with (
        patch(
            "api.routes.design_docs.pipeline_queries.get_pipeline_by_id",
            new_callable=AsyncMock,
            return_value=pipeline,
        ),
        patch(
            "api.routes.design_docs.design_docs_utils.list_design_docs",
            return_value=(documents, 1),
        ) as mock_list,
    ):
        response = await async_client.get("/api/pipelines/p1/design-docs?q=arch")

    assert response.status_code == status.HTTP_200_OK
    body = response.json()
    assert body["total"] == 1
    assert body["query"] == "arch"
    assert body["documents"][0]["path"] == "dd_architecture.md"
    assert body["documents"][0]["title"] == "Architecture"
    # The pipeline and the search query are forwarded to the helper.
    args, _ = mock_list.call_args
    assert args[0] is pipeline
    assert args[1] == "arch"


@pytest.mark.asyncio
async def test_list_design_docs_without_query(async_client, init_mock_db):
    pipeline = Pipeline(name="Project")
    with (
        patch(
            "api.routes.design_docs.pipeline_queries.get_pipeline_by_id",
            new_callable=AsyncMock,
            return_value=pipeline,
        ),
        patch(
            "api.routes.design_docs.design_docs_utils.list_design_docs",
            return_value=([], 0),
        ),
    ):
        response = await async_client.get("/api/pipelines/p1/design-docs")

    assert response.status_code == status.HTTP_200_OK
    body = response.json()
    assert body["documents"] == []
    assert body["total"] == 0
    assert body["query"] is None


@pytest.mark.asyncio
async def test_get_design_doc_content(async_client, init_mock_db):
    pipeline = Pipeline(name="Project")
    content = DesignDocContent(
        path="dd_architecture.md",
        title="Architecture",
        content="# Architecture\n\nDetails.",
        size=20,
    )
    with (
        patch(
            "api.routes.design_docs.pipeline_queries.get_pipeline_by_id",
            new_callable=AsyncMock,
            return_value=pipeline,
        ),
        patch(
            "api.routes.design_docs.design_docs_utils.read_design_doc",
            return_value=content,
        ) as mock_read,
    ):
        response = await async_client.get(
            "/api/pipelines/p1/design-docs/content?path=dd_architecture.md"
        )

    assert response.status_code == status.HTTP_200_OK
    body = response.json()
    assert body["path"] == "dd_architecture.md"
    assert body["title"] == "Architecture"
    assert "Details." in body["content"]
    mock_read.assert_called_once_with(pipeline, "dd_architecture.md")


@pytest.mark.asyncio
async def test_get_design_doc_content_requires_path(async_client, init_mock_db):
    response = await async_client.get("/api/pipelines/p1/design-docs/content")
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT


@pytest.mark.asyncio
async def test_get_design_doc_content_not_found(async_client, init_mock_db):
    pipeline = Pipeline(name="Project")
    with (
        patch(
            "api.routes.design_docs.pipeline_queries.get_pipeline_by_id",
            new_callable=AsyncMock,
            return_value=pipeline,
        ),
        patch(
            "api.routes.design_docs.design_docs_utils.read_design_doc",
            side_effect=EntityNotFoundError("missing"),
        ),
    ):
        response = await async_client.get(
            "/api/pipelines/p1/design-docs/content?path=missing.md"
        )

    assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.asyncio
async def test_get_design_doc_content_invalid_path(async_client, init_mock_db):
    pipeline = Pipeline(name="Project")
    with (
        patch(
            "api.routes.design_docs.pipeline_queries.get_pipeline_by_id",
            new_callable=AsyncMock,
            return_value=pipeline,
        ),
        patch(
            "api.routes.design_docs.design_docs_utils.read_design_doc",
            side_effect=ValidationError("bad path"),
        ),
    ):
        response = await async_client.get(
            "/api/pipelines/p1/design-docs/content?path=../secret.md"
        )

    assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT


@pytest.mark.asyncio
async def test_design_docs_end_to_end(
    async_client, init_mock_db, monkeypatch, tmp_path
):
    """The routes work end-to-end against a real doc_root on disk."""
    from core import config

    monkeypatch.setattr(config, "WORKSPACES_ROOT", tmp_path)
    pipeline = Pipeline(name="Project", workspace_path="proj", doc_root="design")
    await pipeline.insert()

    doc_dir = tmp_path / "proj" / "design"
    doc_dir.mkdir(parents=True)
    (doc_dir / "dd_arch.md").write_text(
        "# Architecture\n\nThe widget scheduler lives here.", encoding="utf-8"
    )

    list_response = await async_client.get(f"/api/pipelines/{pipeline.id}/design-docs")
    assert list_response.status_code == status.HTTP_200_OK
    listing = list_response.json()
    assert listing["total"] == 1
    assert listing["documents"][0]["path"] == "dd_arch.md"
    assert listing["documents"][0]["title"] == "Architecture"

    content_response = await async_client.get(
        f"/api/pipelines/{pipeline.id}/design-docs/content?path=dd_arch.md"
    )
    assert content_response.status_code == status.HTTP_200_OK
    assert content_response.json()["content"].startswith("# Architecture")

    search_response = await async_client.get(
        f"/api/pipelines/{pipeline.id}/design-docs", params={"q": "widget"}
    )
    assert search_response.status_code == status.HTTP_200_OK
    found = search_response.json()
    assert found["total"] == 1
    assert found["documents"][0]["snippet"] is not None

    traversal_response = await async_client.get(
        f"/api/pipelines/{pipeline.id}/design-docs/content",
        params={"path": "../secret.md"},
    )
    assert traversal_response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT


@pytest.mark.asyncio
async def test_design_docs_unauthenticated(async_client, init_mock_db):
    app.dependency_overrides.clear()

    list_response = await async_client.get("/api/pipelines/p1/design-docs")
    content_response = await async_client.get(
        "/api/pipelines/p1/design-docs/content?path=a.md"
    )

    assert list_response.status_code == status.HTTP_401_UNAUTHORIZED
    assert content_response.status_code == status.HTTP_401_UNAUTHORIZED
