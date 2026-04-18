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

from typing import List, Dict
from core.models.models import Task
from core.queries import task as task_queries
from ..decorators import register_tool

# Tool Categories
READ_ONLY = "read_only"
WRITE_ACCESS = "write_access"

@register_tool(
    name="list_tasks",
    description="Returns a list of tasks for a given pipeline.",
    tool_type=READ_ONLY,
    parameters={
        "type": "object",
        "properties": {"pipeline_id": {"type": "string"}},
        "required": ["pipeline_id"],
    }
)
async def list_tasks(pipeline_id: str) -> List[Dict]:
    tasks = await task_queries.get_tasks_by_pipeline(pipeline_id)
    return [t.model_dump(mode="json") for t in tasks]

@register_tool(
    name="get_task",
    description="Returns details for a specific task.",
    tool_type=READ_ONLY,
    parameters={
        "type": "object",
        "properties": {"task_id": {"type": "string"}},
        "required": ["task_id"],
    }
)
async def get_task(task_id: str) -> Dict:
    task = await task_queries.get_task_by_id(task_id)
    return task.model_dump(mode="json")

@register_tool(
    name="create_task",
    description="Creates a new task in a pipeline.",
    tool_type=WRITE_ACCESS,
    parameters={
        "type": "object",
        "properties": {
            "pipeline_id": {"type": "string"},
            "title": {"type": "string"},
            "spec": {
                "type": "string",
                "description": "The task specification in Markdown.",
            },
            "want_design_doc": {"type": "boolean"},
        },
        "required": ["pipeline_id", "title"],
    }
)
async def create_task(
    pipeline_id: str, title: str, spec: str = None, want_design_doc: bool = False
) -> Dict:
    task = Task(
        title=title, spec=spec, want_design_doc=want_design_doc, pipeline_id=pipeline_id
    )
    new_task = await task_queries.create_task(pipeline_id, task, actor="assistant")
    return new_task.model_dump(mode="json")

@register_tool(
    name="update_task_spec",
    description="Updates the specification of an existing task.",
    tool_type=WRITE_ACCESS,
    parameters={
        "type": "object",
        "properties": {"task_id": {"type": "string"}, "spec": {"type": "string"}},
        "required": ["task_id", "spec"],
    }
)
async def update_task_spec(task_id: str, spec: str) -> Dict:
    task = await task_queries.get_task_by_id(task_id)
    updated_task = await task_queries.update_task_details(
        task_id, task.version, spec=spec, actor="assistant"
    )
    return updated_task.model_dump(mode="json")

@register_tool(
    name="update_design_doc",
    description="Updates the design document of an existing task.",
    tool_type=WRITE_ACCESS,
    parameters={
        "type": "object",
        "properties": {
            "task_id": {"type": "string"},
            "design_doc": {"type": "string"},
        },
        "required": ["task_id", "design_doc"],
    }
)
async def update_design_doc(task_id: str, design_doc: str) -> Dict:
    task = await task_queries.get_task_by_id(task_id)
    updated_task = await task_queries.update_task_details(
        task_id, task.version, design_doc=design_doc, actor="assistant"
    )
    return updated_task.model_dump(mode="json")
