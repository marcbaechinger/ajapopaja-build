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
import os
from typing import List

from api.assistant.tools.file_tools import list_project_structure, read_source_file
from api.assistant.tools.git_tools import git_show_commit
from api.assistant.tools.search_tools import grep_search
from core.queries import pipeline as pipeline_queries
from core.utils.path_utils import safe_join

from .decorators import register_doc_tool
from .registry import docbot_registry

logger = logging.getLogger(__name__)

# Re-register existing tools for docbot
docbot_registry.register_tool(read_source_file)
docbot_registry.register_tool(list_project_structure)
docbot_registry.register_tool(git_show_commit)
docbot_registry.register_tool(grep_search)

DOC_DIR = "design"


@register_doc_tool()
async def list_ref_docs(pipeline_id: str) -> List[str]:
    """
    Lists all reference documentation files in the 'design/' directory.
    """
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    if not pipeline or not pipeline.workspace_abs_path:
        return ["Error: Workspace root missing."]

    doc_path = safe_join(pipeline.workspace_abs_path, DOC_DIR)
    if not os.path.isdir(doc_path):
        return []

    files = []
    for f in os.listdir(doc_path):
        if f.endswith(".md"):
            files.append(f)
    return files


@register_doc_tool()
async def read_ref_doc(pipeline_id: str, filename: str) -> str:
    """
    Reads the content of a reference documentation file.
    """
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    if not pipeline or not pipeline.workspace_abs_path:
        return "Error: Workspace root missing."

    file_path = safe_join(pipeline.workspace_abs_path, DOC_DIR, filename)
    if not os.path.isfile(file_path):
        return f"Error: Document '{filename}' not found."

    with open(file_path, "r") as f:
        return f.read()


@register_doc_tool(tool_type="write_access")
async def update_ref_doc(
    pipeline_id: str, filename: str, content: str, reason: str
) -> str:
    """
    Updates or creates a reference documentation file.
    """
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    if not pipeline or not pipeline.workspace_abs_path:
        return "Error: Workspace root missing."

    doc_path = safe_join(pipeline.workspace_abs_path, DOC_DIR)
    os.makedirs(doc_path, exist_ok=True)

    file_path = safe_join(doc_path, filename)
    with open(file_path, "w") as f:
        f.write(content)

    logger.info(
        f"DocBot updated {filename} for pipeline {pipeline_id}. Reason: {reason}"
    )
    return f"Successfully updated {filename}."


@register_doc_tool()
async def no_doc_update_needed(reason: str) -> str:
    """
    Signals that no documentation update is required for the recent change.
    """
    logger.info(f"DocBot decided no update needed. Reason: {reason}")
    return "No documentation update performed."
