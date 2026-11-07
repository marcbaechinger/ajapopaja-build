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

from api.bot.git_helper import SandboxBase, SandboxGitHelper
from core.utils import git_utils


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


def test_branch_name_can_be_overridden():
    """Callers can supply a unique branch while the default stays unchanged."""
    default_helper = SandboxGitHelper("docbot", "task_id", Path("/fake/path"))
    custom_helper = SandboxGitHelper(
        "docbot", "task_id", Path("/fake/path"), branch_name="docbot/task_id/abc123"
    )

    assert default_helper.branch_name == "docbot/task_id"
    assert custom_helper.branch_name == "docbot/task_id/abc123"


def test_setup_sandbox_without_base_checks_out_new_branch(tmp_path):
    """Without a base the sandbox branches off the cloned default branch."""
    helper = SandboxGitHelper(
        "coderbot", "task_id", Path("/fake/path"), workspace_path=tmp_path / "sandbox"
    )
    repo = MagicMock()

    with patch("api.bot.git_helper.git.Repo.clone_from", return_value=repo):
        result = helper.setup_sandbox()

    assert result is repo
    repo.git.fetch.assert_not_called()
    repo.git.checkout.assert_called_once_with("-b", "coderbot/task_id")


def test_setup_sandbox_with_base_fetches_and_checks_out_fetch_head(tmp_path):
    """With a base the predecessor's commit is fetched and used as the branch
    point (never `clone -b`)."""
    base = SandboxBase(
        repo_path="/predecessor/workspace",
        ref="refs/heads/coderbot/t1",
        commit="abc123",
    )
    helper = SandboxGitHelper(
        "coderbot",
        "t2",
        Path("/fake/path"),
        workspace_path=tmp_path / "sandbox",
        base=base,
    )
    repo = MagicMock()

    with patch("api.bot.git_helper.git.Repo.clone_from", return_value=repo):
        result = helper.setup_sandbox()

    assert result is repo
    repo.git.fetch.assert_called_once_with(
        "/predecessor/workspace", "refs/heads/coderbot/t1"
    )
    repo.git.checkout.assert_called_once_with("-b", "coderbot/t2", "FETCH_HEAD")


def test_get_patch_diffs_against_chained_base_commit(monkeypatch):
    """A chained sandbox diffs against the predecessor's commit, not the
    default branch."""
    monkeypatch.delenv("DEFAULT_GIT_BRANCH", raising=False)
    base = SandboxBase(
        repo_path="/predecessor/workspace",
        ref="refs/heads/coderbot/t1",
        commit="chained-base-commit",
    )
    helper = SandboxGitHelper("coderbot", "t2", Path("/fake/path"), base=base)

    repo = MagicMock()
    repo.commit.return_value = "base-commit"
    repo.git.diff.return_value = "chained-patch"

    with patch.object(SandboxGitHelper, "get_repo", return_value=repo):
        with patch.object(
            SandboxGitHelper, "get_default_branch", return_value="main"
        ) as mock_default:
            patch_str = helper.get_patch()

    assert patch_str == "chained-patch"
    repo.git.diff.assert_called_once_with("chained-base-commit", binary=True)
    mock_default.assert_not_called()


def test_setup_sandbox_chains_predecessor_commit(tmp_path):
    """End-to-end (real repos): a new sandbox is branched at the
    predecessor's commit and its patch is the task's own delta, which applies
    cleanly on top of that commit."""
    import os
    import tempfile

    source = tmp_path / "source"
    source.mkdir()
    source_repo = git.Repo.init(str(source))
    (source / "shared.txt").write_text("base\n", encoding="utf-8")
    source_repo.git.add(A=True)
    source_repo.git.commit(
        "-m",
        "main",
        "--no-verify",
        env=git_utils.ensure_git_identity(source_repo),
    )
    main_commit = source_repo.head.commit.hexsha

    # Predecessor sandbox: a clone with one commit on coderbot/t1.
    predecessor = tmp_path / "predecessor"
    pred_repo = git.Repo.clone_from(str(source), str(predecessor))
    pred_repo.git.checkout("-b", "coderbot/t1")
    (predecessor / "shared.txt").write_text("base\ntask1\n", encoding="utf-8")
    pred_repo.git.add(A=True)
    pred_repo.git.commit(
        "-m",
        "task1",
        "--no-verify",
        env=git_utils.ensure_git_identity(pred_repo),
    )
    c1 = pred_repo.head.commit.hexsha
    assert c1 != main_commit

    sandbox = tmp_path / "sandbox"
    base = SandboxBase(
        repo_path=str(predecessor),
        ref="refs/heads/coderbot/t1",
        commit=c1,
    )
    helper = SandboxGitHelper(
        "coderbot", "t2", source, workspace_path=sandbox, base=base
    )
    helper.setup_sandbox()

    repo = helper.get_repo()
    assert repo.active_branch.name == "coderbot/t2"
    # The chained task starts exactly at the predecessor's commit, which sits on
    # top of the source main commit (transitive chain).
    assert repo.head.commit.hexsha == c1
    assert repo.commit("HEAD~1").hexsha == main_commit

    # Task 2 edits the same file and commits.
    (sandbox / "shared.txt").write_text("base\ntask1\ntask2\n", encoding="utf-8")
    repo.git.add(A=True)
    repo.git.commit(
        "-m", "task2", "--no-verify", env=git_utils.ensure_git_identity(repo)
    )

    # The generated patch only carries task 2's own delta (not task 1's).
    patch_str = helper.get_patch()
    assert "+task2" in patch_str
    assert "+task1" not in patch_str

    # ... and applies cleanly on a checkout of the predecessor's commit, which
    # is what acceptance produces after PR1 lands.
    acceptor = tmp_path / "acceptor"
    acc_repo = git.Repo.clone_from(str(predecessor), str(acceptor))
    acc_repo.git.checkout(c1)
    patch_file = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".patch", delete=False) as fh:
            fh.write(patch_str if patch_str.endswith("\n") else patch_str + "\n")
            patch_file = fh.name
        acc_repo.git.apply("--3way", patch_file)
    finally:
        if patch_file and os.path.exists(patch_file):
            os.remove(patch_file)
    assert (acceptor / "shared.txt").read_text(encoding="utf-8") == (
        "base\ntask1\ntask2\n"
    )
