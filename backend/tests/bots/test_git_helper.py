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

from pathlib import Path
from unittest.mock import MagicMock, patch

import git

from api.bot.git_helper import SandboxGitHelper


def test_get_default_branch_from_env(monkeypatch):
    monkeypatch.setenv("DEFAULT_GIT_BRANCH", "custom-main")
    helper = SandboxGitHelper("coderbot", "task_id", Path("/fake/path"))
    assert helper.get_default_branch() == "custom-main"


def test_get_default_branch_from_source_repo(monkeypatch):
    monkeypatch.delenv("DEFAULT_GIT_BRANCH", raising=False)
    helper = SandboxGitHelper("coderbot", "task_id", Path("/fake/path"))

    with patch("api.bot.git_helper.git.Repo") as mock_repo_cls:
        mock_repo = MagicMock()
        mock_repo.active_branch.name = "source-main"
        mock_repo_cls.return_value = mock_repo

        assert helper.get_default_branch() == "source-main"
        mock_repo_cls.assert_called_once_with("/fake/path")


def test_get_default_branch_from_origin_head(monkeypatch):
    monkeypatch.delenv("DEFAULT_GIT_BRANCH", raising=False)
    helper = SandboxGitHelper("coderbot", "task_id", Path("/fake/path"))

    with (
        patch("api.bot.git_helper.git.Repo") as mock_repo_cls,
        patch.object(SandboxGitHelper, "get_repo") as mock_get_repo,
    ):
        # Make source repo fail
        mock_repo_cls.side_effect = Exception("No source repo")

        mock_sandbox_repo = MagicMock()
        origin_head = MagicMock()
        origin_head.reference.name = "origin/origin-main"
        mock_sandbox_repo.remotes.origin.refs.HEAD = origin_head

        mock_get_repo.return_value = mock_sandbox_repo

        assert helper.get_default_branch() == "origin-main"


def test_get_default_branch_fallback_common_names(monkeypatch):
    monkeypatch.delenv("DEFAULT_GIT_BRANCH", raising=False)
    helper = SandboxGitHelper("coderbot", "task_id", Path("/fake/path"))

    with (
        patch("api.bot.git_helper.git.Repo") as mock_repo_cls,
        patch.object(SandboxGitHelper, "get_repo") as mock_get_repo,
    ):
        mock_repo_cls.side_effect = Exception("No source repo")

        mock_sandbox_repo = MagicMock()
        # Remove HEAD to trigger the next fallback
        del mock_sandbox_repo.remotes.origin.refs.HEAD

        # Mock refs
        ref1 = MagicMock()
        ref1.name = "origin/feature"
        ref2 = MagicMock()
        ref2.name = "origin/develop"
        mock_sandbox_repo.remotes.origin.refs = [ref1, ref2]

        mock_get_repo.return_value = mock_sandbox_repo

        assert helper.get_default_branch() == "develop"


def test_get_default_branch_ultimate_fallback(monkeypatch):
    monkeypatch.delenv("DEFAULT_GIT_BRANCH", raising=False)
    helper = SandboxGitHelper("coderbot", "task_id", Path("/fake/path"))

    with (
        patch("api.bot.git_helper.git.Repo") as mock_repo_cls,
        patch.object(SandboxGitHelper, "get_repo") as mock_get_repo,
    ):
        mock_repo_cls.side_effect = Exception("No source repo")

        mock_sandbox_repo = MagicMock()
        del mock_sandbox_repo.remotes.origin.refs.HEAD
        mock_sandbox_repo.remotes.origin.refs = []

        mock_get_repo.return_value = mock_sandbox_repo

        assert helper.get_default_branch() == "main"


def test_get_patch_uses_default_branch_when_base_ref_exists(monkeypatch):
    """When the default branch ref exists, the patch is diffed against it."""
    monkeypatch.delenv("DEFAULT_GIT_BRANCH", raising=False)
    helper = SandboxGitHelper("coderbot", "task_id", Path("/fake/path"))

    repo = MagicMock()
    repo.commit.return_value = "base-commit"
    repo.git.diff.return_value = "default-branch-patch"

    with patch.object(SandboxGitHelper, "get_repo") as mock_get_repo:
        mock_get_repo.return_value = repo
        with patch.object(SandboxGitHelper, "get_default_branch", return_value="main"):
            patch_str = helper.get_patch()

    assert patch_str == "default-branch-patch"
    repo.git.diff.assert_called_once_with("main", binary=True)


def test_get_patch_falls_back_to_empty_tree_when_base_ref_unborn(monkeypatch):
    """
    When the repo has no commits yet (an unborn default branch), diffing is
    done against Git's empty tree so all new files are captured instead of
    failing with 'unknown revision'.
    """
    monkeypatch.delenv("DEFAULT_GIT_BRANCH", raising=False)
    helper = SandboxGitHelper("coderbot", "task_id", Path("/fake/path"))

    repo = MagicMock()
    # Simulate an unresolved/invalid ref -> the default branch is unborn.
    repo.commit.side_effect = git.BadName("main")
    repo.git.diff.return_value = "empty-tree-patch"

    with patch.object(SandboxGitHelper, "get_repo") as mock_get_repo:
        mock_get_repo.return_value = repo
        with patch.object(SandboxGitHelper, "get_default_branch", return_value="main"):
            patch_str = helper.get_patch()

    assert patch_str == "empty-tree-patch"
    repo.git.diff.assert_called_once_with(SandboxGitHelper._EMPTY_TREE, binary=True)
