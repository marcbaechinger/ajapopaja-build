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

from unittest.mock import MagicMock, patch

import pytest

from api.assistant.tools import github_issues_tools as tools
from api.git_hosting.gitea import GiteaApiError


@pytest.fixture
def mock_client():
    """Patches _get_client_and_repo so tools operate against a fake client."""

    client = MagicMock()

    def fake_get(pipe):
        return (client, "https://host", "owner", "repo", None)

    with (
        patch.object(tools, "_get_client_and_repo", side_effect=fake_get),
        patch(
            "api.assistant.tools.github_issues_tools.GiteaClient", return_value=client
        ),
    ):
        yield client


async def test_list_issues_returns_readable_text(mock_client):
    issues = [
        {
            "number": 1,
            "state": "open",
            "title": "Bug in login",
            "user": {"login": "alice"},
            "created_at": "2025-01-01T00:00:00Z",
            "body": "Cannot log in",
        }
    ]

    async def fake_list(*args, **kwargs):
        return issues

    setattr(mock_client, "list_issues", fake_list)
    setattr(mock_client, "aclose", async_noop)

    result = await tools.list_issues("pipe1", state="open")
    assert "#1 [open] Bug in login" in result
    assert "author: alice" in result
    assert "Cannot log in" in result


async def test_list_issues_no_results(mock_client):
    async def fake_list(*args, **kwargs):
        return []

    setattr(mock_client, "list_issues", fake_list)
    setattr(mock_client, "aclose", async_noop)

    result = await tools.list_issues("pipe1")
    assert "No issues found" in result


async def test_list_pull_requests_renders_branch_info(mock_client):
    prs = [
        {
            "number": 2,
            "state": "open",
            "title": "Feature X",
            "user": {"login": "bob"},
            "created_at": "2025-01-01T00:00:00Z",
            "base": {"ref": "main"},
            "head": {"ref": "feature/x"},
            "body": "Adds feature X",
        }
    ]

    async def fake_list(*args, **kwargs):
        return prs

    setattr(mock_client, "list_pull_requests", fake_list)
    setattr(mock_client, "aclose", async_noop)

    result = await tools.list_pull_requests("pipe1")
    assert "#2 [open] Feature X" in result
    assert "main <- feature/x" in result


async def test_read_issue_includes_comments(mock_client):
    async def fake_get(owner, repo, index):
        return {
            "number": 4,
            "state": "open",
            "title": "Question",
            "user": {"login": "alice"},
            "created_at": "2025-01-01T00:00:00Z",
            "body": "How?",
        }

    async def fake_comments(owner, repo, index):
        return [{"user": {"login": "bob"}, "body": "Try this"}]

    setattr(mock_client, "get_issue", fake_get)
    setattr(mock_client, "list_issue_comments", fake_comments)
    setattr(mock_client, "aclose", async_noop)

    result = await tools.read_issue("pipe1", 4)
    assert "Question" in result
    assert "[bob]: Try this" in result


async def test_comment_on_issue_returns_confirmation(mock_client):
    async def fake_comment(owner, repo, index, body):
        return {"html_url": "https://host/owner/repo/issues/4"}

    setattr(mock_client, "create_issue_comment", fake_comment)
    setattr(mock_client, "aclose", async_noop)

    result = await tools.comment_on_issue("pipe1", 4, "Looking into it")
    assert "Added comment to #4" in result


async def test_close_issue_returns_confirmation(mock_client):
    async def fake_close(owner, repo, index):
        return {"title": "Question", "state": "closed"}

    setattr(mock_client, "close_issue", fake_close)
    setattr(mock_client, "aclose", async_noop)

    result = await tools.close_issue("pipe1", 4)
    assert "Closed #4" in result


async def test_create_issue_passes_assignee(mock_client):
    calls = {}

    async def fake_create(owner, repo, *, title, body, assignees):
        calls["title"] = title
        calls["body"] = body
        calls["assignees"] = assignees
        return {"number": 8, "title": title}

    setattr(mock_client, "create_issue", fake_create)
    setattr(mock_client, "aclose", async_noop)

    result = await tools.create_issue(
        "pipe1", "New Task", body="details", assignee="alice"
    )
    assert "Created issue #8" in result
    assert calls["assignees"] == ["alice"]
    assert calls["body"] == "details"


async def test_gitea_api_error_is_surfaced(mock_client):
    async def boom(*args, **kwargs):
        raise GiteaApiError("bad token", status_code=401, detail="unauthorized")

    setattr(mock_client, "list_issues", boom)
    setattr(mock_client, "aclose", async_noop)

    result = await tools.list_issues("pipe1")
    assert "Error:" in result
    assert "401" in result


async def test_no_remote_repo_returns_error():
    async def fake_get(pipe):
        raise ValueError("Pipeline 'pipe1' has no remote repository")

    with patch.object(tools, "_get_client_and_repo", side_effect=fake_get):
        result = await tools.list_issues("pipe1")
    assert "Error:" in result


async def test_list_known_users(init_mock_db):
    from core.models.models import User

    await User(username="alice", hashed_password="x").insert()
    await User(username="bob", hashed_password="x").insert()

    result = await tools.list_known_users()
    assert result == ["alice", "bob"]


async def async_noop(*args, **kwargs):
    return None
