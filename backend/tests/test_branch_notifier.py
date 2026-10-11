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

from api.git_hosting.branch_events import PrStateEvent
from api.git_hosting.branch_notifier import PrStateNotifier
from api.websocket_manager import WSMessage
from core.models.models import (
    Pipeline,
    PiSession,
    PiSessionKind,
    PiSessionStatus,
    PullRequest,
    PullRequestStatus,
    Task,
    TaskStatus,
)


def _event(state="merged", base_branch="main", commit_hash="commit-sha"):
    return PrStateEvent(
        repo_full_name="org/repo",
        branch="main",
        state=state,
        commit_hash=commit_hash if state == "merged" else None,
        base_branch=base_branch,
    )


async def _make_pipeline() -> Pipeline:
    pipeline = Pipeline(
        name="myapp",
        repo_uri="https://host/org/repo.git",
        repo_username="user",
        repo_token="tok",
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
async def test_on_pr_state_busy_returns_busy(init_mock_db):
    pipeline = await _make_pipeline()
    await PiSession(
        uid="uid-1",
        kind=PiSessionKind.CODERBOT,
        status=PiSessionStatus.RUNNING,
        pipeline_id=str(pipeline.id),
    ).insert()

    notifier = PrStateNotifier()
    result = await notifier.on_pr_state(str(pipeline.id), _event())
    assert result.status == "busy"


@pytest.mark.asyncio
async def test_on_pr_state_sync_failure(init_mock_db):
    pipeline = await _make_pipeline()
    notifier = PrStateNotifier()
    with patch(
        "api.git_hosting.branch_notifier.git_utils.ensure_repo_cloned",
        new=AsyncMock(side_effect=RuntimeError("boom")),
    ):
        result = await notifier.on_pr_state(str(pipeline.id), _event())
    assert result.status == "sync_failed"


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
            "api.git_hosting.branch_notifier.git_utils.ensure_repo_cloned",
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
    assert result.commit_hash == "commit-sha"
    assert result.affected_task_ids == [str(task.id)]

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
            "api.git_hosting.branch_notifier.git_utils.ensure_repo_cloned",
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
            "api.git_hosting.branch_notifier.git_utils.ensure_repo_cloned",
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
        result = await notifier.on_pr_state(
            str(pipeline.id), _event(state="closed")
        )

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
            "api.git_hosting.branch_notifier.git_utils.ensure_repo_cloned",
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
            "api.git_hosting.branch_notifier.git_utils.ensure_repo_cloned",
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
