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

:class:`PrStateNotifier.on_pr_state` always mirrors the remote state onto the
local pull requests and tasks (and broadcasts it), fetching remote-tracking
refs first so a reported ``merged`` commit can be verified. Only the
working-tree ``git pull`` is gated: it runs while the pipeline is idle, and
only when the event actually reconciled local state (a merge/reject matched a
``SUBMITTED`` PR). While a coding session is active the DB mirror still
applies and a one-click "Pull now" notification is offered instead of
touching the checkout. Events that mirror nothing (e.g. the feature-branch
push Ajapopaja itself creates when a PR is accepted) never prompt or pull.
"""

import logging
from dataclasses import dataclass, field
from typing import List, Optional

import git
from beanie.operators import In

from api.git_hosting.branch_events import PrStateEvent
from api.websocket_manager import WSMessage, manager as ws_manager
from core.models.models import (
    NotificationAction,
    PiSession,
    PiSessionStatus,
    Pipeline,
    PullRequest,
    PullRequestKind,
    PullRequestStatus,
    Task,
    TaskStatus,
)
from core.queries import task as task_queries
from core.services.notification_manager import notification_manager
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
    #: ``True`` when the DB mirror applied but the working-tree ``git pull`` was
    #: skipped because a session is active (a "Pull now" notification offers it).
    pull_deferred: bool = False


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

        Used to decide whether the working-tree ``git pull`` may run; the DB
        mirror and the safe remote fetch are not gated on a session being
        idle. A session is active when it is ``STARTING``/``RUNNING``/
        ``PAUSED``.
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
                "Failed to query active sessions for pipeline %s",
                pipeline_id,
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

    async def fetch_pipeline_repo(self, pipeline: Pipeline) -> SyncResult:
        """Clone-if-needed and fetch remote-tracking refs only.

        Never touches the working tree or the checked-out branch, so it is safe
        to run while a Pi/CoderBot session is active. Returns ``not_remote`` for
        local pipelines, ``failed`` when the fetch could not complete and
        ``synced`` otherwise.
        """
        if not pipeline.repo_uri:
            return SyncResult(status="not_remote")
        if not pipeline.workspace_abs_path:
            return SyncResult(status="failed", error="no workspace path")
        try:
            fetched_refs = await git_utils.ensure_repo_fetched(pipeline)
            return SyncResult(status="synced", fetched_refs=fetched_refs)
        except Exception as e:
            logger.warning(
                "Failed to fetch pipeline %s repo: %s",
                pipeline.id,
                e,
                exc_info=True,
            )
            return SyncResult(status="failed", error=str(e))

    async def pull_pipeline_repo(self, pipeline: Pipeline) -> SyncResult:
        """Fast-forward the checked-out branch to ``origin/<branch>``.

        This is the only working-tree-mutating step and must be skipped while a
        session is active. Kept ``--ff-only`` (unlike the user-initiated
        :func:`core.utils.git_utils.pull`, which is a plain ``git pull`` with a
        reset fallback) so a deferred pull can never force-move the branch.
        Returns ``not_remote``/``failed``/``synced``.
        """
        if not pipeline.repo_uri:
            return SyncResult(status="not_remote")
        workspace = pipeline.workspace_abs_path
        if not workspace:
            return SyncResult(status="failed", error="no workspace path")
        try:
            repo = git_utils.get_repo(str(workspace))
            try:
                branch = repo.active_branch.name
            except (TypeError, ValueError, git.exc.GitCommandError):
                branch = None

            before = repo.head.commit.hexsha if branch else None
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
            )
        except Exception as e:
            logger.warning(
                "Failed to pull pipeline %s repo: %s",
                pipeline.id,
                e,
                exc_info=True,
            )
            return SyncResult(status="failed", error=str(e))

    async def _notify_pull_deferred(self, pipeline: Pipeline) -> None:
        """Offer a one-click "Pull now" for a deferred working-tree update.

        Uses a stable notification id per pipeline so a re-delivered event does
        not stack duplicate prompts. Best-effort: a notification failure must
        never undo the DB mirror that already applied.
        """
        try:
            await notification_manager.notify_actions(
                "Gitea PR state updated",
                "A coding session is running, so the local clone was not updated.",
                actions=[
                    NotificationAction(
                        name="pull_remote",
                        label="Pull now",
                        data={"pipeline_id": str(pipeline.id)},
                        style="primary",
                    )
                ],
                id=f"pull_remote:{pipeline.id}",
            )
        except Exception:
            logger.warning(
                "Failed to send pull-deferred notification for pipeline %s",
                pipeline.id,
                exc_info=True,
            )

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
            repo.git.merge_base("--is-ancestor", event.commit_hash, f"origin/{branch}")
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

    def _event_target_branch(self, event: PrStateEvent) -> Optional[str]:
        """Branch an event reconciled to (the PR base, or the pushed branch).

        A pull only makes sense when this is the clone's checked-out branch: a
        push to a feature branch must never disturb the checkout of the default
        branch.
        """
        return event.base_branch or event.branch

    def _event_targets_tracked_branch(
        self, pipeline: Pipeline, event: PrStateEvent
    ) -> bool:
        """Whether an event concerns the clone's checked-out (tracked) branch.

        Read-only and best-effort: it never fetches or mutates the repository.
        When the branch cannot be determined it returns ``True`` so the
        historical pull behaviour is preserved rather than skipping a pull that
        might be needed.
        """
        target = self._event_target_branch(event)
        if not target:
            return True
        workspace = pipeline.workspace_abs_path
        if not workspace:
            return True
        try:
            repo = git_utils.get_repo(str(workspace))
        except Exception:
            return True
        try:
            branch = repo.active_branch.name
        except (TypeError, ValueError, git.exc.GitCommandError):
            try:
                branch = git_utils.current_default_branch(repo)
            except Exception:
                return True
        if not isinstance(branch, str):
            # A mocked/undetermined branch: keep the pre-existing behaviour.
            return True
        return target == branch

    async def on_pr_state(self, pipeline_id: str, event: PrStateEvent) -> NotifyResult:
        """Fetch, verify, mirror and (when idle and reconciled) pull.

        The DB mirror and broadcast always run, even while a session is active.
        The working-tree ``git pull`` only runs when idle, when the event
        actually reconciled local state (``affected_task_ids`` is non-empty)
        and when it targets the clone's checked-out branch. While a session is
        active a reconciled event instead defers the pull with a "Pull now"
        notification. Busy pipelines are therefore never reported back as
        ``busy`` by this method.
        """
        pipeline = await self.get_pipeline(pipeline_id)
        if pipeline is None:
            return NotifyResult(status="not_found", pipeline_id=pipeline_id)

        if not self._repo_matches(pipeline, event):
            return NotifyResult(
                status="ignored", branch=event.branch, pipeline_id=pipeline_id
            )

        busy = await self.pipeline_busy(pipeline_id)

        fetch = await self.fetch_pipeline_repo(pipeline)
        if not fetch.ok and not busy:
            # Idle sync failure keeps the historical ``sync_failed`` outcome.
            return NotifyResult(
                status="sync_failed", branch=event.branch, pipeline_id=pipeline_id
            )

        if event.state == "merged" and fetch.ok:
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
                # The merge commit belongs to the pull request. Only an
                # implementation PR may overwrite the task's implementation
                # commit; a documentation PR must leave the task's original
                # commit/summary/review metadata intact.
                pr.status = PullRequestStatus.ACCEPTED
                pr.commit_hash = event.commit_hash
                if pr.kind == PullRequestKind.IMPLEMENTATION:
                    task.commit_hash = event.commit_hash
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

            # Release the PR's artefacts only after the mirror and broadcast:
            # a cleanup failure must never undo or delay them. The helper is
            # best-effort and keeps a predecessor's local branch/patch while a
            # chained descendant is still pending (the sweep below releases it
            # once the chain tip completes).
            try:
                await git_utils.cleanup_completed_pull_request(pipeline, pr)
            except Exception:
                logger.warning(
                    "Failed to clean up completed PR %s in pipeline %s",
                    pr.id,
                    pipeline_id,
                    exc_info=True,
                )

        # Because of ordered chaining a just-completed chain tip can leave its
        # terminal ancestors deferred; release that completed prefix in one
        # pass. Log-only: the webhook response and NotifyResult are unchanged.
        if affected_task_ids:
            try:
                await git_utils.sweep_completed_pull_requests(pipeline)
            except Exception:
                logger.warning(
                    "Failed to sweep completed PRs for pipeline %s",
                    pipeline_id,
                    exc_info=True,
                )

        # The DB mirror is applied; the working-tree update is gated both on a
        # session being idle and on an event that actually reconciled local
        # state. A feature-branch push (e.g. the one Ajapopaja itself creates
        # when a PR is accepted) matches no local PR, mirrors nothing and must
        # therefore neither prompt nor pull.
        pull_deferred = busy and bool(pipeline.repo_uri) and bool(affected_task_ids)
        if pull_deferred:
            await self._notify_pull_deferred(pipeline)
        elif not busy and self._event_targets_tracked_branch(pipeline, event):
            await self.pull_pipeline_repo(pipeline)

        return NotifyResult(
            status="mirrored",
            branch=event.branch,
            commit_hash=event.commit_hash,
            pipeline_id=pipeline_id,
            affected_task_ids=affected_task_ids,
            pull_deferred=pull_deferred,
        )
