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
    """Whether at least one pull request linked to ``record`` is still OPEN."""
    for pr in await _load_linked_pull_requests(record):
        if pr.status == PullRequestStatus.OPEN:
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
