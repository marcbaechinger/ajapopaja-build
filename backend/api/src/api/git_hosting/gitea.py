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

import logging
from urllib.parse import quote

import httpx

logger = logging.getLogger(__name__)


class GiteaApiError(Exception):
    """Raised when the Gitea REST API returns a non-2xx response."""

    def __init__(self, message: str, status_code: int, detail: str = "") -> None:
        super().__init__(message)
        self.status_code = status_code
        self.detail = detail


class GiteaClient:
    """Async client for the Gitea REST API.

    Provides support for reading and writing issues and pull requests. The Gitea
    REST API mirrors the GitHub REST API closely enough that this client can also
    be used against GitHub-compatible hosts.
    """

    def __init__(
        self,
        base_url: str,
        token: str,
        *,
        api_prefix: str = "/api/v1",
        auth_scheme: str = "token",
        web_base_url: str | None = None,
        accept: str = "application/json",
        pr_url_segment: str = "pulls",
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.api_prefix = api_prefix
        self.auth_scheme = auth_scheme
        self.web_base_url = (web_base_url or base_url).rstrip("/")
        self.accept = accept
        self.pr_url_segment = pr_url_segment
        self._client = httpx.AsyncClient()

    def _auth_headers(self) -> dict:
        """Return the authorization headers using an access token."""
        headers = {"Accept": self.accept}
        if self.token:
            headers["Authorization"] = f"{self.auth_scheme} {self.token}"
        return headers

    async def _request(self, method: str, path: str, **kwargs) -> httpx.Response:
        url = f"{self.base_url}{self.api_prefix}{path}"
        try:
            response = await self._client.request(
                method, url, headers=self._auth_headers(), **kwargs
            )
        except httpx.HTTPError as e:
            logger.error(f"Gitea request failed for {url}: {e}", exc_info=True)
            raise GiteaApiError(
                f"Gitea API request failed: {e}",
                status_code=0,
                detail=str(e),
            )
        if response.status_code >= 300:
            logger.error(
                f"Gitea API returned {response.status_code} for {url}: {response.text}"
            )
            raise GiteaApiError(
                f"Gitea API error: {response.status_code}",
                status_code=response.status_code,
                detail=response.text,
            )
        return response

    async def create_pull_request(
        self,
        owner: str,
        repo: str,
        *,
        head: str,
        base: str,
        title: str,
        body: str = "",
    ) -> str:
        """POST /api/v1/repos/{owner}/{repo}/pulls -> returns the PR HTML URL."""
        payload = {
            "head": head,
            "base": base,
            "title": title,
            "body": body,
        }
        response = await self._request(
            "POST",
            f"/repos/{owner}/{repo}/pulls",
            json=payload,
        )
        data = response.json()
        # Gitea returns both html_url and number; prefer html_url when present.
        html_url = (data or {}).get("html_url")
        if html_url:
            return html_url
        number = (data or {}).get("number")
        if number is None:
            raise GiteaApiError(
                "Gitea API response did not include a PR url or number",
                status_code=response.status_code,
                detail=response.text,
            )
        return f"{self.web_base_url}/{owner}/{repo}/{self.pr_url_segment}/{number}"

    async def _get_json(self, path: str, params: dict | None = None) -> list | dict:
        """Perform a GET request and return the parsed JSON body."""
        response = await self._request("GET", path, params=params or {})
        return response.json()

    async def list_issues(
        self,
        owner: str,
        repo: str,
        *,
        state: str = "open",
        type: str = "issues",
        assignee: str | None = None,
        labels: str | None = None,
        page: int = 1,
        per_page: int = 20,
    ) -> list:
        """GET /repos/{owner}/{repo}/issues -> list of issues (or PRs).

        Args:
            state: One of 'open', 'closed', or 'all'.
            type: One of 'issues', 'pulls', or 'all'.
            assignee: Restrict to issues assigned to this username.
            labels: Comma-separated list of labels to filter by.
            page: Page number to return.
            per_page: Number of items per page (max 100).
        """
        params: dict = {
            "state": state,
            "type": type,
            "page": page,
            "limit": per_page,
        }
        if assignee:
            params["assigned"] = assignee
        if labels:
            params["labels"] = labels
        return await self._get_json(f"/repos/{owner}/{repo}/issues", params=params)

    async def get_issue(self, owner: str, repo: str, index: int) -> dict:
        """GET /repos/{owner}/{repo}/issues/{index} -> single issue or PR."""
        return await self._get_json(f"/repos/{owner}/{repo}/issues/{index}")

    async def list_issue_comments(self, owner: str, repo: str, index: int) -> list:
        """GET /repos/{owner}/{repo}/issues/{index}/comments -> issue comments."""
        return await self._get_json(f"/repos/{owner}/{repo}/issues/{index}/comments")

    async def create_issue_comment(
        self, owner: str, repo: str, index: int, body: str
    ) -> dict:
        """POST /repos/{owner}/{repo}/issues/{index}/comments -> the created comment."""
        response = await self._request(
            "POST",
            f"/repos/{owner}/{repo}/issues/{index}/comments",
            json={"body": body},
        )
        return response.json()

    async def close_issue(self, owner: str, repo: str, index: int) -> dict:
        """PATCH /repos/{owner}/{repo}/issues/{index} -> the closed issue."""
        response = await self._request(
            "PATCH",
            f"/repos/{owner}/{repo}/issues/{index}",
            json={"state": "closed"},
        )
        return response.json()

    async def create_issue(
        self,
        owner: str,
        repo: str,
        *,
        title: str,
        body: str = "",
        assignees: list[str] | None = None,
    ) -> dict:
        """POST /repos/{owner}/{repo}/issues -> the created issue."""
        payload: dict = {"title": title, "body": body}
        if assignees:
            payload["assignees"] = assignees
        response = await self._request(
            "POST", f"/repos/{owner}/{repo}/issues", json=payload
        )
        return response.json()

    async def list_pull_requests(
        self,
        owner: str,
        repo: str,
        *,
        state: str = "open",
        page: int = 1,
        per_page: int = 20,
    ) -> list:
        """GET /repos/{owner}/{repo}/pulls -> list of pull requests."""
        return await self._get_json(
            f"/repos/{owner}/{repo}/pulls",
            params={"state": state, "page": page, "limit": per_page},
        )

    async def get_pull_request(self, owner: str, repo: str, index: int) -> dict:
        """GET /repos/{owner}/{repo}/pulls/{index} -> single pull request."""
        return await self._get_json(f"/repos/{owner}/{repo}/pulls/{index}")

    async def delete_branch(
        self,
        owner: str,
        repo: str,
        branch: str,
        *,
        missing_ok: bool = True,
    ) -> None:
        """DELETE /repos/{owner}/{repo}/branches/{branch}.

        When ``missing_ok`` is true an HTTP 404 is treated as success (the branch
        was already deleted, or Gitea's "delete branch after merge" setting
        removed it first). Other non-2xx responses raise :class:`GiteaApiError`.
        """
        encoded_branch = quote(branch, safe="")
        try:
            await self._request(
                "DELETE",
                f"/repos/{owner}/{repo}/branches/{encoded_branch}",
            )
        except GiteaApiError as e:
            if missing_ok and e.status_code == 404:
                logger.debug(
                    "Gitea branch %s/%s/%s already deleted (404)",
                    owner,
                    repo,
                    branch,
                )
                return
            raise

    async def list_webhooks(self, owner: str, repo: str) -> list:
        """GET /repos/{owner}/{repo}/hooks -> the repository's webhooks."""
        return await self._get_json(f"/repos/{owner}/{repo}/hooks")

    async def ensure_pr_state_webhook(
        self,
        owner: str,
        repo: str,
        *,
        pipeline_id: str,
        public_base_url: str,
        secret: str,
    ) -> dict:
        """Register (idempotently) the PR-state webhook for a repository.

        The webhook subscribes to both ``push`` and ``pull_request`` events so a
        merge (delivered as a push to the base branch) and a close-without-merge
        (remote reject) are both observed. The target URL embeds the pipeline ID
        so the receiver can resolve the pipeline by primary key. Returns the
        existing hook when one already targets the URL, otherwise the newly
        created hook.
        """
        base_url = public_base_url.rstrip("/")
        target_url = f"{base_url}/api/git_hosting/pipelines/{pipeline_id}/pr-state"

        existing = await self.list_webhooks(owner, repo)
        for hook in existing or []:
            config_block = hook.get("config") if isinstance(hook, dict) else None
            if isinstance(config_block, dict) and config_block.get("url") == target_url:
                return hook

        payload = {
            "type": "gitea",
            "active": True,
            "events": ["push", "pull_request"],
            "config": {
                "url": target_url,
                "content_type": "json",
                "secret": secret,
            },
        }
        response = await self._request(
            "POST",
            f"/repos/{owner}/{repo}/hooks",
            json=payload,
        )
        return response.json()

    async def aclose(self) -> None:
        await self._client.aclose()


class GitHubClient(GiteaClient):
    """Async client for the GitHub REST API (pull requests).

    GitHub's API lives at ``https://api.github.com`` (no ``/api/v1`` prefix) and
    authenticates fine-grained personal access tokens with a ``Bearer`` header,
    unlike Gitea. Reuses the Gitea client's request/response handling, differing
    only in the API base, auth scheme, web URL and PR URL path segment.
    """

    API_BASE = "https://api.github.com"
    WEB_BASE = "https://github.com"

    def __init__(self, token: str) -> None:
        super().__init__(
            self.API_BASE,
            token,
            api_prefix="",
            auth_scheme="Bearer",
            web_base_url=self.WEB_BASE,
            accept="application/vnd.github+json",
            pr_url_segment="pull",
        )
