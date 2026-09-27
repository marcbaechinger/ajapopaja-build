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

"""Built-in notification actions.

An action handler receives the JSON-serializable ``data`` dict carried by the
:class:`~core.models.models.NotificationAction` plus a
:class:`~core.services.notification_manager.NotificationActionContext` that
identifies the authenticated user who triggered it.

The two handlers below are intentionally small: ``noop`` proves the round-trip
end to end, while ``pull_remote`` is the realistic example from the design
document (confirm → backend runs ``git pull`` → result toast).
"""

from __future__ import annotations

from typing import Any, Dict

from core.services.notification_manager import (
    NotificationActionContext,
    notification_manager,
    register_action,
)
from core.utils import git_utils


@register_action("noop", replace=True)
async def noop_action(
    data: Dict[str, Any], context: NotificationActionContext
) -> Dict[str, Any]:
    """A harmless built-in action used to verify the full round-trip."""

    return {
        "ok": True,
        "action": "noop",
        "username": context.username,
        "data": data,
    }


@register_action("pull_remote", replace=True)
async def pull_remote_action(
    data: Dict[str, Any], context: NotificationActionContext
) -> Dict[str, Any]:
    """Fetch and pull the latest changes for a pipeline's remote repository."""

    pipeline_id = data.get("pipeline_id") or data.get("pipelineId")
    if not pipeline_id:
        return {"ok": False, "error": "pipeline_id is required"}

    task_id = data.get("task_id") or data.get("taskId")
    output = await git_utils.pull(str(pipeline_id), task_id)
    return {"ok": not str(output).startswith("Error"), "output": output}


def register_builtin_actions() -> None:
    """(Re-)registers the built-in actions.

    Idempotent so ``register_notification_handlers`` can be called more than
    once (application lifespan, tests, ...).
    """

    notification_manager.register_action("noop", noop_action, replace=True)
    notification_manager.register_action(
        "pull_remote", pull_remote_action, replace=True
    )


__all__ = [
    "noop_action",
    "pull_remote_action",
    "register_builtin_actions",
]
