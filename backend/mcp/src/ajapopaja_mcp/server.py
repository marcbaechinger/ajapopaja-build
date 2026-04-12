from typing import Any, Dict
from mcp.server.fastmcp import FastMCP
from core.db import init_db
from core.queries import task as task_queries
from core.exceptions import EntityNotFoundError, VersionMismatchError

# Create an MCP server
mcp = FastMCP("Ajapopaja Build MCP")


@mcp.tool()
async def get_next_task(pipeline_id: str) -> Dict[str, Any]:
    """
    Fetches the first available scheduled task in a pipeline and marks it inprogress.

    Args:
        pipeline_id: The ID of the pipeline to pull from.

    Returns:
        A dictionary containing task details (id, title, description, design_doc, version).
    """
    await init_db()
    task = await task_queries.get_next_task(pipeline_id)

    if task:
        return {
            "id": str(task.id),
            "title": task.title,
            "description": task.description or "",
            "design_doc": task.design_doc or "",
            "version": task.version,
        }

    return {"error": "No scheduled tasks found in this pipeline."}


@mcp.tool()
async def update_task_design_doc(task_id: str, design_doc: str, version: int) -> str:
    """
    Updates the design document field for a specific task.

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
        return f"Design document for task {task_id} updated successfully."
    except EntityNotFoundError as e:
        return f"Error: {str(e)}"
    except VersionMismatchError as e:
        return (
            f"Error: {str(e)}. Please fetch the task again to get the latest version."
        )
    except Exception as e:
        return f"An unexpected error occurred: {str(e)}"


@mcp.tool()
async def complete_task(
    task_id: str, commit_hash: str, completion_info: str, version: int
) -> str:
    """
    Finalizes a task implementation.

    Args:
        task_id: The target task ID.
        commit_hash: The full hash of the git commit containing the work.
        completion_info: A brief summary of what was accomplished.
        version: Current version for OCC.
    """
    await init_db()
    try:
        task = await task_queries.complete_task(
            task_id=task_id,
            version=version,
            commit_hash=commit_hash,
            completion_info=completion_info,
        )

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


@mcp.tool()
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
