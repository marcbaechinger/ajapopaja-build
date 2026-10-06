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

import os
import subprocess
from unittest.mock import AsyncMock, MagicMock, patch

import git
import pytest

from core.exceptions import EntityNotFoundError
from core.models.models import RepoBootstrapStatus
from core.utils import git_utils

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


def _make_origin(tmp_path):
    """Create a non-empty bare remote repo and return its path."""
    origin = tmp_path / "origin.git"
    seed = tmp_path / "seed"
    seed.mkdir()
    _git(seed, ["init", "-b", "main"])
    (seed / "readme.md").write_text("readme\n")
    _git(seed, ["add", "."])
    _git(seed, ["commit", "-m", "Initial commit"])
    _git(tmp_path, ["clone", "--bare", str(seed), str(origin)])
    return origin


@pytest.mark.asyncio
async def test_get_repo_for_pipeline_success():
    pipeline_id = "p1"
    mock_pipeline = MagicMock()
    mock_pipeline.workspace_abs_path = "/tmp/repo"
    mock_pipeline.repo_uri = None

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
    mock_pipeline.repo_uri = None

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


@pytest.mark.asyncio
async def test_ensure_repo_cloned_noop_for_local():
    pipeline = MagicMock()
    pipeline.repo_uri = None
    await git_utils.ensure_repo_cloned(pipeline)  # should not raise


@pytest.mark.asyncio
async def test_ensure_repo_cloned_clones_when_missing(tmp_path):
    pipeline = MagicMock()
    pipeline.repo_uri = "https://host/org/my-app.git"
    pipeline.workspace_abs_path = tmp_path / "my-app"

    with patch("core.utils.git_utils.git.Repo.clone_from") as mock_clone:
        await git_utils.ensure_repo_cloned(pipeline)
        mock_clone.assert_called_once_with(
            "https://host/org/my-app.git", str(tmp_path / "my-app")
        )


@pytest.mark.asyncio
async def test_ensure_repo_cloned_syncs_when_present(tmp_path):
    pipeline = MagicMock()
    pipeline.repo_uri = "https://host/org/my-app.git"
    target = tmp_path / "my-app"
    target.mkdir(parents=True)
    pipeline.workspace_abs_path = target

    with patch("core.utils.git_utils.git.Repo") as mock_repo_cls:
        mock_repo = MagicMock()
        mock_repo_cls.return_value = mock_repo
        await git_utils.ensure_repo_cloned(pipeline)
        mock_repo.remotes.origin.fetch.assert_called_once()
        mock_repo.git.pull.assert_called_once_with("--ff-only")


def test_ensure_repo_present_local_returns_none():
    pipeline = MagicMock()
    pipeline.repo_uri = None
    with patch("core.utils.git_utils.git") as mock_git:
        assert git_utils.ensure_repo_present(pipeline) is None
        mock_git.Repo.clone_from.assert_not_called()


def test_ensure_repo_present_clones_when_missing(tmp_path):
    pipeline = MagicMock()
    pipeline.repo_uri = "https://host/org/my-app.git"
    pipeline.workspace_abs_path = tmp_path / "my-app"

    with patch("core.utils.git_utils.git") as mock_git:
        status = git_utils.ensure_repo_present(pipeline)

        assert status is RepoBootstrapStatus.CLONED
        mock_git.Repo.clone_from.assert_called_once_with(
            "https://host/org/my-app.git", str(tmp_path / "my-app")
        )


def test_ensure_repo_present_available_when_present(tmp_path):
    pipeline = MagicMock()
    pipeline.repo_uri = "https://host/org/my-app.git"
    target = tmp_path / "my-app"
    target.mkdir(parents=True)
    pipeline.workspace_abs_path = target

    with patch("core.utils.git_utils.git") as mock_git:
        status = git_utils.ensure_repo_present(pipeline)

        assert status is RepoBootstrapStatus.AVAILABLE
        # An existing checkout is a strictly read-only no-op.
        mock_git.Repo.clone_from.assert_not_called()
        mock_git.Repo.assert_not_called()


def test_ensure_repo_present_none_without_workspace():
    pipeline = MagicMock()
    pipeline.repo_uri = "https://host/org/my-app.git"
    pipeline.workspace_abs_path = None

    with patch("core.utils.git_utils.git") as mock_git:
        assert git_utils.ensure_repo_present(pipeline) is None
        mock_git.Repo.clone_from.assert_not_called()


@pytest.mark.asyncio
async def test_get_repo_for_pipeline_remote_calls_ensure_cloned():
    pipeline_id = "p1"
    mock_pipeline = MagicMock()
    mock_pipeline.workspace_abs_path = "/tmp/repo"
    mock_pipeline.repo_uri = "https://host/org/my-app.git"

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
        mock_get.return_value = mock_pipeline
        mock_repo = MagicMock()
        mock_repo_cls.return_value = mock_repo

        repo = await git_utils.get_repo_for_pipeline(pipeline_id)

        assert repo == mock_repo
        mock_ensure.assert_awaited_with(mock_pipeline)


def test_inject_credentials():
    assert (
        git_utils._inject_credentials("https://github.com/org/repo.git", "user", "tok")
        == "https://user:tok@github.com/org/repo.git"
    )
    # Empty username defaults to x-access-token (GitHub convention).
    assert (
        git_utils._inject_credentials("https://github.com/org/repo.git", "", "tok")
        == "https://x-access-token:tok@github.com/org/repo.git"
    )


def test_inject_credentials_replaces_existing_auth():
    # Pre-existing credentials are replaced, not double-injected.
    assert (
        git_utils._inject_credentials(
            "https://olduser:oldpass@github.com/org/repo.git", "user", "tok"
        )
        == "https://user:tok@github.com/org/repo.git"
    )


def test_inject_credentials_preserves_port_and_path():
    assert (
        git_utils._inject_credentials(
            "https://host:8443/org/repo.git?x=1#frag", "user", "tok"
        )
        == "https://user:tok@host:8443/org/repo.git?x=1#frag"
    )


def test_inject_credentials_scp_ssh_unchanged():
    assert (
        git_utils._inject_credentials("git@github.com:org/repo.git", "user", "tok")
        == "git@github.com:org/repo.git"
    )


def test_resolve_credentials_pipeline_overrides_global():
    pipeline = MagicMock()
    pipeline.repo_username = "pipeuser"
    pipeline.repo_token = "pipetok"
    with (
        patch("core.utils.git_utils.config.GIT_PUSH_USERNAME", "globaluser"),
        patch("core.utils.git_utils.config.GIT_PUSH_TOKEN", "globaltok"),
    ):
        assert git_utils._resolve_credentials(pipeline) == ("pipeuser", "pipetok")


def test_resolve_credentials_falls_back_to_global():
    pipeline = MagicMock()
    pipeline.repo_username = None
    pipeline.repo_token = None
    with (
        patch("core.utils.git_utils.config.GIT_PUSH_USERNAME", "globaluser"),
        patch("core.utils.git_utils.config.GIT_PUSH_TOKEN", "globaltok"),
    ):
        assert git_utils._resolve_credentials(pipeline) == ("globaluser", "globaltok")


def test_push_with_auth_noop_for_local():
    repo = MagicMock()
    pipeline = MagicMock()
    pipeline.repo_uri = None
    git_utils.push_with_auth(repo, pipeline)
    repo.git.push.assert_not_called()


def test_push_with_auth_with_token():
    repo = MagicMock()
    repo.remotes.origin.url = "https://github.com/org/repo.git"
    pipeline = MagicMock()
    pipeline.repo_uri = "https://github.com/org/repo.git"
    pipeline.repo_username = "user"
    pipeline.repo_token = "tok"
    git_utils.push_with_auth(repo, pipeline)
    # Pushes to the remote name using http.extraHeader for auth.
    repo.git.push.assert_called_once_with("origin", "HEAD")
    # Uses GIT_CONFIG_PARAMETERS for auth, not set_url.
    repo.git.custom_environment.assert_called_once()


def test_push_with_auth_without_token():
    repo = MagicMock()
    pipeline = MagicMock()
    pipeline.repo_uri = "https://github.com/org/repo.git"
    pipeline.repo_username = None
    pipeline.repo_token = None
    with patch("core.utils.git_utils.config.GIT_PUSH_TOKEN", ""):
        git_utils.push_with_auth(repo, pipeline)
        repo.git.push.assert_called_once_with("origin", "HEAD")


def test_push_branch_with_auth_with_token():
    repo = MagicMock()
    pipeline = MagicMock()
    pipeline.repo_uri = "https://github.com/org/repo.git"
    pipeline.repo_username = "user"
    pipeline.repo_token = "tok"
    git_utils.push_branch_with_auth(repo, pipeline, "feature/x")
    repo.git.push.assert_called_once_with(
        "origin", "refs/heads/feature/x:refs/heads/feature/x"
    )
    repo.git.custom_environment.assert_called_once()


def test_push_branch_with_auth_without_token():
    repo = MagicMock()
    pipeline = MagicMock()
    pipeline.repo_uri = "https://github.com/org/repo.git"
    pipeline.repo_username = None
    pipeline.repo_token = None
    with patch("core.utils.git_utils.config.GIT_PUSH_TOKEN", ""):
        git_utils.push_branch_with_auth(repo, pipeline, "feature/x")
        repo.git.push.assert_called_once_with(
            "origin", "refs/heads/feature/x:refs/heads/feature/x"
        )


def test_push_branch_with_auth_noop_for_local():
    repo = MagicMock()
    pipeline = MagicMock()
    pipeline.repo_uri = None
    git_utils.push_branch_with_auth(repo, pipeline, "feature/x")
    repo.git.push.assert_not_called()


def test_ensure_feature_branch_creates_when_missing():
    repo = MagicMock()
    repo.branches = [MagicMock(name="main")]
    git_utils.ensure_feature_branch(repo, "feature/x")
    repo.git.checkout.assert_called_once_with("-b", "feature/x")


def test_ensure_feature_branch_checks_out_when_exists():
    repo = MagicMock()
    existing = MagicMock()
    existing.name = "feature/x"
    repo.branches = [existing]
    git_utils.ensure_feature_branch(repo, "feature/x")
    repo.git.checkout.assert_called_once_with("feature/x")


def test_create_branch_at_head_creates_without_checkout():
    repo = MagicMock()
    repo.branches = [MagicMock(name="main")]
    git_utils.create_branch_at_head(repo, "pi/abc1234")
    repo.create_head.assert_called_once_with("pi/abc1234", "HEAD")
    repo.git.checkout.assert_not_called()


def test_create_branch_at_head_existing_is_noop():
    repo = MagicMock()
    existing = MagicMock()
    existing.name = "pi/abc1234"
    repo.branches = [existing]
    git_utils.create_branch_at_head(repo, "pi/abc1234")
    repo.create_head.assert_not_called()
    repo.git.checkout.assert_not_called()


def test_current_default_branch_from_head():
    repo = MagicMock()
    repo.git.symbolic_ref.return_value = "refs/remotes/origin/main"
    assert git_utils.current_default_branch(repo) == "main"


def test_current_default_branch_fallback():
    repo = MagicMock()
    repo.git.symbolic_ref.side_effect = git.exc.GitCommandError("symbolic_ref", 1)
    repo.git.rev_parse.side_effect = [git.exc.GitCommandError("rev-parse", 1), "ok"]
    assert git_utils.current_default_branch(repo) == "master"


def test_resolve_gitea_repo_https():
    assert git_utils.resolve_gitea_repo("https://host/org/my-app.git") == (
        "https://host",
        "org",
        "my-app",
    )


def test_resolve_gitea_repo_http():
    assert git_utils.resolve_gitea_repo("http://host:3000/org/repo") == (
        "http://host:3000",
        "org",
        "repo",
    )


def test_resolve_gitea_repo_scp():
    assert git_utils.resolve_gitea_repo("git@host:owner/my-app.git") == (
        "https://host",
        "owner",
        "my-app",
    )


def test_resolve_gitea_repo_invalid():
    with pytest.raises(ValueError):
        git_utils.resolve_gitea_repo("https://host/repo.git")


def _pipeline_with_repo_uri():
    pipeline = MagicMock()
    pipeline.repo_uri = "https://host/org/repo.git"
    return pipeline


def _patch_pipeline_and_repo(repo):
    return patch(
        "core.utils.git_utils.get_pipeline_and_repo",
        new_callable=AsyncMock,
        return_value=(_pipeline_with_repo_uri(), repo),
    )


@pytest.mark.asyncio
async def test_drop_top_commit_success(tmp_path):
    origin = _make_origin(tmp_path)
    ws = tmp_path / "workspace"
    _git(tmp_path, ["clone", str(origin), str(ws)])

    (ws / "file.txt").write_text("extra change\n")
    _git(ws, ["add", "."])
    _git(ws, ["commit", "-m", "Local extra commit"])
    head_before = _git(ws, ["rev-parse", "HEAD"]).stdout.strip()
    count_before = int(_git(ws, ["rev-list", "--count", "HEAD"]).stdout.strip())

    with _patch_pipeline_and_repo(git.Repo(str(ws))):
        msg = await git_utils.drop_top_commit("p1")

    assert "Successfully dropped" in msg
    head_after = _git(ws, ["rev-parse", "HEAD"]).stdout.strip()
    count_after = int(_git(ws, ["rev-list", "--count", "HEAD"]).stdout.strip())
    assert head_after != head_before
    assert count_after == count_before - 1


@pytest.mark.asyncio
async def test_drop_top_commit_remote_commit(tmp_path):
    origin = _make_origin(tmp_path)
    ws = tmp_path / "workspace"
    _git(tmp_path, ["clone", str(origin), str(ws)])

    (ws / "file.txt").write_text("extra change\n")
    _git(ws, ["add", "."])
    _git(ws, ["commit", "-m", "Local extra commit"])
    _git(ws, ["push", "origin", "HEAD"])

    with _patch_pipeline_and_repo(git.Repo(str(ws))):
        msg = await git_utils.drop_top_commit("p1")

    assert "already exists on the remote" in msg


@pytest.mark.asyncio
async def test_drop_top_commit_only_one_commit(tmp_path):
    origin = _make_origin(tmp_path)
    ws = tmp_path / "workspace"
    ws.mkdir()
    _git(ws, ["init", "-b", "main"])
    (ws / "only.txt").write_text("only\n")
    _git(ws, ["add", "."])
    _git(ws, ["commit", "-m", "single root commit"])
    _git(ws, ["remote", "add", "origin", str(origin)])
    _git(ws, ["fetch", "origin"])

    with _patch_pipeline_and_repo(git.Repo(str(ws))):
        msg = await git_utils.drop_top_commit("p1")

    assert "only a single commit" in msg


@pytest.mark.asyncio
async def test_drop_top_commit_no_remote():
    pipeline = MagicMock()
    pipeline.repo_uri = None
    repo = MagicMock()
    with patch(
        "core.utils.git_utils.get_pipeline_and_repo",
        new_callable=AsyncMock,
        return_value=(pipeline, repo),
    ):
        msg = await git_utils.drop_top_commit("p1")

    assert "no remote repo_uri" in msg
    repo.remotes.origin.fetch.assert_not_called()


@pytest.mark.asyncio
async def test_pull_success(tmp_path):
    origin = _make_origin(tmp_path)
    ws = tmp_path / "workspace"
    _git(tmp_path, ["clone", str(origin), str(ws)])

    # Push an update to the origin from a second clone.
    other = tmp_path / "other"
    _git(tmp_path, ["clone", str(origin), str(other)])
    (other / "readme.md").write_text("updated\n")
    _git(other, ["add", "."])
    _git(other, ["commit", "-m", "Update readme"])
    _git(other, ["push", "origin", "HEAD"])

    with _patch_pipeline_and_repo(git.Repo(str(ws))):
        msg = await git_utils.pull("p1")

    assert "Error" not in msg
    assert (ws / "readme.md").read_text() == "updated\n"


@pytest.mark.asyncio
async def test_pull_reports_exception():
    repo = MagicMock()
    repo.git.pull.side_effect = RuntimeError("pull exploded")
    with _patch_pipeline_and_repo(repo):
        msg = await git_utils.pull("p1")

    assert "pull exploded" in msg


@pytest.mark.asyncio
async def test_get_commit_diff_success(tmp_path):
    origin = _make_origin(tmp_path)
    ws = tmp_path / "workspace"
    _git(tmp_path, ["clone", str(origin), str(ws)])

    (ws / "file.txt").write_text("extra change\n")
    _git(ws, ["add", "."])
    _git(ws, ["commit", "-m", "Add file"])

    repo = git.Repo(str(ws))
    head = repo.head.commit.hexsha

    with _patch_pipeline_and_repo(repo):
        result = await git_utils.get_commit_diff("p1", head)

    assert result["commit_hash"] == head
    assert result["subject"] == "Add file"
    assert result["message"].startswith("Add file")
    assert result["author"] == "Test User"
    assert result["created_at"]
    assert "file.txt" in result["patch"]
    assert "+extra change" in result["patch"]
    # Commit metadata must be stripped, leaving only the patch.
    assert "Add file" not in result["patch"]


@pytest.mark.asyncio
async def test_get_commit_diff_root_commit(tmp_path):
    origin = _make_origin(tmp_path)
    ws = tmp_path / "workspace"
    _git(tmp_path, ["clone", str(origin), str(ws)])

    repo = git.Repo(str(ws))
    # The initial commit of the origin has no parent; the diff must still work.
    root = repo.head.commit.hexsha

    with _patch_pipeline_and_repo(repo):
        result = await git_utils.get_commit_diff("p1", root)

    assert result["commit_hash"] == root
    assert result["subject"] == "Initial commit"
    assert "readme.md" in result["patch"]


@pytest.mark.asyncio
async def test_get_commit_diff_unknown_hash(tmp_path):
    origin = _make_origin(tmp_path)
    ws = tmp_path / "workspace"
    _git(tmp_path, ["clone", str(origin), str(ws)])

    repo = git.Repo(str(ws))

    with _patch_pipeline_and_repo(repo):
        with pytest.raises(EntityNotFoundError, match="not found in pipeline"):
            await git_utils.get_commit_diff("p1", "deadbeef")


def test_get_git_status_details_in_sync_with_changes(tmp_path):
    origin = _make_origin(tmp_path)
    ws = tmp_path / "workspace"
    _git(tmp_path, ["clone", str(origin), str(ws)])
    repo = git.Repo(str(ws))

    # staged change
    (ws / "staged.txt").write_text("staged\n")
    _git(ws, ["add", "staged.txt"])
    # unstaged change
    (ws / "readme.md").write_text("readme changed\n")
    # untracked change
    (ws / "untracked.txt").write_text("untracked\n")

    details = git_utils.get_git_status_details(repo)

    assert details["staged"] == 1
    assert details["unstaged"] == 1
    assert details["untracked"] == 1
    assert details["has_origin"] is True
    assert details["branch"] == "main"
    assert details["in_sync"] is True
    assert details["ahead"] == 0
    assert details["behind"] == 0


def test_get_git_status_details_ahead_of_origin(tmp_path):
    origin = _make_origin(tmp_path)
    ws = tmp_path / "workspace"
    _git(tmp_path, ["clone", str(origin), str(ws)])
    (ws / "local.txt").write_text("local\n")
    _git(ws, ["add", "."])
    _git(ws, ["commit", "-m", "Local commit"])
    repo = git.Repo(str(ws))

    details = git_utils.get_git_status_details(repo)

    assert details["has_origin"] is True
    assert details["in_sync"] is False
    assert details["ahead"] == 1
    assert details["behind"] == 0


def test_get_git_status_details_without_origin(tmp_path):
    ws = tmp_path / "local"
    ws.mkdir()
    _git(ws, ["init", "-b", "main"])
    (ws / "a.txt").write_text("a\n")
    _git(ws, ["add", "."])
    _git(ws, ["commit", "-m", "Initial commit"])
    repo = git.Repo(str(ws))

    details = git_utils.get_git_status_details(repo)

    assert details["has_origin"] is False
    assert details["in_sync"] is None
    assert details["staged"] == 0
    assert details["unstaged"] == 0
    assert details["untracked"] == 0


def test_get_git_log_returns_compact_entries(tmp_path):
    origin = _make_origin(tmp_path)
    ws = tmp_path / "workspace"
    _git(tmp_path, ["clone", str(origin), str(ws)])
    (ws / "next.txt").write_text("next\n")
    _git(ws, ["add", "."])
    _git(ws, ["commit", "-m", "Add next file"])
    repo = git.Repo(str(ws))

    entries = git_utils.get_git_log(repo, limit=10)

    assert len(entries) == 2
    assert entries[0]["subject"] == "Add next file"
    assert entries[0]["short_hash"] == entries[0]["hash"][:7]
    assert entries[0]["author"] == "Test User"
    assert entries[0]["date"]
    assert entries[1]["subject"] == "Initial commit"


def test_get_git_log_empty_repository(tmp_path):
    ws = tmp_path / "empty"
    ws.mkdir()
    _git(ws, ["init", "-b", "main"])
    repo = git.Repo(str(ws))

    assert git_utils.get_git_log(repo) == []


def test_get_git_log_honours_offset(tmp_path):
    origin = _make_origin(tmp_path)
    ws = tmp_path / "workspace"
    _git(tmp_path, ["clone", str(origin), str(ws)])
    (ws / "next.txt").write_text("next\n")
    _git(ws, ["add", "."])
    _git(ws, ["commit", "-m", "Add next file"])
    (ws / "third.txt").write_text("third\n")
    _git(ws, ["add", "."])
    _git(ws, ["commit", "-m", "Add third file"])
    repo = git.Repo(str(ws))

    first_page = git_utils.get_git_log(repo, limit=2, offset=0)
    second_page = git_utils.get_git_log(repo, limit=2, offset=2)

    assert [entry["subject"] for entry in first_page] == [
        "Add third file",
        "Add next file",
    ]
    assert [entry["subject"] for entry in second_page] == ["Initial commit"]


def test_get_git_log_total_counts_commits(tmp_path):
    origin = _make_origin(tmp_path)
    ws = tmp_path / "workspace"
    _git(tmp_path, ["clone", str(origin), str(ws)])
    (ws / "next.txt").write_text("next\n")
    _git(ws, ["add", "."])
    _git(ws, ["commit", "-m", "Add next file"])
    repo = git.Repo(str(ws))

    assert git_utils.get_git_log_total(repo) == 2
    assert len(git_utils.get_git_log(repo, limit=100)) == 2


def test_get_git_log_total_unborn_head_returns_zero(tmp_path):
    ws = tmp_path / "empty"
    ws.mkdir()
    _git(ws, ["init", "-b", "main"])
    repo = git.Repo(str(ws))

    assert git_utils.get_git_log_total(repo) == 0


@pytest.mark.asyncio
async def test_get_pipeline_repo_readonly_missing_repository(tmp_path):
    pipeline = MagicMock()
    pipeline.workspace_abs_path = tmp_path / "does-not-exist"

    with patch(
        "core.utils.git_utils.pipeline_queries.get_pipeline_by_id",
        new_callable=AsyncMock,
        return_value=pipeline,
    ):
        with pytest.raises(EntityNotFoundError, match="Git repository not found"):
            await git_utils.get_pipeline_repo_readonly("p1")


@pytest.mark.asyncio
async def test_get_pipeline_git_status_and_log(tmp_path):
    origin = _make_origin(tmp_path)
    ws = tmp_path / "workspace"
    _git(tmp_path, ["clone", str(origin), str(ws)])
    repo = git.Repo(str(ws))

    pipeline = MagicMock()
    pipeline.workspace_abs_path = ws

    with patch(
        "core.utils.git_utils.pipeline_queries.get_pipeline_by_id",
        new_callable=AsyncMock,
        return_value=pipeline,
    ):
        details = await git_utils.get_pipeline_git_status("p1")
        assert details["has_origin"] is True

        entries = await git_utils.get_pipeline_git_log("p1", limit=5)
        assert entries
        assert entries[0]["subject"] == "Initial commit"

        total = await git_utils.get_pipeline_git_log_total("p1")
        assert total == 1

    # The wrapper must not modify the repository.
    assert not repo.is_dirty(untracked_files=True)
