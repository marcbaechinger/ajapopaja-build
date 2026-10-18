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

"""Queries over durable :class:`PiSession` records.

This module currently hosts the predecessor lookup used by the CoderBot branch
chaining: when a new batch task starts it may branch off the retained workspace
of the most recent *still-pending* CoderBot task so its pull request only carries
its own delta instead of conflicting with its predecessor.
"""

import logging
from datetime import datetime
from typing import List, Optional

import git

from core.models.models import (
    PiSession,
    PiSessionKind,
    PiSessionStatus,
    PullRequest,
    PullRequestStatus,
)

logger = logging.getLogger(__name__)


def workspace_has_branch(
    workspace_path: Optional[str], branch_name: Optional[str]
) -> bool:
    """Whether ``workspace_path`` is a Git repo that contains ``branch_name``.

    A missing/blank path or branch, a non-repository directory or a repository
    where the branch no longer exists all return ``False`` so the caller falls
    back to the default branch.
    """
    if not workspace_path or not branch_name:
        return False
    try:
        repo = git.Repo(str(workspace_path))
        return branch_name in {branch.name for branch in repo.branches}
    except Exception:
        return False


async def _load_linked_pull_requests(record: PiSession) -> List[PullRequest]:
    """Load the pull requests referenced by ``record.pull_request_ids``.

    Unresolvable ids are skipped rather than failing the lookup, so a dangling
    reference does not break chaining.
    """
    result: List[PullRequest] = []
    for pr_id in record.pull_request_ids or []:
        if not pr_id:
            continue
        try:
            pr = await PullRequest.get(pr_id)
        except Exception:
            pr = None
        if pr is not None:
            result.append(pr)
    return result


async def _is_initial_batch_run(record: PiSession) -> bool:
    """Whether ``record`` created its own pull request (vs. iterated on one).

    PR-iteration sessions are not a new step in the task chain: they re-apply an
    existing PR patch on a fresh base and must therefore never be used as a
    chaining predecessor. Such a record is created *after* the pull request it
    iterates on, so a linked PR whose ``created_at`` predates the session marks
    it as an iteration.
    """
    prs = await _load_linked_pull_requests(record)
    session_created = record.created_at
    for pr in prs:
        pr_created = pr.created_at
        if (
            session_created is not None
            and pr_created is not None
            and pr_created < session_created
        ):
            return False
    return True


async def _has_open_pull_request(record: PiSession) -> bool:
    """Whether at least one pull request linked to ``record`` is still pending.

    Both ``OPEN`` and ``SUBMITTED`` count as pending: a ``SUBMITTED`` PR is a
    Gitea pull request awaiting external review and is still a valid chaining
    predecessor (its work is not yet merged or rejected).
    """
    for pr in await _load_linked_pull_requests(record):
        if pr.status in (PullRequestStatus.OPEN, PullRequestStatus.SUBMITTED):
            return True
    return False


async def find_previous_pending_batch_session(
    pipeline_id: str,
    before_created_at: Optional[datetime] = None,
) -> Optional[PiSession]:
    """Return the newest eligible chaining predecessor for ``pipeline_id``.

    A predecessor is eligible when it is a completed, non-interactive CoderBot
    batch run that created its own (still open) pull request, and its retained
    workspace still exists and contains its branch. Ordering is by
    ``created_at`` (matching FIFO queue order); when ``before_created_at`` is
    given only sessions created strictly before it are considered. Returns
    ``None`` when no eligible predecessor remains, in which case the caller
    branches from the default branch.
    """
    conditions = [
        PiSession.pipeline_id == pipeline_id,
        PiSession.kind == PiSessionKind.CODERBOT,
        PiSession.status == PiSessionStatus.COMPLETED,
    ]
    if before_created_at is not None:
        conditions.append(PiSession.created_at < before_created_at)

    try:
        candidates = await PiSession.find(*conditions).sort("-created_at").to_list()
    except Exception:
        logger.debug(
            "Failed to query pending predecessor sessions for pipeline %s",
            pipeline_id,
            exc_info=True,
        )
        return None

    for record in candidates:
        if not await _is_initial_batch_run(record):
            continue
        if not workspace_has_branch(record.workspace_path, record.branch_name):
            continue
        if not await _has_open_pull_request(record):
            continue
        return record
    return None


async def find_chained_predecessor_branch(
    session_uid: Optional[str],
) -> Optional[str]:
    """Return the predecessor branch a chained session's PR was based on.

    ``session_uid`` is the uid of the CoderBot session that produced a pull
    request. When that session chained from an earlier run, the returned value is
    the predecessor's branch name. Accepting a chained pull request can then
    stack its feature branch on the predecessor's accepted branch instead of the
    clean default branch: the chained PR's patch is a delta relative to the
    predecessor's commit and does not apply to the default branch on its own.

    Returns ``None`` for non-chained sessions and when the predecessor cannot be
    resolved (missing uid, missing record, query failure).
    """
    if not session_uid:
        return None
    try:
        session = await PiSession.find_one(PiSession.uid == session_uid)
    except Exception:
        logger.debug(
            "Failed to load session %s for chained base resolution",
            session_uid,
            exc_info=True,
        )
        return None
    if session is None or not session.chained_from_session_uid:
        return None
    try:
        predecessor = await PiSession.find_one(
            PiSession.uid == session.chained_from_session_uid
        )
    except Exception:
        logger.debug(
            "Failed to load predecessor %s for session %s",
            session.chained_from_session_uid,
            session_uid,
            exc_info=True,
        )
        return None
    return predecessor.branch_name if predecessor else None


async def has_pending_chained_descendant(session_uid: str, *, pipeline_id: str) -> bool:
    """Whether ``session_uid`` still has a pending descendant in its chain.

    Descendants are found transitively via
    :attr:`PiSession.chained_from_session_uid`. A descendant is pending while
    its session is ``STARTING``/``RUNNING``/``PAUSED`` (still producing its PR)
    or while it owns an ``OPEN``/``SUBMITTED`` pull request.

    Completion cleanup uses this to defer releasing a predecessor's local
    feature branch and patch: a descendant's accept starts from that branch and
    its patch fallback replays the predecessor patches. The remote Gitea branch
    has no such dependency and is deleted at the PR's own completion.

    The walk is capped defensively and guards against cycles. Any DB error is
    treated as "no pending descendant" (logged at debug level) so cleanup
    degrades to cleaning rather than blocking forever.
    """
    if not session_uid:
        return False

    pending_session_statuses = {
        PiSessionStatus.STARTING,
        PiSessionStatus.RUNNING,
        PiSessionStatus.PAUSED,
    }
    pending_pr_statuses = {PullRequestStatus.OPEN, PullRequestStatus.SUBMITTED}
    max_depth = 100
    max_nodes = 1000

    try:
        frontier = [session_uid]
        seen = {session_uid}
        visited = 0
        depth = 0

        while frontier and depth < max_depth and visited < max_nodes:
            next_frontier: List[str] = []
            for uid in frontier:
                children = await PiSession.find(
                    PiSession.chained_from_session_uid == uid,
                    PiSession.pipeline_id == pipeline_id,
                ).to_list()
                for child in children:
                    if not child.uid or child.uid in seen:
                        continue
                    seen.add(child.uid)
                    visited += 1
                    next_frontier.append(child.uid)

                    if child.status in pending_session_statuses:
                        return True
                    for pr in await _load_linked_pull_requests(child):
                        if pr.status in pending_pr_statuses:
                            return True
            frontier = next_frontier
            depth += 1
    except Exception:
        logger.debug(
            "Failed to inspect chained descendants of session %s in pipeline %s",
            session_uid,
            pipeline_id,
            exc_info=True,
        )
        return False

    return False
