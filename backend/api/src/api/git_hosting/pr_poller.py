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

from api.git_hosting.branch_events import PrStateEvent
from api.git_hosting.branch_notifier import PrStateNotifier
from api.git_hosting.gitea import GiteaClient
from core import config
from core.models.models import Pipeline, PullRequest, PullRequestStatus
from core.utils import git_utils

logger = logging.getLogger(__name__)


def pr_index_from_url(remote_pr_url: str | None) -> int | None:
    """Extract the Gitea pull-request number from its web URL.

    ``remote_pr_url`` is ``{base}/{owner}/{repo}/pulls/{number}``; the trailing
    path segment is the PR index. Returns ``None`` when it cannot be parsed.
    """
    if not remote_pr_url:
        return None
    try:
        return int(remote_pr_url.rstrip("/").rsplit("/", 1)[-1])
    except (ValueError, IndexError):
        return None


async def reconcile_submitted_pull_requests(notifier: PrStateNotifier) -> int:
    """Reconcile every ``SUBMITTED`` PR's remote state; return the count polled.

    Pull requests are grouped by pipeline and read with that pipeline's Gitea
    credentials. A closed remote PR is mapped to ``merged``/``closed`` and fed
    to the notifier (which re-syncs the clone and verifies before mirroring).
    """
    prs = await PullRequest.find(
        PullRequest.status == PullRequestStatus.SUBMITTED
    ).to_list()

    polled = 0
    by_pipeline: dict[str, list[PullRequest]] = {}
    for pr in prs:
        by_pipeline.setdefault(pr.pipeline_id, []).append(pr)

    for pipeline_id, pipeline_prs in by_pipeline.items():
        pipeline = await Pipeline.get(pipeline_id)
        if pipeline is None or not pipeline.repo_uri:
            continue

        try:
            base_url, owner, repo = git_utils.resolve_gitea_repo(pipeline.repo_uri)
        except Exception:
            logger.debug(
                "Cannot resolve Gitea repo for pipeline %s", pipeline_id,
                exc_info=True,
            )
            continue

        token = pipeline.repo_token or config.GIT_PUSH_TOKEN
        client = GiteaClient(base_url, token)
        try:
            for pr in pipeline_prs:
                index = pr_index_from_url(pr.remote_pr_url)
                if index is None:
                    continue
                data = await client.get_pull_request(owner, repo, index)
                if not isinstance(data, dict) or data.get("state") != "closed":
                    continue
                base = data.get("base") if isinstance(data.get("base"), dict) else {}
                base_branch = base.get("ref") or pr.base_branch
                event = PrStateEvent(
                    repo_full_name=f"{owner}/{repo}",
                    branch=base_branch or pr.base_branch or "",
                    state="merged" if data.get("merged") else "closed",
                    commit_hash=data.get("merge_commit_sha"),
                    base_branch=base_branch,
                )
                await notifier.on_pr_state(pipeline_id, event)
                polled += 1
        finally:
            await client.aclose()

    return polled


class PrStatePoller:
    """Background task that runs :func:`reconcile_submitted_pull_requests`."""

    def __init__(self, interval: float | None = None) -> None:
        self.interval = interval if interval is not None else config.GITEA_PR_POLL_INTERVAL
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
