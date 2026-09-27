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

"""Optional REST endpoint that sends a notification.

Auth-protected like every other router. This is primarily useful for tests,
scripts and a future admin UI; the core flow (backend push, user action back)
does not require it.
"""

from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from api.auth import get_current_user
from core.models.models import (
    Notification,
    NotificationAction,
    NotificationSeverity,
    NotificationType,
    User,
)
from core.services.notification_manager import notification_manager

router = APIRouter(prefix="/notifications", tags=["notifications"])


class NotificationRequest(BaseModel):
    """Body for ``POST /api/notifications``."""

    type: NotificationType
    severity: NotificationSeverity = NotificationSeverity.NORMAL
    title: str
    message: str = ""
    actions: List[NotificationAction] = Field(default_factory=list)
    targets: Optional[List[str]] = None
    dismissible: bool = True


@router.post("", response_model=dict)
async def create_notification(
    request: NotificationRequest,
    current_user: User = Depends(get_current_user),
):
    """Sends a notification to all users (``targets=None``) or specific users."""

    notification = Notification(
        type=request.type,
        severity=request.severity,
        title=request.title,
        message=request.message,
        actions=request.actions,
        dismissible=request.dismissible,
    )
    await notification_manager.send(notification, request.targets)
    return notification.model_dump(mode="json")
