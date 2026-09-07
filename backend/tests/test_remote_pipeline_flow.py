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

"""Integration tests for the remote-pipeline flow (repo_uri)."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from core import config
from core.models.models import Pipeline
from core.utils import git_utils


@pytest.fixture
async def remote_pipeline(tmp_path, monkeypatch, init_mock_db):
    """A remote pipeline whose clone root is a temp dir."""
    monkeypatch.setattr(config, "REMOTE_WORKSPACES_ROOT", tmp_path)
    return Pipeline(name="my-app", repo_uri="https://host/org/my-app.git")


@pytest.mark.asyncio
async def test_remote_pipeline_workspace_abs_path(remote_pipeline):
    assert (
        remote_pipeline.workspace_abs_path == config.REMOTE_WORKSPACES_ROOT / "my-app"
    )


@pytest.mark.asyncio
async def test_ensure_repo_cloned_clones_when_missing(remote_pipeline):
    with patch("core.utils.git_utils.git.Repo.clone_from") as mock_clone:
        await git_utils.ensure_repo_cloned(remote_pipeline)
        mock_clone.assert_called_once_with(
            "https://host/org/my-app.git", str(remote_pipeline.workspace_abs_path)
        )


@pytest.mark.asyncio
async def test_ensure_repo_cloned_syncs_when_present(remote_pipeline):
    target = remote_pipeline.workspace_abs_path
    target.mkdir(parents=True)
    with patch("core.utils.git_utils.git.Repo") as mock_repo_cls:
        mock_repo = MagicMock()
        mock_repo_cls.return_value = mock_repo
        await git_utils.ensure_repo_cloned(remote_pipeline)
        mock_repo.remotes.origin.fetch.assert_called_once()
        mock_repo.git.pull.assert_called_once_with("--ff-only")


@pytest.mark.asyncio
async def test_get_repo_for_pipeline_remote_returns_cloned_repo(remote_pipeline):
    with (
        patch(
            "core.utils.git_utils.pipeline_queries.get_pipeline_by_id",
            new_callable=AsyncMock,
        ) as mock_get,
        patch(
            "core.utils.git_utils.ensure_repo_cloned", new_callable=AsyncMock
        ) as mock_ensure,
        patch("core.utils.git_utils.git.Repo") as mock_repo_cls,
    ):
        mock_get.return_value = remote_pipeline
        mock_repo = MagicMock()
        mock_repo_cls.return_value = mock_repo

        repo = await git_utils.get_repo_for_pipeline("p1")

        assert repo == mock_repo
        mock_ensure.assert_awaited_with(remote_pipeline)
        mock_repo_cls.assert_called_once_with(str(remote_pipeline.workspace_abs_path))


@pytest.mark.asyncio
async def test_tool_execution_on_remote_repo(remote_pipeline):
    # A git tool operates on the repo at the cloned path.
    mock_repo = MagicMock()
    mock_repo.git.status.return_value = "M  file1.txt\n?? file2.txt"
    summary = git_utils.get_git_status_summary(mock_repo)
    assert summary["staged"] == 1
    assert summary["untracked"] == 1


@pytest.mark.asyncio
async def test_push_with_auth_on_remote_pipeline(remote_pipeline):
    remote_pipeline.repo_username = "user"
    remote_pipeline.repo_token = "tok"
    mock_repo = MagicMock()
    mock_repo.remotes.origin.url = "https://host/org/my-app.git"
    git_utils.push_with_auth(mock_repo, remote_pipeline)
    # Pushes to the remote name, not a tokenized URL.
    mock_repo.git.push.assert_called_once_with("origin", "HEAD")
    mock_repo.remotes.origin.set_url.assert_any_call(
        "https://user:tok@host/org/my-app.git"
    )
    mock_repo.remotes.origin.set_url.assert_any_call("https://host/org/my-app.git")
