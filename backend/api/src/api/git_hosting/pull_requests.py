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

"""Shared helpers for opening remote (Gitea) pull requests for a pipeline.

Both the batch ``accept_pull_request`` route and the MCP ``create_pull_request``
tool need to push a branch and open a Gitea pull request with the pipeline's
credentials. Keeping that sequence in one place avoids duplicating the
credential resolution and the Gitea client lifecycle.
"""

import logging
from urllib.parse import urlsplit

import git

from api.git_hosting.gitea import GiteaClient, GitHubClient
from core import config
from core.models.models import Pipeline
from core.utils import git_utils

logger = logging.getLogger(__name__)


def _is_github_host(repo_uri: str) -> bool:
    """Return True when the ``repo_uri`` points at github.com."""
    base_url, _, _ = git_utils.resolve_gitea_repo(repo_uri)
    host = (urlsplit(base_url).hostname or "").lower()
    return host in ("github.com", "www.github.com")


async def create_pipeline_pull_request(
    pipeline: Pipeline,
    repo: git.Repo,
    *,
    head: str,
    base: str,
    title: str,
    body: str = "",
) -> str:
    """Push ``head`` to the pipeline's remote and open a Gitea pull request.

    The Gitea credential never leaves the server: it is resolved exactly like
    the git push credentials (``pipeline.repo_token`` first, then the global
    ``GIT_PUSH_TOKEN``). The ``head`` branch must already exist locally.

    Args:
        pipeline: The pipeline whose repository receives the pull request.
        repo: The local clone to push from.
        head: The feature branch to push and use as the PR head.
        base: The target branch for the pull request.
        title: The pull request title.
        body: The pull request description (Markdown).

    Returns:
        The Gitea pull request web URL.

    Raises:
        ValueError: When the pipeline has no remote ``repo_uri``.
        GiteaApiError: When the Gitea REST API rejects the request.
    """
    if not pipeline.repo_uri:
        raise ValueError("Cannot create a pull request for a local pipeline.")

    git_utils.push_branch_with_auth(repo, pipeline, head)

    base_url, owner, repo_name = git_utils.resolve_gitea_repo(pipeline.repo_uri)
    token = pipeline.repo_token or config.GIT_PUSH_TOKEN
    if _is_github_host(pipeline.repo_uri):
        client: GiteaClient = GitHubClient(token)
    else:
        client = GiteaClient(base_url, token)
    try:
        return await client.create_pull_request(
            owner,
            repo_name,
            head=head,
            base=base,
            title=title,
            body=body,
        )
    finally:
        await client.aclose()


async def ensure_pr_state_webhook_best_effort(pipeline: Pipeline) -> None:
    """Register the PR-state webhook for a remote pipeline (best effort).

    The webhook reports Gitea ``push``/``pull_request`` events back to the
    ``/api/git_hosting/pipelines/{pipeline_id}/pr-state`` endpoint so a remote
    merge/reject can be reconciled onto local state. Registration is skipped
    when the pipeline is local or the public URL / webhook secret are not
    configured, and any failure is logged without failing pipeline creation.
    """
    if not pipeline.repo_uri or not config.AJAPOPAJA_PUBLIC_URL:
        return
    if not config.GITEA_WEBHOOK_SECRET:
        logger.warning(
            "Skipping PR-state webhook registration for pipeline %s: "
            "GITEA_WEBHOOK_SECRET is not configured",
            pipeline.id,
        )
        return
    try:
        base_url, owner, repo_name = git_utils.resolve_gitea_repo(pipeline.repo_uri)
        token = pipeline.repo_token or config.GIT_PUSH_TOKEN
        client = GiteaClient(base_url, token)
        try:
            await client.ensure_pr_state_webhook(
                owner,
                repo_name,
                pipeline_id=str(pipeline.id),
                public_base_url=config.AJAPOPAJA_PUBLIC_URL,
                secret=config.GITEA_WEBHOOK_SECRET,
            )
        finally:
            await client.aclose()
    except Exception:
        logger.warning(
            "Failed to register PR-state webhook for pipeline %s",
            pipeline.id,
            exc_info=True,
        )
