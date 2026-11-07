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

"""Optional polling reconciler for remote Gitea PR state.

Webhooks are the primary mechanism for observing remote merges/rejects, but they
cannot always reach Ajapopaja (e.g. firewalled deployments). When enabled via
``GITEA_PR_POLL_ENABLED`` this reconciler periodically reads every ``SUBMITTED``
pull request's remote state with ``GiteaClient.get_pull_request`` and feeds the
same :class:`PrStateNotifier.on_pr_state` used by the webhook receiver.
"""

import asyncio
import logging

from api.git_hosting.branch_events import PrStateEvent, pr_index_from_url
from api.git_hosting.branch_notifier import PrStateNotifier
from api.git_hosting.gitea import GiteaClient
from core import config
from core.models.models import Pipeline, PullRequest, PullRequestStatus, Task
from core.utils import git_utils

logger = logging.getLogger(__name__)


# Pipelines with an in-flight reconciliation. The guard is shared by the
# background poller and the on-demand endpoint so a user-triggered sync and a
# poll iteration can never fetch/reset the same clone concurrently.
_active_syncs: set[str] = set()
_active_syncs_lock = asyncio.Lock()


async def _try_acquire_pipeline_sync(pipeline_id: str) -> bool:
    """Atomically claim the per-pipeline sync slot, or return ``False``."""
    async with _active_syncs_lock:
        if pipeline_id in _active_syncs:
            return False
        _active_syncs.add(pipeline_id)
        return True


async def _release_pipeline_sync(pipeline_id: str) -> None:
    """Release a slot previously claimed by :func:`_try_acquire_pipeline_sync`."""
    async with _active_syncs_lock:
        _active_syncs.discard(pipeline_id)


def _remote_state(data: dict) -> str:
    """Map a Gitea ``get_pull_request`` body to ``merged``/``closed``/``open``."""
    if data.get("state") != "closed":
        return "open"
    return "merged" if data.get("merged") else "closed"


async def reconcile_pipeline_pull_requests(
    notifier: PrStateNotifier, pipeline_id: str
) -> dict:
    """Reconcile one pipeline's ``SUBMITTED`` PRs against Gitea.

    This is the single reconciliation path used by both the periodic poller
    (:func:`reconcile_submitted_pull_requests`) and the on-demand
    ``POST /api/pipelines/{id}/pull_requests/sync`` endpoint. It reads each
    submitted PR's remote state with the pipeline's Gitea credentials and feeds
    a closed remote state to the shared :class:`PrStateNotifier` (which syncs
    the clone, verifies the commit and mirrors the state).

    Returns a JSON-serialisable summary::

        {"status": "ok"|"busy"|"sync_failed"|"already_running"|"not_found",
         "up_to_date": bool,
         "reconciled": [{"pr_id", "gitea_pr", "remote_state", "outcome",
                         "task_id", "task_status"}, ...]}

    Only ``SUBMITTED`` PRs are acted on, so the call is idempotent; a pipeline
    whose PRs are all current returns ``up_to_date: true``. A second concurrent
    sync for the same pipeline is rejected with ``already_running`` and a sync
    attempted while a Pi/CoderBot session is active returns ``busy`` without
    touching the clone.
    """
    try:
        pipeline = await Pipeline.get(pipeline_id)
    except Exception:
        # An id that is not a valid ObjectId is simply "not found".
        return {"status": "not_found", "up_to_date": False, "reconciled": []}
    if pipeline is None:
        return {"status": "not_found", "up_to_date": False, "reconciled": []}
    # Local pipelines have no remote state to reconcile: nothing to do.
    if not pipeline.repo_uri:
        return {"status": "ok", "up_to_date": True, "reconciled": []}

    if not await _try_acquire_pipeline_sync(pipeline_id):
        return {
            "status": "already_running",
            "up_to_date": False,
            "reconciled": [],
        }

    try:
        # Never fetch/reset the clone while a session may hold uncommitted work.
        if await notifier.pipeline_busy(pipeline_id):
            return {"status": "busy", "up_to_date": False, "reconciled": []}

        try:
            base_url, owner, repo = git_utils.resolve_gitea_repo(pipeline.repo_uri)
        except Exception:
            logger.debug(
                "Cannot resolve Gitea repo for pipeline %s",
                pipeline_id,
                exc_info=True,
            )
            return {
                "status": "sync_failed",
                "up_to_date": False,
                "reconciled": [],
            }

        prs = await PullRequest.find(
            PullRequest.pipeline_id == pipeline_id,
            PullRequest.status == PullRequestStatus.SUBMITTED,
        ).to_list()
        if not prs:
            return {"status": "ok", "up_to_date": True, "reconciled": []}

        # Read every submitted PR's remote state first so a Gitea outage is
        # reported as ``sync_failed`` without half-applying anything.
        token = pipeline.repo_token or config.GIT_PUSH_TOKEN
        client = GiteaClient(base_url, token)
        remote: dict[str, tuple[int, dict]] = {}
        sync_failed = False
        try:
            for pr in prs:
                index = pr_index_from_url(pr.remote_pr_url)
                if index is None:
                    continue
                try:
                    data = await client.get_pull_request(owner, repo, index)
                except Exception:
                    logger.warning(
                        "Failed to read Gitea PR %s for pipeline %s",
                        index,
                        pipeline_id,
                        exc_info=True,
                    )
                    sync_failed = True
                    continue
                if isinstance(data, dict):
                    remote[str(pr.id)] = (index, data)
        finally:
            await client.aclose()

        # Feed each closed remote PR through the shared notifier. Identical
        # events (same base branch/state/commit) are coalesced so the clone is
        # not fetched once per PR.
        seen_events: set[tuple] = set()
        for pr in prs:
            entry = remote.get(str(pr.id))
            if entry is None:
                continue
            _index, data = entry
            if data.get("state") != "closed":
                continue
            base = data.get("base") if isinstance(data.get("base"), dict) else {}
            base_branch = base.get("ref") or pr.base_branch
            event = PrStateEvent(
                repo_full_name=f"{owner}/{repo}",
                branch=base_branch or pr.base_branch or "",
                state="merged" if data.get("merged") else "closed",
                commit_hash=data.get("merge_commit_sha"),
                base_branch=base_branch,
                pr_number=index,
                remote_pr_url=pr.remote_pr_url,
            )
            event_key = (
                event.remote_pr_url,
                event.pr_number,
                event.base_branch,
                event.state,
                event.commit_hash,
            )
            if event_key in seen_events:
                continue
            seen_events.add(event_key)
            result = await notifier.on_pr_state(pipeline_id, event)
            if result.status == "busy":
                return {"status": "busy", "up_to_date": False, "reconciled": []}
            # A sync that could not verify the merged commit did not mirror the
            # remote state; surface it as a failure rather than "up to date".
            if result.status in ("sync_failed", "commit_not_found"):
                sync_failed = True

        # Build the summary from the local state the notifier just produced.
        reconciled = []
        for pr in prs:
            entry = remote.get(str(pr.id))
            if entry is None:
                continue
            index, data = entry
            if data.get("state") != "closed":
                continue
            current = await PullRequest.get(pr.id)
            if current is None or current.status == PullRequestStatus.SUBMITTED:
                continue
            task = await Task.get(current.task_id)
            outcome = (
                "accepted"
                if current.status == PullRequestStatus.ACCEPTED
                else "rejected"
            )
            reconciled.append(
                {
                    "pr_id": str(current.id),
                    "gitea_pr": index,
                    "remote_state": _remote_state(data),
                    "outcome": outcome,
                    "task_id": current.task_id,
                    "task_status": task.status.value if task is not None else None,
                }
            )

        return {
            "status": "sync_failed" if sync_failed else "ok",
            "up_to_date": len(reconciled) == 0,
            "reconciled": reconciled,
        }
    finally:
        await _release_pipeline_sync(pipeline_id)


async def reconcile_submitted_pull_requests(notifier: PrStateNotifier) -> int:
    """Reconcile every ``SUBMITTED`` PR's remote state; return the count changed.

    Pull requests are grouped by pipeline and each pipeline is reconciled
    through :func:`reconcile_pipeline_pull_requests` so the poller and the
    on-demand endpoint share exactly one code path (and one per-pipeline
    concurrency guard).
    """
    prs = await PullRequest.find(
        PullRequest.status == PullRequestStatus.SUBMITTED
    ).to_list()

    pipeline_ids = sorted({pr.pipeline_id for pr in prs})
    reconciled = 0
    for pipeline_id in pipeline_ids:
        try:
            result = await reconcile_pipeline_pull_requests(notifier, pipeline_id)
        except Exception:
            logger.warning(
                "PR-state poll for pipeline %s failed", pipeline_id, exc_info=True
            )
            continue
        reconciled += len(result.get("reconciled", []))

    return reconciled


class PrStatePoller:
    """Background task that runs :func:`reconcile_submitted_pull_requests`."""

    def __init__(self, interval: float | None = None) -> None:
        self.interval = (
            interval if interval is not None else config.GITEA_PR_POLL_INTERVAL
        )
        self._task: asyncio.Task | None = None

    async def _loop(self) -> None:
        notifier = PrStateNotifier()
        while True:
            try:
                await reconcile_submitted_pull_requests(notifier)
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.warning("PR-state poll iteration failed", exc_info=True)
            await asyncio.sleep(self.interval)

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._loop())
            logger.info("Gitea PR-state poller started (interval %ss)", self.interval)

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
