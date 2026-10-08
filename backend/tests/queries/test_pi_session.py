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
async def test_skips_sessions_without_open_pull_request(init_mock_db, tmp_path):
    ws = _make_workspace(tmp_path / "s1")
    for status in (
        PullRequestStatus.ACCEPTED,
        PullRequestStatus.REJECTED,
        PullRequestStatus.SUBMITTED,
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
    pr2 = await _insert_pr("p2")
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
        pi_session_queries.workspace_has_branch(str(tmp_path / "missing"), "b")
        is False
    )
