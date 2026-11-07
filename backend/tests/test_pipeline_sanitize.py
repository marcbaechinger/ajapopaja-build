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

"""Sanitization of pipeline creation (repo_uri reachability / workspace_path)."""

import subprocess
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api.auth import get_current_user
from api.main import app
from core import config
from core.exceptions import ValidationError
from core.models.models import Pipeline
from core.queries import pipeline as pipeline_queries
from core.utils import git_utils


@pytest.fixture(autouse=True)
def mock_auth():
    mock_user = MagicMock()
    mock_user.username = "testuser"
    app.dependency_overrides[get_current_user] = lambda: mock_user
    yield
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# verify_remote_repo (sync helper)
# ---------------------------------------------------------------------------


def _mock_subprocess_run(monkeypatch, *, returncode=0, stderr="", exc=None):
    def fake_run(cmd, **kwargs):
        if exc is not None:
            raise exc(cmd, returncode, "", stderr or "")
        result = MagicMock()
        result.returncode = returncode
        result.stderr = stderr
        return result

    monkeypatch.setattr(git_utils.subprocess, "run", fake_run)


def test_verify_remote_repo_success(monkeypatch):
    _mock_subprocess_run(monkeypatch)
    # No exception expected for a reachable/authenticated repo.
    git_utils.verify_remote_repo("https://host/org/my-app.git", "user", "tok")


def test_verify_remote_repo_injects_credentials(monkeypatch):
    calls = {}

    def fake_run(cmd, **kwargs):
        calls["cmd"] = cmd
        return MagicMock()

    monkeypatch.setattr(subprocess, "run", fake_run)
    git_utils.verify_remote_repo("https://host/org/repo.git", "user", "tok")
    assert calls["cmd"][:3] == ["git", "ls-remote", "--heads"]
    assert calls["cmd"][3] == "https://user:tok@host/org/repo.git"


def test_verify_remote_repo_failure_message_includes_uri(monkeypatch):
    _mock_subprocess_run(
        monkeypatch,
        returncode=128,
        stderr=(
            "fatal: could not read Username for 'https://host': "
            "terminal prompts disabled"
        ),
        exc=subprocess.CalledProcessError,
    )
    with pytest.raises(ValidationError) as excinfo:
        git_utils.verify_remote_repo("https://host/org/my-app.git", "user", "tok")
    message = str(excinfo.value)
    assert "https://host/org/my-app.git" in message
    assert "could not read Username" in message


def test_verify_remote_repo_timeout(monkeypatch):
    def fake_run(cmd, **kwargs):
        raise subprocess.TimeoutExpired(cmd, timeout=kwargs.get("timeout"))

    monkeypatch.setattr(git_utils.subprocess, "run", fake_run)
    with pytest.raises(ValidationError) as excinfo:
        git_utils.verify_remote_repo("https://slow.example/org/repo.git")
    assert "https://slow.example/org/repo.git" in str(excinfo.value)
    assert "Timed out" in str(excinfo.value)


# ---------------------------------------------------------------------------
# validate_pipeline_repository (query-level)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_validate_remote_valid(init_mock_db):
    pipeline = Pipeline(name="Remote", repo_uri="https://host/org/my-app.git")
    with (
        patch.object(git_utils, "verify_remote_repo", return_value=None) as mock_verify,
        patch.object(
            git_utils, "_resolve_credentials", return_value=("u", "t")
        ) as mock_creds,
    ):
        await pipeline_queries.validate_pipeline_repository(pipeline)
    mock_creds.assert_called_once_with(pipeline)
    mock_verify.assert_called_once_with("https://host/org/my-app.git", "u", "t")


@pytest.mark.asyncio
async def test_validate_remote_invalid_raises(init_mock_db):
    pipeline = Pipeline(name="Remote", repo_uri="https://host/org/my-app.git")
    with (
        patch.object(
            git_utils,
            "verify_remote_repo",
            side_effect=ValidationError("Could not reach the repository"),
        ),
        patch.object(git_utils, "_resolve_credentials", return_value=("u", "t")),
    ):
        with pytest.raises(ValidationError):
            await pipeline_queries.validate_pipeline_repository(pipeline)


@pytest.mark.asyncio
async def test_validate_local_valid(tmp_path, monkeypatch, init_mock_db):
    monkeypatch.setattr(config, "WORKSPACES_ROOT", tmp_path)
    (tmp_path / "proj").mkdir()
    pipeline = Pipeline(name="Local", workspace_path="proj")
    await pipeline_queries.validate_pipeline_repository(pipeline)  # no raise


@pytest.mark.asyncio
async def test_validate_local_missing_path_raises(tmp_path, monkeypatch, init_mock_db):
    monkeypatch.setattr(config, "WORKSPACES_ROOT", tmp_path)
    pipeline = Pipeline(name="Local", workspace_path="does-not-exist")
    with pytest.raises(ValidationError) as excinfo:
        await pipeline_queries.validate_pipeline_repository(pipeline)
    assert "does-not-exist" in str(excinfo.value)


@pytest.mark.asyncio
async def test_validate_local_no_path_allowed(init_mock_db):
    pipeline = Pipeline(name="Local")
    await pipeline_queries.validate_pipeline_repository(pipeline)  # no raise


# ---------------------------------------------------------------------------
# create_pipeline integration: bad repo must never persist
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_create_pipeline_remote_unreachable_not_persisted(init_mock_db):
    pipeline = Pipeline(name="Remote", repo_uri="https://host/org/my-app.git")
    with patch.object(
        git_utils,
        "verify_remote_repo",
        side_effect=ValidationError("Could not reach the repository"),
    ):
        with pytest.raises(ValidationError):
            await pipeline_queries.create_pipeline(pipeline)
    assert await pipeline_queries.get_all_pipelines() == []


@pytest.mark.asyncio
async def test_create_pipeline_local_missing_workspace_not_persisted(
    tmp_path, monkeypatch, init_mock_db
):
    monkeypatch.setattr(config, "WORKSPACES_ROOT", tmp_path)
    pipeline = Pipeline(name="Local", workspace_path="does-not-exist")
    with pytest.raises(ValidationError):
        await pipeline_queries.create_pipeline(pipeline)
    assert await pipeline_queries.get_all_pipelines() == []


@pytest.mark.asyncio
async def test_create_pipeline_local_valid_persisted(
    tmp_path, monkeypatch, init_mock_db
):
    monkeypatch.setattr(config, "WORKSPACES_ROOT", tmp_path)
    (tmp_path / "proj").mkdir()
    pipeline = Pipeline(name="Local", workspace_path="proj")
    created = await pipeline_queries.create_pipeline(pipeline)
    assert created.version == 1
    assert len(await pipeline_queries.get_all_pipelines()) == 1


@pytest.mark.asyncio
async def test_create_pipeline_remote_clones_repo(init_mock_db):
    pipeline = Pipeline(name="Remote", repo_uri="https://host/org/my-app.git")
    with (
        patch.object(git_utils, "verify_remote_repo", return_value=None),
        patch.object(git_utils, "_resolve_credentials", return_value=("u", "t")),
        patch.object(
            git_utils, "ensure_repo_cloned", new_callable=AsyncMock
        ) as mock_clone,
    ):
        created = await pipeline_queries.create_pipeline(pipeline)
    mock_clone.assert_awaited_once_with(pipeline)
    assert created.version == 1
    assert len(await pipeline_queries.get_all_pipelines()) == 1


@pytest.mark.asyncio
async def test_create_pipeline_remote_clone_failure_still_persists(init_mock_db):
    pipeline = Pipeline(name="Remote", repo_uri="https://host/org/my-app.git")
    with (
        patch.object(git_utils, "verify_remote_repo", return_value=None),
        patch.object(git_utils, "_resolve_credentials", return_value=("u", "t")),
        patch.object(
            git_utils,
            "ensure_repo_cloned",
            new_callable=AsyncMock,
            side_effect=RuntimeError("clone boom"),
        ),
    ):
        created = await pipeline_queries.create_pipeline(pipeline)
    # A clone failure is logged but the pipeline is still persisted (best-effort).
    assert created.version == 1
    assert len(await pipeline_queries.get_all_pipelines()) == 1


# ---------------------------------------------------------------------------
# Route-level (HTTP) sanitization
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_route_create_remote_unreachable_422(async_client, init_mock_db):
    with patch(
        "core.utils.git_utils.verify_remote_repo",
        side_effect=ValidationError(
            "Could not reach the repository 'https://host/org/bad.git'"
        ),
    ):
        response = await async_client.post(
            "/api/pipelines/",
            json={"name": "Bad", "repo_uri": "https://host/org/bad.git"},
        )
        assert response.status_code == 422
        assert "Could not reach" in response.json()["detail"]
    # Nothing was persisted: the later GET returns an empty list.
    resp = await async_client.get("/api/pipelines/")
    assert resp.json() == []


@pytest.mark.asyncio
async def test_route_create_remote_insert_not_called(async_client, init_mock_db):
    with (
        patch(
            "core.utils.git_utils.verify_remote_repo",
            side_effect=ValidationError("boom"),
        ),
        patch.object(Pipeline, "insert", new_callable=AsyncMock) as mock_insert,
    ):
        response = await async_client.post(
            "/api/pipelines/",
            json={"name": "Bad", "repo_uri": "https://host/org/bad.git"},
        )
        assert response.status_code == 422
        mock_insert.assert_not_called()


@pytest.mark.asyncio
async def test_route_create_local_missing_path_422(async_client, init_mock_db):
    response = await async_client.post(
        "/api/pipelines/",
        json={"name": "Local", "workspace_path": "definitely-missing"},
    )
    assert response.status_code == 422
    assert "does not resolve to an existing directory" in response.json()["detail"]
    resp = await async_client.get("/api/pipelines/")
    assert resp.json() == []


@pytest.mark.asyncio
async def test_route_create_remote_reachable_ok(async_client, init_mock_db):
    with (
        patch("core.utils.git_utils.verify_remote_repo", return_value=None),
        patch(
            "core.utils.git_utils.ensure_repo_cloned", new_callable=AsyncMock
        ),
    ):
        response = await async_client.post(
            "/api/pipelines/",
            json={"name": "Remote", "repo_uri": "https://host/org/good.git"},
        )
        assert response.status_code == 200
        assert response.json()["repo_uri"] == "https://host/org/good.git"
    # The pipeline was persisted.
    resp = await async_client.get("/api/pipelines/")
    assert len(resp.json()) == 1
