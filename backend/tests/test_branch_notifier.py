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
from unittest.mock import AsyncMock, MagicMock, patch

import git
import pytest

from api.git_hosting.branch_events import PrStateEvent
from api.git_hosting.branch_notifier import PrStateNotifier, SyncResult
from api.git_hosting.gitea import GiteaApiError
from api.websocket_manager import WSMessage
from core import config
from core.models.models import (
    Pipeline,
    PiSession,
    PiSessionKind,
    PiSessionStatus,
    PullRequest,
    PullRequestKind,
    PullRequestStatus,
    Task,
    TaskStatus,
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


@pytest.fixture(autouse=True)
def isolated_cleanup_roots(monkeypatch, tmp_path):
    root = tmp_path / "workspaces"
    remote = tmp_path / "remote_workspaces"
    root.mkdir()
    remote.mkdir()
    monkeypatch.setattr(config, "WORKSPACES_ROOT", root)
    monkeypatch.setattr(config, "REMOTE_WORKSPACES_ROOT", remote)
    monkeypatch.setattr(config, "PI_SESSIONS_ROOT", tmp_path / "pi_sessions")
    monkeypatch.setattr(config, "GITEA_DELETE_BRANCH_ON_COMPLETE", True)


@pytest.fixture(autouse=True)
def fake_gitea():
    client = MagicMock()
    client.delete_branch = AsyncMock()
    client.aclose = AsyncMock()
    with patch("core.utils.git_utils.GiteaClient", return_value=client):
        yield client


def _event(state="merged", base_branch="main", commit_hash="commit-sha"):
    return PrStateEvent(
        repo_full_name="org/repo",
        branch="main",
        state=state,
        commit_hash=commit_hash if state == "merged" else None,
        base_branch=base_branch,
    )


async def _make_pipeline(workspace_abs_path=None) -> Pipeline:
    pipeline = Pipeline(
        name="myapp",
        repo_uri="https://host/org/repo.git",
        repo_username="user",
        repo_token="tok",
        workspace_abs_path=workspace_abs_path,
    )
    await pipeline.insert()
    return pipeline


async def _make_pr_and_task(pipeline: Pipeline, base_branch="main"):
    task = Task(
        title="Implement feature",
        pipeline_id=str(pipeline.id),
        status=TaskStatus.SUBMITTED,
    )
    await task.insert()
    pr = PullRequest(
        pipeline_id=str(pipeline.id),
        task_id=str(task.id),
        summary="summary",
        subject="subject",
        branch_name="coderbot/t1",
        patch="patch",
        status=PullRequestStatus.SUBMITTED,
        base_branch=base_branch,
        remote_pr_url="https://host/org/repo/pulls/1",
    )
    await pr.insert()
    return pr, task


@pytest.mark.asyncio
async def test_on_pr_state_unknown_pipeline(init_mock_db):
    notifier = PrStateNotifier()
    result = await notifier.on_pr_state("does-not-exist", _event())
    assert result.status == "not_found"


@pytest.mark.asyncio
async def test_on_pr_state_repo_mismatch_is_ignored(init_mock_db):
    await _make_pipeline()
    notifier = PrStateNotifier()
    event = PrStateEvent(
        repo_full_name="other/repo",
        branch="main",
        state="merged",
        commit_hash="commit-sha",
        base_branch="main",
    )
    with patch(
        "api.git_hosting.branch_notifier.git_utils.resolve_gitea_repo",
        return_value=("https://host", "org", "repo"),
    ):
        result = await notifier.on_pr_state(str((await Pipeline.find_one()).id), event)
    assert result.status == "ignored"


@pytest.mark.asyncio
async def test_on_pr_state_busy_mirrors_and_defers_pull(init_mock_db):
    pipeline = await _make_pipeline()
    pr, task = await _make_pr_and_task(pipeline)
    await PiSession(
        uid="uid-1",
        kind=PiSessionKind.CODERBOT,
        status=PiSessionStatus.RUNNING,
        pipeline_id=str(pipeline.id),
    ).insert()

    mock_repo = MagicMock()
    mock_repo.active_branch.name = "main"
    mock_repo.head.commit.hexsha = "commit-sha"

    notifier = PrStateNotifier()
    with (
        patch(
            "api.git_hosting.branch_notifier.git_utils.ensure_repo_fetched",
            new=AsyncMock(return_value=1),
        ),
        patch(
            "api.git_hosting.branch_notifier.git_utils.get_repo",
            return_value=mock_repo,
        ),
        patch(
            "api.git_hosting.branch_notifier.git_utils.validate_commit_hash",
            return_value=True,
        ),
        patch(
            "api.git_hosting.branch_notifier.ws_manager.broadcast",
            new=AsyncMock(),
        ) as mock_broadcast,
        patch.object(
            PrStateNotifier, "pull_pipeline_repo", new=AsyncMock()
        ) as mock_pull,
        patch(
            "api.git_hosting.branch_notifier.notification_manager.notify_actions",
            new=AsyncMock(),
        ) as mock_notify,
    ):
        result = await notifier.on_pr_state(str(pipeline.id), _event())

    # The DB mirror is applied even though a session is active.
    assert result.status == "mirrored"
    assert result.pull_deferred is True
    assert result.affected_task_ids == [str(task.id)]
    assert (await PullRequest.get(pr.id)).status == PullRequestStatus.ACCEPTED
    updated_task = await Task.get(task.id)
    assert updated_task.status == TaskStatus.IMPLEMENTED
    assert updated_task.commit_hash == "commit-sha"

    # ...but the working tree is not pulled; a "Pull now" action is offered.
    mock_pull.assert_not_awaited()
    mock_notify.assert_awaited_once()
    assert mock_notify.await_args.kwargs["id"] == f"pull_remote:{pipeline.id}"
    action = mock_notify.await_args.kwargs["actions"][0]
    assert action.name == "pull_remote"
    assert action.label == "Pull now"
    assert action.data == {"pipeline_id": str(pipeline.id)}
    assert action.style == "primary"

    status_msgs = [
        c
        for c in mock_broadcast.await_args_list
        if isinstance(c.args[0], WSMessage) and c.args[0].type == "TASK_STATUS_UPDATED"
    ]
    assert len(status_msgs) == 1


@pytest.mark.asyncio
async def test_on_pr_state_sync_failure(init_mock_db):
    pipeline = await _make_pipeline()
    notifier = PrStateNotifier()
    with patch(
        "api.git_hosting.branch_notifier.git_utils.ensure_repo_fetched",
        new=AsyncMock(side_effect=RuntimeError("boom")),
    ):
        result = await notifier.on_pr_state(str(pipeline.id), _event())
    assert result.status == "sync_failed"


@pytest.mark.asyncio
async def test_on_pr_state_busy_fetch_failure_still_mirrors(init_mock_db):
    """Decision (a): a signed payload is mirrored even if the safe fetch fails
    while a session is active (only the pull is deferred)."""
    pipeline = await _make_pipeline()
    pr, task = await _make_pr_and_task(pipeline)
    await PiSession(
        uid="uid-1",
        kind=PiSessionKind.CODERBOT,
        status=PiSessionStatus.RUNNING,
        pipeline_id=str(pipeline.id),
    ).insert()

    notifier = PrStateNotifier()
    with (
        patch(
            "api.git_hosting.branch_notifier.git_utils.ensure_repo_fetched",
            new=AsyncMock(side_effect=RuntimeError("network down")),
        ),
        patch(
            "api.git_hosting.branch_notifier.ws_manager.broadcast",
            new=AsyncMock(),
        ),
        patch.object(PrStateNotifier, "pull_pipeline_repo", new=AsyncMock()),
        patch(
            "api.git_hosting.branch_notifier.notification_manager.notify_actions",
            new=AsyncMock(),
        ) as mock_notify,
    ):
        result = await notifier.on_pr_state(str(pipeline.id), _event())

    assert result.status == "mirrored"
    assert result.pull_deferred is True
    assert result.affected_task_ids == [str(task.id)]
    assert (await PullRequest.get(pr.id)).status == PullRequestStatus.ACCEPTED
    assert (await Task.get(task.id)).status == TaskStatus.IMPLEMENTED
    mock_notify.assert_awaited_once()


@pytest.mark.asyncio
async def test_on_pr_state_busy_closed_still_rejects(init_mock_db):
    pipeline = await _make_pipeline()
    pr, task = await _make_pr_and_task(pipeline)
    await PiSession(
        uid="uid-1",
        kind=PiSessionKind.CODERBOT,
        status=PiSessionStatus.RUNNING,
        pipeline_id=str(pipeline.id),
    ).insert()

    notifier = PrStateNotifier()
    with (
        patch(
            "api.git_hosting.branch_notifier.git_utils.ensure_repo_fetched",
            new=AsyncMock(),
        ),
        patch(
            "api.git_hosting.branch_notifier.ws_manager.broadcast",
            new=AsyncMock(),
        ),
        patch.object(
            PrStateNotifier, "pull_pipeline_repo", new=AsyncMock()
        ) as mock_pull,
        patch(
            "api.git_hosting.branch_notifier.notification_manager.notify_actions",
            new=AsyncMock(),
        ) as mock_notify,
    ):
        result = await notifier.on_pr_state(str(pipeline.id), _event(state="closed"))

    assert result.status == "mirrored"
    assert result.pull_deferred is True
    assert (await PullRequest.get(pr.id)).status == PullRequestStatus.REJECTED
    assert (await Task.get(task.id)).status == TaskStatus.CREATED
    mock_pull.assert_not_awaited()
    mock_notify.assert_awaited_once()


@pytest.mark.asyncio
async def test_on_pr_state_merged_mirrors_pr_and_task(init_mock_db):
    pipeline = await _make_pipeline()
    pr, task = await _make_pr_and_task(pipeline)

    mock_repo = MagicMock()
    mock_repo.active_branch.name = "main"
    mock_repo.head.commit.hexsha = "commit-sha"
    mock_repo.remotes.origin.fetch.return_value = []

    notifier = PrStateNotifier()
    with (
        patch(
            "api.git_hosting.branch_notifier.git_utils.ensure_repo_fetched",
            new=AsyncMock(),
        ),
        patch(
            "api.git_hosting.branch_notifier.git_utils.get_repo",
            return_value=mock_repo,
        ),
        patch(
            "api.git_hosting.branch_notifier.git_utils.validate_commit_hash",
            return_value=True,
        ),
        patch(
            "api.git_hosting.branch_notifier.ws_manager.broadcast",
            new=AsyncMock(),
        ) as mock_broadcast,
        patch.object(
            PrStateNotifier, "pull_pipeline_repo", new=AsyncMock()
        ) as mock_pull,
        patch(
            "api.git_hosting.branch_notifier.notification_manager.notify_actions",
            new=AsyncMock(),
        ) as mock_notify,
    ):
        result = await notifier.on_pr_state(str(pipeline.id), _event())

    assert result.status == "mirrored"
    assert result.pull_deferred is False
    assert result.commit_hash == "commit-sha"
    assert result.affected_task_ids == [str(task.id)]

    # No session: the working tree is pulled immediately and no notification is
    # sent.
    mock_pull.assert_awaited_once()
    mock_notify.assert_not_awaited()

    updated_pr = await PullRequest.get(pr.id)
    assert updated_pr.status == PullRequestStatus.ACCEPTED

    updated_task = await Task.get(task.id)
    assert updated_task.status == TaskStatus.IMPLEMENTED
    assert updated_task.commit_hash == "commit-sha"
    transitions = [(t.from_status, t.to_status, t.by) for t in updated_task.history]
    assert (TaskStatus.SUBMITTED, TaskStatus.IMPLEMENTED, "system") in transitions

    status_msgs = [
        c
        for c in mock_broadcast.await_args_list
        if isinstance(c.args[0], WSMessage) and c.args[0].type == "TASK_STATUS_UPDATED"
    ]
    assert len(status_msgs) == 1


@pytest.mark.asyncio
async def test_on_pr_state_merged_documentation_pr_preserves_task_metadata(
    init_mock_db,
):
    """Merging a DocBot PR records the merge on the PR but keeps the task's
    implementation commit/summary/review metadata untouched."""
    pipeline = await _make_pipeline()
    task = Task(
        title="Implement feature",
        pipeline_id=str(pipeline.id),
        status=TaskStatus.IMPLEMENTED,
        commit_hash="impl-commit",
        completion_info="implementation summary",
        review_md="https://host/org/repo/pulls/1",
    )
    await task.insert()
    pr = PullRequest(
        pipeline_id=str(pipeline.id),
        task_id=str(task.id),
        summary="documentation summary",
        subject="DocBot: update docs",
        branch_name="docbot/t1/abc123",
        patch="patch",
        status=PullRequestStatus.SUBMITTED,
        base_branch="main",
        remote_pr_url="https://host/org/repo/pulls/2",
        kind=PullRequestKind.DOCUMENTATION,
    )
    await pr.insert()

    mock_repo = MagicMock()
    mock_repo.active_branch.name = "main"
    mock_repo.head.commit.hexsha = "merge-sha"

    notifier = PrStateNotifier()
    event = PrStateEvent(
        repo_full_name="org/repo",
        branch="main",
        state="merged",
        commit_hash="merge-sha",
        base_branch="main",
        pr_number=2,
        remote_pr_url="https://host/org/repo/pulls/2",
    )
    with (
        patch(
            "api.git_hosting.branch_notifier.git_utils.ensure_repo_fetched",
            new=AsyncMock(),
        ),
        patch(
            "api.git_hosting.branch_notifier.git_utils.get_repo",
            return_value=mock_repo,
        ),
        patch(
            "api.git_hosting.branch_notifier.git_utils.validate_commit_hash",
            return_value=True,
        ),
        patch(
            "api.git_hosting.branch_notifier.ws_manager.broadcast",
            new=AsyncMock(),
        ) as mock_broadcast,
        patch.object(PrStateNotifier, "pull_pipeline_repo", new=AsyncMock()),
        patch(
            "api.git_hosting.branch_notifier.notification_manager.notify_actions",
            new=AsyncMock(),
        ),
    ):
        result = await notifier.on_pr_state(str(pipeline.id), event)

    assert result.status == "mirrored"
    assert result.affected_task_ids == []
    updated_pr = await PullRequest.get(pr.id)
    assert updated_pr.status == PullRequestStatus.ACCEPTED
    # A documentation PR has no implementation commit of its own to record.
    assert updated_pr.commit_hash is None

    updated_task = await Task.get(task.id)
    assert updated_task.status == TaskStatus.IMPLEMENTED
    assert updated_task.commit_hash == "impl-commit"
    assert updated_task.completion_info == "implementation summary"
    assert updated_task.review_md == "https://host/org/repo/pulls/1"

    pr_msgs = [
        c
        for c in mock_broadcast.await_args_list
        if isinstance(c.args[0], WSMessage) and c.args[0].type == "PULL_REQUEST_UPDATED"
    ]
    assert len(pr_msgs) == 1


@pytest.mark.asyncio
async def test_on_pr_state_closed_documentation_pr_keeps_completed_task(
    init_mock_db,
):
    """Closing a DocBot PR only rejects the PR; a completed implementation task
    stays completed with its metadata."""
    pipeline = await _make_pipeline()
    task = Task(
        title="Implement feature",
        pipeline_id=str(pipeline.id),
        status=TaskStatus.IMPLEMENTED,
        commit_hash="impl-commit",
        completion_info="implementation summary",
        review_md="https://host/org/repo/pulls/1",
    )
    await task.insert()
    pr = PullRequest(
        pipeline_id=str(pipeline.id),
        task_id=str(task.id),
        summary="documentation summary",
        subject="DocBot: update docs",
        branch_name="docbot/t1/abc123",
        patch="patch",
        status=PullRequestStatus.SUBMITTED,
        base_branch="main",
        remote_pr_url="https://host/org/repo/pulls/2",
        kind=PullRequestKind.DOCUMENTATION,
    )
    await pr.insert()

    notifier = PrStateNotifier()
    event = PrStateEvent(
        repo_full_name="org/repo",
        branch="docbot/t1/abc123",
        state="closed",
        commit_hash=None,
        base_branch="main",
        pr_number=2,
        remote_pr_url="https://host/org/repo/pulls/2",
    )
    with (
        patch(
            "api.git_hosting.branch_notifier.git_utils.ensure_repo_fetched",
            new=AsyncMock(),
        ),
        patch(
            "api.git_hosting.branch_notifier.git_utils.get_repo",
            return_value=_mock_repo(),
        ),
        patch(
            "api.git_hosting.branch_notifier.ws_manager.broadcast",
            new=AsyncMock(),
        ),
        patch.object(PrStateNotifier, "pull_pipeline_repo", new=AsyncMock()),
    ):
        result = await notifier.on_pr_state(str(pipeline.id), event)

    assert result.status == "mirrored"
    assert result.affected_task_ids == []
    assert (await PullRequest.get(pr.id)).status == PullRequestStatus.REJECTED

    updated_task = await Task.get(task.id)
    assert updated_task.status == TaskStatus.IMPLEMENTED
    assert updated_task.commit_hash == "impl-commit"
    assert updated_task.completion_info == "implementation summary"
    assert updated_task.review_md == "https://host/org/repo/pulls/1"


@pytest.mark.asyncio
async def test_on_pr_state_merged_unreachable_commit(init_mock_db):
    pipeline = await _make_pipeline()
    await _make_pr_and_task(pipeline)

    mock_repo = MagicMock()
    mock_repo.active_branch.name = "main"
    mock_repo.head.commit.hexsha = "other-sha"
    mock_repo.remotes.origin.fetch.return_value = []
    mock_repo.git.merge_base.side_effect = git.exc.GitCommandError(
        "merge-base --is-ancestor", 1
    )

    notifier = PrStateNotifier()
    with (
        patch(
            "api.git_hosting.branch_notifier.git_utils.ensure_repo_fetched",
            new=AsyncMock(),
        ),
        patch(
            "api.git_hosting.branch_notifier.git_utils.get_repo",
            return_value=mock_repo,
        ),
        patch(
            "api.git_hosting.branch_notifier.git_utils.validate_commit_hash",
            return_value=True,
        ),
        patch(
            "api.git_hosting.branch_notifier.ws_manager.broadcast",
            new=AsyncMock(),
        ) as mock_broadcast,
    ):
        result = await notifier.on_pr_state(str(pipeline.id), _event())

    assert result.status == "commit_not_found"
    mock_broadcast.assert_not_awaited()


@pytest.mark.asyncio
async def test_on_pr_state_closed_rejects(init_mock_db):
    pipeline = await _make_pipeline()
    pr, task = await _make_pr_and_task(pipeline)

    mock_repo = MagicMock()
    mock_repo.active_branch.name = "main"
    mock_repo.head.commit.hexsha = "commit-sha"
    mock_repo.remotes.origin.fetch.return_value = []

    notifier = PrStateNotifier()
    with (
        patch(
            "api.git_hosting.branch_notifier.git_utils.ensure_repo_fetched",
            new=AsyncMock(),
        ),
        patch(
            "api.git_hosting.branch_notifier.git_utils.get_repo",
            return_value=mock_repo,
        ),
        patch(
            "api.git_hosting.branch_notifier.ws_manager.broadcast",
            new=AsyncMock(),
        ) as mock_broadcast,
    ):
        result = await notifier.on_pr_state(str(pipeline.id), _event(state="closed"))

    assert result.status == "mirrored"
    assert result.affected_task_ids == [str(task.id)]

    updated_pr = await PullRequest.get(pr.id)
    assert updated_pr.status == PullRequestStatus.REJECTED

    updated_task = await Task.get(task.id)
    assert updated_task.status == TaskStatus.CREATED
    transitions = [(t.from_status, t.to_status, t.by) for t in updated_task.history]
    assert (TaskStatus.SUBMITTED, TaskStatus.CREATED, "system") in transitions

    status_msgs = [
        c
        for c in mock_broadcast.await_args_list
        if isinstance(c.args[0], WSMessage) and c.args[0].type == "TASK_STATUS_UPDATED"
    ]
    assert len(status_msgs) == 1


@pytest.mark.asyncio
async def test_on_pr_state_skips_task_not_submitted(init_mock_db):
    pipeline = await _make_pipeline()
    pr, task = await _make_pr_and_task(pipeline)
    # Task already moved on (e.g. manually accepted) — must be skipped safely.
    task.status = TaskStatus.IMPLEMENTED
    await task.save()

    mock_repo = MagicMock()
    mock_repo.active_branch.name = "main"
    mock_repo.head.commit.hexsha = "commit-sha"
    mock_repo.remotes.origin.fetch.return_value = []

    notifier = PrStateNotifier()
    with (
        patch(
            "api.git_hosting.branch_notifier.git_utils.ensure_repo_fetched",
            new=AsyncMock(),
        ),
        patch(
            "api.git_hosting.branch_notifier.git_utils.get_repo",
            return_value=mock_repo,
        ),
        patch(
            "api.git_hosting.branch_notifier.git_utils.validate_commit_hash",
            return_value=True,
        ),
        patch(
            "api.git_hosting.branch_notifier.ws_manager.broadcast",
            new=AsyncMock(),
        ) as mock_broadcast,
    ):
        result = await notifier.on_pr_state(str(pipeline.id), _event())

    assert result.status == "mirrored"
    assert result.affected_task_ids == []
    mock_broadcast.assert_not_awaited()
    # PR stays SUBMITTED because its task is no longer SUBMITTED.
    assert (await PullRequest.get(pr.id)).status == PullRequestStatus.SUBMITTED


@pytest.mark.asyncio
async def test_on_pr_state_only_matching_base_branch_mirrors(init_mock_db):
    pipeline = await _make_pipeline()
    pr_main, task_main = await _make_pr_and_task(pipeline, base_branch="main")
    pr_dev, task_dev = await _make_pr_and_task(pipeline, base_branch="develop")

    mock_repo = MagicMock()
    mock_repo.active_branch.name = "main"
    mock_repo.head.commit.hexsha = "commit-sha"
    mock_repo.remotes.origin.fetch.return_value = []

    notifier = PrStateNotifier()
    with (
        patch(
            "api.git_hosting.branch_notifier.git_utils.ensure_repo_fetched",
            new=AsyncMock(),
        ),
        patch(
            "api.git_hosting.branch_notifier.git_utils.get_repo",
            return_value=mock_repo,
        ),
        patch(
            "api.git_hosting.branch_notifier.git_utils.validate_commit_hash",
            return_value=True,
        ),
        patch(
            "api.git_hosting.branch_notifier.ws_manager.broadcast",
            new=AsyncMock(),
        ),
    ):
        result = await notifier.on_pr_state(
            str(pipeline.id), _event(base_branch="main")
        )

    assert result.affected_task_ids == [str(task_main.id)]
    assert (await PullRequest.get(pr_main.id)).status == PullRequestStatus.ACCEPTED
    # The develop-based PR is untouched.
    assert (await PullRequest.get(pr_dev.id)).status == PullRequestStatus.SUBMITTED


async def _make_identity_pr(
    pipeline: Pipeline,
    *,
    remote_pr_url: str,
    base_branch: str = "main",
    kind: PullRequestKind = PullRequestKind.IMPLEMENTATION,
    task: Task | None = None,
) -> tuple[PullRequest, Task]:
    if task is None:
        task = Task(
            title=f"Task {remote_pr_url}",
            pipeline_id=str(pipeline.id),
            status=TaskStatus.SUBMITTED,
        )
        await task.insert()
    pr = PullRequest(
        pipeline_id=str(pipeline.id),
        task_id=str(task.id),
        summary="summary",
        subject="subject",
        branch_name=f"coderbot/{remote_pr_url.rsplit('/', 1)[-1]}",
        patch="patch",
        status=PullRequestStatus.SUBMITTED,
        base_branch=base_branch,
        remote_pr_url=remote_pr_url,
        kind=kind,
    )
    await pr.insert()
    return pr, task


@pytest.mark.asyncio
async def test_on_pr_state_merge_for_pr_a_does_not_touch_pr_b(init_mock_db):
    """Two submitted PRs share a base branch; identity selects exactly one."""
    pipeline = await _make_pipeline()
    pr_a, task_a = await _make_identity_pr(
        pipeline, remote_pr_url="https://host/org/repo/pulls/1"
    )
    pr_b, task_b = await _make_identity_pr(
        pipeline, remote_pr_url="https://host/org/repo/pulls/2"
    )

    event = PrStateEvent(
        repo_full_name="org/repo",
        branch="main",
        state="merged",
        commit_hash="merge-a",
        base_branch="main",
        pr_number=1,
        remote_pr_url="https://host/org/repo/pulls/1",
    )

    notifier = PrStateNotifier()
    with (
        patch(
            "api.git_hosting.branch_notifier.git_utils.ensure_repo_fetched",
            new=AsyncMock(),
        ),
        patch(
            "api.git_hosting.branch_notifier.git_utils.get_repo",
            return_value=_mock_repo("main", "merge-a"),
        ),
        patch(
            "api.git_hosting.branch_notifier.git_utils.validate_commit_hash",
            return_value=True,
        ),
        patch(
            "api.git_hosting.branch_notifier.ws_manager.broadcast",
            new=AsyncMock(),
        ),
        patch.object(PrStateNotifier, "pull_pipeline_repo", new=AsyncMock()),
    ):
        result = await notifier.on_pr_state(str(pipeline.id), event)

    assert result.affected_task_ids == [str(task_a.id)]
    assert (await PullRequest.get(pr_a.id)).status == PullRequestStatus.ACCEPTED
    assert (await PullRequest.get(pr_b.id)).status == PullRequestStatus.SUBMITTED

    updated_a = await Task.get(task_a.id)
    assert updated_a.status == TaskStatus.IMPLEMENTED
    assert updated_a.commit_hash == "merge-a"

    updated_b = await Task.get(task_b.id)
    assert updated_b.status == TaskStatus.SUBMITTED
    assert updated_b.commit_hash is None


@pytest.mark.asyncio
async def test_on_pr_state_pr_number_matches_local_remote_url(init_mock_db):
    """A poller event may carry only the number in addition to the URL."""
    pipeline = await _make_pipeline()
    pr_a, task_a = await _make_identity_pr(
        pipeline, remote_pr_url="https://host/org/repo/pulls/7"
    )
    pr_b, task_b = await _make_identity_pr(
        pipeline, remote_pr_url="https://host/org/repo/pulls/8"
    )

    event = PrStateEvent(
        repo_full_name="org/repo",
        branch="main",
        state="closed",
        commit_hash=None,
        base_branch="main",
        pr_number=7,
        remote_pr_url="https://host/org/repo/pulls/7",
    )

    notifier = PrStateNotifier()
    with (
        patch(
            "api.git_hosting.branch_notifier.git_utils.ensure_repo_fetched",
            new=AsyncMock(),
        ),
        patch(
            "api.git_hosting.branch_notifier.git_utils.get_repo",
            return_value=_mock_repo(),
        ),
        patch(
            "api.git_hosting.branch_notifier.ws_manager.broadcast",
            new=AsyncMock(),
        ),
        patch.object(PrStateNotifier, "pull_pipeline_repo", new=AsyncMock()),
    ):
        result = await notifier.on_pr_state(str(pipeline.id), event)

    assert result.affected_task_ids == [str(task_a.id)]
    assert (await PullRequest.get(pr_a.id)).status == PullRequestStatus.REJECTED
    assert (await PullRequest.get(pr_b.id)).status == PullRequestStatus.SUBMITTED
    assert (await Task.get(task_a.id)).status == TaskStatus.CREATED
    assert (await Task.get(task_b.id)).status == TaskStatus.SUBMITTED


@pytest.mark.asyncio
async def test_on_pr_state_ambiguous_push_reconciles_none(init_mock_db, caplog):
    """A push without identity cannot distinguish two same-base PRs."""
    pipeline = await _make_pipeline()
    pr_a, task_a = await _make_identity_pr(
        pipeline, remote_pr_url="https://host/org/repo/pulls/1"
    )
    pr_b, task_b = await _make_identity_pr(
        pipeline, remote_pr_url="https://host/org/repo/pulls/2"
    )

    notifier = PrStateNotifier()
    with (
        patch(
            "api.git_hosting.branch_notifier.git_utils.ensure_repo_fetched",
            new=AsyncMock(),
        ),
        patch(
            "api.git_hosting.branch_notifier.git_utils.get_repo",
            return_value=_mock_repo(),
        ),
        patch(
            "api.git_hosting.branch_notifier.git_utils.validate_commit_hash",
            return_value=True,
        ),
        patch(
            "api.git_hosting.branch_notifier.ws_manager.broadcast",
            new=AsyncMock(),
        ) as mock_broadcast,
        patch.object(PrStateNotifier, "pull_pipeline_repo", new=AsyncMock()),
    ):
        result = await notifier.on_pr_state(
            str(pipeline.id), _push_event("main", "push-sha")
        )

    assert result.affected_task_ids == []
    assert "Ambiguous PR state event" in caplog.text
    assert (await PullRequest.get(pr_a.id)).status == PullRequestStatus.SUBMITTED
    assert (await PullRequest.get(pr_b.id)).status == PullRequestStatus.SUBMITTED
    assert (await Task.get(task_a.id)).status == TaskStatus.SUBMITTED
    assert (await Task.get(task_b.id)).status == TaskStatus.SUBMITTED
    mock_broadcast.assert_not_awaited()


def _push_event(branch: str, commit_hash: str = "push-sha") -> PrStateEvent:
    """A Gitea ``push`` event: ``base_branch`` is the pushed branch."""
    return PrStateEvent(
        repo_full_name="org/repo",
        branch=branch,
        state="merged",
        commit_hash=commit_hash,
        base_branch=branch,
    )


def _mock_repo(branch: str = "main", head: str = "commit-sha") -> MagicMock:
    repo = MagicMock()
    repo.active_branch.name = branch
    repo.head.commit.hexsha = head
    return repo


@pytest.mark.asyncio
async def test_on_pr_state_feature_branch_push_busy_does_not_prompt(init_mock_db):
    """Our own feature-branch push (e.g. on PR acceptance) must not prompt.

    It targets ``coderbot/t1``, which matches no ``SUBMITTED`` PR (those carry
    ``base_branch = "main"``), so nothing is mirrored and the clone is left
    alone even though a session is active.
    """
    pipeline = await _make_pipeline()
    await _make_pr_and_task(pipeline, base_branch="main")
    await PiSession(
        uid="uid-1",
        kind=PiSessionKind.CODERBOT,
        status=PiSessionStatus.RUNNING,
        pipeline_id=str(pipeline.id),
    ).insert()

    notifier = PrStateNotifier()
    with (
        patch(
            "api.git_hosting.branch_notifier.git_utils.ensure_repo_fetched",
            new=AsyncMock(return_value=1),
        ),
        patch(
            "api.git_hosting.branch_notifier.git_utils.get_repo",
            return_value=_mock_repo("main", "feature-sha"),
        ),
        patch(
            "api.git_hosting.branch_notifier.git_utils.validate_commit_hash",
            return_value=True,
        ),
        patch(
            "api.git_hosting.branch_notifier.ws_manager.broadcast",
            new=AsyncMock(),
        ) as mock_broadcast,
        patch.object(
            PrStateNotifier, "pull_pipeline_repo", new=AsyncMock()
        ) as mock_pull,
        patch(
            "api.git_hosting.branch_notifier.notification_manager.notify_actions",
            new=AsyncMock(),
        ) as mock_notify,
    ):
        result = await notifier.on_pr_state(
            str(pipeline.id), _push_event("coderbot/t1")
        )

    assert result.status == "mirrored"
    assert result.affected_task_ids == []
    assert result.pull_deferred is False
    mock_broadcast.assert_not_awaited()
    mock_pull.assert_not_awaited()
    mock_notify.assert_not_awaited()


@pytest.mark.asyncio
async def test_on_pr_state_busy_no_match_does_not_pull_or_prompt(init_mock_db):
    """A busy pipeline is never pulled when an event mirrors nothing."""
    pipeline = await _make_pipeline()
    await _make_pr_and_task(pipeline, base_branch="main")
    await PiSession(
        uid="uid-1",
        kind=PiSessionKind.CODERBOT,
        status=PiSessionStatus.RUNNING,
        pipeline_id=str(pipeline.id),
    ).insert()

    notifier = PrStateNotifier()
    with (
        patch(
            "api.git_hosting.branch_notifier.git_utils.ensure_repo_fetched",
            new=AsyncMock(return_value=1),
        ),
        patch(
            "api.git_hosting.branch_notifier.git_utils.get_repo",
            return_value=_mock_repo(),
        ),
        patch(
            "api.git_hosting.branch_notifier.git_utils.validate_commit_hash",
            return_value=True,
        ),
        patch(
            "api.git_hosting.branch_notifier.ws_manager.broadcast",
            new=AsyncMock(),
        ),
        patch.object(
            PrStateNotifier, "pull_pipeline_repo", new=AsyncMock()
        ) as mock_pull,
        patch(
            "api.git_hosting.branch_notifier.notification_manager.notify_actions",
            new=AsyncMock(),
        ) as mock_notify,
    ):
        result = await notifier.on_pr_state(
            str(pipeline.id), _push_event("unrelated/branch")
        )

    assert result.affected_task_ids == []
    assert result.pull_deferred is False
    mock_pull.assert_not_awaited()
    mock_notify.assert_not_awaited()


@pytest.mark.asyncio
async def test_on_pr_state_direct_push_tracked_branch_busy_does_not_prompt(
    init_mock_db,
):
    """Decision: the gate is the DB mirror (``affected_task_ids``), so a direct
    push to the tracked branch that matches no local PR does not prompt."""
    pipeline = await _make_pipeline()
    await PiSession(
        uid="uid-1",
        kind=PiSessionKind.CODERBOT,
        status=PiSessionStatus.RUNNING,
        pipeline_id=str(pipeline.id),
    ).insert()

    notifier = PrStateNotifier()
    with (
        patch(
            "api.git_hosting.branch_notifier.git_utils.ensure_repo_fetched",
            new=AsyncMock(return_value=1),
        ),
        patch(
            "api.git_hosting.branch_notifier.git_utils.get_repo",
            return_value=_mock_repo(),
        ),
        patch(
            "api.git_hosting.branch_notifier.git_utils.validate_commit_hash",
            return_value=True,
        ),
        patch(
            "api.git_hosting.branch_notifier.ws_manager.broadcast",
            new=AsyncMock(),
        ),
        patch.object(
            PrStateNotifier, "pull_pipeline_repo", new=AsyncMock()
        ) as mock_pull,
        patch(
            "api.git_hosting.branch_notifier.notification_manager.notify_actions",
            new=AsyncMock(),
        ) as mock_notify,
    ):
        result = await notifier.on_pr_state(str(pipeline.id), _push_event("main"))

    assert result.affected_task_ids == []
    assert result.pull_deferred is False
    mock_pull.assert_not_awaited()
    mock_notify.assert_not_awaited()


@pytest.mark.asyncio
async def test_on_pr_state_feature_branch_push_idle_does_not_pull(init_mock_db):
    """An idle feature-branch push must not update the checkout either."""
    pipeline = await _make_pipeline()
    await _make_pr_and_task(pipeline, base_branch="main")

    notifier = PrStateNotifier()
    with (
        patch(
            "api.git_hosting.branch_notifier.git_utils.ensure_repo_fetched",
            new=AsyncMock(return_value=1),
        ),
        patch(
            "api.git_hosting.branch_notifier.git_utils.get_repo",
            return_value=_mock_repo("main", "feature-sha"),
        ),
        patch(
            "api.git_hosting.branch_notifier.git_utils.validate_commit_hash",
            return_value=True,
        ),
        patch(
            "api.git_hosting.branch_notifier.ws_manager.broadcast",
            new=AsyncMock(),
        ),
        patch.object(
            PrStateNotifier, "pull_pipeline_repo", new=AsyncMock()
        ) as mock_pull,
        patch(
            "api.git_hosting.branch_notifier.notification_manager.notify_actions",
            new=AsyncMock(),
        ) as mock_notify,
    ):
        result = await notifier.on_pr_state(
            str(pipeline.id), _push_event("coderbot/t1")
        )

    assert result.status == "mirrored"
    assert result.pull_deferred is False
    mock_pull.assert_not_awaited()
    mock_notify.assert_not_awaited()


@pytest.mark.asyncio
async def test_on_pr_state_second_event_of_merge_prompts_once(init_mock_db):
    """A merge delivers a ``push`` and a ``pull_request`` event; only the first
    finds a ``SUBMITTED`` PR and prompts, the second neither prompts nor pulls."""
    pipeline = await _make_pipeline()
    await _make_pr_and_task(pipeline, base_branch="main")
    await PiSession(
        uid="uid-1",
        kind=PiSessionKind.CODERBOT,
        status=PiSessionStatus.RUNNING,
        pipeline_id=str(pipeline.id),
    ).insert()

    notifier = PrStateNotifier()
    with (
        patch(
            "api.git_hosting.branch_notifier.git_utils.ensure_repo_fetched",
            new=AsyncMock(return_value=1),
        ),
        patch(
            "api.git_hosting.branch_notifier.git_utils.get_repo",
            return_value=_mock_repo(),
        ),
        patch(
            "api.git_hosting.branch_notifier.git_utils.validate_commit_hash",
            return_value=True,
        ),
        patch(
            "api.git_hosting.branch_notifier.ws_manager.broadcast",
            new=AsyncMock(),
        ),
        patch.object(
            PrStateNotifier, "pull_pipeline_repo", new=AsyncMock()
        ) as mock_pull,
        patch(
            "api.git_hosting.branch_notifier.notification_manager.notify_actions",
            new=AsyncMock(),
        ) as mock_notify,
    ):
        first = await notifier.on_pr_state(str(pipeline.id), _push_event("main"))
        second = await notifier.on_pr_state(
            str(pipeline.id), _event(base_branch="main")
        )

    assert first.pull_deferred is True
    assert first.affected_task_ids != []
    assert second.pull_deferred is False
    assert second.affected_task_ids == []
    mock_notify.assert_awaited_once()
    mock_pull.assert_not_awaited()


async def _make_pr(
    pipeline,
    *,
    branch_name,
    status=PullRequestStatus.OPEN,
    base_branch="main",
    pi_session_uid=None,
):
    task = Task(
        title=f"Task {branch_name}",
        pipeline_id=str(pipeline.id),
        status=TaskStatus.SUBMITTED,
    )
    await task.insert()
    pr = PullRequest(
        pipeline_id=str(pipeline.id),
        task_id=str(task.id),
        summary="summary",
        subject="subject",
        branch_name=branch_name,
        patch=f"patch {branch_name}",
        status=status,
        base_branch=base_branch,
        remote_pr_url="https://host/org/repo/pulls/1",
        pi_session_uid=pi_session_uid,
    )
    await pr.insert()
    return pr, task


def _add_worktree(pipeline, pr):
    wt = git_utils._pr_worktree_path(pipeline, pr)
    wt.parent.mkdir(parents=True, exist_ok=True)
    git_utils.get_repo(str(pipeline.workspace_abs_path)).git.worktree(
        "add", str(wt), pr.branch_name
    )
    return wt


def _local_branches(repo_path):
    return {b.name for b in git.Repo(str(repo_path)).branches}


@pytest.mark.asyncio
async def test_on_pr_state_remote_merge_releases_completion_artifacts(
    init_mock_db, tmp_path, fake_gitea
):
    pipeline = await _make_pipeline()
    repo = _make_repo(Path(pipeline.workspace_abs_path))
    _commit_file(repo, "coderbot/t1", "one.txt", "one\n")
    _git(repo, ["checkout", "main"])
    pr, _task = await _make_pr_and_task(pipeline)
    wt = _add_worktree(pipeline, pr)

    notifier = PrStateNotifier()
    with (
        patch.object(
            PrStateNotifier,
            "fetch_pipeline_repo",
            new=AsyncMock(return_value=SyncResult(status="synced")),
        ),
        patch.object(PrStateNotifier, "verify_commit_present", return_value=True),
        patch.object(PrStateNotifier, "pull_pipeline_repo", new=AsyncMock()),
        patch(
            "api.git_hosting.branch_notifier.ws_manager.broadcast",
            new=AsyncMock(),
        ),
    ):
        result = await notifier.on_pr_state(str(pipeline.id), _event())

    assert result.status == "mirrored"
    refreshed = await PullRequest.get(pr.id)
    assert refreshed.status == PullRequestStatus.ACCEPTED
    assert refreshed.patch is None
    assert "coderbot/t1" not in _local_branches(repo)
    assert not wt.exists()
    fake_gitea.delete_branch.assert_awaited_once_with(
        "org", "repo", "coderbot/t1", missing_ok=True
    )


@pytest.mark.asyncio
async def test_on_pr_state_remote_close_releases_completion_artifacts(
    init_mock_db, tmp_path, fake_gitea
):
    pipeline = await _make_pipeline()
    repo = _make_repo(Path(pipeline.workspace_abs_path))
    _commit_file(repo, "coderbot/t1", "one.txt", "one\n")
    _git(repo, ["checkout", "main"])
    pr, _task = await _make_pr_and_task(pipeline)
    wt = _add_worktree(pipeline, pr)

    notifier = PrStateNotifier()
    with (
        patch.object(
            PrStateNotifier,
            "fetch_pipeline_repo",
            new=AsyncMock(return_value=SyncResult(status="synced")),
        ),
        patch.object(PrStateNotifier, "pull_pipeline_repo", new=AsyncMock()),
        patch(
            "api.git_hosting.branch_notifier.ws_manager.broadcast",
            new=AsyncMock(),
        ),
    ):
        result = await notifier.on_pr_state(str(pipeline.id), _event(state="closed"))

    assert result.status == "mirrored"
    refreshed = await PullRequest.get(pr.id)
    assert refreshed.status == PullRequestStatus.REJECTED
    assert refreshed.patch is None
    assert "coderbot/t1" not in _local_branches(repo)
    assert not wt.exists()
    fake_gitea.delete_branch.assert_awaited_once_with(
        "org", "repo", "coderbot/t1", missing_ok=True
    )


@pytest.mark.asyncio
async def test_remote_branch_delete_uses_pipeline_credentials_and_tolerates_404(
    init_mock_db, tmp_path, fake_gitea
):
    pipeline = await _make_pipeline()
    repo = _make_repo(Path(pipeline.workspace_abs_path))
    _commit_file(repo, "coderbot/t1", "one.txt", "one\n")
    _git(repo, ["checkout", "main"])
    pr, _task = await _make_pr_and_task(pipeline)
    fake_gitea.delete_branch.side_effect = GiteaApiError("not found", 404)

    notifier = PrStateNotifier()
    with (
        patch("core.utils.git_utils.GiteaClient", return_value=fake_gitea) as ctor,
        patch.object(
            PrStateNotifier,
            "fetch_pipeline_repo",
            new=AsyncMock(return_value=SyncResult(status="synced")),
        ),
        patch.object(PrStateNotifier, "pull_pipeline_repo", new=AsyncMock()),
        patch(
            "api.git_hosting.branch_notifier.ws_manager.broadcast",
            new=AsyncMock(),
        ),
    ):
        result = await notifier.on_pr_state(str(pipeline.id), _event(state="closed"))

    ctor.assert_called_once_with("https://host", "tok")
    fake_gitea.delete_branch.assert_awaited_once_with(
        "org", "repo", "coderbot/t1", missing_ok=True
    )
    # A 404 (already deleted / Gitea's delete-after-merge) never fails the
    # webhook or blocks the rest of the cleanup.
    assert result.status == "mirrored"
    refreshed = await PullRequest.get(pr.id)
    assert refreshed.status == PullRequestStatus.REJECTED
    assert refreshed.patch is None
    assert "coderbot/t1" not in _local_branches(repo)


@pytest.mark.asyncio
async def test_cleanup_failure_does_not_change_result_or_block_broadcast(
    init_mock_db,
):
    pipeline = await _make_pipeline()
    pr, task = await _make_pr_and_task(pipeline)
    mock_broadcast = AsyncMock()

    notifier = PrStateNotifier()
    with (
        patch.object(
            PrStateNotifier,
            "fetch_pipeline_repo",
            new=AsyncMock(return_value=SyncResult(status="synced")),
        ),
        patch.object(PrStateNotifier, "pull_pipeline_repo", new=AsyncMock()),
        patch(
            "api.git_hosting.branch_notifier.ws_manager.broadcast",
            new=mock_broadcast,
        ),
        patch(
            "api.git_hosting.branch_notifier.git_utils.cleanup_completed_pull_request",
            new=AsyncMock(side_effect=RuntimeError("cleanup boom")),
        ),
        patch(
            "api.git_hosting.branch_notifier.git_utils.sweep_completed_pull_requests",
            new=AsyncMock(),
        ) as mock_sweep,
    ):
        result = await notifier.on_pr_state(str(pipeline.id), _event(state="closed"))

    assert result.status == "mirrored"
    assert result.affected_task_ids == [str(task.id)]
    assert (await PullRequest.get(pr.id)).status == PullRequestStatus.REJECTED
    assert (await Task.get(task.id)).status == TaskStatus.CREATED
    mock_broadcast.assert_awaited_once()
    mock_sweep.assert_awaited_once()
    assert mock_sweep.await_args.args[0].id == pipeline.id


@pytest.mark.asyncio
async def test_chain_tip_completion_sweeps_deferred_predecessor(
    init_mock_db, tmp_path, fake_gitea
):
    pipeline = await _make_pipeline()
    repo = _make_repo(Path(pipeline.workspace_abs_path))
    _commit_file(repo, "coderbot/t1", "one.txt", "one\n")
    _commit_file(repo, "coderbot/t2", "two.txt", "two\n")
    _git(repo, ["checkout", "main"])

    pr1, task1 = await _make_pr(
        pipeline,
        branch_name="coderbot/t1",
        status=PullRequestStatus.SUBMITTED,
        pi_session_uid="u1",
    )
    pr2, task2 = await _make_pr(
        pipeline,
        branch_name="coderbot/t2",
        status=PullRequestStatus.OPEN,
        pi_session_uid="u2",
    )
    await PiSession(
        uid="u1",
        kind=PiSessionKind.CODERBOT,
        status=PiSessionStatus.COMPLETED,
        pipeline_id=str(pipeline.id),
        task_id=str(task1.id),
        branch_name="coderbot/t1",
        pull_request_ids=[str(pr1.id)],
    ).insert()
    await PiSession(
        uid="u2",
        kind=PiSessionKind.CODERBOT,
        status=PiSessionStatus.COMPLETED,
        pipeline_id=str(pipeline.id),
        task_id=str(task2.id),
        branch_name="coderbot/t2",
        pull_request_ids=[str(pr2.id)],
        chained_from_session_uid="u1",
    ).insert()

    notifier = PrStateNotifier()
    with (
        patch.object(
            PrStateNotifier,
            "fetch_pipeline_repo",
            new=AsyncMock(return_value=SyncResult(status="synced")),
        ),
        patch.object(PrStateNotifier, "verify_commit_present", return_value=True),
        patch.object(PrStateNotifier, "pull_pipeline_repo", new=AsyncMock()),
        patch(
            "api.git_hosting.branch_notifier.ws_manager.broadcast",
            new=AsyncMock(),
        ),
    ):
        first = await notifier.on_pr_state(str(pipeline.id), _event())
        # The predecessor is terminal but its local branch/patch must survive
        # while the chained descendant is still pending.
        assert first.affected_task_ids == [str(task1.id)]
        assert "coderbot/t1" in _local_branches(repo)
        assert (await PullRequest.get(pr1.id)).patch is not None

        # The descendant becomes the chain tip and completes.
        pr2.status = PullRequestStatus.SUBMITTED
        await pr2.save()
        task2.status = TaskStatus.SUBMITTED
        await task2.save()
        second = await notifier.on_pr_state(str(pipeline.id), _event())

    assert second.affected_task_ids == [str(task2.id)]
    assert not [
        branch for branch in _local_branches(repo) if branch.startswith("coderbot/")
    ]
    assert (await PullRequest.get(pr1.id)).patch is None
    assert (await PullRequest.get(pr2.id)).patch is None
    assert [c.args[2] for c in fake_gitea.delete_branch.await_args_list] == [
        "coderbot/t1",
        "coderbot/t2",
    ]
