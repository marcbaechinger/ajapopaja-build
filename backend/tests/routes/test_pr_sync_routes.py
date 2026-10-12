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

"""Tests for the on-demand ``POST /api/pipelines/{id}/pull_requests/sync``.

The endpoint must reuse the shared notifier/poller reconciliation (never a
second implementation), only act on ``SUBMITTED`` PRs, report ``busy`` for an
active session, surface sync failures without a 500 and reject concurrent syncs
for the same pipeline.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import status

from api.auth import get_current_user
from api.git_hosting.branch_notifier import PrStateNotifier, SyncResult
from api.git_hosting.pr_poller import (
    _release_pipeline_sync,
    _try_acquire_pipeline_sync,
    reconcile_submitted_pull_requests,
)
from api.main import app
from core.models.models import (
    Pipeline,
    PullRequest,
    PullRequestStatus,
    Task,
    TaskStatus,
)


@pytest.fixture(autouse=True)
def mock_auth():
    mock_user = MagicMock()
    mock_user.username = "testuser"
    app.dependency_overrides[get_current_user] = lambda: mock_user
    yield
    app.dependency_overrides.clear()


def _fake_gitea(data):
    """A stand-in GiteaClient whose get_pull_request returns ``data``."""
    client = MagicMock()
    client.get_pull_request = AsyncMock(return_value=data)
    client.aclose = AsyncMock()
    return client


def _merged_payload():
    return {
        "state": "closed",
        "merged": True,
        "merge_commit_sha": "merge-sha-123",
        "base": {"ref": "main"},
    }


def _open_payload():
    return {"state": "open", "merged": False, "base": {"ref": "main"}}


async def _insert_pipeline_and_pr(
    *, remote_pr_url: str = "https://host/org/myapp/pulls/42"
):
    pipeline = Pipeline(
        name="myapp",
        repo_uri="https://host/org/myapp.git",
        repo_username="user",
        repo_token="tok",
    )
    await pipeline.insert()

    task = Task(
        title="Implement a feature",
        pipeline_id=str(pipeline.id),
        status=TaskStatus.SUBMITTED,
    )
    await task.insert()

    pr = PullRequest(
        pipeline_id=str(pipeline.id),
        task_id=str(task.id),
        summary="summary",
        subject="subject",
        branch_name="coderbot/t1",
        patch="patch",
        status=PullRequestStatus.SUBMITTED,
        base_branch="main",
        remote_pr_url=remote_pr_url,
    )
    await pr.insert()
    return pipeline, task, pr


@pytest.mark.asyncio
async def test_sync_endpoint_calls_shared_reconcile_function(
    async_client, init_mock_db
):
    """The route must delegate to the shared poller reconcile helper."""
    pipeline = Pipeline(
        name="myapp",
        repo_uri="https://host/org/myapp.git",
        repo_token="tok",
    )
    await pipeline.insert()

    summary = {"status": "ok", "up_to_date": True, "reconciled": []}
    with patch(
        "api.routes.pipeline.reconcile_pipeline_pull_requests",
        new=AsyncMock(return_value=summary),
    ) as mock_reconcile:
        response = await async_client.post(
            f"/api/pipelines/{pipeline.id}/pull_requests/sync"
        )

    assert response.status_code == status.HTTP_200_OK
    assert response.json() == summary
    mock_reconcile.assert_awaited_once()
    # The first positional argument is the shared notifier instance.
    assert mock_reconcile.await_args.args[1] == str(pipeline.id)


@pytest.mark.asyncio
async def test_sync_endpoint_unknown_pipeline_404(async_client, init_mock_db):
    response = await async_client.post("/api/pipelines/unknown/pull_requests/sync")
    assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.asyncio
async def test_sync_endpoint_up_to_date_noop(async_client, init_mock_db):
    pipeline, task, pr = await _insert_pipeline_and_pr()
    fake = _fake_gitea(_open_payload())

    with patch("api.git_hosting.pr_poller.GiteaClient", new=lambda *a, **k: fake):
        response = await async_client.post(
            f"/api/pipelines/{pipeline.id}/pull_requests/sync"
        )

    assert response.status_code == status.HTTP_200_OK
    body = response.json()
    assert body["up_to_date"] is True
    assert body["reconciled"] == []

    # Nothing changed.
    assert (await PullRequest.get(pr.id)).status == PullRequestStatus.SUBMITTED
    assert (await Task.get(task.id)).status == TaskStatus.SUBMITTED


@pytest.mark.asyncio
async def test_sync_endpoint_merged_pr_is_accepted(async_client, init_mock_db):
    pipeline, task, pr = await _insert_pipeline_and_pr()
    fake = _fake_gitea(_merged_payload())

    with (
        patch("api.git_hosting.pr_poller.GiteaClient", new=lambda *a, **k: fake),
        patch.object(
            PrStateNotifier,
            "fetch_pipeline_repo",
            new=AsyncMock(return_value=SyncResult(status="synced")),
        ),
        patch(
            "api.git_hosting.branch_notifier.git_utils.get_repo",
            return_value=MagicMock(),
        ),
        patch.object(PrStateNotifier, "verify_commit_present", return_value=True),
    ):
        response = await async_client.post(
            f"/api/pipelines/{pipeline.id}/pull_requests/sync"
        )

    assert response.status_code == status.HTTP_200_OK
    body = response.json()
    assert body["up_to_date"] is False
    assert len(body["reconciled"]) == 1
    entry = body["reconciled"][0]
    assert entry["pr_id"] == str(pr.id)
    assert entry["gitea_pr"] == 42
    assert entry["remote_state"] == "merged"
    assert entry["outcome"] == "accepted"
    assert entry["task_id"] == str(task.id)
    assert entry["task_status"] == "implemented"

    assert (await PullRequest.get(pr.id)).status == PullRequestStatus.ACCEPTED
    updated_task = await Task.get(task.id)
    assert updated_task.status == TaskStatus.IMPLEMENTED
    assert updated_task.commit_hash == "merge-sha-123"


@pytest.mark.asyncio
async def test_sync_endpoint_closed_pr_is_rejected(async_client, init_mock_db):
    pipeline, task, pr = await _insert_pipeline_and_pr()
    fake = _fake_gitea({"state": "closed", "merged": False, "base": {"ref": "main"}})

    with (
        patch("api.git_hosting.pr_poller.GiteaClient", new=lambda *a, **k: fake),
        patch(
            "api.git_hosting.branch_notifier.PrStateNotifier.fetch_pipeline_repo",
            new=AsyncMock(return_value=SyncResult(status="synced")),
        ),
    ):
        response = await async_client.post(
            f"/api/pipelines/{pipeline.id}/pull_requests/sync"
        )

    assert response.status_code == status.HTTP_200_OK
    body = response.json()
    assert body["up_to_date"] is False
    entry = body["reconciled"][0]
    assert entry["remote_state"] == "closed"
    assert entry["outcome"] == "rejected"
    assert entry["task_status"] == "created"

    assert (await PullRequest.get(pr.id)).status == PullRequestStatus.REJECTED
    assert (await Task.get(task.id)).status == TaskStatus.CREATED


@pytest.mark.asyncio
async def test_sync_endpoint_busy_pipeline(async_client, init_mock_db):
    pipeline, _task, _pr = await _insert_pipeline_and_pr()

    with patch.object(
        PrStateNotifier, "pipeline_busy", new=AsyncMock(return_value=True)
    ):
        response = await async_client.post(
            f"/api/pipelines/{pipeline.id}/pull_requests/sync"
        )

    assert response.status_code == status.HTTP_200_OK
    body = response.json()
    assert body["status"] == "busy"
    assert body["up_to_date"] is False
    assert body["reconciled"] == []


@pytest.mark.asyncio
async def test_sync_endpoint_gitea_failure_is_surfaced(async_client, init_mock_db):
    pipeline, _task, _pr = await _insert_pipeline_and_pr()
    client = MagicMock()
    client.get_pull_request = AsyncMock(side_effect=RuntimeError("gitea down"))
    client.aclose = AsyncMock()

    with patch("api.git_hosting.pr_poller.GiteaClient", new=lambda *a, **k: client):
        response = await async_client.post(
            f"/api/pipelines/{pipeline.id}/pull_requests/sync"
        )

    # No 500: the failure is reported in the summary body.
    assert response.status_code == status.HTTP_200_OK
    body = response.json()
    assert body["status"] == "sync_failed"
    assert body["reconciled"] == []


@pytest.mark.asyncio
async def test_sync_endpoint_commit_not_found_is_sync_failed(
    async_client, init_mock_db
):
    pipeline, _task, pr = await _insert_pipeline_and_pr()
    fake = _fake_gitea(_merged_payload())

    with (
        patch("api.git_hosting.pr_poller.GiteaClient", new=lambda *a, **k: fake),
        patch.object(
            PrStateNotifier,
            "fetch_pipeline_repo",
            new=AsyncMock(return_value=SyncResult(status="synced")),
        ),
        patch(
            "api.git_hosting.branch_notifier.git_utils.get_repo",
            return_value=MagicMock(),
        ),
        patch.object(PrStateNotifier, "verify_commit_present", return_value=False),
    ):
        response = await async_client.post(
            f"/api/pipelines/{pipeline.id}/pull_requests/sync"
        )

    assert response.status_code == status.HTTP_200_OK
    body = response.json()
    assert body["status"] == "sync_failed"
    assert body["reconciled"] == []
    # The unverified merge must not be mirrored.
    assert (await PullRequest.get(pr.id)).status == PullRequestStatus.SUBMITTED


@pytest.mark.asyncio
async def test_sync_endpoint_rejects_concurrent_sync(async_client, init_mock_db):
    pipeline, _task, _pr = await _insert_pipeline_and_pr()

    acquired = await _try_acquire_pipeline_sync(str(pipeline.id))
    assert acquired is True
    try:
        response = await async_client.post(
            f"/api/pipelines/{pipeline.id}/pull_requests/sync"
        )
    finally:
        await _release_pipeline_sync(str(pipeline.id))

    assert response.status_code == status.HTTP_200_OK
    body = response.json()
    assert body["status"] == "already_running"
    assert body["reconciled"] == []


@pytest.mark.asyncio
async def test_poller_reuses_shared_reconcile_function(init_mock_db):
    """The background poller must call the same per-pipeline helper as the
    on-demand endpoint (no duplicate reconciliation implementation)."""
    pipeline_a = Pipeline(name="a", repo_uri="https://host/org/a.git")
    pipeline_b = Pipeline(name="b", repo_uri="https://host/org/b.git")
    await pipeline_a.insert()
    await pipeline_b.insert()

    for pipeline in (pipeline_a, pipeline_b):
        task = Task(
            title="t", pipeline_id=str(pipeline.id), status=TaskStatus.SUBMITTED
        )
        await task.insert()
        await PullRequest(
            pipeline_id=str(pipeline.id),
            task_id=str(task.id),
            summary="s",
            branch_name="b",
            patch="p",
            status=PullRequestStatus.SUBMITTED,
            remote_pr_url="https://host/org/repo/pulls/1",
        ).insert()

    with patch(
        "api.git_hosting.pr_poller.reconcile_pipeline_pull_requests",
        new=AsyncMock(
            return_value={"status": "ok", "up_to_date": True, "reconciled": []}
        ),
    ) as mock_reconcile:
        await reconcile_submitted_pull_requests(MagicMock())

    called_ids = {call.args[1] for call in mock_reconcile.await_args_list}
    assert called_ids == {str(pipeline_a.id), str(pipeline_b.id)}
