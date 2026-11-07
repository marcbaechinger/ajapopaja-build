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
from unittest.mock import AsyncMock, MagicMock, patch

import git
import pytest

from core import config
from core.exceptions import EntityNotFoundError
from core.models.models import (
    PiSession,
    PiSessionKind,
    PiSessionStatus,
    PullRequest,
    PullRequestKind,
    PullRequestStatus,
)
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
    path.mkdir(parents=True, exist_ok=True)
    _git(path, ["init", "-b", branch])
    (path / "readme.md").write_text("readme\n")
    _git(path, ["add", "."])
    _git(path, ["commit", "-m", "Initial commit"])
    return path


def _commit_file(repo_path: Path, branch: str, name: str, text: str) -> str:
    _git(repo_path, ["checkout", "-B", branch])
    (repo_path / name).write_text(text)
    _git(repo_path, ["add", "."])
    _git(repo_path, ["commit", "-m", f"commit {name}"])
    return _git(repo_path, ["rev-parse", "HEAD"]).stdout.strip()


def _make_pipeline(repo_path: Path, *, repo_uri: str | None = None):
    return SimpleNamespace(
        id="p1",
        name="ws",
        workspace_path="ws",
        workspace_abs_path=repo_path,
        repo_uri=repo_uri,
        repo_token=None,
    )


async def _make_pr(
    *,
    task_id: str,
    branch_name: str,
    patch: str | None = "diff --git a/a b/a\n+change\n",
    status: PullRequestStatus = PullRequestStatus.ACCEPTED,
    pi_session_uid: str | None = None,
    kind: PullRequestKind = PullRequestKind.IMPLEMENTATION,
) -> PullRequest:
    pr = PullRequest(
        pipeline_id="p1",
        task_id=task_id,
        subject=task_id,
        summary=task_id,
        branch_name=branch_name,
        kind=kind,
        patch=patch,
        status=status,
        pi_session_uid=pi_session_uid,
        remote_pr_url=f"https://host/org/ws/pulls/{task_id}",
        base_branch="main",
    )
    await pr.insert()
    return pr


async def _make_session(
    uid: str,
    *,
    status: PiSessionStatus = PiSessionStatus.COMPLETED,
    chained_from: str | None = None,
    pull_request_ids: list[str] | None = None,
) -> PiSession:
    session = PiSession(
        uid=uid,
        kind=PiSessionKind.CODERBOT,
        status=status,
        pipeline_id="p1",
        task_id=uid,
        branch_name=f"coderbot/{uid.replace('u', 't', 1)}",
        pull_request_ids=pull_request_ids or [],
        chained_from_session_uid=chained_from,
    )
    await session.insert()
    return session


def _create_worktree(pipeline, pr: PullRequest) -> Path:
    wt = git_utils._pr_worktree_path(pipeline, pr)
    wt.parent.mkdir(parents=True, exist_ok=True)
    git_utils.get_repo(str(pipeline.workspace_abs_path)).git.worktree(
        "add", str(wt), pr.branch_name
    )
    return wt


@pytest.fixture(autouse=True)
def isolated_workspace_roots(monkeypatch, tmp_path):
    root = tmp_path / "workspaces"
    remote = tmp_path / "remote_workspaces"
    root.mkdir()
    remote.mkdir()
    monkeypatch.setattr(config, "WORKSPACES_ROOT", root)
    monkeypatch.setattr(config, "REMOTE_WORKSPACES_ROOT", remote)
    monkeypatch.setattr(config, "PI_SESSIONS_ROOT", tmp_path / "pi_sessions")
    monkeypatch.setattr(config, "GITEA_DELETE_BRANCH_ON_COMPLETE", True)


@pytest.fixture
def fake_gitea():
    client = MagicMock()
    client.delete_branch = AsyncMock()
    client.aclose = AsyncMock()
    with patch("core.utils.git_utils.GiteaClient", return_value=client):
        yield client


def _remote_deleted_branches(client) -> list[str]:
    return [call.args[2] for call in client.delete_branch.await_args_list]


@pytest.mark.asyncio
async def test_t_a_hook_deletes_only_its_own_remote_branch(
    init_mock_db, tmp_path, fake_gitea
):
    repo = _make_repo(tmp_path / "r")
    pipeline = _make_pipeline(repo, repo_uri="https://host/org/ws.git")
    _commit_file(repo, "coderbot/t1", "one.txt", "one\n")
    _git(repo, ["checkout", "main"])

    pr1 = await _make_pr(task_id="t1", branch_name="coderbot/t1", pi_session_uid="u1")
    pr2 = await _make_pr(
        task_id="t2",
        branch_name="coderbot/t2",
        status=PullRequestStatus.SUBMITTED,
        pi_session_uid="u2",
    )
    await _make_session("u1", pull_request_ids=[str(pr1.id)])
    await _make_session("u2", chained_from="u1", pull_request_ids=[str(pr2.id)])
    wt = _create_worktree(pipeline, pr1)

    result = await git_utils.cleanup_completed_pull_request(pipeline, pr1)

    assert result["deferred"] is True
    assert result["local_branch_deleted"] is False
    assert result["patch_cleared"] is False
    assert _remote_deleted_branches(fake_gitea) == ["coderbot/t1"]
    assert "coderbot/t1" in {b.name for b in git.Repo(str(repo)).branches}
    assert not wt.exists()
    refreshed = await PullRequest.get(pr1.id)
    assert refreshed.patch is not None


@pytest.mark.asyncio
async def test_t_b_deferred_branch_is_still_a_start_point(
    init_mock_db, tmp_path, fake_gitea
):
    repo = _make_repo(tmp_path / "r")
    pipeline = _make_pipeline(repo, repo_uri="https://host/org/ws.git")
    c1 = _commit_file(repo, "coderbot/t1", "one.txt", "one\n")
    _git(repo, ["checkout", "main"])

    pr1 = await _make_pr(task_id="t1", branch_name="coderbot/t1", pi_session_uid="u1")
    pr2 = await _make_pr(
        task_id="t2",
        branch_name="coderbot/t2",
        status=PullRequestStatus.SUBMITTED,
        pi_session_uid="u2",
    )
    await _make_session("u1", pull_request_ids=[str(pr1.id)])
    await _make_session("u2", chained_from="u1", pull_request_ids=[str(pr2.id)])

    await git_utils.cleanup_completed_pull_request(pipeline, pr1)

    repo_obj = git_utils.get_repo(str(repo))
    start_point = await git_utils._resolve_chained_start_point_for_repo(repo_obj, pr2)
    assert start_point == "coderbot/t1"
    git_utils.ensure_feature_branch(repo_obj, "coderbot/t2", start_point=start_point)
    assert repo_obj.head.commit.hexsha == c1
    assert repo_obj.active_branch.name == "coderbot/t2"
    _git(repo, ["checkout", "main"])


@pytest.mark.asyncio
async def test_t_c_tip_releases_whole_prefix(init_mock_db, tmp_path, fake_gitea):
    repo = _make_repo(tmp_path / "r")
    pipeline = _make_pipeline(repo, repo_uri="https://host/org/ws.git")
    _commit_file(repo, "coderbot/t1", "one.txt", "one\n")
    _commit_file(repo, "coderbot/t2", "two.txt", "two\n")
    _commit_file(repo, "coderbot/t3", "three.txt", "three\n")
    _git(repo, ["checkout", "main"])

    pr1 = await _make_pr(task_id="t1", branch_name="coderbot/t1", pi_session_uid="u1")
    pr2 = await _make_pr(task_id="t2", branch_name="coderbot/t2", pi_session_uid="u2")
    pr3 = await _make_pr(task_id="t3", branch_name="coderbot/t3", pi_session_uid="u3")
    # At the start PR2/PR3 are still pending, so every completion except the
    # tip is deferred.
    pr2.status = PullRequestStatus.SUBMITTED
    pr3.status = PullRequestStatus.SUBMITTED
    await pr2.save()
    await pr3.save()
    await _make_session("u1", pull_request_ids=[str(pr1.id)])
    await _make_session("u2", chained_from="u1", pull_request_ids=[str(pr2.id)])
    await _make_session("u3", chained_from="u2", pull_request_ids=[str(pr3.id)])
    worktrees = [_create_worktree(pipeline, pr) for pr in (pr1, pr2, pr3)]

    # PR1 merged while PR2/PR3 are pending.
    result1 = await git_utils.cleanup_completed_pull_request(pipeline, pr1)
    assert result1["deferred"] is True

    # PR2 merged while PR3 is pending.
    pr2.status = PullRequestStatus.ACCEPTED
    await pr2.save()
    result2 = await git_utils.cleanup_completed_pull_request(pipeline, pr2)
    assert result2["deferred"] is True

    # PR3 (the tip) completes: its own branch is released immediately, then the
    # sweep releases PR1 and PR2.
    pr3.status = PullRequestStatus.ACCEPTED
    await pr3.save()
    result3 = await git_utils.cleanup_completed_pull_request(pipeline, pr3)
    assert result3["deferred"] is False
    assert result3["local_branch_deleted"] is True
    assert result3["patch_cleared"] is True

    released = await git_utils.sweep_completed_pull_requests(pipeline)
    assert released >= 2

    assert not [
        b for b in git.Repo(str(repo)).branches if b.name.startswith("coderbot/")
    ]
    for pr in (pr1, pr2, pr3):
        refreshed = await PullRequest.get(pr.id)
        assert refreshed.patch is None
    assert _remote_deleted_branches(fake_gitea) == [
        "coderbot/t1",
        "coderbot/t2",
        "coderbot/t3",
    ]
    assert all(not wt.exists() for wt in worktrees)


@pytest.mark.asyncio
async def test_t_d_non_chained_pr_cleans_immediately(
    init_mock_db, tmp_path, fake_gitea
):
    repo = _make_repo(tmp_path / "r")
    pipeline = _make_pipeline(repo, repo_uri="https://host/org/ws.git")
    _commit_file(repo, "coderbot/t1", "one.txt", "one\n")
    _git(repo, ["checkout", "main"])

    pr = await _make_pr(task_id="t1", branch_name="coderbot/t1", pi_session_uid="u1")
    await _make_session("u1", pull_request_ids=[str(pr.id)])

    result = await git_utils.cleanup_completed_pull_request(pipeline, pr)

    assert result == {
        "local_branch_deleted": True,
        "remote_branch_deleted": True,
        "patch_cleared": True,
        "deferred": False,
        "errors": [],
    }
    assert "coderbot/t1" not in {b.name for b in git.Repo(str(repo)).branches}
    assert (await PullRequest.get(pr.id)).patch is None


@pytest.mark.asyncio
async def test_documentation_pr_cleanup_never_defers_on_chained_descendant(
    init_mock_db, tmp_path, fake_gitea
):
    repo = _make_repo(tmp_path / "r")
    pipeline = _make_pipeline(repo, repo_uri="https://host/org/ws.git")
    _commit_file(repo, "docbot/task/t1", "one.txt", "one\n")
    _git(repo, ["checkout", "main"])

    doc_pr = await _make_pr(
        task_id="t1",
        branch_name="docbot/task/t1",
        pi_session_uid="u1",
        kind=PullRequestKind.DOCUMENTATION,
    )
    descendant = await _make_pr(
        task_id="t2",
        branch_name="coderbot/t2",
        status=PullRequestStatus.OPEN,
        pi_session_uid="u2",
    )
    await _make_session("u1", pull_request_ids=[str(doc_pr.id)])
    await _make_session("u2", chained_from="u1", pull_request_ids=[str(descendant.id)])

    result = await git_utils.cleanup_completed_pull_request(pipeline, doc_pr)

    assert result["deferred"] is False
    assert result["local_branch_deleted"] is True
    assert result["patch_cleared"] is True
    assert "docbot/task/t1" not in {b.name for b in git.Repo(str(repo)).branches}
    assert (await PullRequest.get(doc_pr.id)).patch is None
    assert _remote_deleted_branches(fake_gitea) == ["docbot/task/t1"]


@pytest.mark.asyncio
async def test_cleanup_one_documentation_pr_keeps_another_documentation_branch(
    init_mock_db, tmp_path, fake_gitea
):
    repo = _make_repo(tmp_path / "r")
    pipeline = _make_pipeline(repo, repo_uri="https://host/org/ws.git")
    _commit_file(repo, "docbot/task/t1", "one.txt", "one\n")
    _commit_file(repo, "docbot/task/t2", "two.txt", "two\n")
    _git(repo, ["checkout", "main"])

    doc_pr1 = await _make_pr(
        task_id="t1",
        branch_name="docbot/task/t1",
        pi_session_uid="u1",
        kind=PullRequestKind.DOCUMENTATION,
    )
    doc_pr2 = await _make_pr(
        task_id="t2",
        branch_name="docbot/task/t2",
        status=PullRequestStatus.OPEN,
        pi_session_uid="u2",
        kind=PullRequestKind.DOCUMENTATION,
    )
    await _make_session("u1", pull_request_ids=[str(doc_pr1.id)])
    await _make_session("u2", pull_request_ids=[str(doc_pr2.id)])

    result = await git_utils.cleanup_completed_pull_request(pipeline, doc_pr1)

    assert result["deferred"] is False
    assert result["local_branch_deleted"] is True
    branches = {b.name for b in git.Repo(str(repo)).branches}
    assert "docbot/task/t1" not in branches
    assert "docbot/task/t2" in branches
    assert (await PullRequest.get(doc_pr2.id)).patch is not None
    assert _remote_deleted_branches(fake_gitea) == ["docbot/task/t1"]


@pytest.mark.asyncio
async def test_t_e_sibling_pending_pr_does_not_defer(
    init_mock_db, tmp_path, fake_gitea
):
    repo = _make_repo(tmp_path / "r")
    pipeline = _make_pipeline(repo, repo_uri="https://host/org/ws.git")
    _commit_file(repo, "coderbot/t1", "one.txt", "one\n")
    _git(repo, ["checkout", "main"])

    pr1 = await _make_pr(task_id="t1", branch_name="coderbot/t1", pi_session_uid="u1")
    sibling = await _make_pr(
        task_id="t2",
        branch_name="coderbot/t2",
        status=PullRequestStatus.OPEN,
        pi_session_uid="u2",
    )
    await _make_session("u1", pull_request_ids=[str(pr1.id)])
    await _make_session("u2", pull_request_ids=[str(sibling.id)])
    # No chained_from link: both branched from the default branch.

    result = await git_utils.cleanup_completed_pull_request(pipeline, pr1)

    assert result["deferred"] is False
    assert result["local_branch_deleted"] is True
    assert result["patch_cleared"] is True


@pytest.mark.asyncio
async def test_t_f_abandoned_chain_stays_deferred(init_mock_db, tmp_path, fake_gitea):
    repo = _make_repo(tmp_path / "r")
    pipeline = _make_pipeline(repo, repo_uri="https://host/org/ws.git")
    _commit_file(repo, "coderbot/t1", "one.txt", "one\n")
    _git(repo, ["checkout", "main"])

    pr1 = await _make_pr(
        task_id="t1",
        branch_name="coderbot/t1",
        status=PullRequestStatus.REJECTED,
        pi_session_uid="u1",
    )
    pr2 = await _make_pr(
        task_id="t2",
        branch_name="coderbot/t2",
        status=PullRequestStatus.OPEN,
        pi_session_uid="u2",
    )
    await _make_session("u1", pull_request_ids=[str(pr1.id)])
    await _make_session("u2", chained_from="u1", pull_request_ids=[str(pr2.id)])

    result = await git_utils.cleanup_completed_pull_request(pipeline, pr1)
    released = await git_utils.sweep_completed_pull_requests(pipeline)

    assert result["deferred"] is True
    assert released == 0
    assert "coderbot/t1" in {b.name for b in git.Repo(str(repo)).branches}
    assert (await PullRequest.get(pr1.id)).patch is not None


@pytest.mark.asyncio
async def test_t_g_order_independence(init_mock_db, tmp_path, fake_gitea):
    repo = _make_repo(tmp_path / "r")
    pipeline = _make_pipeline(repo, repo_uri="https://host/org/ws.git")
    _commit_file(repo, "coderbot/t1", "one.txt", "one\n")
    _commit_file(repo, "coderbot/t2", "two.txt", "two\n")
    _commit_file(repo, "coderbot/t3", "three.txt", "three\n")
    _git(repo, ["checkout", "main"])

    pr1 = await _make_pr(task_id="t1", branch_name="coderbot/t1", pi_session_uid="u1")
    pr2 = await _make_pr(task_id="t2", branch_name="coderbot/t2", pi_session_uid="u2")
    pr3 = await _make_pr(task_id="t3", branch_name="coderbot/t3", pi_session_uid="u3")
    pr1.status = PullRequestStatus.SUBMITTED
    pr3.status = PullRequestStatus.SUBMITTED
    await pr1.save()
    await pr3.save()
    await _make_session("u1", pull_request_ids=[str(pr1.id)])
    await _make_session("u2", chained_from="u1", pull_request_ids=[str(pr2.id)])
    await _make_session("u3", chained_from="u2", pull_request_ids=[str(pr3.id)])

    # Complete PR2 first (force), while PR1/PR3 are still pending.
    result2 = await git_utils.cleanup_completed_pull_request(pipeline, pr2)
    assert result2["deferred"] is True

    # Then PR1; PR3 is still pending, so it defers too.
    pr1.status = PullRequestStatus.ACCEPTED
    await pr1.save()
    result1 = await git_utils.cleanup_completed_pull_request(pipeline, pr1)
    assert result1["deferred"] is True

    # Finally the tip; the sweep releases the earlier completions in any order.
    pr3.status = PullRequestStatus.ACCEPTED
    await pr3.save()
    result3 = await git_utils.cleanup_completed_pull_request(pipeline, pr3)
    assert result3["deferred"] is False
    await git_utils.sweep_completed_pull_requests(pipeline)

    assert not [
        b for b in git.Repo(str(repo)).branches if b.name.startswith("coderbot/")
    ]
    for pr in (pr1, pr2, pr3):
        assert (await PullRequest.get(pr.id)).patch is None
    assert _remote_deleted_branches(fake_gitea) == [
        "coderbot/t2",
        "coderbot/t1",
        "coderbot/t3",
    ]


@pytest.mark.asyncio
async def test_t_h_idempotency(init_mock_db, tmp_path, fake_gitea):
    repo = _make_repo(tmp_path / "r")
    pipeline = _make_pipeline(repo, repo_uri="https://host/org/ws.git")
    _commit_file(repo, "coderbot/t1", "one.txt", "one\n")
    _git(repo, ["checkout", "main"])
    pr = await _make_pr(task_id="t1", branch_name="coderbot/t1", pi_session_uid="u1")
    await _make_session("u1", pull_request_ids=[str(pr.id)])

    first = await git_utils.cleanup_completed_pull_request(pipeline, pr)
    assert first["remote_branch_deleted"] is True

    second = await git_utils.cleanup_completed_pull_request(pipeline, pr)
    assert second["deferred"] is False
    assert second["local_branch_deleted"] is False
    assert second["remote_branch_deleted"] is False
    assert second["patch_cleared"] is False

    assert await git_utils.sweep_completed_pull_requests(pipeline) == 0
    # The first call performed the only remote delete.
    assert _remote_deleted_branches(fake_gitea) == ["coderbot/t1"]


@pytest.mark.asyncio
async def test_t_i_pr_without_branch_never_raises(init_mock_db, tmp_path, fake_gitea):
    repo = _make_repo(tmp_path / "r")
    pipeline = _make_pipeline(repo, repo_uri="https://host/org/ws.git")
    pr = await _make_pr(task_id="t1", branch_name="coderbot/t1", pi_session_uid=None)

    result = await git_utils.cleanup_completed_pull_request(pipeline, pr)

    assert result["local_branch_deleted"] is False
    assert result["patch_cleared"] is True
    assert result["errors"] == []
    assert (await PullRequest.get(pr.id)).patch is None


@pytest.mark.asyncio
async def test_remote_branch_delete_can_be_disabled(init_mock_db, tmp_path, fake_gitea):
    repo = _make_repo(tmp_path / "r")
    pipeline = _make_pipeline(repo, repo_uri="https://host/org/ws.git")
    _commit_file(repo, "coderbot/t1", "one.txt", "one\n")
    _git(repo, ["checkout", "main"])
    pr = await _make_pr(task_id="t1", branch_name="coderbot/t1")
    config.GITEA_DELETE_BRANCH_ON_COMPLETE = False

    result = await git_utils.cleanup_completed_pull_request(pipeline, pr)

    assert result["remote_branch_deleted"] is False
    fake_gitea.delete_branch.assert_not_awaited()


@pytest.mark.asyncio
async def test_resolve_pr_workspace_rejects_cleaned_up_terminal_pr(
    init_mock_db, tmp_path
):
    repo = _make_repo(tmp_path / "r")
    pipeline = _make_pipeline(repo)
    pr = await _make_pr(task_id="t1", branch_name="coderbot/t1", patch=None)
    pr.status = PullRequestStatus.ACCEPTED
    await pr.save()

    with pytest.raises(EntityNotFoundError, match="cleaned up"):
        await git_utils.resolve_pr_workspace(pipeline, pr)


@pytest.mark.asyncio
async def test_pr_without_patch_loads_and_is_returned_by_route(init_mock_db):
    from api.routes.pull_request import get_pull_request as route_get_pull_request

    pr = await _make_pr(task_id="t1", branch_name="coderbot/t1", patch=None)
    pr.status = PullRequestStatus.ACCEPTED
    await pr.save()

    loaded = await PullRequest.get(pr.id)
    assert loaded.patch is None
    returned = await route_get_pull_request(str(pr.id))
    assert returned.patch is None


@pytest.mark.asyncio
async def test_cleanup_drops_stale_remote_tracking_ref(
    init_mock_db, tmp_path, fake_gitea
):
    repo = _make_repo(tmp_path / "r")
    pipeline = _make_pipeline(repo, repo_uri="https://host/org/ws.git")
    _commit_file(repo, "coderbot/t1", "one.txt", "one\n")
    _git(repo, ["checkout", "main"])
    # Simulate the remote-tracking ref created by the feature-branch push.
    _git(repo, ["update-ref", "refs/remotes/origin/coderbot/t1", "coderbot/t1"])
    pr = await _make_pr(task_id="t1", branch_name="coderbot/t1")

    await git_utils.cleanup_completed_pull_request(pipeline, pr)

    repo_obj = git_utils.get_repo(str(repo))
    assert not git_utils._branch_exists_remote(repo_obj, "coderbot/t1")
    with patch.object(git_utils, "ensure_repo_cloned", new=AsyncMock()):
        with pytest.raises(EntityNotFoundError, match="cleaned up"):
            await git_utils.resolve_pr_workspace(pipeline, pr)
