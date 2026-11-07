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

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api.git_hosting.gitea import GiteaApiError, GiteaClient, GitHubClient


@pytest.mark.asyncio
async def test_create_pull_request_builds_request_and_returns_html_url():
    client = GiteaClient("https://host", "mytoken")
    response = MagicMock()
    response.status_code = 201
    response.json.return_value = {
        "html_url": "https://host/owner/repo/pulls/42",
        "number": 42,
    }
    response.text = "{}"

    with patch.object(
        client._client, "request", new=AsyncMock(return_value=response)
    ) as mock_req:
        url = await client.create_pull_request(
            "owner",
            "repo",
            head="feature/x",
            base="main",
            title="Summary",
            body="Summary body",
        )

    assert url == "https://host/owner/repo/pulls/42"
    mock_req.assert_awaited_once()
    args, kwargs = mock_req.await_args
    assert args[0] == "POST"
    assert args[1] == "https://host/api/v1/repos/owner/repo/pulls"
    assert kwargs["headers"]["Authorization"] == "token mytoken"
    assert kwargs["json"] == {
        "head": "feature/x",
        "base": "main",
        "title": "Summary",
        "body": "Summary body",
    }


@pytest.mark.asyncio
async def test_create_pull_request_falls_back_to_number_url():
    client = GiteaClient("http://host:3000", "tok")
    response = MagicMock()
    response.status_code = 201
    response.json.return_value = {"number": 7}
    response.text = "{}"

    with patch.object(client._client, "request", new=AsyncMock(return_value=response)):
        url = await client.create_pull_request(
            "owner", "repo", head="h", base="main", title="t"
        )

    assert url == "http://host:3000/owner/repo/pulls/7"


@pytest.mark.asyncio
async def test_create_pull_request_raises_on_non_2xx():
    client = GiteaClient("https://host", "tok")
    response = MagicMock()
    response.status_code = 422
    response.json.return_value = {}
    response.text = '{"message":"bad"}'

    with patch.object(client._client, "request", new=AsyncMock(return_value=response)):
        with pytest.raises(GiteaApiError) as excinfo:
            await client.create_pull_request(
                "owner", "repo", head="h", base="main", title="t"
            )

    assert excinfo.value.status_code == 422
    assert "bad" in excinfo.value.detail


@pytest.mark.asyncio
async def test_list_issues_builds_request():
    client = GiteaClient("https://host", "tok")
    response = MagicMock()
    response.status_code = 200
    response.json.return_value = [{"number": 1, "title": "Bug"}]

    with patch.object(
        client._client, "request", new=AsyncMock(return_value=response)
    ) as mock_req:
        issues = await client.list_issues(
            "owner", "repo", state="closed", assignee="alice", labels="bug,ui"
        )

    assert issues == [{"number": 1, "title": "Bug"}]
    args, kwargs = mock_req.await_args
    assert args[0] == "GET"
    assert args[1] == "https://host/api/v1/repos/owner/repo/issues"
    assert kwargs["params"] == {
        "state": "closed",
        "type": "issues",
        "page": 1,
        "limit": 20,
        "assigned": "alice",
        "labels": "bug,ui",
    }


@pytest.mark.asyncio
async def test_list_pull_requests_builds_request():
    client = GiteaClient("https://host", "tok")
    response = MagicMock()
    response.status_code = 200
    response.json.return_value = [{"number": 7, "title": "PR"}]

    with patch.object(
        client._client, "request", new=AsyncMock(return_value=response)
    ) as mock_req:
        prs = await client.list_pull_requests("owner", "repo", state="all", per_page=50)

    assert prs == [{"number": 7, "title": "PR"}]
    args, kwargs = mock_req.await_args
    assert args[1] == "https://host/api/v1/repos/owner/repo/pulls"
    assert kwargs["params"] == {"state": "all", "page": 1, "limit": 50}


@pytest.mark.asyncio
async def test_get_issue_uses_index_in_path():
    client = GiteaClient("https://host", "tok")
    response = MagicMock()
    response.status_code = 200
    response.json.return_value = {"number": 3, "title": "Detail"}

    with patch.object(
        client._client, "request", new=AsyncMock(return_value=response)
    ) as mock_req:
        issue = await client.get_issue("owner", "repo", 3)

    assert issue["number"] == 3
    args, _ = mock_req.await_args
    assert args[1] == "https://host/api/v1/repos/owner/repo/issues/3"


@pytest.mark.asyncio
async def test_create_issue_comment_posts_json():
    client = GiteaClient("https://host", "tok")
    response = MagicMock()
    response.status_code = 201
    response.json.return_value = {"id": 9, "body": "hello"}

    with patch.object(
        client._client, "request", new=AsyncMock(return_value=response)
    ) as mock_req:
        result = await client.create_issue_comment("owner", "repo", 2, "hello")

    assert result == {"id": 9, "body": "hello"}
    args, kwargs = mock_req.await_args
    assert args[0] == "POST"
    assert args[1] == "https://host/api/v1/repos/owner/repo/issues/2/comments"
    assert kwargs["json"] == {"body": "hello"}


@pytest.mark.asyncio
async def test_close_issue_patches_state():
    client = GiteaClient("https://host", "tok")
    response = MagicMock()
    response.status_code = 200
    response.json.return_value = {"number": 5, "state": "closed"}

    with patch.object(
        client._client, "request", new=AsyncMock(return_value=response)
    ) as mock_req:
        result = await client.close_issue("owner", "repo", 5)

    assert result["state"] == "closed"
    args, kwargs = mock_req.await_args
    assert args[0] == "PATCH"
    assert kwargs["json"] == {"state": "closed"}


@pytest.mark.asyncio
async def test_create_issue_posts_assignees():
    client = GiteaClient("https://host", "tok")
    response = MagicMock()
    response.status_code = 201
    response.json.return_value = {"number": 10, "title": "New"}

    with patch.object(
        client._client, "request", new=AsyncMock(return_value=response)
    ) as mock_req:
        result = await client.create_issue(
            "owner", "repo", title="New", body="desc", assignees=["alice", "bob"]
        )

    assert result["number"] == 10
    args, kwargs = mock_req.await_args
    assert args[0] == "POST"
    assert args[1] == "https://host/api/v1/repos/owner/repo/issues"
    assert kwargs["json"] == {
        "title": "New",
        "body": "desc",
        "assignees": ["alice", "bob"],
    }


@pytest.mark.asyncio
async def test_ensure_pr_state_webhook_posts_push_and_pr_events():
    client = GiteaClient("https://host", "tok")

    list_response = MagicMock()
    list_response.status_code = 200
    list_response.json.return_value = []

    create_response = MagicMock()
    create_response.status_code = 201
    create_response.json.return_value = {"id": 1, "config": {"url": "target"}}

    with patch.object(
        client._client,
        "request",
        new=AsyncMock(side_effect=[list_response, create_response]),
    ) as mock_req:
        result = await client.ensure_pr_state_webhook(
            "owner",
            "repo",
            pipeline_id="pipe-1",
            public_base_url="https://ajapopaja.example",
            secret="s3cret",
        )

    assert result == {"id": 1, "config": {"url": "target"}}
    assert mock_req.await_count == 2
    # First call lists hooks, second creates the hook.
    create_args, create_kwargs = mock_req.await_args_list[1]
    assert create_args[0] == "POST"
    assert create_args[1] == "https://host/api/v1/repos/owner/repo/hooks"
    assert create_kwargs["json"] == {
        "type": "gitea",
        "active": True,
        "events": ["push", "pull_request"],
        "config": {
            "url": "https://ajapopaja.example/api/git_hosting/pipelines/pipe-1/pr-state",
            "content_type": "json",
            "secret": "s3cret",
        },
    }


@pytest.mark.asyncio
async def test_ensure_pr_state_webhook_skips_existing_target():
    client = GiteaClient("https://host", "tok")
    target = "https://ajapopaja.example/api/git_hosting/pipelines/pipe-1/pr-state"

    list_response = MagicMock()
    list_response.status_code = 200
    list_response.json.return_value = [
        {"id": 7, "config": {"url": target}},
    ]

    with patch.object(
        client._client,
        "request",
        new=AsyncMock(return_value=list_response),
    ) as mock_req:
        result = await client.ensure_pr_state_webhook(
            "owner",
            "repo",
            pipeline_id="pipe-1",
            public_base_url="https://ajapopaja.example",
            secret="s3cret",
        )

    assert result == {"id": 7, "config": {"url": target}}
    # Only the list call happened; no POST.
    assert mock_req.await_count == 1
    assert mock_req.await_args.args[0] == "GET"


@pytest.mark.asyncio
async def test_delete_branch_builds_encoded_request_and_accepts_204():
    client = GiteaClient("https://host", "tok")
    response = MagicMock()
    response.status_code = 204
    response.text = ""

    with patch.object(
        client._client, "request", new=AsyncMock(return_value=response)
    ) as mock_req:
        await client.delete_branch("owner", "repo", "coderbot/task 1")

    args, _ = mock_req.await_args
    assert args[0] == "DELETE"
    assert (
        args[1] == "https://host/api/v1/repos/owner/repo/branches/coderbot%2Ftask%201"
    )


@pytest.mark.asyncio
async def test_delete_branch_treats_404_as_missing_ok():
    client = GiteaClient("https://host", "tok")
    response = MagicMock()
    response.status_code = 404
    response.text = '{"message":"not found"}'

    with patch.object(client._client, "request", new=AsyncMock(return_value=response)):
        await client.delete_branch("owner", "repo", "coderbot/t1", missing_ok=True)


@pytest.mark.asyncio
async def test_delete_branch_404_raises_when_missing_not_ok():
    client = GiteaClient("https://host", "tok")
    response = MagicMock()
    response.status_code = 404
    response.text = '{"message":"not found"}'

    with patch.object(client._client, "request", new=AsyncMock(return_value=response)):
        with pytest.raises(GiteaApiError) as excinfo:
            await client.delete_branch("owner", "repo", "coderbot/t1", missing_ok=False)

    assert excinfo.value.status_code == 404


@pytest.mark.asyncio
async def test_delete_branch_raises_on_500():
    client = GiteaClient("https://host", "tok")
    response = MagicMock()
    response.status_code = 500
    response.text = "boom"

    with patch.object(client._client, "request", new=AsyncMock(return_value=response)):
        with pytest.raises(GiteaApiError) as excinfo:
            await client.delete_branch("owner", "repo", "coderbot/t1")

    assert excinfo.value.status_code == 500


@pytest.mark.asyncio
async def test_github_client_create_pull_request_uses_github_api():
    client = GitHubClient("gh-token")
    response = MagicMock()
    response.status_code = 201
    response.json.return_value = {
        "html_url": "https://github.com/owner/repo/pull/42",
        "number": 42,
    }
    response.text = "{}"

    with patch.object(
        client._client, "request", new=AsyncMock(return_value=response)
    ) as mock_req:
        url = await client.create_pull_request(
            "owner", "repo", head="feature/x", base="main", title="t", body="b"
        )

    assert url == "https://github.com/owner/repo/pull/42"
    args, kwargs = mock_req.await_args
    assert args[0] == "POST"
    # GitHub's API has no /api/v1 prefix and uses api.github.com.
    assert args[1] == "https://api.github.com/repos/owner/repo/pulls"
    assert kwargs["headers"]["Authorization"] == "Bearer gh-token"
    assert kwargs["json"] == {
        "head": "feature/x",
        "base": "main",
        "title": "t",
        "body": "b",
    }


@pytest.mark.asyncio
async def test_github_client_falls_back_to_pull_url():
    client = GitHubClient("gh-token")
    response = MagicMock()
    response.status_code = 201
    response.json.return_value = {"number": 7}
    response.text = "{}"

    with patch.object(client._client, "request", new=AsyncMock(return_value=response)):
        url = await client.create_pull_request(
            "owner", "repo", head="h", base="main", title="t"
        )

    # GitHub uses the singular "pull" segment in its web URL.
    assert url == "https://github.com/owner/repo/pull/7"


def test_is_github_host_detects_github():
    from api.git_hosting.pull_requests import _is_github_host

    assert _is_github_host("https://github.com/owner/repo.git")
    assert _is_github_host("https://github.com/owner/repo")
    assert _is_github_host("https://www.github.com/owner/repo.git")
    assert _is_github_host("git@github.com:owner/repo.git")
    assert not _is_github_host("https://gitea.example.com/owner/repo.git")
    assert not _is_github_host("http://localhost:3000/owner/repo.git")
