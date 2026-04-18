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
from typing import List
from core.queries import pipeline as pipeline_queries
from api.assistant.decorators import register_tool

# Tool Categories
READ_ONLY = "read_only"


@register_tool(tool_type=READ_ONLY)
async def read_source_file(pipeline_id: str, path: str) -> str:
    """
    Reads the content of a source file from the project.

    Args:
        pipeline_id: The ID of the pipeline to which the project belongs.
        path: Relative path to the file from the project root.
    """
    try:
        pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
        if not pipeline.workspace_path:
            return f"Error: Workspace root is missing for pipeline {pipeline_id}."

        # Sanitize path
        if ".." in path or path.startswith("/"):
            return "Error: Invalid path. Path must be relative and not contain '..'."

        full_path = os.path.join(pipeline.workspace_path, path)

        # Double check that we are still within the workspace_path
        if not os.path.abspath(full_path).startswith(
            os.path.abspath(pipeline.workspace_path)
        ):
            return "Error: Invalid path. Access denied."

        with open(full_path, "r") as f:
            return f.read()
    except Exception as e:
        return f"Error reading file: {str(e)}"


@register_tool(tool_type=READ_ONLY)
async def list_project_structure(pipeline_id: str, path: str = ".") -> List[str]:
    """
    Lists files in the project structure for a given pipeline.

    Args:
        pipeline_id: The ID of the pipeline whose project structure should be listed.
        path: Subdirectory to list (optional, defaults to root).
    """
    try:
        pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
        if not pipeline.workspace_path:
            return [f"Error: Workspace root is missing for pipeline {pipeline_id}."]

        # Sanitize path
        if ".." in path or path.startswith("/"):
            return ["Error: Invalid path. Path must be relative and not contain '..'."]

        full_search_path = os.path.join(pipeline.workspace_path, path)

        # Double check that we are still within the workspace_path
        if not os.path.abspath(full_search_path).startswith(
            os.path.abspath(pipeline.workspace_path)
        ):
            return ["Error: Invalid path. Access denied."]

        files = glob.glob(os.path.join(full_search_path, "**"), recursive=True)
        # Filter out __pycache__, .git, node_modules etc
        ignored = [
            "__pycache__",
            ".git",
            "node_modules",
            ".venv",
            "dist",
            ".pytest_cache",
        ]
        result = []
        for f in files:
            if not any(ig in f for ig in ignored):
                # Make path relative to workspace root for output
                rel_path = os.path.relpath(f, pipeline.workspace_path)
                result.append(rel_path)
        return result[:100]  # Limit output
    except Exception as e:
        return [f"Error listing files: {str(e)}"]
