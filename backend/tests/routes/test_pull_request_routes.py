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

from unittest.mock import AsyncMock, patch

import pytest
from bson import ObjectId
from fastapi import status

from api.auth import get_current_user
from api.main import app
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
