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

"""Backend notification actions for SpecAgent proposals.

These handlers run when the user accepts or rejects a finished proposal from an
``actions`` notification. Executing the write-back on the backend (rather than
through the embedding component's ``TaskClient``) means Accept works from any
page and is authenticated exactly like any other remote call.

Mirrors :mod:`api.notifications.actions`.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional, Tuple

from api.websocket_manager import WSMessage, manager
from core.queries import task as task_queries
from core.services.notification_manager import (
    NotificationActionContext,
    notification_manager,
    register_action,
)

from .cache import clear_proposal, get_proposal

logger = logging.getLogger(__name__)


def _ids(data: Dict[str, Any]) -> Tuple[Optional[str], Optional[str]]:
    """Extracts ``(task_id, pipeline_id)`` from an action payload."""

    task_id = data.get("task_id") or data.get("taskId")
    pipeline_id = data.get("pipeline_id") or data.get("pipelineId")
    return (
        str(task_id) if task_id else None,
        str(pipeline_id) if pipeline_id else None,
    )


@register_action("specagent_accept", replace=True)
async def specagent_accept(
    data: Dict[str, Any], context: NotificationActionContext
) -> Dict[str, Any]:
    """Applies an outstanding proposal to the task's specification."""

    task_id, _ = _ids(data)
    if not task_id:
        return {"ok": False, "error": "task_id is required"}

    proposal = await get_proposal(task_id)
    if not proposal:
        return {"ok": False, "error": "Proposal no longer available"}

    try:
        task = await task_queries.get_task_by_id(task_id)
    except Exception:  # noqa: BLE001 - surface a clean result to the client
        logger.warning("[SpecAgent] accept: task %s no longer exists", task_id)
        return {"ok": False, "error": "Task no longer available"}

    updated = await task_queries.update_task_details(
        task_id,
        version=task.version,
        spec=proposal.spec_md,
        actor="user",
    )
    await clear_proposal(task_id)
    await manager.broadcast(
        WSMessage(type="TASK_UPDATED", payload=updated.model_dump(mode="json"))
    )
    logger.info("[SpecAgent] proposal accepted and applied task=%s", task_id)
    return {"ok": True, "spec_updated": True}


@register_action("specagent_reject", replace=True)
async def specagent_reject(
    data: Dict[str, Any], context: NotificationActionContext
) -> Dict[str, Any]:
    """Discards an outstanding proposal without touching the task."""

    task_id, _ = _ids(data)
    if not task_id:
        return {"ok": False, "error": "task_id is required"}

    await clear_proposal(task_id)
    logger.info("[SpecAgent] proposal rejected task=%s", task_id)
    return {"ok": True}


@register_action("specagent_open", replace=True)
async def specagent_open(
    data: Dict[str, Any], context: NotificationActionContext
) -> Dict[str, Any]:
    """Returns the pipeline/task ids so the client can navigate to the proposal."""

    task_id, pipeline_id = _ids(data)
    return {"ok": True, "pipeline_id": pipeline_id, "task_id": task_id}


def register_specagent_actions() -> None:
    """(Re-)registers the SpecAgent actions. Idempotent."""

    notification_manager.register_action(
        "specagent_accept", specagent_accept, replace=True
    )
    notification_manager.register_action(
        "specagent_reject", specagent_reject, replace=True
    )
    notification_manager.register_action("specagent_open", specagent_open, replace=True)


__all__ = [
    "register_specagent_actions",
    "specagent_accept",
    "specagent_open",
    "specagent_reject",
]
