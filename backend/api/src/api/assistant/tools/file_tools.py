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
from pathlib import Path
from typing import List
from core.queries import pipeline as pipeline_queries
from core.utils.path_utils import safe_join
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
        if not pipeline or not pipeline.workspace_abs_path:
            return f"Error: Workspace root is missing for pipeline {pipeline_id}."

        try:
            full_path = safe_join(pipeline.workspace_abs_path, path)
        except ValueError as e:
            return f"Error: {str(e)}"

        with open(full_path, "r") as f:
            return f.read()
    except Exception as e:
        return f"Error reading file: {str(e)}"


@register_tool(tool_type=READ_ONLY)
async def list_project_structure(
    pipeline_id: str, path: str = ".", list_files: bool = False
) -> List[str]:
    """
    Lists files or directories in the project structure for a given pipeline.

    Args:
        pipeline_id: The ID of the pipeline whose project structure should be listed.
        path: Subdirectory to list (optional, defaults to root).
        list_files: If True, lists all files. If False (default), lists directories and the number of files they contain.
    """
    try:
        pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
        if not pipeline or not pipeline.workspace_abs_path:
            return [f"Error: Workspace root is missing for pipeline {pipeline_id}."]

        try:
            full_search_path = safe_join(pipeline.workspace_abs_path, path)
        except ValueError as e:
            return [f"Error: {str(e)}"]

        if not os.path.isdir(full_search_path):
            return [f"Error: Path '{path}' is not a directory."]

        # Filter out __pycache__, .git, node_modules etc
        ignored = [
            "__pycache__",
            ".git",
            "node_modules",
            ".venv",
            "dist",
            ".pytest_cache",
            ".logs",
        ]
        result = []
        workspace_root = str(pipeline.workspace_abs_path)

        for root, dirs, files in os.walk(full_search_path):
            # Filter ignored directories in-place to prevent walking into them
            dirs[:] = [d for d in dirs if d not in ignored]

            rel_root = os.path.relpath(root, workspace_root)

            if list_files:
                # Add the directory itself (if not root of search or if it's the root but we want it)
                # To match previous glob behavior (which was recursive but didn't necessarily list dirs explicitly as trailing slash)
                # Actually glob.glob(..., recursive=True) lists both files and dirs.
                if rel_root != ".":
                    result.append(rel_root + "/")

                for f in files:
                    if f not in ignored:
                        rel_file = os.path.relpath(os.path.join(root, f), workspace_root)
                        result.append(rel_file)
            else:
                # Only show directory and count of files it directly contains
                file_count = len([f for f in files if f not in ignored])
                display_path = "./" if rel_root == "." else f"{rel_root}/"
                result.append(f"{display_path} ({file_count} files)")

            if len(result) >= 100:
                break

        return result[:100]
    except Exception as e:
        return [f"Error listing files: {str(e)}"]
