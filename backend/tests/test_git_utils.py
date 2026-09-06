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

import git
import pytest

from core.exceptions import EntityNotFoundError
from core.utils import git_utils


@pytest.mark.asyncio
async def test_get_repo_for_pipeline_success():
    pipeline_id = "p1"
    mock_pipeline = MagicMock()
    mock_pipeline.workspace_abs_path = "/tmp/repo"

    with patch(
        "core.utils.git_utils.pipeline_queries.get_pipeline_by_id",
        new_callable=AsyncMock,
    ) as mock_get:
        mock_get.return_value = mock_pipeline
        with patch("core.utils.git_utils.git.Repo") as mock_repo_cls:
            mock_repo = MagicMock()
            mock_repo_cls.return_value = mock_repo

            repo = await git_utils.get_repo_for_pipeline(pipeline_id)

            assert repo == mock_repo
            mock_repo_cls.assert_called_once_with("/tmp/repo")


@pytest.mark.asyncio
async def test_get_repo_for_pipeline_no_path():
    pipeline_id = "p1"
    mock_pipeline = MagicMock()
    mock_pipeline.workspace_abs_path = None

    with patch(
        "core.utils.git_utils.pipeline_queries.get_pipeline_by_id",
        new_callable=AsyncMock,
    ) as mock_get:
        mock_get.return_value = mock_pipeline
        with pytest.raises(EntityNotFoundError, match="Workspace path not found"):
            await git_utils.get_repo_for_pipeline(pipeline_id)


@pytest.mark.asyncio
async def test_get_repo_for_pipeline_by_task_success():
    task_id = "t1"
    mock_task = MagicMock()
    mock_task.pipeline_id = "p1"
    mock_pipeline = MagicMock()
    mock_pipeline.workspace_abs_path = "/tmp/repo"

    with (
        patch(
            "core.utils.git_utils.task_queries.get_task_by_id", new_callable=AsyncMock
        ) as mock_get_task,
        patch(
            "core.utils.git_utils.pipeline_queries.get_pipeline_by_id",
            new_callable=AsyncMock,
        ) as mock_get_pipe,
        patch("core.utils.git_utils.git.Repo") as mock_repo_cls,
    ):
        mock_get_task.return_value = mock_task
        mock_get_pipe.return_value = mock_pipeline
        mock_repo = MagicMock()
        mock_repo_cls.return_value = mock_repo

        repo = await git_utils.get_repo_for_pipeline_by_task(task_id)

        assert repo == mock_repo
        mock_get_task.assert_awaited_once_with(task_id)
        mock_get_pipe.assert_awaited_once_with("p1")


def test_validate_commit_hash():
    mock_repo = MagicMock()
    commit_hash = "abc1234"

    # Success case
    git_utils.validate_commit_hash(mock_repo, commit_hash)
    mock_repo.git.show.assert_called_once_with(commit_hash, "--no-patch")

    # Failure case
    mock_repo.git.show.side_effect = git.exc.GitCommandError("git show", 128)
    assert git_utils.validate_commit_hash(mock_repo, "badhash") is False


def test_get_git_status_summary():
    mock_repo = MagicMock()
    mock_repo.git.status.return_value = (
        "M  file1.txt\n M file2.txt\n?? file3.txt\nAM file4.txt"
    )

    summary = git_utils.get_git_status_summary(mock_repo)

    # file1: M  -> staged:1, unstaged:0
    # file2:  M -> staged:0, unstaged:1
    # file3: ?? -> untracked:1
    # file4: AM -> staged:1, unstaged:1
    assert summary["staged"] == 2
    assert summary["unstaged"] == 2
    assert summary["untracked"] == 1


def test_ensure_git_identity_returns_empty_when_configured():
    mock_repo = MagicMock()
    mock_reader = MagicMock()
    mock_reader.get_value.side_effect = lambda section, option, default=None: {
        ("user", "name"): "Jane Doe",
        ("user", "email"): "jane@example.com",
    }.get((section, option), default)
    mock_repo.config_reader.return_value = mock_reader

    env = git_utils.ensure_git_identity(mock_repo)

    assert env == {}


def test_ensure_git_identity_fills_missing_fields():
    mock_repo = MagicMock()
    mock_reader = MagicMock()
    mock_reader.get_value.return_value = None
    mock_repo.config_reader.return_value = mock_reader

    with (
        patch("core.utils.git_utils.config.GIT_USER_NAME", "Bot"),
        patch("core.utils.git_utils.config.GIT_USER_EMAIL", "bot@localhost"),
    ):
        env = git_utils.ensure_git_identity(mock_repo)

    assert env == {
        "GIT_AUTHOR_NAME": "Bot",
        "GIT_COMMITTER_NAME": "Bot",
        "GIT_AUTHOR_EMAIL": "bot@localhost",
        "GIT_COMMITTER_EMAIL": "bot@localhost",
    }


def test_ensure_git_identity_respects_existing_identity():
    mock_repo = MagicMock()
    mock_reader = MagicMock()
    mock_reader.get_value.side_effect = lambda section, option, default=None: {
        ("user", "name"): "Jane Doe",
        ("user", "email"): None,
    }.get((section, option), default)
    mock_repo.config_reader.return_value = mock_reader

    with patch("core.utils.git_utils.config.GIT_USER_EMAIL", "bot@localhost"):
        env = git_utils.ensure_git_identity(mock_repo)

    # Existing name is respected; only the missing email is filled in.
    assert env == {
        "GIT_AUTHOR_EMAIL": "bot@localhost",
        "GIT_COMMITTER_EMAIL": "bot@localhost",
    }
