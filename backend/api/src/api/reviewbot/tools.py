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

import logging
from typing import Any, Optional

from api.assistant.tools.file_tools import list_project_structure, read_source_file
from api.assistant.tools.git_tools import git_show_commit
from api.assistant.tools.search_tools import grep
from api.websocket_manager import WSMessage, manager
from core.queries import task as task_queries

from .registry import reviewbot_registry

logger = logging.getLogger(__name__)

# Re-register existing tools for reviewbot
reviewbot_registry.register_tool(read_source_file)
reviewbot_registry.register_tool(list_project_structure)
reviewbot_registry.register_tool(git_show_commit)
reviewbot_registry.register_tool(grep)


async def save_review(
    pipeline_id: str,
    task_id: str,
    review_md: str,
    session: Optional[Any] = None,
) -> str:
    """
    Saves the technical review for a completed task.

    This tool MUST be called to finalize the review process. The review should be
    a comprehensive technical assessment of the implemented changes.

    Args:
        pipeline_id: The ID of the pipeline.
        task_id: The ID of the task being reviewed.
        review_md: The complete review in Markdown format.
    """
    logger.info(f"save_review: Saving review for task {task_id}")

    if not review_md:
        return "Error: review_md is required."

    try:
        task = await task_queries.get_task_by_id(task_id)
        if not task:
            return f"Error: Task {task_id} not found."

        # Update the task with the review
        task.review_md = review_md
        await task.save()

        if session and hasattr(session, "session_result"):
            session.session_result = {
                "status": "review_saved",
                "task_id": task_id,
            }

        # WebSocket notification
        await manager.broadcast(
            WSMessage(
                type="REVIEWBOT_REVIEW_READY",
                payload={"pipeline_id": pipeline_id, "task_id": task_id},
            )
        )
        logger.info(f"save_review: Review saved and notified for {task_id}")

        return f"Successfully saved review for task {task_id}."
    except Exception as e:
        logger.error(f"save_review: Failed to save review for {task_id}: {e}")
        return f"Error saving review: {str(e)}"


# Register the save_review tool
reviewbot_registry.register_tool(save_review)
