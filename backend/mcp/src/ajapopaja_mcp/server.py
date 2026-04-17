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
import httpx
import re
from typing import Any, Dict
from fastmcp import FastMCP
from api.websocket_manager import manager
from core.db import init_db
from core.queries import task as task_queries
from core.exceptions import EntityNotFoundError, VersionMismatchError

# Create an MCP server
mcp = FastMCP("Ajapopaja Build MCP")


async def notify_api(task_id: str):
    """Notifies the API that a task has changed via WebSocket manager directly."""
    try:
        await manager.notify_task_update(task_id)
    except Exception as e:
        logging.error(f"Failed to notify API for task {task_id}: {e}")


@mcp.tool
async def get_next_task(pipeline_id: str) -> Dict[str, Any]:
    """
    Fetches the first available scheduled task in a pipeline and marks it inprogress.

    IMPORTANT: If 'want_design_doc' is True, you MUST provide a design proposal using
    'update_task_design_doc' before implementing and completing the task.
    The task will automatically move to 'proposed' status once the design_doc is set.
    Once you have submitted the design, you should stop working on this task.
    You can then call 'get_next_task' again to pick up the next available task
    (which might be this one again once it has been approved and moved back to 'scheduled').

    Args:
        pipeline_id: The ID of the pipeline to pull from.

    Returns:
        A dictionary containing task details (id, title, description, design_doc, spec, want_design_doc, design_doc_ready, version).
    """
    await init_db()
    task = await task_queries.get_next_task(pipeline_id, actor="mcp")

    if task:
        await notify_api(str(task.id))
        return {
            "id": str(task.id),
            "title": task.title,
            "description": task.description or "",
            "design_doc": task.design_doc or "",
            "spec": task.spec or "",
            "want_design_doc": task.want_design_doc,
            "design_doc_ready": task.want_design_doc and bool(task.design_doc),
            "version": task.version,
        }

    return {"error": "No scheduled tasks found in this pipeline."}


@mcp.tool
async def update_task_design_doc(task_id: str, design_doc: str, version: int) -> str:
    """
    Updates the design document field for a specific task.
    This also automatically moves tasks to 'proposed' if 'want_design_doc' is True.

    If 'want_design_doc' is True, you should stop working on this task and can call
    'get_next_task' to see if there is any other scheduled task to pick up.

    If 'want_design_doc' is False implementation can directly continue.

    Args:
        task_id: The target task ID.
        design_doc: The Markdown-formatted design document.
        version: Current version for optimistic concurrency control (OCC).
    """
    await init_db()
    try:
        await task_queries.update_task_details(
            task_id=task_id, version=version, design_doc=design_doc
        )
        await notify_api(task_id)
        return f"Design document for task {task_id} updated successfully."
    except EntityNotFoundError as e:
        return f"Error: {str(e)}"
    except VersionMismatchError as e:
        return (
            f"Error: {str(e)}. Please fetch the task again to get the latest version."
        )
    except Exception as e:
        return f"An unexpected error occurred: {str(e)}"


@mcp.tool
async def complete_task(
    task_id: str, commit_hash: str, completion_info: str, version: int
) -> str:
    """
    Finalizes a task implementation.

    IMPORTANT: If 'want_design_doc' was True for this task, a 'design_doc' must have been
    provided and approved by the user before calling this tool.

    Args:
        task_id: The target task ID.
        commit_hash: The full hash of the git commit containing the work.
        completion_info: A brief summary of what was accomplished.
        version: Current version for OCC.
    """
    if not commit_hash or not re.match(r"^[0-9a-fA-F]{7,40}$", commit_hash):
        return f"Error: Invalid commit hash '{commit_hash}'. Must be a valid 7-40 character hexadecimal string."

    await init_db()
    try:
        task = await task_queries.complete_task(
            task_id=task_id,
            version=version,
            commit_hash=commit_hash,
            completion_info=completion_info,
            actor="mcp",
        )

        await notify_api(task_id)
        status_msg = f"Task {task_id} completed successfully."
        if task.verification and not task.verification.get("success"):
            status_msg += f" WARNING: Verification failed. Errors: {', '.join(task.verification.get('errors', []))}. A follow-up system task has been created."

        return status_msg
    except EntityNotFoundError as e:
        return f"Error: {str(e)}"
    except VersionMismatchError as e:
        return (
            f"Error: {str(e)}. Please fetch the task again to get the latest version."
        )
    except Exception as e:
        return f"An unexpected error occurred: {str(e)}"


@mcp.tool
async def get_task_status(task_id: str) -> Dict[str, Any]:
    """
    Retrieves current status and verification results for a task.

    Args:
        task_id: The target task ID.
    """
    await init_db()
    try:
        task = await task_queries.get_task_by_id(task_id)
        return {
            "id": str(task.id),
            "status": task.status,
            "version": task.version,
            "verification": task.verification,
        }
    except EntityNotFoundError as e:
        return {"error": str(e)}


if __name__ == "__main__":
    mcp.run()
