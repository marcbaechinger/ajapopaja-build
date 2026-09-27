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

"""Tests for the notification WebSocket bridge."""

from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api.notifications.ws_handler import (
    NOTIFICATION,
    NOTIFICATION_ACTION,
    NOTIFICATION_ACTION_RESULT,
    register_notification_handlers,
)
from api.websocket_manager import ConnectionManager
from core.models.models import Notification, NotificationType
from core.services.notification_manager import (
    NotificationManager,
    notification_manager,
)


@pytest.fixture(autouse=True)
def reset_manager():
    NotificationManager.reset()
    yield
    NotificationManager.reset()


def _sent(websocket: AsyncMock) -> list[dict[str, Any]]:
    return [json.loads(call.args[0]) for call in websocket.send_text.call_args_list]


def _user(username: str = "alice") -> MagicMock:
    user = MagicMock()
    user.username = username
    user.id = "u-1"
    return user


async def _dispatch(cm: ConnectionManager, websocket: AsyncMock, message: dict) -> None:
    await cm.handle_message(json.dumps(message), websocket)


def test_register_notification_handlers_registers_and_installs_sink():
    cm = ConnectionManager()
    returned = register_notification_handlers(cm)

    assert returned is cm
    assert NOTIFICATION_ACTION in cm.handlers
    assert NotificationManager._delivery_sink is not None
    # Built-in actions are registered idempotently.
    assert "noop" in notification_manager.list_actions()
    assert "pull_remote" in notification_manager.list_actions()


async def test_delivery_sink_broadcasts_and_targets_users():
    cm = ConnectionManager()
    register_notification_handlers(cm)
    alice = AsyncMock()
    bob = AsyncMock()
    await cm.add_connection(alice, "c1", "alice")
    await cm.add_connection(bob, "c2", "bob")

    notification = Notification(
        type=NotificationType.MESSAGE, title="Hello", message="World"
    )
    await notification_manager.send(notification)

    alice.send_text.assert_awaited_once()
    bob.send_text.assert_awaited_once()
    sent = _sent(alice)[0]
    assert sent["type"] == NOTIFICATION
    assert sent["id"] == notification.id
    assert sent["payload"]["title"] == "Hello"

    alice.send_text.reset_mock()
    bob.send_text.reset_mock()
    await notification_manager.send(notification, ["alice"])
    alice.send_text.assert_awaited_once()
    bob.send_text.assert_not_awaited()


async def test_unauthenticated_action_does_not_dispatch():
    cm = ConnectionManager()
    register_notification_handlers(cm)
    handler = AsyncMock()
    notification_manager.register_action("do_it", handler)
    websocket = AsyncMock()

    with patch(
        "api.notifications.ws_handler.get_current_user_from_token",
        new=AsyncMock(return_value=None),
    ):
        await _dispatch(
            cm,
            websocket,
            {
                "type": NOTIFICATION_ACTION,
                "payload": {
                    "notification_id": "n-1",
                    "action": "do_it",
                    "data": {},
                    "token": "bad",
                },
            },
        )

    handler.assert_not_awaited()
    sent = _sent(websocket)
    assert len(sent) == 1
    assert sent[0]["type"] == NOTIFICATION_ACTION_RESULT
    assert sent[0]["payload"]["status"] == "unauthorized"
    assert sent[0]["payload"]["notification_id"] == "n-1"


async def test_authenticated_action_dispatches_and_returns_result():
    cm = ConnectionManager()
    register_notification_handlers(cm)
    captured: dict[str, Any] = {}

    async def handler(data, context):
        captured["data"] = data
        captured["context"] = context
        return {"echo": data, "user": context.username}

    notification_manager.register_action("do_it", handler)
    websocket = AsyncMock()

    with patch(
        "api.notifications.ws_handler.get_current_user_from_token",
        new=AsyncMock(return_value=_user("alice")),
    ):
        await _dispatch(
            cm,
            websocket,
            {
                "type": NOTIFICATION_ACTION,
                "payload": {
                    "notification_id": "n-1",
                    "action": "do_it",
                    "data": {"a": 1},
                    "token": "good",
                },
            },
        )

    assert captured["data"] == {"a": 1}
    assert captured["context"].username == "alice"
    assert captured["context"].notification_id == "n-1"
    # The originating connection is resolved so handlers can target it.
    assert captured["context"].client_id is None

    sent = _sent(websocket)
    assert len(sent) == 1
    result = sent[0]
    assert result["type"] == NOTIFICATION_ACTION_RESULT
    assert result["id"] == "n-1"
    assert result["payload"] == {
        "notification_id": "n-1",
        "action": "do_it",
        "status": "ok",
        "result": {"echo": {"a": 1}, "user": "alice"},
        "error": None,
    }


async def test_unknown_action_yields_error_result():
    cm = ConnectionManager()
    register_notification_handlers(cm)
    websocket = AsyncMock()

    with patch(
        "api.notifications.ws_handler.get_current_user_from_token",
        new=AsyncMock(return_value=_user("alice")),
    ):
        await _dispatch(
            cm,
            websocket,
            {
                "type": NOTIFICATION_ACTION,
                "payload": {
                    "notification_id": "n-2",
                    "action": "does-not-exist",
                    "token": "good",
                },
            },
        )

    sent = _sent(websocket)
    assert len(sent) == 1
    payload = sent[0]["payload"]
    assert payload["status"] == "error"
    assert payload["action"] == "does-not-exist"
    assert "does-not-exist" in payload["error"]


async def test_handler_exception_is_surfaced_as_error_result():
    cm = ConnectionManager()
    register_notification_handlers(cm)

    async def boom(data, context):
        raise RuntimeError("kaboom")

    notification_manager.register_action("boom", boom)
    websocket = AsyncMock()

    with patch(
        "api.notifications.ws_handler.get_current_user_from_token",
        new=AsyncMock(return_value=_user("alice")),
    ):
        await _dispatch(
            cm,
            websocket,
            {
                "type": NOTIFICATION_ACTION,
                "payload": {
                    "notification_id": "n-3",
                    "action": "boom",
                    "token": "good",
                },
            },
        )

    sent = _sent(websocket)
    assert sent[0]["payload"]["status"] == "error"
    assert "kaboom" in sent[0]["payload"]["error"]


async def test_notification_id_falls_back_to_message_id():
    cm = ConnectionManager()
    register_notification_handlers(cm)
    notification_manager.register_action(
        "noop", AsyncMock(return_value=None), replace=True
    )
    websocket = AsyncMock()

    with patch(
        "api.notifications.ws_handler.get_current_user_from_token",
        new=AsyncMock(return_value=_user("alice")),
    ):
        await _dispatch(
            cm,
            websocket,
            {
                "type": NOTIFICATION_ACTION,
                "id": "msg-42",
                "payload": {"action": "noop", "token": "good"},
            },
        )

    sent = _sent(websocket)
    assert sent[0]["id"] == "msg-42"
    assert sent[0]["payload"]["notification_id"] == "msg-42"
