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
from bson import ObjectId
from fastapi import status

from api.auth import get_current_user
from api.main import app
from api.routes import pull_request as pr_routes
from core.models.models import PullRequest, PullRequestStatus


@pytest.mark.asyncio
async def test_get_pull_request_unauthenticated(async_client, init_mock_db):
    response = await async_client.get("/api/pull_requests/pr_123")
    assert response.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.asyncio
async def test_get_pull_request_authenticated(async_client, init_mock_db):
    mock_user = AsyncMock()
    mock_user.username = "testuser"

    app.dependency_overrides[get_current_user] = lambda: mock_user

    try:
        with patch(
            "api.routes.pull_request.PullRequest.get", new_callable=AsyncMock
        ) as mock_get_pr:
            mock_pr = PullRequest(
                id=ObjectId(),
                pipeline_id="pipe_123",
                task_id="task_123",
                summary="summary",
                branch_name="branch",
                patch="patch",
                status=PullRequestStatus.OPEN,
            )
            mock_get_pr.return_value = mock_pr

            response = await async_client.get(f"/api/pull_requests/{mock_pr.id}")
            assert response.status_code == status.HTTP_200_OK
            assert response.json()["pipeline_id"] == "pipe_123"
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_accept_pull_request_unauthenticated(async_client, init_mock_db):
    response = await async_client.post("/api/pull_requests/pr_123/accept")
    assert response.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.asyncio
async def test_reject_pull_request_unauthenticated(async_client, init_mock_db):
    response = await async_client.post("/api/pull_requests/pr_123/reject")
    assert response.status_code == status.HTTP_401_UNAUTHORIZED


def test_commit_changes_passes_git_identity_env():
    mock_repo = MagicMock()
    mock_repo.head.commit.hexsha = "abc1234"
    mock_pr = MagicMock()
    mock_pr.id = "pr_123"
    identity_env = {"GIT_AUTHOR_NAME": "Bot", "GIT_AUTHOR_EMAIL": "bot@localhost"}

    with patch(
        "api.routes.pull_request.git_utils.ensure_git_identity",
        return_value=identity_env,
    ) as mock_identity:
        result = pr_routes.commit_changes(mock_repo, mock_pr, "commit msg")

    assert result == "abc1234"
    mock_repo.git.add.assert_called_once_with(A=True)
    mock_repo.git.commit.assert_called_once_with(
        "-m", "commit msg", "--no-verify", env=identity_env
    )
    mock_identity.assert_called_once_with(mock_repo)


def test_build_commit_message_uses_request_when_provided():
    mock_pr = MagicMock()
    mock_pr.summary = "Original summary"
    request = pr_routes.AcceptPullRequestRequest(
        commit_message="Add new feature",
        failure_strategy=pr_routes.FailureStrategy.REVERT,
    )
    assert pr_routes.build_commit_message(request, mock_pr) == "Add new feature"


def test_build_commit_message_returns_empty_string_when_both_empty():
    mock_pr = MagicMock()
    mock_pr.summary = None
    request = pr_routes.AcceptPullRequestRequest(
        commit_message=None, failure_strategy=pr_routes.FailureStrategy.REVERT
    )
    assert pr_routes.build_commit_message(request, mock_pr) == ""


def test_build_commit_message_none_request():
    mock_pr = MagicMock()
    mock_pr.summary = "summary"
    assert pr_routes.build_commit_message(None, mock_pr) == "summary"


def test_is_gitea_pr_mode_remote_and_flag(monkeypatch):
    monkeypatch.setattr(pr_routes.config, "REMOTE_PR_MODE", "gitea_pr")
    pipeline = MagicMock()
    pipeline.repo_uri = "https://host/owner/repo.git"
    assert pr_routes._is_gitea_pr_mode(pipeline) is True


def test_is_gitea_pr_mode_local_always_direct(monkeypatch):
    monkeypatch.setattr(pr_routes.config, "REMOTE_PR_MODE", "gitea_pr")
    pipeline = MagicMock()
    pipeline.repo_uri = None
    assert pr_routes._is_gitea_pr_mode(pipeline) is False


def test_is_gitea_pr_mode_direct_flag(monkeypatch):
    monkeypatch.setattr(pr_routes.config, "REMOTE_PR_MODE", "direct")
    pipeline = MagicMock()
    pipeline.repo_uri = "https://host/owner/repo.git"
    assert pr_routes._is_gitea_pr_mode(pipeline) is False


@pytest.mark.asyncio
async def test_submit_as_gitea_pr_flow():
    mock_repo = MagicMock()
    mock_pipeline = MagicMock()
    mock_pipeline.repo_uri = "https://host/owner/repo.git"
    mock_pipeline.repo_token = "pipetok"
    mock_pr = MagicMock()
    mock_pr.branch_name = "feature/x"
    mock_pr.summary = "summary"

    with (
        patch(
            "api.routes.pull_request.git_utils.current_default_branch",
            return_value="main",
        ) as mock_base,
        patch("api.routes.pull_request.git_utils.ensure_feature_branch") as mock_ensure,
        patch(
            "api.routes.pull_request.commit_changes",
            return_value="abc123",
        ) as mock_commit,
        patch("api.routes.pull_request.git_utils.push_branch_with_auth") as mock_push,
        patch(
            "api.routes.pull_request.git_utils.resolve_gitea_repo",
            return_value=("https://host", "owner", "repo"),
        ),
        patch("api.routes.pull_request.config.GIT_PUSH_TOKEN", "globaltok"),
        patch("api.routes.pull_request.GiteaClient") as mock_client_cls,
    ):
        mock_client = mock_client_cls.return_value
        mock_client.create_pull_request = AsyncMock(
            return_value="https://host/owner/repo/pulls/9"
        )
        mock_client.aclose = AsyncMock()

        url = await pr_routes._submit_as_gitea_pr(
            mock_repo, mock_pipeline, mock_pr, "msg"
        )

    assert url == "https://host/owner/repo/pulls/9"
    mock_base.assert_called_once_with(mock_repo)
    mock_ensure.assert_called_once_with(mock_repo, "feature/x")
    mock_commit.assert_called_once_with(mock_repo, mock_pr, "msg")
    mock_push.assert_called_once_with(mock_repo, mock_pipeline, "feature/x")
    mock_client_cls.assert_called_once_with("https://host", "pipetok")
    mock_client.create_pull_request.assert_awaited_once_with(
        "owner",
        "repo",
        head="feature/x",
        base="main",
        title="summary",
        body="summary",
    )
    mock_client.aclose.assert_awaited_once()


@pytest.mark.asyncio
async def test_accept_pull_request_gitea_pr_mode(async_client, init_mock_db):
    mock_user = AsyncMock()
    mock_user.username = "testuser"
    app.dependency_overrides[get_current_user] = lambda: mock_user

    pr_id = ObjectId()
    mock_pr = PullRequest(
        id=pr_id,
        pipeline_id="pipe_123",
        task_id="task_123",
        summary="summary",
        branch_name="feature/x",
        patch="patch",
        status=PullRequestStatus.OPEN,
    )
    mock_pipeline = MagicMock()
    mock_pipeline.workspace_abs_path = "/tmp/remote_repo"
    mock_pipeline.repo_uri = "https://host/owner/repo.git"
    mock_repo = MagicMock()
    mock_task = MagicMock()
    mock_task.id = "task_123"
    from core.models.models import TaskStatus

    mock_task.status = TaskStatus.PULL_REQUEST_AVAILABLE

    with (
        patch("api.routes.pull_request.PullRequest.get") as mock_get_pr,
        patch("api.routes.pull_request.Pipeline.get") as mock_get_pipe,
        patch("api.routes.pull_request.git_utils.get_repo", return_value=mock_repo),
        patch(
            "api.routes.pull_request.validate_workspace_clean",
            new_callable=AsyncMock,
        ),
        patch("api.routes.pull_request.apply_patch", new_callable=AsyncMock),
        patch("api.routes.pull_request.format_workspace", new_callable=AsyncMock),
        patch("api.routes.pull_request.commit_changes", return_value="abc1234"),
        patch(
            "api.routes.pull_request._submit_as_gitea_pr",
            new_callable=AsyncMock,
            return_value="https://host/owner/repo/pulls/9",
        ) as mock_submit,
        patch("api.routes.pull_request.Task.get", return_value=mock_task),
        patch(
            "api.routes.pull_request.update_pull_request_status",
            new_callable=AsyncMock,
        ) as mock_update_status,
        patch(
            "api.routes.pull_request.keep_task_pending_review",
            new_callable=AsyncMock,
        ) as mock_keep,
        patch.object(pr_routes.config, "REMOTE_PR_MODE", "gitea_pr"),
    ):
        mock_get_pr.return_value = mock_pr
        mock_get_pipe.return_value = mock_pipeline

        response = await async_client.post(f"/api/pull_requests/{pr_id}/accept")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "success"
    assert body["remote_pr_url"] == "https://host/owner/repo/pulls/9"
    mock_submit.assert_awaited_once()
    mock_update_status.assert_awaited_once_with(
        mock_pr,
        PullRequestStatus.SUBMITTED,
        remote_pr_url="https://host/owner/repo/pulls/9",
    )
    mock_keep.assert_awaited_once()
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_accept_pull_request_direct_mode_uses_push(async_client, init_mock_db):
    mock_user = AsyncMock()
    mock_user.username = "testuser"
    app.dependency_overrides[get_current_user] = lambda: mock_user

    pr_id = ObjectId()
    mock_pr = PullRequest(
        id=pr_id,
        pipeline_id="pipe_123",
        task_id="task_123",
        summary="summary",
        branch_name="feature/x",
        patch="patch",
        status=PullRequestStatus.OPEN,
    )
    mock_pipeline = MagicMock()
    mock_pipeline.workspace_abs_path = "/tmp/remote_repo"
    mock_pipeline.repo_uri = "https://host/owner/repo.git"
    mock_repo = MagicMock()
    mock_task = MagicMock()
    mock_task.id = "task_123"

    with (
        patch("api.routes.pull_request.PullRequest.get") as mock_get_pr,
        patch("api.routes.pull_request.Pipeline.get") as mock_get_pipe,
        patch("api.routes.pull_request.git_utils.get_repo", return_value=mock_repo),
        patch(
            "api.routes.pull_request.validate_workspace_clean",
            new_callable=AsyncMock,
        ),
        patch("api.routes.pull_request.apply_patch", new_callable=AsyncMock),
        patch("api.routes.pull_request.format_workspace", new_callable=AsyncMock),
        patch("api.routes.pull_request.commit_changes", return_value="abc1234"),
        patch("api.routes.pull_request.git_utils.push_with_auth") as mock_push,
        patch("api.routes.pull_request.Task.get", return_value=mock_task),
        patch(
            "api.routes.pull_request.update_pull_request_status",
            new_callable=AsyncMock,
        ) as mock_update_status,
        patch(
            "api.routes.pull_request.update_task_status",
            new_callable=AsyncMock,
        ) as mock_update_task,
        patch.object(pr_routes.config, "REMOTE_PR_MODE", "direct"),
    ):
        mock_get_pr.return_value = mock_pr
        mock_get_pipe.return_value = mock_pipeline

        response = await async_client.post(f"/api/pull_requests/{pr_id}/accept")

    assert response.status_code == 200
    mock_push.assert_called_once_with(mock_repo, mock_pipeline)
    mock_update_status.assert_awaited_once_with(mock_pr, PullRequestStatus.ACCEPTED)
    mock_update_task.assert_awaited_once()
    app.dependency_overrides.clear()
