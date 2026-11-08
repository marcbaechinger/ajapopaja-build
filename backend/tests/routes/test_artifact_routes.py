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

"""End-to-end tests for the pipeline build-artifact REST surface.

The tests exercise the real router, auth helpers and core service against a
real temporary workspace (and, for provenance, a real git repository). Only the
current-user lookup is overridden for the JWT-protected endpoints.
"""

import hashlib
import os
import subprocess
from unittest.mock import MagicMock

import pytest
from fastapi import status
from jose import JWTError

import api.auth as auth_module
from api.auth import (
    ARTIFACT_TOKEN_TTL_SECONDS,
    create_access_token,
    create_artifact_token,
    create_raw_file_token,
    decode_artifact_token,
    decode_raw_file_token,
    decode_token,
    get_current_user,
    get_current_user_from_token,
)
from api.main import app
from core import config
from core.models.models import Pipeline

RUN_GIT_ENV = {
    "GIT_AUTHOR_NAME": "Test User",
    "GIT_AUTHOR_EMAIL": "test@example.com",
    "GIT_COMMITTER_NAME": "Test User",
    "GIT_COMMITTER_EMAIL": "test@example.com",
}


def _git(cwd, args):
    return subprocess.run(
        ["git"] + args,
        cwd=cwd,
        check=True,
        capture_output=True,
        text=True,
        env={**os.environ, **RUN_GIT_ENV},
    )


@pytest.fixture(autouse=True)
def mock_auth():
    mock_user = MagicMock()
    mock_user.username = "testuser"
    app.dependency_overrides[get_current_user] = lambda: mock_user
    yield
    app.dependency_overrides.clear()


async def _insert_pipeline(
    *,
    workspace_path="ws",
    artifact_path="dist/app.bin",
    media_type=None,
    build_commands=None,
):
    pipeline = Pipeline(
        name="Artifact Pipeline",
        workspace_path=workspace_path,
        build_commands=build_commands,
        build_artifact=(
            {"path": artifact_path, "label": "App binary", "media_type": media_type}
            if artifact_path is not None
            else None
        ),
    )
    await pipeline.insert()
    return pipeline


def _make_workspace(tmp_path):
    workspace = tmp_path / "ws"
    (workspace / "dist").mkdir(parents=True)
    return workspace


# ---------------------------------------------------------------------------
# GET /artifact metadata
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_metadata_reports_exact_fingerprint(
    async_client, init_mock_db, tmp_path, monkeypatch
):
    monkeypatch.setattr(config, "WORKSPACES_ROOT", tmp_path)
    workspace = _make_workspace(tmp_path)
    payload = b"\x00\x01metadata-artifact\xff" * 4096
    artifact = workspace / "dist" / "app.bin"
    artifact.write_bytes(payload)
    pipeline = await _insert_pipeline(build_commands=[["make", "build"]])

    response = await async_client.get(f"/api/pipelines/{pipeline.id}/artifact")

    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    assert data["pipeline_id"] == str(pipeline.id)
    assert data["configured"] is True
    assert data["path"] == "dist/app.bin"
    assert data["label"] == "App binary"
    assert data["exists"] is True
    assert data["size"] == len(payload)
    assert data["sha256"] == hashlib.sha256(payload).hexdigest()
    assert data["modified_at"] is not None
    assert data["version"] is None  # non-git workspace
    assert data["build_commands_configured"] is True
    assert data["media_type"] == "application/octet-stream"


@pytest.mark.asyncio
async def test_metadata_include_hash_false_omits_sha256(
    async_client, init_mock_db, tmp_path, monkeypatch
):
    monkeypatch.setattr(config, "WORKSPACES_ROOT", tmp_path)
    workspace = _make_workspace(tmp_path)
    (workspace / "dist" / "app.bin").write_bytes(b"cheap-poll")
    pipeline = await _insert_pipeline()

    response = await async_client.get(
        f"/api/pipelines/{pipeline.id}/artifact", params={"include_hash": "false"}
    )

    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    assert data["exists"] is True
    assert data["size"] == len(b"cheap-poll")
    assert data["modified_at"] is not None
    assert data["sha256"] is None


@pytest.mark.asyncio
async def test_metadata_for_git_workspace_reports_head(
    async_client, init_mock_db, tmp_path, monkeypatch
):
    monkeypatch.setattr(config, "WORKSPACES_ROOT", tmp_path)
    repo = tmp_path / "ws"
    repo.mkdir()
    _git(repo, ["init", "-b", "main"])
    (repo / "README.md").write_text("# Repo\n")
    _git(repo, ["add", "README.md"])
    _git(repo, ["commit", "-m", "Initial commit"])
    head = _git(repo, ["rev-parse", "HEAD"]).stdout.strip()
    artifact = repo / "dist" / "app.bin"
    artifact.parent.mkdir()
    artifact.write_bytes(b"git-artifact")
    pipeline = await _insert_pipeline()

    response = await async_client.get(f"/api/pipelines/{pipeline.id}/artifact")

    assert response.status_code == status.HTTP_200_OK
    assert response.json()["version"] == head


@pytest.mark.asyncio
async def test_metadata_for_missing_file_reports_not_built(
    async_client, init_mock_db, tmp_path, monkeypatch
):
    monkeypatch.setattr(config, "WORKSPACES_ROOT", tmp_path)
    _make_workspace(tmp_path)
    pipeline = await _insert_pipeline()

    response = await async_client.get(f"/api/pipelines/{pipeline.id}/artifact")

    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    assert data["configured"] is True
    assert data["path"] == "dist/app.bin"
    assert data["exists"] is False
    assert data["size"] is None
    assert data["modified_at"] is None
    assert data["sha256"] is None


@pytest.mark.asyncio
async def test_metadata_without_declaration_is_unconfigured(
    async_client, init_mock_db, tmp_path, monkeypatch
):
    monkeypatch.setattr(config, "WORKSPACES_ROOT", tmp_path)
    (tmp_path / "ws").mkdir()
    pipeline = await _insert_pipeline(artifact_path=None, build_commands=[["make"]])

    response = await async_client.get(f"/api/pipelines/{pipeline.id}/artifact")

    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    assert data["configured"] is False
    assert data["path"] is None
    assert data["exists"] is False
    assert data["size"] is None
    assert data["sha256"] is None
    assert data["build_commands_configured"] is True


@pytest.mark.asyncio
async def test_metadata_requires_jwt(async_client, init_mock_db):
    app.dependency_overrides.clear()
    response = await async_client.get("/api/pipelines/missing/artifact")
    assert response.status_code == status.HTTP_401_UNAUTHORIZED


# ---------------------------------------------------------------------------
# POST /artifact/token
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_mint_token_is_pipeline_path_bound_and_short_lived(
    async_client, init_mock_db, tmp_path, monkeypatch
):
    monkeypatch.setattr(config, "WORKSPACES_ROOT", tmp_path)
    workspace = _make_workspace(tmp_path)
    (workspace / "dist" / "app.bin").write_bytes(b"token-me")
    pipeline = await _insert_pipeline()

    response = await async_client.post(f"/api/pipelines/{pipeline.id}/artifact/token")

    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    assert data["expires_in"] == ARTIFACT_TOKEN_TTL_SECONDS
    claims = decode_artifact_token(data["token"])
    assert claims.pipeline_id == str(pipeline.id)
    assert claims.path == "dist/app.bin"
    assert claims.jti
    assert claims.exp is not None


@pytest.mark.asyncio
async def test_mint_token_rejects_missing_artifact_or_file(
    async_client, init_mock_db, tmp_path, monkeypatch
):
    monkeypatch.setattr(config, "WORKSPACES_ROOT", tmp_path)
    _make_workspace(tmp_path)

    no_artifact = await _insert_pipeline(artifact_path=None)
    response = await async_client.post(
        f"/api/pipelines/{no_artifact.id}/artifact/token"
    )
    assert response.status_code == status.HTTP_404_NOT_FOUND

    missing_file = await _insert_pipeline()
    response = await async_client.post(
        f"/api/pipelines/{missing_file.id}/artifact/token"
    )
    assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.asyncio
async def test_mint_token_requires_jwt(async_client, init_mock_db):
    app.dependency_overrides.clear()
    response = await async_client.post("/api/pipelines/missing/artifact/token")
    assert response.status_code == status.HTTP_401_UNAUTHORIZED


# ---------------------------------------------------------------------------
# GET /artifact/download
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_download_streams_exact_bytes_with_safe_headers(
    async_client, init_mock_db, tmp_path, monkeypatch
):
    monkeypatch.setattr(config, "WORKSPACES_ROOT", tmp_path)
    workspace = _make_workspace(tmp_path)
    # Larger than the text-preview limit proves the binary is not truncated.
    payload = b"\x00\x01\x02" * (600 * 1024) + b"tail"
    (workspace / "dist" / "app.bin").write_bytes(payload)
    pipeline = await _insert_pipeline(media_type="application/x-test-artifact")
    token = create_artifact_token(str(pipeline.id), "dist/app.bin")

    app.dependency_overrides.clear()  # the token alone authenticates the download
    response = await async_client.get(
        f"/api/pipelines/{pipeline.id}/artifact/download",
        params={"token": token},
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.content == payload
    assert (
        hashlib.sha256(response.content).hexdigest()
        == hashlib.sha256(payload).hexdigest()
    )
    assert response.headers["content-type"].startswith("application/x-test-artifact")
    disposition = response.headers["content-disposition"]
    assert disposition.startswith("attachment;")
    assert "filename*=UTF-8''app.bin" in disposition
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["content-security-policy"] == "sandbox"
    assert response.headers["cache-control"] == "private, no-store"


@pytest.mark.asyncio
async def test_download_uses_inferred_media_type_and_basename(
    async_client, init_mock_db, tmp_path, monkeypatch
):
    monkeypatch.setattr(config, "WORKSPACES_ROOT", tmp_path)
    workspace = _make_workspace(tmp_path)
    (workspace / "dist" / "app.apk").write_bytes(b"apk-bytes")
    pipeline = await _insert_pipeline(artifact_path="dist/app.apk")
    token = create_artifact_token(str(pipeline.id), "dist/app.apk")

    app.dependency_overrides.clear()
    response = await async_client.get(
        f"/api/pipelines/{pipeline.id}/artifact/download",
        params={"token": token},
    )

    assert response.status_code == status.HTTP_200_OK
    assert response.content == b"apk-bytes"
    assert response.headers["content-type"].startswith(
        "application/vnd.android.package-archive"
    )
    assert "filename*=UTF-8''app.apk" in response.headers["content-disposition"]
    assert str(workspace) not in response.headers["content-disposition"]


@pytest.mark.asyncio
@pytest.mark.parametrize("token", [None, "not-a-jwt"])
async def test_download_rejects_missing_or_garbage_token(async_client, token):
    app.dependency_overrides.clear()
    params = {} if token is None else {"token": token}
    response = await async_client.get(
        "/api/pipelines/p1/artifact/download", params=params
    )
    assert response.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.asyncio
async def test_download_rejects_tampered_token(async_client):
    token = create_artifact_token("p1", "dist/app.bin")

    app.dependency_overrides.clear()
    response = await async_client.get(
        "/api/pipelines/p1/artifact/download",
        params={"token": token + "tampered"},
    )
    assert response.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.asyncio
async def test_download_rejects_expired_token(async_client, monkeypatch):
    monkeypatch.setattr(auth_module, "ARTIFACT_TOKEN_TTL_SECONDS", -1)
    token = create_artifact_token("p1", "dist/app.bin")

    app.dependency_overrides.clear()
    response = await async_client.get(
        "/api/pipelines/p1/artifact/download", params={"token": token}
    )
    assert response.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.asyncio
async def test_download_rejects_foreign_pipeline(async_client):
    token = create_artifact_token("p1", "dist/app.bin")

    app.dependency_overrides.clear()
    response = await async_client.get(
        "/api/pipelines/p2/artifact/download", params={"token": token}
    )
    assert response.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.asyncio
async def test_download_rejects_token_bound_to_another_path(
    async_client, init_mock_db, tmp_path, monkeypatch
):
    monkeypatch.setattr(config, "WORKSPACES_ROOT", tmp_path)
    workspace = _make_workspace(tmp_path)
    (workspace / "dist" / "app.bin").write_bytes(b"public artifact")
    (workspace / "secret.txt").write_bytes(b"do not leak")
    pipeline = await _insert_pipeline()
    # A caller cannot mint a token for an arbitrary workspace file: the
    # endpoint compares the signed path with the configured artifact path.
    token = create_artifact_token(str(pipeline.id), "secret.txt")

    app.dependency_overrides.clear()
    response = await async_client.get(
        f"/api/pipelines/{pipeline.id}/artifact/download",
        params={"token": token},
    )

    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert b"do not leak" not in response.content


@pytest.mark.asyncio
async def test_download_rejects_symlink_escape(
    async_client, init_mock_db, tmp_path, monkeypatch
):
    monkeypatch.setattr(config, "WORKSPACES_ROOT", tmp_path)
    workspace = _make_workspace(tmp_path)
    outside = tmp_path / "outside.txt"
    outside.write_bytes(b"secret outside the workspace")
    (workspace / "escape.bin").symlink_to(outside)
    pipeline = await _insert_pipeline(artifact_path="escape.bin")
    token = create_artifact_token(str(pipeline.id), "escape.bin")

    app.dependency_overrides.clear()
    response = await async_client.get(
        f"/api/pipelines/{pipeline.id}/artifact/download",
        params={"token": token},
    )

    assert response.status_code == status.HTTP_403_FORBIDDEN
    assert b"secret outside" not in response.content


@pytest.mark.asyncio
async def test_download_rejects_directory_artifact(
    async_client, init_mock_db, tmp_path, monkeypatch
):
    monkeypatch.setattr(config, "WORKSPACES_ROOT", tmp_path)
    _make_workspace(tmp_path)
    pipeline = await _insert_pipeline(artifact_path="dist")
    token = create_artifact_token(str(pipeline.id), "dist")

    app.dependency_overrides.clear()
    response = await async_client.get(
        f"/api/pipelines/{pipeline.id}/artifact/download",
        params={"token": token},
    )
    assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.asyncio
async def test_download_without_declaration_returns_404(
    async_client, init_mock_db, tmp_path, monkeypatch
):
    monkeypatch.setattr(config, "WORKSPACES_ROOT", tmp_path)
    (tmp_path / "ws").mkdir()
    pipeline = await _insert_pipeline(artifact_path=None)
    token = create_artifact_token(str(pipeline.id), "anything.bin")

    app.dependency_overrides.clear()
    response = await async_client.get(
        f"/api/pipelines/{pipeline.id}/artifact/download",
        params={"token": token},
    )
    assert response.status_code == status.HTTP_404_NOT_FOUND


# ---------------------------------------------------------------------------
# Token separation: artifact tokens vs general JWT / raw-file tokens
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_artifact_token_is_rejected_by_general_jwt_endpoints(
    async_client, init_mock_db
):
    token = create_artifact_token("p1", "dist/app.bin")
    app.dependency_overrides.clear()

    response = await async_client.get(
        "/api/auth/me", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == status.HTTP_401_UNAUTHORIZED
    assert await get_current_user_from_token(token) is None
    with pytest.raises(JWTError):
        decode_token(token)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "make_token",
    [
        lambda: create_access_token({"sub": "testuser"}),
        lambda: create_raw_file_token("testuser", "p1", "dist/app.bin"),
    ],
)
async def test_general_and_raw_tokens_are_rejected_by_artifact_download(
    async_client, make_token
):
    token = make_token()
    app.dependency_overrides.clear()

    response = await async_client.get(
        "/api/pipelines/p1/artifact/download", params={"token": token}
    )
    assert response.status_code == status.HTTP_401_UNAUTHORIZED


def test_artifact_token_is_rejected_as_raw_file_token():
    token = create_artifact_token("p1", "dist/app.bin")
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as excinfo:
        decode_raw_file_token(token)
    assert excinfo.value.status_code == status.HTTP_401_UNAUTHORIZED
