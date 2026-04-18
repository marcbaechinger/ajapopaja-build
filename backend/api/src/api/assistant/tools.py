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

import os
import glob
from typing import List, Optional, Dict, Any
from core.models.models import Pipeline, Task, TaskStatus
from core.queries import task as task_queries
from core.queries import pipeline as pipeline_queries

# Tool Categories
READ_ONLY = "read_only"
WRITE_ACCESS = "write_access"

# Tool Definitions
TOOLS = [
    {
        "name": "list_pipelines",
        "description": "Returns a list of all pipelines.",
        "type": READ_ONLY,
        "parameters": {
            "type": "object",
            "properties": {}
        }
    },
    {
        "name": "get_pipeline_details",
        "description": "Returns details for a specific pipeline.",
        "type": READ_ONLY,
        "parameters": {
            "type": "object",
            "properties": {
                "pipeline_id": {"type": "string"}
            },
            "required": ["pipeline_id"]
        }
    },
    {
        "name": "list_tasks",
        "description": "Returns a list of tasks for a given pipeline.",
        "type": READ_ONLY,
        "parameters": {
            "type": "object",
            "properties": {
                "pipeline_id": {"type": "string"}
            },
            "required": ["pipeline_id"]
        }
    },
    {
        "name": "get_task",
        "description": "Returns details for a specific task.",
        "type": READ_ONLY,
        "parameters": {
            "type": "object",
            "properties": {
                "task_id": {"type": "string"}
            },
            "required": ["task_id"]
        }
    },
    {
        "name": "create_task",
        "description": "Creates a new task in a pipeline.",
        "type": WRITE_ACCESS,
        "parameters": {
            "type": "object",
            "properties": {
                "pipeline_id": {"type": "string"},
                "title": {"type": "string"},
                "spec": {"type": "string", "description": "The task specification in Markdown."},
                "want_design_doc": {"type": "boolean"}
            },
            "required": ["pipeline_id", "title"]
        }
    },
    {
        "name": "update_task_spec",
        "description": "Updates the specification of an existing task.",
        "type": WRITE_ACCESS,
        "parameters": {
            "type": "object",
            "properties": {
                "task_id": {"type": "string"},
                "spec": {"type": "string"}
            },
            "required": ["task_id", "spec"]
        }
    },
    {
        "name": "update_design_doc",
        "description": "Updates the design document of an existing task.",
        "type": WRITE_ACCESS,
        "parameters": {
            "type": "object",
            "properties": {
                "task_id": {"type": "string"},
                "design_doc": {"type": "string"}
            },
            "required": ["task_id", "design_doc"]
        }
    },
    {
        "name": "read_source_file",
        "description": "Reads the content of a source file from the project.",
        "type": READ_ONLY,
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Relative path to the file from project root."}
            },
            "required": ["path"]
        }
    },
    {
        "name": "list_project_structure",
        "description": "Lists files in the project structure.",
        "type": READ_ONLY,
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Subdirectory to list (optional)."}
            }
        }
    }
]

# Tool Implementations
async def list_pipelines() -> List[Dict]:
    pipelines = await pipeline_queries.get_all_pipelines()
    return [p.model_dump(mode='json') for p in pipelines]

async def get_pipeline_details(pipeline_id: str) -> Dict:
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    return pipeline.model_dump(mode='json')

async def list_tasks(pipeline_id: str) -> List[Dict]:
    tasks = await task_queries.get_tasks_by_pipeline(pipeline_id)
    return [t.model_dump(mode='json') for t in tasks]

async def get_task(task_id: str) -> Dict:
    task = await task_queries.get_task_by_id(task_id)
    return task.model_dump(mode='json')

async def create_task(pipeline_id: str, title: str, spec: str = None, want_design_doc: bool = False) -> Dict:
    task = Task(title=title, spec=spec, want_design_doc=want_design_doc, pipeline_id=pipeline_id)
    new_task = await task_queries.create_task(pipeline_id, task, actor="assistant")
    return new_task.model_dump(mode='json')

async def update_task_spec(task_id: str, spec: str) -> Dict:
    task = await task_queries.get_task_by_id(task_id)
    updated_task = await task_queries.update_task_details(task_id, task.version, spec=spec, actor="assistant")
    return updated_task.model_dump(mode='json')

async def update_design_doc(task_id: str, design_doc: str) -> Dict:
    task = await task_queries.get_task_by_id(task_id)
    updated_task = await task_queries.update_task_details(task_id, task.version, design_doc=design_doc, actor="assistant")
    return updated_task.model_dump(mode='json')

async def read_source_file(path: str) -> str:
    # Basic path traversal protection
    if ".." in path or path.startswith("/"):
        return "Error: Invalid path."
    
    try:
        with open(path, "r") as f:
            return f.read()
    except Exception as e:
        return f"Error reading file: {str(e)}"

async def list_project_structure(path: str = ".") -> List[str]:
    if ".." in path or path.startswith("/"):
        return ["Error: Invalid path."]
    
    try:
        files = glob.glob(os.path.join(path, "**"), recursive=True)
        # Filter out __pycache__, .git, node_modules etc
        ignored = ["__pycache__", ".git", "node_modules", ".venv", "dist", ".pytest_cache"]
        result = []
        for f in files:
            if not any(ig in f for ig in ignored):
                result.append(f)
        return result[:100] # Limit output
    except Exception as e:
        return [f"Error listing files: {str(e)}"]

TOOL_MAP = {
    "list_pipelines": list_pipelines,
    "get_pipeline_details": get_pipeline_details,
    "list_tasks": list_tasks,
    "get_task": get_task,
    "create_task": create_task,
    "update_task_spec": update_task_spec,
    "update_design_doc": update_design_doc,
    "read_source_file": read_source_file,
    "list_project_structure": list_project_structure
}

def get_tool_definition(name: str):
    for tool in TOOLS:
        if tool["name"] == name:
            return tool
    return None
