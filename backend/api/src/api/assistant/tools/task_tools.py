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

from typing import List, Dict, Optional
from core.models.models import Task
from core.queries import task as task_queries
from core.queries import pipeline as pipeline_queries
from core.exceptions import EntityNotFoundError
from api.assistant.decorators import register_tool
from api.websocket_manager import manager, WSMessage

# Tool Categories
READ_ONLY = "read_only"
WRITE_ACCESS = "write_access"


@register_tool(tool_type=READ_ONLY)
async def list_tasks(
    pipeline_id: str,
    offset: int = 0,
    page_size: int = 5,
    sort_order: str = "last_created_first"
) -> Dict:
    """
    Returns a paginated list of tasks belonging to a specific pipeline, up to 5 tasks at a time.
    Specs and design_doc entries are truncated to limit the output size.

    Args:
        pipeline_id: The ID of the pipeline whose tasks should be listed.
        offset: The number of items to skip for pagination (default: 0).
        page_size: The number of items to return at once (default: 5, max: 5).
        sort_order: Order of the returned tasks. Can be 'last_created_first', 'last_implemented_first', or 'default' (default: 'last_created_first').
    
    Returns:
        A JSON dictionary containing:
        - total_tasks: The total number of non-deleted tasks in the pipeline.
        - offset: The offset used in the query.
        - page_size: The number of items requested.
        - sort_order: The sort order used.
        - tasks: The list of task objects with truncated 'spec' and 'design_doc'.
    """
    # Validate pipeline existence
    try:
        await pipeline_queries.get_pipeline_by_id(pipeline_id)
    except EntityNotFoundError:
        return {
            "error": f"Pipeline with ID '{pipeline_id}' not found. Please verify the pipeline_id or use list_pipelines to find the correct ID."
        }

    page_size = min(page_size, 5)  # Enforce max 5
    return await task_queries.get_tasks_for_tool(pipeline_id, offset, page_size, sort_order)


@register_tool(tool_type=READ_ONLY)
async def get_task(task_id: str) -> Dict:
    """
    Returns detailed information for a specific task.

    Args:
        task_id: The unique identifier of the task.
    """
    task = await task_queries.get_task_by_id(task_id)
    return task.model_dump(mode="json")


@register_tool(tool_type=WRITE_ACCESS)
async def create_task(
    pipeline_id: str,
    title: str,
    spec: Optional[str] = None,
    want_design_doc: bool = False,
) -> Dict:
    """
    Creates a new task within a specified pipeline.

    Args:
        pipeline_id: The ID of the pipeline where the task will be created.
        title: The title of the new task.
        spec: Optional Markdown specification for the task.
        want_design_doc: Whether this task requires a design document before implementation.
    """
    # Validate pipeline existence
    try:
        await pipeline_queries.get_pipeline_by_id(pipeline_id)
    except EntityNotFoundError:
        return {
            "error": f"Pipeline with ID '{pipeline_id}' not found. You cannot create a task for a non-existent pipeline. Please verify the pipeline_id."
        }

    task = Task(
        title=title, spec=spec, want_design_doc=want_design_doc, pipeline_id=pipeline_id
    )
    new_task = await task_queries.create_task(pipeline_id, task, actor="assistant")
    
    await manager.broadcast(
        WSMessage(type="TASK_CREATED", payload=new_task.model_dump(mode="json"))
    )
    return new_task.model_dump(mode="json")


@register_tool(tool_type=WRITE_ACCESS)
async def update_task_spec(task_id: str, spec: str) -> Dict:
    """
    Updates the specification of an existing task.

    Args:
        task_id: The identifier of the task to update.
        spec: The new Markdown specification for the task.
    """
    task = await task_queries.get_task_by_id(task_id)
    updated_task = await task_queries.update_task_details(
        task_id, task.version, spec=spec, actor="assistant"
    )
    
    await manager.notify_task_update(task_id)
    return updated_task.model_dump(mode="json")


@register_tool(tool_type=WRITE_ACCESS)
async def update_design_doc(task_id: str, design_doc: str) -> Dict:
    """
    Updates the design document of an existing task.

    Args:
        task_id: The identifier of the task to update.
        design_doc: The new Markdown design document content.
    """
    task = await task_queries.get_task_by_id(task_id)
    updated_task = await task_queries.update_task_details(
        task_id, task.version, design_doc=design_doc, actor="assistant"
    )
    
    await manager.notify_task_update(task_id)
    return updated_task.model_dump(mode="json")
