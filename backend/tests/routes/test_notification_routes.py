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

"""Tests for the optional notification REST endpoint."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import status

from api.auth import get_current_user
from api.main import app


@pytest.fixture
def mock_auth():
    user = MagicMock()
    user.username = "testuser"
    app.dependency_overrides[get_current_user] = lambda: user
    yield user
    app.dependency_overrides.clear()


async def test_create_notification_requires_auth(async_client, init_mock_db):
    app.dependency_overrides.pop(get_current_user, None)

    response = await async_client.post(
        "/api/notifications",
        json={"type": "message", "title": "Hi", "message": "there"},
    )

    assert response.status_code == status.HTTP_401_UNAUTHORIZED


async def test_create_notification_forwards_to_manager(
    async_client, mock_auth, init_mock_db
):
    with patch(
        "api.notifications.router.notification_manager.send", new=AsyncMock()
    ) as mock_send:
        response = await async_client.post(
            "/api/notifications",
            json={
                "type": "confirmation",
                "severity": "warning",
                "title": "Pull?",
                "message": "Pull remote now",
                "actions": [{"name": "pull_remote", "label": "Pull", "data": {"x": 1}}],
                "targets": ["alice"],
            },
        )

    assert response.status_code == status.HTTP_200_OK
    body = response.json()
    assert body["type"] == "confirmation"
    assert body["severity"] == "warning"
    assert body["title"] == "Pull?"
    assert body["actions"][0]["name"] == "pull_remote"
    assert body["actions"][0]["data"] == {"x": 1}

    mock_send.assert_awaited_once()
    notification, targets = mock_send.await_args.args
    assert notification.type.value == "confirmation"
    assert targets == ["alice"]


async def test_create_notification_defaults_to_broadcast(
    async_client, mock_auth, init_mock_db
):
    with patch(
        "api.notifications.router.notification_manager.send", new=AsyncMock()
    ) as mock_send:
        response = await async_client.post(
            "/api/notifications",
            json={"type": "message", "title": "All"},
        )

    assert response.status_code == status.HTTP_200_OK
    _, targets = mock_send.await_args.args
    assert targets is None
