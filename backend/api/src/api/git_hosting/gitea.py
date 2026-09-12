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

import httpx

logger = logging.getLogger(__name__)

GITEA_API_VERSION = "v1"


class GiteaApiError(Exception):
    """Raised when the Gitea REST API returns a non-2xx response."""

    def __init__(self, message: str, status_code: int, detail: str = "") -> None:
        super().__init__(message)
        self.status_code = status_code
        self.detail = detail


class GiteaClient:
    """Async client for the Gitea REST API, focused on pull-request creation."""

    def __init__(self, base_url: str, token: str) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self._client = httpx.AsyncClient()

    def _auth_headers(self) -> dict:
        """Return the authorization headers using a Gitea access token."""
        headers = {"Accept": "application/json"}
        if self.token:
            headers["Authorization"] = f"token {self.token}"
        return headers

    async def _request(
        self, method: str, path: str, **kwargs
    ) -> httpx.Response:
        url = f"{self.base_url}/api/{GITEA_API_VERSION}{path}"
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
        return f"{self.base_url}/{owner}/{repo}/pulls/{number}"

    async def aclose(self) -> None:
        await self._client.aclose()
