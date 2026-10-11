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

"""Reconcile remote Gitea PR/branch state onto local ``PullRequest``/``Task``.

The primary effect of :class:`PrStateNotifier.on_pr_state` is synchronising the
pipeline's git clone with the remote the event came from and verifying any
reported commit is present and reachable. Only when that succeeds is the remote
state mirrored onto the local pull requests and tasks, so a remote reject can
flip the local state and stop the chain.
"""

import logging
from dataclasses import dataclass, field
from typing import List, Optional

import git
from beanie.operators import In

from api.git_hosting.branch_events import PrStateEvent
from api.websocket_manager import WSMessage, manager as ws_manager
from core.models.models import (
    PiSession,
    PiSessionStatus,
    Pipeline,
    PullRequest,
    PullRequestStatus,
    Task,
    TaskStatus,
)
from core.queries import task as task_queries
from core.utils import git_utils

logger = logging.getLogger(__name__)


@dataclass
class SyncResult:
    """Outcome of synchronising a pipeline clone with its remote."""

    status: str  # "synced" | "not_remote" | "failed"
    branch: Optional[str] = None
    synced_branch_head: Optional[str] = None
    advanced_branch: bool = False
    fetched_refs: int = 0
    error: Optional[str] = None

    @property
    def ok(self) -> bool:
        return self.status in ("synced", "not_remote")


@dataclass
class NotifyResult:
    """Outcome of reconciling a remote PR/branch event."""

    status: str
    branch: Optional[str] = None
    commit_hash: Optional[str] = None
    pipeline_id: Optional[str] = None
    affected_task_ids: List[str] = field(default_factory=list)


class PrStateNotifier:
    """Mirror remote Gitea PR state (merged/closed) onto local PRs and tasks."""

    async def get_pipeline(self, pipeline_id: str) -> Optional[Pipeline]:
        """Resolve a pipeline by primary key, returning ``None`` when absent."""
        try:
            return await Pipeline.get(pipeline_id)
        except Exception:
            return None

    async def pipeline_busy(self, pipeline_id: str) -> bool:
        """Whether any Pi/CoderBot session is currently active for the pipeline.

        Refuses reconciliation while a session is ``STARTING``/``RUNNING``/
        ``PAUSED`` so the fetch/reset fallback never clobbers uncommitted work.
        """
        try:
            count = await PiSession.find(
                PiSession.pipeline_id == pipeline_id,
                In(
                    PiSession.status,
                    [
                        PiSessionStatus.STARTING,
                        PiSessionStatus.RUNNING,
                        PiSessionStatus.PAUSED,
                    ],
                ),
            ).count()
            return count > 0
        except Exception:
            logger.warning(
                "Failed to query active sessions for pipeline %s", pipeline_id,
                exc_info=True,
            )
            return False

    def _repo_matches(self, pipeline: Pipeline, event: PrStateEvent) -> bool:
        """Defence-in-depth: the event's repo must match the pipeline's repo."""
        if not event.repo_full_name or not pipeline.repo_uri:
            # Cannot verify; treat as matching rather than dropping the event.
            return True
        try:
            _, owner, repo = git_utils.resolve_gitea_repo(pipeline.repo_uri)
        except Exception:
            return True
        return event.repo_full_name == f"{owner}/{repo}"

    async def sync_pipeline_repo(self, pipeline: Pipeline) -> SyncResult:
        """Clone/fetch/ff the pipeline's clone with its remote.

        Returns ``not_remote`` for local pipelines (no ``repo_uri``), ``failed``
        when the sync could not complete, and ``synced`` otherwise (carrying the
        checked-out branch head so callers never claim an arbitrary pushed
        branch's ref advanced).
        """
        if not pipeline.repo_uri:
            return SyncResult(status="not_remote")
        workspace = pipeline.workspace_abs_path
        if not workspace:
            return SyncResult(status="failed", error="no workspace path")
        try:
            await git_utils.ensure_repo_cloned(pipeline)
            repo = git_utils.get_repo(str(workspace))

            try:
                branch = repo.active_branch.name
            except (TypeError, ValueError, git.exc.GitCommandError):
                branch = None

            before = repo.head.commit.hexsha if branch else None
            fetch_infos = repo.remotes.origin.fetch()
            fetched_refs = len(fetch_infos)

            advanced_branch = False
            synced_branch_head = None
            if branch:
                repo.git.pull("--ff-only", "origin", branch)
                synced_branch_head = repo.head.commit.hexsha
                advanced_branch = before != synced_branch_head

            return SyncResult(
                status="synced",
                branch=branch,
                synced_branch_head=synced_branch_head,
                advanced_branch=advanced_branch,
                fetched_refs=fetched_refs,
            )
        except Exception as e:
            logger.warning(
                "Failed to sync pipeline %s repo: %s", pipeline.id, e, exc_info=True
            )
            return SyncResult(status="failed", error=str(e))

    def verify_commit_present(self, repo: git.Repo, event: PrStateEvent) -> bool:
        """Verify a reported ``merged`` commit exists and is reachable.

        A ``closed`` event carries no commit and trivially passes. For ``merged``
        the commit must exist in the fetched object store and be an ancestor of
        ``origin/<branch>``; otherwise the event cannot be trusted.
        """
        if event.state != "merged" or not event.commit_hash:
            return True
        if not git_utils.validate_commit_hash(repo, event.commit_hash):
            return False
        branch = event.base_branch or event.branch
        if not branch:
            return True
        try:
            repo.git.merge_base(
                "--is-ancestor", event.commit_hash, f"origin/{branch}"
            )
            return True
        except git.exc.GitCommandError:
            return False

    def _matching_prs(
        self, prs: List[PullRequest], event: PrStateEvent
    ) -> List[PullRequest]:
        """Select ``SUBMITTED`` PRs whose base branch matches the event's."""
        target = event.base_branch or event.branch
        if not target:
            return list(prs)
        return [pr for pr in prs if pr.base_branch == target]

    async def on_pr_state(
        self, pipeline_id: str, event: PrStateEvent
    ) -> NotifyResult:
        """Sync the pipeline clone, verify, then mirror the remote state.

        Mirrors ``merged`` onto ``ACCEPTED``/``IMPLEMENTED`` and ``closed`` onto
        ``REJECTED``/``CREATED`` for every matching, still-``SUBMITTED`` pull
        request, broadcasting a WebSocket message per affected task.
        """
        pipeline = await self.get_pipeline(pipeline_id)
        if pipeline is None:
            return NotifyResult(status="not_found", pipeline_id=pipeline_id)

        if not self._repo_matches(pipeline, event):
            return NotifyResult(
                status="ignored", branch=event.branch, pipeline_id=pipeline_id
            )

        if await self.pipeline_busy(pipeline_id):
            return NotifyResult(
                status="busy", branch=event.branch, pipeline_id=pipeline_id
            )

        sync = await self.sync_pipeline_repo(pipeline)
        if not sync.ok:
            return NotifyResult(
                status="sync_failed", branch=event.branch, pipeline_id=pipeline_id
            )

        if event.state == "merged":
            workspace = pipeline.workspace_abs_path
            if not workspace:
                return NotifyResult(
                    status="sync_failed",
                    branch=event.branch,
                    pipeline_id=pipeline_id,
                )
            repo = git_utils.get_repo(str(workspace))
            if not self.verify_commit_present(repo, event):
                return NotifyResult(
                    status="commit_not_found",
                    branch=event.branch,
                    commit_hash=event.commit_hash,
                    pipeline_id=pipeline_id,
                )

        prs = await PullRequest.find(
            PullRequest.pipeline_id == pipeline_id,
            PullRequest.status == PullRequestStatus.SUBMITTED,
        ).to_list()
        matching = self._matching_prs(prs, event)

        affected_task_ids: List[str] = []
        for pr in matching:
            if pr.status != PullRequestStatus.SUBMITTED:
                continue
            task = await Task.get(pr.task_id)
            if task is None or task.status != TaskStatus.SUBMITTED:
                continue

            if event.state == "merged":
                task.commit_hash = event.commit_hash
                pr.status = PullRequestStatus.ACCEPTED
                await pr.save()
                await task_queries.transition_task(
                    str(task.id), TaskStatus.IMPLEMENTED, actor="system", task=task
                )
            else:  # "closed" remote reject
                pr.status = PullRequestStatus.REJECTED
                await pr.save()
                await task_queries.transition_task(
                    str(task.id), TaskStatus.CREATED, actor="system", task=task
                )

            await ws_manager.broadcast(
                WSMessage(
                    type="TASK_STATUS_UPDATED",
                    payload=task.model_dump(mode="json"),
                )
            )
            affected_task_ids.append(str(task.id))

        return NotifyResult(
            status="mirrored",
            branch=event.branch,
            commit_hash=event.commit_hash,
            pipeline_id=pipeline_id,
            affected_task_ids=affected_task_ids,
        )
