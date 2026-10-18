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

import subprocess
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from bson import ObjectId
from fastapi import status

from api.auth import get_current_user
from api.main import app
from api.routes import pull_request as pr_routes
from core.models.models import (
    PullRequest,
    PullRequestStatus,
    TaskStatus,
)


@pytest.mark.asyncio
async def test_keep_task_pending_review_transitions_to_submitted(init_mock_db):
    """Gitea-PR submission marks the task as SUBMITTED (a completed state)
    instead of leaving it in PULL_REQUEST_AVAILABLE."""
    from core.models.models import Task

    task = Task(
        title="Task 1",
        pipeline_id="pipe_123",
        status=TaskStatus.PULL_REQUEST_AVAILABLE,
        commit_hash="abc1234",
        completion_info="summary",
    )
    await task.insert()

    await pr_routes.keep_task_pending_review(
        task, "abc1234", "summary", "https://host/owner/repo/pulls/9"
    )

    assert task.status == TaskStatus.SUBMITTED
    assert task.commit_hash == "abc1234"
    assert task.completion_info == "summary"
    assert task.review_md == "https://host/owner/repo/pulls/9"
    assert task.history[-1].to_status == TaskStatus.SUBMITTED
    assert task.history[-1].from_status == TaskStatus.PULL_REQUEST_AVAILABLE


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


@pytest.mark.asyncio
async def test_reject_pull_request_broadcasts_task_status_update(init_mock_db):
    """Rejecting a PR moves the task PULL_REQUEST_AVAILABLE -> CREATED and
    broadcasts TASK_STATUS_UPDATED so the UI updates the displayed TaskItem."""
    from api.websocket_manager import WSMessage
    from core.models.models import Task

    task = Task(
        title="Task 1",
        pipeline_id="pipe_123",
        status=TaskStatus.PULL_REQUEST_AVAILABLE,
        commit_hash="abc1234",
    )
    await task.insert()

    pr = PullRequest(
        id=ObjectId(),
        pipeline_id="pipe_123",
        task_id=str(task.id),
        summary="summary",
        branch_name="branch",
        patch="patch",
        status=PullRequestStatus.SUBMITTED,
    )
    await pr.insert()

    with patch(
        "api.routes.pull_request.ws_manager.broadcast", new_callable=AsyncMock
    ) as mock_broadcast:
        result = await pr_routes.reject_pull_request(str(pr.id))

    assert result["status"] == "success"

    updated = await Task.get(str(task.id))
    assert updated.status == TaskStatus.CREATED
    transitions = [(t.from_status, t.to_status, t.by) for t in updated.history]
    assert (
        TaskStatus.PULL_REQUEST_AVAILABLE,
        TaskStatus.CREATED,
        "user",
    ) in transitions

    status_msgs = [
        c
        for c in mock_broadcast.await_args_list
        if isinstance(c.args[0], WSMessage) and c.args[0].type == "TASK_STATUS_UPDATED"
    ]
    assert len(status_msgs) == 1
    payload = status_msgs[0].args[0].payload
    assert payload["id"] == str(task.id)
    assert payload["status"] == TaskStatus.CREATED


@pytest.mark.asyncio
async def test_reject_pull_request_leaves_other_statuses_untouched(init_mock_db):
    """A task that is not awaiting review keeps its status and no WS message
    is broadcast."""
    from api.websocket_manager import WSMessage
    from core.models.models import Task

    task = Task(
        title="Task 1",
        pipeline_id="pipe_123",
        status=TaskStatus.IMPLEMENTED,
    )
    await task.insert()

    pr = PullRequest(
        id=ObjectId(),
        pipeline_id="pipe_123",
        task_id=str(task.id),
        summary="summary",
        branch_name="branch",
        patch="patch",
        status=PullRequestStatus.OPEN,
    )
    await pr.insert()

    with patch(
        "api.routes.pull_request.ws_manager.broadcast", new_callable=AsyncMock
    ) as mock_broadcast:
        await pr_routes.reject_pull_request(str(pr.id))

    unchanged = await Task.get(str(task.id))
    assert unchanged.status == TaskStatus.IMPLEMENTED
    assert not [
        c
        for c in mock_broadcast.await_args_list
        if isinstance(c.args[0], WSMessage) and c.args[0].type == "TASK_STATUS_UPDATED"
    ]


def test_retarget_verified_commit_hash_replaces_sandbox_hash():
    head = "70ce091c2163f5561a8468bfd14c0e880bd5e283"
    sandbox = "3e80ca4f2777bd1180dbab8717ad514fa6f5853c"
    base = "2991321c02a5c5ae8776c2e352dc513f14fa1936"
    summary = (
        "Done.\n"
        "\n"
        "### Verification\n"
        "Task ID: **abc123**\n"
        f"Verified commit (HEAD): `{sandbox}`\n"
        f"Parent commit (base): `{base}`\n"
        "Status: **PASSED**"
    )
    refined = pr_routes.retarget_verified_commit_hash(summary, head)
    assert f"Verified commit (HEAD): `{head}`" in refined
    # Only the Verified/HEAD hash is rewritten; the parent base hash is untouched.
    assert f"Parent commit (base): `{base}`" in refined
    assert sandbox not in refined


def test_retarget_verified_commit_hash_noop_without_verification_line():
    summary = "Just a summary without a verification section."
    assert pr_routes.retarget_verified_commit_hash(summary, "abc123") == summary
    assert pr_routes.retarget_verified_commit_hash("", "abc123") == ""


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
    mock_pr.subject = None
    request = pr_routes.AcceptPullRequestRequest(
        commit_message=None, failure_strategy=pr_routes.FailureStrategy.REVERT
    )
    assert pr_routes.build_commit_message(request, mock_pr) == ""


def test_build_commit_message_falls_back_to_subject():
    mock_pr = MagicMock()
    mock_pr.subject = "Task title"
    assert pr_routes.build_commit_message(None, mock_pr) == "Task title"


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


def test_resolve_apply_mode_local_defaults_to_merge(monkeypatch):
    monkeypatch.setattr(pr_routes.config, "REMOTE_PR_MODE", "direct")
    pipeline = MagicMock()
    pipeline.repo_uri = None
    assert pr_routes.resolve_apply_mode(pipeline) == "merge"
    assert pr_routes.resolve_apply_mode(None) == "merge"


def test_resolve_apply_mode_remote_direct_is_push(monkeypatch):
    monkeypatch.setattr(pr_routes.config, "REMOTE_PR_MODE", "direct")
    pipeline = MagicMock()
    pipeline.repo_uri = "https://host/owner/repo.git"
    assert pr_routes.resolve_apply_mode(pipeline) == "push"


def test_resolve_apply_mode_remote_gitea_is_submit(monkeypatch):
    monkeypatch.setattr(pr_routes.config, "REMOTE_PR_MODE", "gitea_pr")
    pipeline = MagicMock()
    pipeline.repo_uri = "https://host/owner/repo.git"
    assert pr_routes.resolve_apply_mode(pipeline) == "submit"


def test_resolve_apply_mode_remote_gitea_ignored_for_local(monkeypatch):
    monkeypatch.setattr(pr_routes.config, "REMOTE_PR_MODE", "gitea_pr")
    pipeline = MagicMock()
    pipeline.repo_uri = None
    assert pr_routes.resolve_apply_mode(pipeline) == "merge"


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
        patch("api.routes.pull_request.git_utils.push_branch_with_auth") as mock_push,
        patch(
            "api.git_hosting.pull_requests.git_utils.resolve_gitea_repo",
            return_value=("https://host", "owner", "repo"),
        ),
        patch("api.git_hosting.pull_requests.config.GIT_PUSH_TOKEN", "globaltok"),
        patch("api.git_hosting.pull_requests.GiteaClient") as mock_client_cls,
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
    mock_push.assert_called_once_with(mock_repo, mock_pipeline, "feature/x")
    mock_client_cls.assert_called_once_with("https://host", "pipetok")
    mock_client.create_pull_request.assert_awaited_once_with(
        "owner",
        "repo",
        head="feature/x",
        base="main",
        title="msg",
        body="summary",
    )
    mock_client.aclose.assert_awaited_once()
    mock_repo.git.checkout.assert_called_with("main")


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
async def test_accept_pull_request_retargets_verified_commit_in_summary(
    async_client, init_mock_db
):
    mock_user = AsyncMock()
    mock_user.username = "testuser"
    app.dependency_overrides[get_current_user] = lambda: mock_user

    pr_id = ObjectId()
    sandbox = "3e80ca4f2777bd1180dbab8717ad514fa6f5853c"
    head = "70ce091c2163f5561a8468bfd14c0e880bd5e283"
    base = "2991321c02a5c5ae8776c2e352dc513f14fa1936"
    mock_pr = PullRequest(
        id=pr_id,
        pipeline_id="pipe_123",
        task_id="task_123",
        summary=(
            "### Verification\n"
            f"Verified commit (HEAD): `{sandbox}`\n"
            f"Parent commit (base): `{base}`\n"
            "Status: **PASSED**"
        ),
        branch_name="feature/x",
        patch="patch",
        status=PullRequestStatus.OPEN,
    )
    mock_pipeline = MagicMock()
    mock_pipeline.workspace_abs_path = "/tmp/remote_repo"
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
        patch(
            "api.routes.pull_request.commit_changes",
            return_value=head,
        ),
        patch("api.routes.pull_request.Task.get", return_value=mock_task),
        patch(
            "api.routes.pull_request.update_pull_request_status",
            new_callable=AsyncMock,
        ),
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
    # The summary is rewritten to reference the commit that actually landed.
    assert f"Verified commit (HEAD): `{head}`" in mock_pr.summary
    assert sandbox not in mock_pr.summary
    assert f"Parent commit (base): `{base}`" in mock_pr.summary
    # The real commit hash is recorded on the task.
    captured = mock_update_task.await_args.args[1]
    assert captured == head
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


def _run_git(cwd, *args):
    return subprocess.run(
        ["git", *args],
        cwd=cwd,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def _make_git_repo(path):
    path.mkdir(parents=True, exist_ok=True)
    _run_git(path, "init", "-b", "main")
    (path / "readme.txt").write_text("readme\n")
    _run_git(path, "add", ".")
    _run_git(
        path,
        "-c",
        "user.name=Test User",
        "-c",
        "user.email=test@example.com",
        "commit",
        "-m",
        "initial",
    )
    return path


@pytest.mark.asyncio
async def test_accept_merge_mode_clears_patch_and_keeps_default_branch_commit(
    async_client, init_mock_db, tmp_path, monkeypatch
):
    from core.models.models import Pipeline, Task

    monkeypatch.setattr(pr_routes.config, "WORKSPACES_ROOT", tmp_path)
    repo_path = _make_git_repo(tmp_path / "repo")
    head_before = _run_git(repo_path, "rev-parse", "HEAD")

    pipeline = Pipeline(name="local", workspace_path="repo")
    await pipeline.insert()
    task = Task(
        title="Task",
        pipeline_id=str(pipeline.id),
        status=TaskStatus.PULL_REQUEST_AVAILABLE,
    )
    await task.insert()
    branch = f"coderbot/{task.id}"
    pr = PullRequest(
        pipeline_id=str(pipeline.id),
        task_id=str(task.id),
        summary="summary",
        branch_name=branch,
        patch="diff --git a/readme.txt b/readme.txt\n",
        status=PullRequestStatus.OPEN,
    )
    await pr.insert()

    mock_user = AsyncMock()
    mock_user.username = "testuser"
    app.dependency_overrides[get_current_user] = lambda: mock_user
    try:
        with (
            patch("api.routes.pull_request.apply_patch", new_callable=AsyncMock),
            patch("api.routes.pull_request.format_workspace", new_callable=AsyncMock),
            patch(
                "api.routes.pull_request.commit_changes", return_value=head_before
            ),
        ):
            response = await async_client.post(
                f"/api/pull_requests/{pr.id}/accept"
            )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    refreshed = await PullRequest.get(pr.id)
    assert refreshed.status == PullRequestStatus.ACCEPTED
    assert refreshed.patch is None
    assert _run_git(repo_path, "rev-parse", "HEAD") == head_before


@pytest.mark.asyncio
async def test_accept_submit_mode_keeps_patch_and_feature_branch(
    async_client, init_mock_db, tmp_path, monkeypatch
):
    from core.models.models import Pipeline, Task

    monkeypatch.setattr(pr_routes.config, "REMOTE_WORKSPACES_ROOT", tmp_path)
    monkeypatch.setattr(pr_routes.config, "REMOTE_PR_MODE", "gitea_pr")
    repo_path = _make_git_repo(tmp_path / "repo")

    pipeline = Pipeline(name="repo", repo_uri="https://host/owner/repo.git")
    await pipeline.insert()
    task = Task(
        title="Task",
        pipeline_id=str(pipeline.id),
        status=TaskStatus.PULL_REQUEST_AVAILABLE,
    )
    await task.insert()
    branch = f"coderbot/{task.id}"
    patch_text = "diff --git a/readme.txt b/readme.txt\n"
    pr = PullRequest(
        pipeline_id=str(pipeline.id),
        task_id=str(task.id),
        summary="summary",
        branch_name=branch,
        patch=patch_text,
        status=PullRequestStatus.OPEN,
    )
    await pr.insert()

    mock_user = AsyncMock()
    mock_user.username = "testuser"
    app.dependency_overrides[get_current_user] = lambda: mock_user
    try:
        with (
            patch("api.routes.pull_request.apply_patch", new_callable=AsyncMock),
            patch("api.routes.pull_request.format_workspace", new_callable=AsyncMock),
            patch(
                "api.routes.pull_request.commit_changes",
                return_value=_run_git(repo_path, "rev-parse", "HEAD"),
            ),
            patch(
                "api.routes.pull_request._submit_as_gitea_pr",
                new_callable=AsyncMock,
                return_value="https://host/owner/repo/pulls/1",
            ),
        ):
            response = await async_client.post(
                f"/api/pull_requests/{pr.id}/accept"
            )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    refreshed = await PullRequest.get(pr.id)
    assert refreshed.status == PullRequestStatus.SUBMITTED
    assert refreshed.patch == patch_text
    assert branch in _run_git(repo_path, "branch", "--format=%(refname:short)")


@pytest.mark.asyncio
async def test_reject_clears_patch_and_deletes_existing_local_branch(
    async_client, init_mock_db, tmp_path, monkeypatch
):
    from core.models.models import Pipeline, Task

    monkeypatch.setattr(pr_routes.config, "WORKSPACES_ROOT", tmp_path)
    repo_path = _make_git_repo(tmp_path / "repo")

    pipeline = Pipeline(name="local", workspace_path="repo")
    await pipeline.insert()
    task = Task(
        title="Task",
        pipeline_id=str(pipeline.id),
        status=TaskStatus.IMPLEMENTED,
    )
    await task.insert()
    branch = f"coderbot/{task.id}"
    _run_git(repo_path, "branch", branch)
    pr = PullRequest(
        pipeline_id=str(pipeline.id),
        task_id=str(task.id),
        summary="summary",
        branch_name=branch,
        patch="diff --git a/readme.txt b/readme.txt\n",
        status=PullRequestStatus.OPEN,
    )
    await pr.insert()

    mock_user = AsyncMock()
    mock_user.username = "testuser"
    app.dependency_overrides[get_current_user] = lambda: mock_user
    try:
        response = await async_client.post(f"/api/pull_requests/{pr.id}/reject")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    refreshed = await PullRequest.get(pr.id)
    assert refreshed.status == PullRequestStatus.REJECTED
    assert refreshed.patch is None
    assert branch not in _run_git(repo_path, "branch", "--format=%(refname:short)")


@pytest.mark.asyncio
async def test_accept_cleanup_failure_is_logged_without_changing_response(
    async_client, init_mock_db, tmp_path, monkeypatch, caplog
):
    from core.models.models import Pipeline, Task

    monkeypatch.setattr(pr_routes.config, "WORKSPACES_ROOT", tmp_path)
    repo_path = _make_git_repo(tmp_path / "repo")
    head = _run_git(repo_path, "rev-parse", "HEAD")

    pipeline = Pipeline(name="local", workspace_path="repo")
    await pipeline.insert()
    task = Task(
        title="Task",
        pipeline_id=str(pipeline.id),
        status=TaskStatus.PULL_REQUEST_AVAILABLE,
    )
    await task.insert()
    pr = PullRequest(
        pipeline_id=str(pipeline.id),
        task_id=str(task.id),
        summary="summary",
        branch_name=f"coderbot/{task.id}",
        patch="diff --git a/readme.txt b/readme.txt\n",
        status=PullRequestStatus.OPEN,
    )
    await pr.insert()

    mock_user = AsyncMock()
    mock_user.username = "testuser"
    app.dependency_overrides[get_current_user] = lambda: mock_user
    try:
        with (
            patch("api.routes.pull_request.apply_patch", new_callable=AsyncMock),
            patch("api.routes.pull_request.format_workspace", new_callable=AsyncMock),
            patch("api.routes.pull_request.commit_changes", return_value=head),
            patch(
                "api.routes.pull_request.git_utils.sweep_completed_pull_requests",
                new_callable=AsyncMock,
                side_effect=RuntimeError("cleanup boom"),
            ),
        ):
            caplog.set_level("WARNING", logger="api.routes.pull_request")
            response = await async_client.post(
                f"/api/pull_requests/{pr.id}/accept"
            )
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json()["status"] == "success"
    assert any(
        "Failed to clean up completed pull requests" in record.message
        for record in caplog.records
    )


@pytest.mark.asyncio
async def test_iterate_pull_request_unauthenticated(async_client, init_mock_db):
    response = await async_client.post(
        "/api/pull_requests/pr_123/iterate",
        json={"comments": "please review"},
    )
    assert response.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.asyncio
async def test_iterate_pull_request_empty_comments(async_client, init_mock_db):
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

            response = await async_client.post(
                f"/api/pull_requests/{mock_pr.id}/iterate",
                json={"comments": "   "},
            )
            assert response.status_code == 400
            assert "Comments are required" in response.json()["detail"]
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_iterate_pull_request_non_open(async_client, init_mock_db):
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
                status=PullRequestStatus.ACCEPTED,
            )
            mock_get_pr.return_value = mock_pr

            response = await async_client.post(
                f"/api/pull_requests/{mock_pr.id}/iterate",
                json={"comments": "please change this"},
            )
            assert response.status_code == 400
            assert "not open" in response.json()["detail"]
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_iterate_pull_request_not_found(async_client, init_mock_db):
    mock_user = AsyncMock()
    mock_user.username = "testuser"
    app.dependency_overrides[get_current_user] = lambda: mock_user

    try:
        with patch(
            "api.routes.pull_request.PullRequest.get", new_callable=AsyncMock
        ) as mock_get_pr:
            mock_get_pr.return_value = None

            response = await async_client.post(
                "/api/pull_requests/pr_123/iterate",
                json={"comments": "please change"},
            )
            assert response.status_code == 404
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_iterate_pull_request_happy_path(async_client, init_mock_db):
    mock_user = AsyncMock()
    mock_user.username = "testuser"
    app.dependency_overrides[get_current_user] = lambda: mock_user

    pr_id = ObjectId()
    mock_pr = PullRequest(
        id=pr_id,
        pipeline_id="pipe_123",
        task_id="task_123",
        summary="summary",
        branch_name="branch",
        patch="patch",
        status=PullRequestStatus.OPEN,
    )

    try:
        with (
            patch(
                "api.routes.pull_request.PullRequest.get", new_callable=AsyncMock
            ) as mock_get_pr,
            patch("api.routes.pull_request.coderbot_manager") as mock_manager,
        ):
            mock_get_pr.return_value = mock_pr
            mock_manager.process_pr_iteration = AsyncMock()

            response = await async_client.post(
                f"/api/pull_requests/{pr_id}/iterate",
                json={"comments": "  Please review and fix  "},
            )
            assert response.status_code == 200
            body = response.json()
            assert body["status"] == "success"
            assert "enqueued" in body["message"]

            mock_manager.process_pr_iteration.assert_awaited_once()
            enqueued_pr, comments = mock_manager.process_pr_iteration.await_args.args
            assert str(enqueued_pr.id) == str(pr_id)
            assert comments == "Please review and fix"
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_accept_pull_request_blocks_out_of_order(async_client, init_mock_db):
    """Accepting a newer PR while an older one is still OPEN returns a 409."""
    mock_user = AsyncMock()
    mock_user.username = "testuser"
    app.dependency_overrides[get_current_user] = lambda: mock_user

    base = datetime(2026, 1, 1, tzinfo=UTC)
    older = PullRequest(
        pipeline_id="pipe_123",
        task_id="task_old",
        summary="old",
        branch_name="coderbot/old",
        patch="patch",
        status=PullRequestStatus.OPEN,
        created_at=base,
    )
    await older.insert()

    newer_id = ObjectId()
    newer = PullRequest(
        id=newer_id,
        pipeline_id="pipe_123",
        task_id="task_new",
        summary="new",
        branch_name="coderbot/new",
        patch="patch",
        status=PullRequestStatus.OPEN,
        created_at=base + timedelta(hours=1),
    )

    try:
        with patch(
            "api.routes.pull_request.PullRequest.get",
            new_callable=AsyncMock,
            return_value=newer,
        ):
            response = await async_client.post(
                f"/api/pull_requests/{newer_id}/accept"
            )

        assert response.status_code == 409
        assert "older pull request" in response.json()["detail"].lower()
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_accept_pull_request_force_allows_out_of_order(
    async_client, init_mock_db
):
    """``force=true`` accepts a newer PR even though an older one is OPEN."""
    mock_user = AsyncMock()
    mock_user.username = "testuser"
    app.dependency_overrides[get_current_user] = lambda: mock_user

    base = datetime(2026, 1, 1, tzinfo=UTC)
    older = PullRequest(
        pipeline_id="pipe_123",
        task_id="task_old",
        summary="old",
        branch_name="coderbot/old",
        patch="patch",
        status=PullRequestStatus.OPEN,
        created_at=base,
    )
    await older.insert()

    pr_id = ObjectId()
    mock_pr = PullRequest(
        id=pr_id,
        pipeline_id="pipe_123",
        task_id="task_new",
        summary="summary",
        branch_name="feature/x",
        patch="patch",
        status=PullRequestStatus.OPEN,
        created_at=base + timedelta(hours=1),
    )
    mock_pipeline = MagicMock()
    mock_pipeline.workspace_abs_path = "/tmp/remote_repo"
    mock_pipeline.repo_uri = "https://host/owner/repo.git"
    mock_repo = MagicMock()
    mock_task = MagicMock()
    mock_task.id = "task_new"
    mock_task.status = TaskStatus.PULL_REQUEST_AVAILABLE

    try:
        with (
            patch(
                "api.routes.pull_request.PullRequest.get",
                new_callable=AsyncMock,
                return_value=mock_pr,
            ),
            patch("api.routes.pull_request.Pipeline.get", return_value=mock_pipeline),
            patch("api.routes.pull_request.git_utils.get_repo", return_value=mock_repo),
            patch(
                "api.routes.pull_request.validate_workspace_clean",
                new_callable=AsyncMock,
            ),
            patch("api.routes.pull_request.apply_patch", new_callable=AsyncMock),
            patch("api.routes.pull_request.format_workspace", new_callable=AsyncMock),
            patch("api.routes.pull_request.commit_changes", return_value="abc1234"),
            patch("api.routes.pull_request.git_utils.push_with_auth"),
            patch("api.routes.pull_request.Task.get", return_value=mock_task),
            patch(
                "api.routes.pull_request.update_pull_request_status",
                new_callable=AsyncMock,
            ),
            patch(
                "api.routes.pull_request.update_task_status",
                new_callable=AsyncMock,
            ),
            patch.object(pr_routes.config, "REMOTE_PR_MODE", "direct"),
        ):
            response = await async_client.post(
                f"/api/pull_requests/{pr_id}/accept",
                json={"force": True},
            )

        assert response.status_code == 200
    finally:
        app.dependency_overrides.clear()
