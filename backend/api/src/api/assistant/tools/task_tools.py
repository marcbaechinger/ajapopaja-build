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
from api.assistant.decorators import register_tool
from api.websocket_manager import manager, WSMessage

# Tool Categories
READ_ONLY = "read_only"
WRITE_ACCESS = "write_access"


@register_tool(tool_type=READ_ONLY)
async def list_tasks(pipeline_id: str) -> List[Dict]:
    """
    Returns a list of all tasks belonging to a specific pipeline.

    Args:
        pipeline_id: The ID of the pipeline whose tasks should be listed.
    """
    tasks = await task_queries.get_tasks_by_pipeline(pipeline_id)
    return [t.model_dump(mode="json") for t in tasks]


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
