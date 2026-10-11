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
from fastapi import status

from api.auth import get_current_user
from api.main import app
from core.models.models import Pipeline, PullRequest, PullRequestStatus
from core.services.dev_process_manager import (
    DevProcessAlreadyRunningError,
    DevProcessManager,
    DevProcessNotFoundError,
)


@pytest.fixture(autouse=True)
def mock_auth():
    mock_user = MagicMock()
    mock_user.username = "testuser"
    app.dependency_overrides[get_current_user] = lambda: mock_user
    yield
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_dev_status(async_client, init_mock_db):
    with patch.object(
        DevProcessManager, "status", new_callable=AsyncMock
    ) as mock_status:
        mock_status.return_value = {
            "running": False,
            "pid": None,
            "exit_code": None,
            "port": 1224,
        }
        response = await async_client.get("/api/pipelines/p1/dev/status")
        assert response.status_code == status.HTTP_200_OK
        assert response.json() == {
            "running": False,
            "pid": None,
            "exit_code": None,
            "port": 1224,
        }


@pytest.mark.asyncio
async def test_dev_start_without_serve_commands(async_client, init_mock_db):
    pipeline = Pipeline(name="No serve")
    await pipeline.insert()

    response = await async_client.post(f"/api/pipelines/{pipeline.id}/dev/start")
    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "No serve commands" in response.json()["detail"]


@pytest.mark.asyncio
async def test_dev_start_pipeline_not_found(async_client, init_mock_db):
    response = await async_client.post("/api/pipelines/does-not-exist/dev/start")
    assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.asyncio
async def test_dev_start_uses_pipeline_serve_commands(async_client, init_mock_db):
    pipeline = Pipeline(name="Serve", serve_commands=[["sh", "-c", "sleep 30"]])
    await pipeline.insert()

    with patch.object(DevProcessManager, "start", new_callable=AsyncMock) as mock_start:
        mock_start.return_value = {
            "status": "started",
            "run_id": "abc",
            "pid": 42,
            "port": 1224,
        }
        response = await async_client.post(f"/api/pipelines/{pipeline.id}/dev/start")

    assert response.status_code == status.HTTP_200_OK
    assert response.json()["status"] == "started"
    assert response.json()["port"] == 1224
    mock_start.assert_awaited_once()
    args = mock_start.await_args.args
    assert args[0] == str(pipeline.id)
    assert args[1] == [["sh", "-c", "sleep 30"]]
    assert args[2] == "testuser"


@pytest.mark.asyncio
async def test_dev_start_conflict(async_client, init_mock_db):
    pipeline = Pipeline(name="Serve", serve_commands=[["sh", "-c", "sleep 30"]])
    await pipeline.insert()

    with patch.object(
        DevProcessManager,
        "start",
        new_callable=AsyncMock,
        side_effect=DevProcessAlreadyRunningError("already running"),
    ):
        response = await async_client.post(f"/api/pipelines/{pipeline.id}/dev/start")

    assert response.status_code == status.HTTP_409_CONFLICT
    assert "already running" in response.json()["detail"]


@pytest.mark.asyncio
async def test_dev_stop_success(async_client, init_mock_db):
    with patch.object(DevProcessManager, "stop", new_callable=AsyncMock) as mock_stop:
        mock_stop.return_value = {"status": "stopped", "running": False}
        response = await async_client.post("/api/pipelines/p1/dev/stop")

    assert response.status_code == status.HTTP_200_OK
    assert response.json()["status"] == "stopped"
    mock_stop.assert_awaited_once_with("p1")


@pytest.mark.asyncio
async def test_dev_stop_not_found(async_client, init_mock_db):
    with patch.object(
        DevProcessManager,
        "stop",
        new_callable=AsyncMock,
        side_effect=DevProcessNotFoundError("no process"),
    ):
        response = await async_client.post("/api/pipelines/p1/dev/stop")

    assert response.status_code == status.HTTP_404_NOT_FOUND
    assert "no process" in response.json()["detail"]


@pytest.mark.asyncio
async def test_dev_restart_stops_then_starts(async_client, init_mock_db):
    pipeline = Pipeline(name="Serve", serve_commands=[["sh", "-c", "sleep 30"]])
    await pipeline.insert()

    with (
        patch.object(DevProcessManager, "stop", new_callable=AsyncMock) as mock_stop,
        patch.object(DevProcessManager, "start", new_callable=AsyncMock) as mock_start,
    ):
        mock_start.return_value = {
            "status": "started",
            "run_id": "new",
            "pid": 7,
            "port": 1224,
        }
        response = await async_client.post(f"/api/pipelines/{pipeline.id}/dev/restart")

    assert response.status_code == status.HTTP_200_OK
    assert response.json()["port"] == 1224
    mock_stop.assert_awaited_once()
    mock_start.assert_awaited_once()
    start_args = mock_start.await_args.args
    assert start_args[0] == str(pipeline.id)
    assert start_args[2] == "testuser"


# ---------------------------------------------------------------------------
# Pull-request-scoped dev-server start
# ---------------------------------------------------------------------------


@pytest.fixture
async def open_pr():
    pipeline = Pipeline(
        name="Serve",
        serve_commands=[["sh", "-c", "sleep 30"]],
        build_commands=[["sh", "-c", "true"]],
    )
    await pipeline.insert()
    pr = PullRequest(
        pipeline_id=str(pipeline.id),
        task_id="t1",
        summary="summary",
        subject="subject",
        branch_name="coderbot/t1",
        patch="diff",
        status=PullRequestStatus.OPEN,
    )
    await pr.insert()
    return pipeline, pr


@pytest.mark.asyncio
async def test_dev_start_on_pr_resolves_workspace_and_target(
    async_client, init_mock_db, open_pr
):
    pipeline, pr = open_pr

    with (
        patch(
            "api.routes.dev_server.git_utils.resolve_pr_workspace",
            new_callable=AsyncMock,
        ) as mock_resolve,
        patch(
            "api.routes.dev_server.run_command_sequence",
            new_callable=AsyncMock,
        ) as mock_build,
        patch.object(DevProcessManager, "stop", new_callable=AsyncMock) as mock_stop,
        patch.object(DevProcessManager, "start", new_callable=AsyncMock) as mock_start,
    ):
        mock_resolve.return_value = ("/tmp/pr-ws", "coderbot/t1")
        mock_build.return_value = {"commands": [], "passed": True}
        mock_start.return_value = {
            "status": "started",
            "run_id": "r",
            "pid": 1,
            "port": 1224,
            "target": "coderbot/t1",
        }
        response = await async_client.post(
            f"/api/pipelines/{pipeline.id}/pull_requests/{pr.id}/dev/start"
        )

    assert response.status_code == status.HTTP_200_OK
    assert response.json()["target"] == "coderbot/t1"
    mock_resolve.assert_awaited_once()
    mock_build.assert_awaited_once()
    # The build runs inside the resolved PR checkout.
    assert mock_build.await_args.args[1] == "/tmp/pr-ws"
    mock_stop.assert_awaited_once_with(str(pipeline.id))
    mock_start.assert_awaited_once()
    kwargs = mock_start.await_args.kwargs
    assert kwargs["workspace"] == "/tmp/pr-ws"
    assert kwargs["target"] == "coderbot/t1"


@pytest.mark.asyncio
async def test_dev_start_on_pr_rejects_missing_serve_commands(
    async_client, init_mock_db
):
    pipeline = Pipeline(name="No serve")
    await pipeline.insert()
    pr = PullRequest(
        pipeline_id=str(pipeline.id),
        task_id="t1",
        summary="s",
        subject="s",
        branch_name="coderbot/t1",
        patch="diff",
        status=PullRequestStatus.OPEN,
    )
    await pr.insert()

    response = await async_client.post(
        f"/api/pipelines/{pipeline.id}/pull_requests/{pr.id}/dev/start"
    )
    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "No serve commands" in response.json()["detail"]


@pytest.mark.asyncio
async def test_dev_start_on_pr_aborts_on_build_failure(
    async_client, init_mock_db, open_pr
):
    pipeline, pr = open_pr

    with (
        patch(
            "api.routes.dev_server.git_utils.resolve_pr_workspace",
            new_callable=AsyncMock,
        ) as mock_resolve,
        patch(
            "api.routes.dev_server.run_command_sequence",
            new_callable=AsyncMock,
        ) as mock_build,
        patch.object(DevProcessManager, "stop", new_callable=AsyncMock) as mock_stop,
        patch.object(DevProcessManager, "start", new_callable=AsyncMock) as mock_start,
    ):
        mock_resolve.return_value = ("/tmp/pr-ws", "coderbot/t1")
        mock_build.return_value = {
            "commands": [
                {"cmd": "npm run build", "exit_code": 1, "output_tail": "boom"}
            ],
            "passed": False,
        }
        response = await async_client.post(
            f"/api/pipelines/{pipeline.id}/pull_requests/{pr.id}/dev/start"
        )

    assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert "Build failed" in response.json()["detail"]
    # A failed build must not tear down or start a new server.
    mock_stop.assert_not_called()
    mock_start.assert_not_called()


@pytest.mark.asyncio
async def test_dev_start_on_pr_switches_when_process_running(
    async_client, init_mock_db, open_pr
):
    pipeline, pr = open_pr

    with (
        patch(
            "api.routes.dev_server.git_utils.resolve_pr_workspace",
            new_callable=AsyncMock,
        ) as mock_resolve,
        patch(
            "api.routes.dev_server.run_command_sequence",
            new_callable=AsyncMock,
        ) as mock_build,
        patch.object(DevProcessManager, "stop", new_callable=AsyncMock) as mock_stop,
        patch.object(DevProcessManager, "start", new_callable=AsyncMock) as mock_start,
    ):
        mock_resolve.return_value = ("/tmp/pr-ws", "coderbot/t1")
        mock_build.return_value = {"commands": [], "passed": True}
        mock_stop.side_effect = DevProcessNotFoundError("none")
        mock_start.return_value = {
            "status": "started",
            "run_id": "r",
            "pid": 1,
            "port": 1224,
            "target": "coderbot/t1",
        }
        response = await async_client.post(
            f"/api/pipelines/{pipeline.id}/pull_requests/{pr.id}/dev/start"
        )

    # The stop-not-found is ignored, so the start still happens (switch semantics).
    assert response.status_code == status.HTTP_200_OK
    mock_stop.assert_awaited_once_with(str(pipeline.id))
    mock_start.assert_awaited_once()


@pytest.mark.asyncio
async def test_dev_start_on_pr_not_found(async_client, init_mock_db):
    from bson import ObjectId

    missing_pr_id = str(ObjectId())
    response = await async_client.post(
        f"/api/pipelines/p1/pull_requests/{missing_pr_id}/dev/start"
    )
    assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.asyncio
async def test_dev_start_on_pr_rejects_accepted_pr(async_client, init_mock_db):
    pipeline = Pipeline(
        name="Serve", serve_commands=[["sh", "-c", "sleep 30"]]
    )
    await pipeline.insert()
    pr = PullRequest(
        pipeline_id=str(pipeline.id),
        task_id="t1",
        summary="s",
        subject="s",
        branch_name="coderbot/t1",
        patch="diff",
        status=PullRequestStatus.ACCEPTED,
    )
    await pr.insert()

    response = await async_client.post(
        f"/api/pipelines/{pipeline.id}/pull_requests/{pr.id}/dev/start"
    )
    assert response.status_code == status.HTTP_400_BAD_REQUEST
    assert "OPEN or SUBMITTED" in response.json()["detail"]
