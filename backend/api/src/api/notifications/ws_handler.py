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

"""WebSocket bridge for the notification framework.

This module lives in the ``api`` layer (``core`` never imports from ``api``) and
wires the notification message family into the shared ``/ws/{client_id}``
:class:`~api.websocket_manager.ConnectionManager`:

* ``NOTIFICATION`` (server → client) — a serialized
  :class:`~core.models.models.Notification`.
* ``notification_action`` (client → server) — the user confirmed/selected an
  action; the payload is ``{notification_id, action, data, token}``.
* ``NOTIFICATION_ACTION_RESULT`` (server → client) — the outcome of executing
  the action, payload ``{notification_id, action, status, result, error}``.

Inbound actions are authenticated exactly like any other remote call: the JWT
from the payload is validated with
:func:`api.auth.get_current_user_from_token` before the handler runs.
"""

from __future__ import annotations

import logging
from datetime import date, datetime
from typing import Any, Dict, Optional

from fastapi import WebSocket
from pydantic import BaseModel

from api.auth import get_current_user_from_token
from api.notifications.actions import register_builtin_actions
from api.websocket_manager import ConnectionManager, WSMessage
from api.websocket_manager import manager as default_manager
from core.models.models import Notification
from core.services.notification_manager import (
    NotificationActionContext,
    NotificationActionNotFoundError,
    notification_manager,
)

logger = logging.getLogger(__name__)

__all__ = [
    "NOTIFICATION",
    "NOTIFICATION_ACTION",
    "NOTIFICATION_ACTION_RESULT",
    "handle_notification_action",
    "register_notification_handlers",
    "send_notification",
]

# -- Message types ---------------------------------------------------------

#: Server → client: a serialized :class:`~core.models.models.Notification`.
NOTIFICATION = "NOTIFICATION"
#: Client → server: the user confirmed/selected a notification action.
NOTIFICATION_ACTION = "notification_action"
#: Server → client: the outcome of executing the action.
NOTIFICATION_ACTION_RESULT = "NOTIFICATION_ACTION_RESULT"


def _payload(message: WSMessage) -> Dict[str, Any]:
    """Returns the message payload as a plain ``dict`` (never ``None``)."""

    payload = message.payload
    if isinstance(payload, dict):
        return payload
    return {}


def _jsonable(value: Any) -> Any:
    """Coerces a handler result into something JSON-serializable."""

    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, (list, tuple)):
        return [_jsonable(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _jsonable(item) for key, item in value.items()}
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    # Last resort: stringify so the result message can always be sent.
    return str(value)


async def _send_result(
    websocket: WebSocket,
    *,
    notification_id: str,
    action: str,
    status: str,
    result: Any = None,
    error: Optional[str] = None,
) -> None:
    """Sends a ``NOTIFICATION_ACTION_RESULT`` correlated by notification id."""

    message = WSMessage(
        type=NOTIFICATION_ACTION_RESULT,
        id=notification_id,
        payload={
            "notification_id": notification_id,
            "action": action,
            "status": status,
            "result": _jsonable(result),
            "error": error,
        },
    )
    await websocket.send_text(message.model_dump_json())


async def handle_notification_action(
    message: WSMessage,
    websocket: WebSocket,
    *,
    manager: Optional[ConnectionManager] = None,
) -> None:
    """Handles an inbound ``notification_action`` request.

    The caller is authenticated from the JWT in the payload (identical to
    ``assistant_message``); unauthenticated requests never reach the registry.
    The registered handler is then awaited with ``(data, context)`` and the
    outcome relayed back as ``NOTIFICATION_ACTION_RESULT``.
    """

    payload = _payload(message)
    token = payload.get("token")
    user = await get_current_user_from_token(token)

    notification_id = str(payload.get("notification_id") or message.id or "")
    action_name = str(payload.get("action") or "")
    data = payload.get("data")
    if not isinstance(data, dict):
        data = {}

    if not user:
        await _send_result(
            websocket,
            notification_id=notification_id,
            action=action_name,
            status="unauthorized",
            error="Unauthorized",
        )
        return

    cm = manager if manager is not None else default_manager
    client_id = next(
        (cid for cid, ws in cm.active_connections.items() if ws is websocket),
        None,
    )
    context = NotificationActionContext(
        username=user.username,
        notification_id=notification_id,
        client_id=client_id,
    )

    try:
        result = await notification_manager.dispatch_action(action_name, data, context)
    except NotificationActionNotFoundError as exc:
        await _send_result(
            websocket,
            notification_id=notification_id,
            action=action_name,
            status="error",
            error=str(exc),
        )
        return
    except Exception as exc:  # noqa: BLE001 - surface failures to the client
        logger.exception(
            "Notification action '%s' failed for user %s.", action_name, user.username
        )
        await _send_result(
            websocket,
            notification_id=notification_id,
            action=action_name,
            status="error",
            error=str(exc),
        )
        return

    await _send_result(
        websocket,
        notification_id=notification_id,
        action=action_name,
        status="ok",
        result=result,
    )


async def send_notification(
    notification: Notification,
    targets: Optional[list[str]] = None,
    *,
    manager: Optional[ConnectionManager] = None,
) -> None:
    """Delivers a notification over ``manager`` (defaults to the global one)."""

    cm = manager if manager is not None else default_manager
    message = WSMessage(
        type=NOTIFICATION,
        id=notification.id,
        payload=notification.model_dump(mode="json"),
    )
    if targets:
        await cm.send_to_users(message, targets)
    else:
        await cm.broadcast(message)


def register_notification_handlers(
    manager: Optional[ConnectionManager] = None,
) -> ConnectionManager:
    """Registers the inbound handler and installs the delivery sink.

    Args:
        manager: Connection manager to register with. Defaults to the
            process-wide :data:`api.websocket_manager.manager`.

    Returns:
        The manager the handler was registered on.
    """

    cm = manager if manager is not None else default_manager
    cm.register_handler(NOTIFICATION_ACTION, handle_notification_action)

    async def _delivery_sink(
        notification: Notification,
        targets: Optional[list[str]],
    ) -> None:
        await send_notification(notification, targets, manager=cm)

    notification_manager.set_delivery_sink(_delivery_sink)
    register_builtin_actions()
    logger.debug("Registered notification WebSocket handlers.")
    return cm
