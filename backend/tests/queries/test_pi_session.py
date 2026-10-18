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

from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import patch

import git
import pytest

from core.models.models import (
    PiSession,
    PiSessionKind,
    PiSessionStatus,
    PullRequest,
    PullRequestStatus,
)
from core.queries import pi_session as pi_session_queries
from core.utils import git_utils


def _make_workspace(path: Path, branch: str = "coderbot/t1") -> Path:
    """Create a real Git repo at ``path`` containing ``branch``."""
    path.mkdir(parents=True, exist_ok=True)
    repo = git.Repo.init(str(path))
    (path / "file.txt").write_text("hello\n", encoding="utf-8")
    repo.git.add(A=True)
    repo.git.commit(
        "-m",
        "initial",
        "--no-verify",
        env=git_utils.ensure_git_identity(repo),
    )
    repo.create_head(branch)
    return path


async def _insert_pr(
    pipeline_id: str,
    *,
    status: PullRequestStatus = PullRequestStatus.OPEN,
    created_at: datetime | None = None,
) -> PullRequest:
    pr = PullRequest(
        pipeline_id=pipeline_id,
        task_id="t1",
        subject="subject",
        summary="summary",
        branch_name="coderbot/t1",
        patch="diff --git a/a b/a\n+change\n",
        status=status,
        created_at=created_at or datetime.now(UTC),
    )
    await pr.insert()
    return pr


async def _insert_session(
    pipeline_id: str,
    *,
    uid: str,
    workspace_path: str | None,
    branch_name: str | None = "coderbot/t1",
    status: PiSessionStatus = PiSessionStatus.COMPLETED,
    kind: PiSessionKind = PiSessionKind.CODERBOT,
    pull_request_ids: list[str] | None = None,
    created_at: datetime | None = None,
) -> PiSession:
    record = PiSession(
        uid=uid,
        kind=kind,
        status=status,
        pipeline_id=pipeline_id,
        task_id="t1",
        workspace_path=workspace_path,
        branch_name=branch_name,
        pull_request_ids=pull_request_ids or [],
        created_at=created_at or datetime.now(UTC),
    )
    await record.insert()
    return record


@pytest.mark.asyncio
async def test_returns_newest_eligible_predecessor(init_mock_db, tmp_path):
    base = datetime(2026, 1, 1, tzinfo=UTC)
    ws1 = _make_workspace(tmp_path / "s1")
    ws2 = _make_workspace(tmp_path / "s2")

    pr1 = await _insert_pr("p1", created_at=base + timedelta(seconds=1))
    pr2 = await _insert_pr("p1", created_at=base + timedelta(seconds=3))

    await _insert_session(
        "p1",
        uid="u1",
        workspace_path=str(ws1),
        pull_request_ids=[str(pr1.id)],
        created_at=base,
    )
    newer = await _insert_session(
        "p1",
        uid="u2",
        workspace_path=str(ws2),
        pull_request_ids=[str(pr2.id)],
        created_at=base + timedelta(seconds=2),
    )

    found = await pi_session_queries.find_previous_pending_batch_session("p1")
    assert found is not None
    assert found.uid == newer.uid


@pytest.mark.asyncio
async def test_skips_non_completed_sessions(init_mock_db, tmp_path):
    ws = _make_workspace(tmp_path / "s1")
    pr = await _insert_pr("p1")
    await _insert_session(
        "p1",
        uid="u-running",
        workspace_path=str(ws),
        status=PiSessionStatus.RUNNING,
        pull_request_ids=[str(pr.id)],
    )

    found = await pi_session_queries.find_previous_pending_batch_session("p1")
    assert found is None


@pytest.mark.asyncio
async def test_skips_sessions_without_pending_pull_request(init_mock_db, tmp_path):
    ws = _make_workspace(tmp_path / "s1")
    for status in (
        PullRequestStatus.ACCEPTED,
        PullRequestStatus.REJECTED,
    ):
        pr = await _insert_pr("p1", status=status)
        await _insert_session(
            "p1",
            uid=f"u-{status.value}",
            workspace_path=str(ws),
            pull_request_ids=[str(pr.id)],
        )

    found = await pi_session_queries.find_previous_pending_batch_session("p1")
    assert found is None


@pytest.mark.asyncio
async def test_submitted_pull_request_is_pending(init_mock_db, tmp_path):
    """A SUBMITTED PR (awaiting external Gitea review) is a valid chaining
    predecessor, not a completed/closed one."""
    ws = _make_workspace(tmp_path / "s1")
    base = datetime(2026, 1, 1, tzinfo=UTC)
    pr = await _insert_pr(
        "p1", status=PullRequestStatus.SUBMITTED, created_at=base + timedelta(seconds=1)
    )
    await _insert_session(
        "p1",
        uid="u-submitted",
        workspace_path=str(ws),
        pull_request_ids=[str(pr.id)],
        created_at=base,
    )

    found = await pi_session_queries.find_previous_pending_batch_session("p1")
    assert found is not None
    assert found.uid == "u-submitted"


@pytest.mark.asyncio
async def test_skips_sessions_without_pull_request(init_mock_db, tmp_path):
    ws = _make_workspace(tmp_path / "s1")
    await _insert_session("p1", uid="u-no-pr", workspace_path=str(ws))

    found = await pi_session_queries.find_previous_pending_batch_session("p1")
    assert found is None


@pytest.mark.asyncio
async def test_skips_missing_or_invalid_workspace(init_mock_db, tmp_path):
    pr = await _insert_pr("p1")

    # Missing path.
    await _insert_session(
        "p1",
        uid="u-missing",
        workspace_path=str(tmp_path / "does-not-exist"),
        pull_request_ids=[str(pr.id)],
    )
    # Not a Git repository.
    not_a_repo = tmp_path / "plain"
    not_a_repo.mkdir()
    await _insert_session(
        "p1",
        uid="u-plain",
        workspace_path=str(not_a_repo),
        pull_request_ids=[str(pr.id)],
    )
    # Valid repo but the branch was swept away.
    ws = _make_workspace(tmp_path / "s1", branch="coderbot/other")
    await _insert_session(
        "p1",
        uid="u-no-branch",
        workspace_path=str(ws),
        pull_request_ids=[str(pr.id)],
    )

    found = await pi_session_queries.find_previous_pending_batch_session("p1")
    assert found is None


@pytest.mark.asyncio
async def test_skips_pr_iteration_sessions(init_mock_db, tmp_path):
    """A PR-iteration session is created after the PR it iterates on."""
    ws = _make_workspace(tmp_path / "s1")
    base = datetime(2026, 1, 1, tzinfo=UTC)
    # The PR already existed (created first) ...
    pr = await _insert_pr("p1", created_at=base)
    # ... then the iteration session was created (later).
    await _insert_session(
        "p1",
        uid="u-iteration",
        workspace_path=str(ws),
        pull_request_ids=[str(pr.id)],
        created_at=base + timedelta(minutes=5),
    )

    found = await pi_session_queries.find_previous_pending_batch_session("p1")
    assert found is None


@pytest.mark.asyncio
async def test_excludes_interactive_and_scopes_by_pipeline(init_mock_db, tmp_path):
    ws = _make_workspace(tmp_path / "s1")
    # An interactive session in p1 is never a batch predecessor.
    pr1 = await _insert_pr("p1")
    await _insert_session(
        "p1",
        uid="u-interactive",
        workspace_path=str(ws),
        kind=PiSessionKind.INTERACTIVE,
        pull_request_ids=[str(pr1.id)],
    )
    assert await pi_session_queries.find_previous_pending_batch_session("p1") is None

    # A valid batch session in p2 is not returned for p1.
    # The PR must post-date the session so it is recognised as an initial run
    # rather than a PR-iteration run (see `_is_initial_batch_run`).
    pr2 = await _insert_pr("p2", created_at=datetime.now(UTC) + timedelta(seconds=1))
    await _insert_session(
        "p2",
        uid="u-batch",
        workspace_path=str(ws),
        pull_request_ids=[str(pr2.id)],
    )
    assert await pi_session_queries.find_previous_pending_batch_session("p1") is None
    found = await pi_session_queries.find_previous_pending_batch_session("p2")
    assert found is not None
    assert found.uid == "u-batch"


@pytest.mark.asyncio
async def test_respects_before_created_at(init_mock_db, tmp_path):
    ws = _make_workspace(tmp_path / "s1")
    base = datetime(2026, 1, 1, tzinfo=UTC)
    pr = await _insert_pr("p1", created_at=base + timedelta(seconds=1))
    await _insert_session(
        "p1",
        uid="u1",
        workspace_path=str(ws),
        pull_request_ids=[str(pr.id)],
        created_at=base,
    )

    # A successor created at the same time as (or before) the predecessor sees
    # nothing.
    found = await pi_session_queries.find_previous_pending_batch_session(
        "p1", before_created_at=base
    )
    assert found is None

    found = await pi_session_queries.find_previous_pending_batch_session(
        "p1", before_created_at=base + timedelta(minutes=1)
    )
    assert found is not None
    assert found.uid == "u1"


@pytest.mark.asyncio
async def test_returns_none_when_no_sessions(init_mock_db):
    assert await pi_session_queries.find_previous_pending_batch_session("p1") is None


def test_workspace_has_branch_handles_blank_inputs(tmp_path):
    assert pi_session_queries.workspace_has_branch(None, "b") is False
    assert pi_session_queries.workspace_has_branch(str(tmp_path), None) is False
    assert (
        pi_session_queries.workspace_has_branch(str(tmp_path / "missing"), "b") is False
    )


@pytest.mark.asyncio
async def test_find_chained_predecessor_branch(init_mock_db):
    """A chained session resolves to its predecessor's branch name."""
    await _insert_session(
        "p1", uid="u1", workspace_path=None, branch_name="coderbot/t1"
    )
    chained = await _insert_session(
        "p1", uid="u2", workspace_path=None, branch_name="coderbot/t2"
    )
    chained.chained_from_session_uid = "u1"
    await chained.save()

    found = await pi_session_queries.find_chained_predecessor_branch("u2")
    assert found == "coderbot/t1"


@pytest.mark.asyncio
async def test_find_chained_predecessor_branch_returns_none(init_mock_db):
    """Non-chained, unknown and blank session uids return None."""
    await _insert_session(
        "p1", uid="u1", workspace_path=None, branch_name="coderbot/t1"
    )

    assert await pi_session_queries.find_chained_predecessor_branch(None) is None
    assert await pi_session_queries.find_chained_predecessor_branch("missing") is None
    assert await pi_session_queries.find_chained_predecessor_branch("u1") is None


@pytest.mark.asyncio
async def test_find_chained_predecessor_branch_missing_predecessor(init_mock_db):
    """A dangling chained_from reference does not raise."""
    chained = await _insert_session(
        "p1", uid="u2", workspace_path=None, branch_name="coderbot/t2"
    )
    chained.chained_from_session_uid = "does-not-exist"
    await chained.save()

    assert await pi_session_queries.find_chained_predecessor_branch("u2") is None


async def _set_chained_from(uid: str, predecessor_uid: str) -> None:
    record = await PiSession.find_one(PiSession.uid == uid)
    record.chained_from_session_uid = predecessor_uid
    await record.save()


@pytest.mark.asyncio
async def test_has_pending_chained_descendant_detects_active_session(init_mock_db):
    await _insert_session("p1", uid="u1", workspace_path=None)
    await _insert_session(
        "p1",
        uid="u2",
        workspace_path=None,
        status=PiSessionStatus.RUNNING,
    )
    await _set_chained_from("u2", "u1")

    assert (
        await pi_session_queries.has_pending_chained_descendant("u1", pipeline_id="p1")
        is True
    )


@pytest.mark.asyncio
async def test_has_pending_chained_descendant_detects_open_pr(init_mock_db):
    await _insert_session("p1", uid="u1", workspace_path=None)
    pr = await _insert_pr("p1", status=PullRequestStatus.OPEN)
    await _insert_session(
        "p1",
        uid="u2",
        workspace_path=None,
        pull_request_ids=[str(pr.id)],
    )
    await _set_chained_from("u2", "u1")

    assert (
        await pi_session_queries.has_pending_chained_descendant("u1", pipeline_id="p1")
        is True
    )


@pytest.mark.asyncio
async def test_has_pending_chained_descendant_transitive_and_terminal(init_mock_db):
    await _insert_session("p1", uid="u1", workspace_path=None)
    await _insert_session("p1", uid="u2", workspace_path=None)
    await _insert_session("p1", uid="u3", workspace_path=None)
    await _set_chained_from("u2", "u1")
    await _set_chained_from("u3", "u2")
    terminal = await _insert_pr("p1", status=PullRequestStatus.ACCEPTED)
    await _insert_session(
        "p1",
        uid="u4",
        workspace_path=None,
        pull_request_ids=[str(terminal.id)],
    )
    await _set_chained_from("u4", "u3")

    # u4 is completed and owns only a terminal PR, so no pending descendant.
    assert (
        await pi_session_queries.has_pending_chained_descendant("u1", pipeline_id="p1")
        is False
    )

    u3 = await PiSession.find_one(PiSession.uid == "u3")
    u3.status = PiSessionStatus.PAUSED
    await u3.save()
    assert (
        await pi_session_queries.has_pending_chained_descendant("u1", pipeline_id="p1")
        is True
    )


@pytest.mark.asyncio
async def test_has_pending_chained_descendant_handles_cycles_and_errors(init_mock_db):
    await _insert_session("p1", uid="u1", workspace_path=None)
    await _insert_session("p1", uid="u2", workspace_path=None)
    await _set_chained_from("u1", "u2")
    await _set_chained_from("u2", "u1")

    assert (
        await pi_session_queries.has_pending_chained_descendant("u1", pipeline_id="p1")
        is False
    )

    with patch.object(PiSession, "find", side_effect=RuntimeError("db down")):
        assert (
            await pi_session_queries.has_pending_chained_descendant(
                "u1", pipeline_id="p1"
            )
            is False
        )
