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

"""Unit tests for the :class:`NotificationManager` service."""

from unittest.mock import AsyncMock

import pytest

from core.models.models import (
    Notification,
    NotificationAction,
    NotificationSeverity,
    NotificationType,
)
from core.services.notification_manager import (
    NotificationActionAlreadyRegisteredError,
    NotificationActionContext,
    NotificationActionNotFoundError,
    NotificationManager,
    notification_manager,
)


@pytest.fixture(autouse=True)
def reset_manager():
    NotificationManager.reset()
    yield
    NotificationManager.reset()


def _context() -> NotificationActionContext:
    return NotificationActionContext(
        username="alice", notification_id="n-1", client_id="c-1"
    )


async def test_notify_message_builds_message_notification():
    sink = AsyncMock()
    notification_manager.set_delivery_sink(sink)

    notification = await notification_manager.notify_message(
        "Hello", "World", severity=NotificationSeverity.WARNING
    )

    assert notification.type == NotificationType.MESSAGE
    assert notification.severity == NotificationSeverity.WARNING
    assert notification.title == "Hello"
    assert notification.message == "World"
    assert notification.actions == []
    sink.assert_awaited_once_with(notification, None)


async def test_notify_confirmation_wraps_single_action():
    sink = AsyncMock()
    notification_manager.set_delivery_sink(sink)
    action = NotificationAction(name="pull_remote", label="Pull", data={"x": 1})

    notification = await notification_manager.notify_confirmation(
        "Pull?", "Do it?", action=action, targets=["alice"]
    )

    assert notification.type == NotificationType.CONFIRMATION
    assert notification.actions == [action]
    sink.assert_awaited_once_with(notification, ["alice"])


async def test_notify_actions_preserves_action_order():
    notification_manager.set_delivery_sink(AsyncMock())
    actions = [
        NotificationAction(name="a", label="A"),
        NotificationAction(name="b", label="B", style="danger"),
    ]

    notification = await notification_manager.notify_actions(
        "Choose", "Pick one", actions=actions
    )

    assert notification.type == NotificationType.ACTIONS
    assert [a.name for a in notification.actions] == ["a", "b"]


async def test_notify_actions_accepts_stable_id():
    notification_manager.set_delivery_sink(AsyncMock())

    notification = await notification_manager.notify_actions(
        "Ready",
        "Body",
        actions=[NotificationAction(name="a", label="A")],
        id="specagent:task-1",
    )

    assert notification.id == "specagent:task-1"


async def test_send_without_sink_is_soft_failure():
    # No sink installed -> should not raise, just return the notification.
    notification = Notification(
        type=NotificationType.MESSAGE, title="No sink", message=""
    )
    result = await notification_manager.send(notification)
    assert result is notification


async def test_send_forwards_targets_none_for_broadcast():
    sink = AsyncMock()
    notification_manager.set_delivery_sink(sink)
    notification = Notification(type=NotificationType.MESSAGE, title="Broadcast")

    await notification_manager.send(notification, None)

    sink.assert_awaited_once_with(notification, None)


async def test_dispatch_action_calls_handler_with_data_and_context():
    seen = {}

    async def handler(data, context):
        seen["data"] = data
        seen["context"] = context
        return {"ok": True}

    notification_manager.register_action("do_it", handler)
    result = await notification_manager.dispatch_action(
        "do_it", {"value": 42}, _context()
    )

    assert result == {"ok": True}
    assert seen["data"] == {"value": 42}
    assert seen["context"].username == "alice"


async def test_dispatch_action_normalizes_missing_data():
    captured = {}

    async def handler(data, context):
        captured["data"] = data
        return None

    notification_manager.register_action("x", handler)
    await notification_manager.dispatch_action("x", None, _context())

    assert captured["data"] == {}


async def test_dispatch_unknown_action_raises():
    with pytest.raises(NotificationActionNotFoundError):
        await notification_manager.dispatch_action("missing", {}, _context())


async def test_duplicate_registration_rejected_unless_replace():
    async def handler(data, context):  # pragma: no cover - never called
        return None

    notification_manager.register_action("dup", handler)
    with pytest.raises(NotificationActionAlreadyRegisteredError):
        notification_manager.register_action("dup", handler)

    async def replacement(data, context):
        return "replaced"

    notification_manager.register_action("dup", replacement, replace=True)
    assert notification_manager.get_action("dup") is replacement


def test_empty_action_name_rejected():
    async def handler(data, context):  # pragma: no cover - never called
        return None

    with pytest.raises(Exception):
        notification_manager.register_action("", handler)


def test_unregister_and_list_actions():
    async def handler(data, context):  # pragma: no cover - never called
        return None

    notification_manager.register_action("a", handler)
    notification_manager.register_action("b", handler)

    assert set(notification_manager.list_actions()) == {"a", "b"}
    assert notification_manager.unregister_action("a") is True
    assert notification_manager.unregister_action("a") is False
    assert notification_manager.list_actions() == ["b"]


def test_register_action_decorator_registers_on_singleton():
    from core.services.notification_manager import register_action

    @register_action("decorated")
    async def handler(data, context):  # pragma: no cover - never called
        return "ok"

    assert notification_manager.get_action("decorated") is handler
