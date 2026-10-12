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
