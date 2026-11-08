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

"""MCP build-artifact tool tests, including a token-authenticated REST download."""

import hashlib

import pytest

from ajapopaja_mcp.tools import get_build_artifact
from api.auth import ARTIFACT_TOKEN_TTL_SECONDS, decode_artifact_token
from api.main import app
from core import config
from core.models.models import Pipeline

VALID_PIPELINE_ID = "0123456789abcdef01234567"


@pytest.fixture(autouse=True)
def setup_mcp_artifact_env(monkeypatch, init_mock_db):
    monkeypatch.setenv("DATABASE_NAME", init_mock_db)
    yield


# ---------------------------------------------------------------------------
# Tool-level metadata + token
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_build_artifact_rejects_invalid_pipeline_id():
    result = await get_build_artifact("not-an-object-id")
    assert "error" in result
    assert "Invalid pipeline_id" in result["error"]


@pytest.mark.asyncio
async def test_get_build_artifact_reports_unknown_pipeline():
    result = await get_build_artifact(VALID_PIPELINE_ID)
    assert "error" in result
    assert "not found" in result["error"].lower()


@pytest.mark.asyncio
async def test_get_build_artifact_returns_metadata_and_usable_token(
    async_client, tmp_path, monkeypatch
):
    monkeypatch.setattr(config, "WORKSPACES_ROOT", tmp_path)
    workspace = tmp_path / "ws"
    artifact = workspace / "dist" / "app.apk"
    artifact.parent.mkdir(parents=True)
    payload = b"mcp-artifact-bytes\x00\x01" * 2048
    artifact.write_bytes(payload)

    pipeline = Pipeline(
        name="MCP Artifact",
        workspace_path="ws",
        build_commands=[["make", "build"]],
        build_artifact={
            "path": "dist/app.apk",
            "label": "Debug APK",
            "media_type": "application/vnd.android.package-archive",
        },
    )
    await pipeline.insert()
    pipeline_id = str(pipeline.id)

    result = await get_build_artifact(pipeline_id)

    assert result["pipeline_id"] == pipeline_id
    assert result["configured"] is True
    assert result["path"] == "dist/app.apk"
    assert result["label"] == "Debug APK"
    assert result["exists"] is True
    assert result["size"] == len(payload)
    assert result["sha256"] == hashlib.sha256(payload).hexdigest()
    assert result["modified_at"] is not None
    assert result["version"] is None
    assert result["build_commands_configured"] is True
    assert result["download_url"] == (f"/api/pipelines/{pipeline_id}/artifact/download")
    assert result["expires_in"] == ARTIFACT_TOKEN_TTL_SECONDS

    claims = decode_artifact_token(result["download_token"])
    assert claims.pipeline_id == pipeline_id
    assert claims.path == "dist/app.apk"

    # The signed token alone authorises the byte transfer; no user JWT/login
    # override is involved.
    app.dependency_overrides.clear()
    response = await async_client.get(
        result["download_url"], params={"token": result["download_token"]}
    )
    assert response.status_code == 200
    assert response.content == payload
    assert response.headers["content-type"].startswith(
        "application/vnd.android.package-archive"
    )


@pytest.mark.asyncio
async def test_get_build_artifact_without_declaration_has_no_token(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(config, "WORKSPACES_ROOT", tmp_path)
    (tmp_path / "ws").mkdir()
    pipeline = Pipeline(
        name="No MCP Artifact",
        workspace_path="ws",
        build_commands=[["make"]],
    )
    await pipeline.insert()

    result = await get_build_artifact(str(pipeline.id))

    assert result["configured"] is False
    assert result["path"] is None
    assert result["exists"] is False
    assert result["download_url"] is None
    assert result["download_token"] is None
    assert result["expires_in"] is None
    assert result["build_commands_configured"] is True


@pytest.mark.asyncio
async def test_get_build_artifact_returns_token_even_when_file_is_missing(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(config, "WORKSPACES_ROOT", tmp_path)
    workspace = tmp_path / "ws"
    (workspace / "dist").mkdir(parents=True)
    pipeline = Pipeline(
        name="Not Built",
        workspace_path="ws",
        build_artifact={"path": "dist/app.bin"},
    )
    await pipeline.insert()

    result = await get_build_artifact(str(pipeline.id))

    assert result["configured"] is True
    assert result["exists"] is False
    assert result["sha256"] is None
    assert result["download_token"]
    claims = decode_artifact_token(result["download_token"])
    assert claims.path == "dist/app.bin"
