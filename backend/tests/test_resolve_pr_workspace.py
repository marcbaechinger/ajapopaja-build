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
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import git
import pytest

from core import config
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


def _make_repo(path: Path, branch: str = "main") -> Path:
    """Create a git repository with a single commit and the given branch."""
    path.mkdir(parents=True, exist_ok=True)
    _git(path, ["init", "-b", branch])
    (path / "readme.md").write_text("readme\n")
    _git(path, ["add", "."])
    _git(path, ["commit", "-m", "Initial commit"])
    return path


def _make_pipeline(workspace_abs_path: Path, workspace_path: str) -> "object":
    return SimpleNamespace(
        repo_uri=None,
        name="repo",
        workspace_path=workspace_path,
        workspace_abs_path=workspace_abs_path,
    )


def _make_pr(
    branch_name: str = "coderbot/t1",
    patch: str = "",
    task_id: str = "t1",
    pi_session_uid: str | None = None,
) -> "object":
    return SimpleNamespace(
        id=task_id,
        pipeline_id="p1",
        task_id=task_id,
        branch_name=branch_name,
        patch=patch,
        pi_session_uid=pi_session_uid,
    )


@pytest.fixture(autouse=True)
def unique_workspace_root(monkeypatch, tmp_path):
    # Isolate local worktrees away from the shared /tmp WORKSPACES_ROOT so
    # parallel tests cannot collide on ``<workspace>.dev`` directories.
    root = tmp_path / "workspaces"
    root.mkdir()
    monkeypatch.setattr(config, "WORKSPACES_ROOT", root)
    return root


@pytest.mark.asyncio
async def test_resolve_returns_retained_sandbox(tmp_path):
    pipeline = _make_pipeline(tmp_path / "r", "ws1")
    _make_repo(pipeline.workspace_abs_path)

    sandbox = config.PI_SESSIONS_ROOT / "sess-1" / "workspace"
    _make_repo(sandbox, branch="coderbot/t1")

    pr = _make_pr(pi_session_uid="sess-1")

    workspace, target = await git_utils.resolve_pr_workspace(pipeline, pr)

    assert workspace == str(sandbox)
    assert target == "coderbot/t1"


@pytest.mark.asyncio
async def test_resolve_returns_existing_feature_branch_worktree(tmp_path):
    pipeline = _make_pipeline(tmp_path / "r", "ws2")
    r = _make_repo(pipeline.workspace_abs_path)
    # Create a feature branch that is not checked out in R.
    _git(r, ["checkout", "-b", "coderbot/t1"])
    _git(r, ["checkout", "main"])

    pr = _make_pr(branch_name="coderbot/t1", patch="diff")

    workspace, target = await git_utils.resolve_pr_workspace(pipeline, pr)

    wt = config.WORKSPACES_ROOT / "ws2.dev" / "t1"
    assert workspace == str(wt)
    assert target == "coderbot/t1"
    assert git.Repo(str(wt)).active_branch.name == "coderbot/t1"
    # R's checked-out branch is untouched.
    assert git.Repo(str(r)).active_branch.name == "main"


@pytest.mark.asyncio
async def test_resolve_applies_patch_in_fallback_worktree(tmp_path):
    pipeline = _make_pipeline(tmp_path / "r", "ws3")
    r = _make_repo(pipeline.workspace_abs_path)

    patch = "diff --git a/added.txt b/added.txt\n"
    patch += "new file mode 100644\n"
    patch += "index 0000000..e69de29\n"
    patch += "--- /dev/null\n"
    patch += "+++ b/added.txt\n"
    patch += "@@ -0,0 +1 @@\n"
    patch += "+hello\n"

    pr = _make_pr(branch_name="coderbot/t1", patch=patch)

    workspace, target = await git_utils.resolve_pr_workspace(pipeline, pr)

    wt = config.WORKSPACES_ROOT / "ws3.dev" / "t1"
    assert workspace == str(wt)
    assert target == "coderbot/t1"
    assert (wt / "added.txt").read_text() == "hello\n"
    # R stays clean and on its original branch.
    assert git.Repo(str(r)).active_branch.name == "main"
    assert not git.Repo(str(r)).is_dirty(untracked_files=True)


@pytest.mark.asyncio
async def test_resolve_chained_fallback_applies_predecessors_in_order(tmp_path):
    pipeline = _make_pipeline(tmp_path / "r", "ws4")
    r = _make_repo(pipeline.workspace_abs_path)

    first_patch = (
        "diff --git a/first.txt b/first.txt\n"
        "new file mode 100644\n"
        "index 0000000..e69de29\n"
        "--- /dev/null\n"
        "+++ b/first.txt\n"
        "@@ -0,0 +1 @@\n"
        "+first\n"
    )
    second_patch = (
        "diff --git a/second.txt b/second.txt\n"
        "new file mode 100644\n"
        "index 0000000..e69de29\n"
        "--- /dev/null\n"
        "+++ b/second.txt\n"
        "@@ -0,0 +1 @@\n"
        "+second\n"
    )

    second = _make_pr(branch_name="coderbot/t2", patch=second_patch, task_id="t2")

    # Make the chained-predecessor lookup resolve PR2 -> PR1 without a database.
    async def fake_find_predecessor(pr):
        if getattr(pr, "id", None) == "t2":
            return _make_pr(branch_name="coderbot/t1", patch=first_patch, task_id="t1")
        return None

    with patch.object(
        git_utils,
        "_find_chained_predecessor_pr",
        new=AsyncMock(side_effect=fake_find_predecessor),
    ):
        workspace, target = await git_utils.resolve_pr_workspace(pipeline, second)

    wt = config.WORKSPACES_ROOT / "ws4.dev" / "t2"
    assert workspace == str(wt)
    assert target == "coderbot/t2"
    # Both the predecessor and the PR's own patch are applied in order.
    assert (wt / "first.txt").read_text() == "first\n"
    assert (wt / "second.txt").read_text() == "second\n"
    assert not git.Repo(str(r)).is_dirty(untracked_files=True)


@pytest.mark.asyncio
async def test_resolve_raises_when_workspace_missing(tmp_path):
    pipeline = _make_pipeline(tmp_path / "missing", "ws5")
    pr = _make_pr(patch="diff")

    with pytest.raises(git.exc.NoSuchPathError):
        await git_utils.resolve_pr_workspace(pipeline, pr)
