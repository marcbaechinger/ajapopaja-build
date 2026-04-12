from mcp.server.fastmcp import FastMCP
from core.db import init_db
from core.models.models import Task, TaskStatus

# Create an MCP server
mcp = FastMCP("Ajapopaja Build MCP")


@mcp.tool()
async def get_next_task(pipeline_id: str) -> str:
    """Gets the next scheduled task for a given pipeline."""
    # Ensure DB is initialized
    await init_db()

    task = (
        await Task.find(
            Task.pipeline_id == pipeline_id, Task.status == TaskStatus.SCHEDULED
        )
        .sort("order")
        .first_or_none()
    )

    if task:
        task.status = TaskStatus.INPROGRESS
        await task.save()
        response = (
            f"Task ID: {task.id}\nTitle: {task.title}\nDescription: {task.description}"
        )
        if task.design_doc:
            response += f"\nDesign Doc: {task.design_doc}"
        return response

    return "No scheduled tasks found in this pipeline."


@mcp.tool()
async def complete_task(task_id: str) -> str:
    """Marks a task as implemented."""
    await init_db()
    task = await Task.get(task_id)
    if task:
        task.status = TaskStatus.IMPLEMENTED
        await task.save()
        return f"Task {task_id} marked as implemented."
    return f"Task {task_id} not found."


if __name__ == "__main__":
    mcp.run()
