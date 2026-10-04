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

"""Notification framework service.

``NotificationManager`` is the process-wide, framework-agnostic core of the
notification infrastructure. It owns two things:

* the **action registry** — a mapping from action name to an async handler
  ``(data, context) -> Any`` that runs when the user confirms/selects an action
  in the UI. Registration intentionally mirrors the shape of
  :class:`api.bot.tool_registry.ToolRegistry` (name → callable with
  register/lookup/unregister), but lives in ``core`` so API routers, bots and
  services can all register handlers.
* the **delivery sink** — an api-layer hook that actually pushes a
  :class:`~core.models.models.Notification` to "all users" or "specific users".
  Keeping it as a dependency-inversion hook means the ``core`` layer never
  imports from ``api``.

Any backend module can then send a notification with the high-level helpers
(:meth:`NotificationManager.notify_message`,
:meth:`NotificationManager.notify_confirmation`,
:meth:`NotificationManager.notify_actions`) and have the user's decision flow
back through :meth:`NotificationManager.dispatch_action`.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Dict, List, Optional

from core.models.models import (
    Notification,
    NotificationAction,
    NotificationSeverity,
    NotificationType,
)

logger = logging.getLogger(__name__)


class NotificationError(Exception):
    """Base error for notification management."""


class NotificationActionNotFoundError(NotificationError):
    """Raised when an action name has no registered handler."""


class NotificationActionAlreadyRegisteredError(NotificationError):
    """Raised when registering an action name that is already taken."""


@dataclass
class NotificationActionContext:
    """Identity of the user/client that triggered a notification action."""

    username: str
    notification_id: str
    client_id: Optional[str] = None


#: Signature of a registered action handler.
ActionHandler = Callable[[Dict[str, Any], NotificationActionContext], Awaitable[Any]]

#: Signature of the delivery sink installed by the api layer. ``targets=None``
#: means "broadcast to all"; a list of usernames means "only those users".
DeliverySink = Callable[[Notification, Optional[List[str]]], Awaitable[None]]


class NotificationManager:
    """Singleton owning the action registry and the delivery sink.

    ``_actions`` and ``_delivery_sink`` are class-level so every caller shares
    the same registrations regardless of which module instantiated the manager
    (mirroring :class:`~core.services.dev_process_manager.DevProcessManager`).
    """

    _instance: Optional["NotificationManager"] = None
    _actions: Dict[str, ActionHandler] = {}
    _delivery_sink: Optional[DeliverySink] = None

    @classmethod
    def instance(cls) -> "NotificationManager":
        """Returns the process-wide singleton instance."""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @classmethod
    def set_delivery_sink(cls, sink: Optional[DeliverySink]) -> None:
        """Installs the delivery sink (``None`` restores the no-op default).

        The api layer wires this to :class:`api.websocket_manager.ConnectionManager`;
        the ``core`` layer only knows the hook.
        """
        cls._delivery_sink = sink

    # -- Action registry ---------------------------------------------------

    def register_action(
        self,
        name: str,
        handler: ActionHandler,
        *,
        replace: bool = False,
    ) -> None:
        """Registers ``handler`` under ``name``.

        Raises :class:`NotificationActionAlreadyRegisteredError` when the name
        is already taken and ``replace`` is ``False``.
        """
        if not name:
            raise NotificationError("Action name must be a non-empty string")
        registry = type(self)._actions
        if name in registry and not replace:
            raise NotificationActionAlreadyRegisteredError(
                f"Notification action '{name}' is already registered"
            )
        registry[name] = handler

    def get_action(self, name: str) -> Optional[ActionHandler]:
        """Returns the handler registered for ``name`` (or ``None``)."""
        return type(self)._actions.get(name)

    def unregister_action(self, name: str) -> bool:
        """Removes an action. Returns ``True`` when one was removed."""
        return type(self)._actions.pop(name, None) is not None

    def list_actions(self) -> List[str]:
        """Returns the names of every registered action."""
        return list(type(self)._actions.keys())

    # -- Delivery ----------------------------------------------------------

    async def send(
        self,
        notification: Notification,
        targets: Optional[List[str]] = None,
    ) -> Notification:
        """Delivers ``notification`` through the installed sink.

        ``targets=None`` broadcasts to all users; a list of usernames restricts
        delivery to those users. Delivery is best-effort: a missing sink only
        logs a warning so callers without an api layer (e.g. scripts) do not
        crash.
        """
        sink = type(self)._delivery_sink
        if sink is None:
            logger.warning(
                "No delivery sink installed; dropping notification %s (%s).",
                notification.id,
                notification.type,
            )
            return notification
        await sink(notification, targets)
        return notification

    async def notify_message(
        self,
        title: str,
        message: str = "",
        *,
        severity: NotificationSeverity = NotificationSeverity.NORMAL,
        targets: Optional[List[str]] = None,
        dismissible: bool = True,
    ) -> Notification:
        """Sends a :attr:`NotificationType.MESSAGE` notification."""
        return await self.send(
            Notification(
                type=NotificationType.MESSAGE,
                severity=severity,
                title=title,
                message=message,
                dismissible=dismissible,
            ),
            targets,
        )

    async def notify_confirmation(
        self,
        title: str,
        message: str,
        *,
        action: NotificationAction,
        targets: Optional[List[str]] = None,
        severity: NotificationSeverity = NotificationSeverity.NORMAL,
        dismissible: bool = True,
    ) -> Notification:
        """Sends a :attr:`NotificationType.CONFIRMATION` with one action."""
        return await self.send(
            Notification(
                type=NotificationType.CONFIRMATION,
                severity=severity,
                title=title,
                message=message,
                actions=[action],
                dismissible=dismissible,
            ),
            targets,
        )

    async def notify_actions(
        self,
        title: str,
        message: str,
        *,
        actions: List[NotificationAction],
        targets: Optional[List[str]] = None,
        severity: NotificationSeverity = NotificationSeverity.NORMAL,
        dismissible: bool = True,
        id: Optional[str] = None,
    ) -> Notification:
        """Sends an :attr:`NotificationType.ACTIONS` notification.

        Passing a stable ``id`` lets the client de-duplicate re-delivered
        notifications (e.g. after a reconnect or reload) instead of presenting
        the same action dialog twice.
        """
        fields: Dict[str, Any] = {
            "type": NotificationType.ACTIONS,
            "severity": severity,
            "title": title,
            "message": message,
            "actions": list(actions),
            "dismissible": dismissible,
        }
        if id is not None:
            fields["id"] = id
        return await self.send(Notification(**fields), targets)

    # -- Inbound action execution -----------------------------------------

    async def dispatch_action(
        self,
        name: str,
        data: Optional[Dict[str, Any]],
        context: NotificationActionContext,
    ) -> Any:
        """Runs the handler registered for ``name`` with ``(data, context)``.

        Raises :class:`NotificationActionNotFoundError` for unknown names so the
        caller (WebSocket bridge) can surface an error result to the client
        instead of silently dropping the request.
        """
        handler = self.get_action(name)
        if handler is None:
            raise NotificationActionNotFoundError(
                f"No notification action registered for '{name}'"
            )
        return await handler(dict(data or {}), context)

    @classmethod
    def reset(cls) -> None:
        """Clears the registry and sink. Intended for tests."""
        cls._actions.clear()
        cls._delivery_sink = None


#: Process-wide singleton used by routers, bots and WebSocket handlers.
notification_manager = NotificationManager.instance()


def register_action(name: str, *, replace: bool = False):
    """Decorator convenience that registers an action on the singleton.

    Usage::

        @register_action("pull_remote")
        async def pull_remote(data, ctx):
            ...
    """

    def decorator(handler: ActionHandler) -> ActionHandler:
        notification_manager.register_action(name, handler, replace=replace)
        return handler

    return decorator


__all__ = [
    "ActionHandler",
    "DeliverySink",
    "NotificationActionAlreadyRegisteredError",
    "NotificationActionContext",
    "NotificationActionNotFoundError",
    "NotificationError",
    "NotificationManager",
    "notification_manager",
    "register_action",
]
