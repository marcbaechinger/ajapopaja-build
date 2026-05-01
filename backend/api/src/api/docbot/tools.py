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
from api.assistant.tools.search_tools import grep
from core.queries import pipeline as pipeline_queries
from core.utils.path_utils import safe_join

from .decorators import register_doc_tool
from .registry import docbot_registry

logger = logging.getLogger(__name__)

# Re-register existing tools for docbot
docbot_registry.register_tool(read_source_file)
docbot_registry.register_tool(list_project_structure)
docbot_registry.register_tool(git_show_commit)
docbot_registry.register_tool(grep)

DOC_DIR = "design"


@register_doc_tool()
async def list_ref_docs(pipeline_id: str, **kwargs) -> List[str]:
    """
    Lists all reference documentation files available in the 'design/' directory.

    This tool helps discover existing design documents, architectural diagrams,
    and specification files to understand the current state of the project'self
    documentation.
    """
    if kwargs:
        logger.warning(f"list_ref_docs received unexpected arguments: {kwargs}")

    try:
        pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    except Exception as e:
        logger.error(f"list_ref_docs: Failed to fetch pipeline {pipeline_id}: {e}")
        return [f"Error: {str(e)}"]

    if not pipeline or not pipeline.workspace_abs_path:
        logger.error(
            f"list_ref_docs: Workspace root missing for pipeline {pipeline_id}"
        )
        return ["Error: Workspace root missing."]

    doc_path = safe_join(pipeline.workspace_abs_path, DOC_DIR)
    logger.info(f"list_ref_docs: Scanning directory: {doc_path}")

    if not os.path.isdir(doc_path):
        msg = " ".join(
            [
                f"Directory '{DOC_DIR}/' does not exist yet. If this change requires"
                "new documentation, please create a new document using",
                "'update_ref_doc'.",
            ]
        )
        logger.info(f"list_ref_docs: {msg}")
        return [msg]

    files = []
    for f in os.listdir(doc_path):
        if f.endswith(".md"):
            files.append(f)

    logger.info(f"list_ref_docs: Found {len(files)} documents: {files}")
    return files


@register_doc_tool()
async def read_ref_doc(pipeline_id: str, filename: str, **kwargs) -> str:
    """
    Reads the full content of a specific reference documentation file from the 'design/'
    directory.

    Use this tool to examine existing documentation before deciding whether an update is
    needed or to gather context for modifying a document.

    Args:
        filename: The name of the file to read (e.g., 'dd_architecture.md'). Only the
                  filename is needed.
    """
    # Handle cases where the model might use 'path' instead of 'filename'
    fname = filename or kwargs.get("path")
    if not fname:
        logger.error(
            " ".join(
                [
                    "read_ref_doc: Missing filename. Received:"
                    f"filename={filename}, kwargs={kwargs}"
                ]
            )
        )
        return "Error: filename is required."

    # Strip directory prefix if the agent provided one
    fname = os.path.basename(fname)

    logger.info(
        f"read_ref_doc: Attempting to read '{fname}' for pipeline {pipeline_id}"
    )

    try:
        pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    except Exception as e:
        logger.error(f"read_ref_doc: Failed to fetch pipeline {pipeline_id}: {e}")
        return f"Error: {str(e)}"

    if not pipeline or not pipeline.workspace_abs_path:
        logger.error(f"read_ref_doc: Workspace root missing for pipeline {pipeline_id}")
        return "Error: Workspace root missing."

    file_path = safe_join(pipeline.workspace_abs_path, DOC_DIR, fname)
    logger.info(f"read_ref_doc: Full file path: {file_path}")

    if not os.path.isfile(file_path):
        logger.warning(f"read_ref_doc: Document '{fname}' not found at {file_path}")
        return f"Error: Document '{fname}' not found in '{DOC_DIR}/'."

    try:
        with open(file_path, "r") as f:
            content = f.read()
            logger.info(
                " ".join(
                    [
                        f"read_ref_doc: Successfully read {len(content)}",
                        f"characters from {fname}",
                    ]
                )
            )
            return content
    except Exception as e:
        logger.error(f"read_ref_doc: Failed to read {file_path}: {e}")
        return f"Error reading file: {str(e)}"


@register_doc_tool(tool_type="write_access")
async def update_ref_doc(
    pipeline_id: str,
    filename: str,
    content: str,
    reason: str,
    **kwargs,
) -> str:
    """
    Updates an existing documentation file or creates a new one in the 'design/'
    directory.

    This tool MUST be called when a software change introduces new features, modifies
    architecture, or changes public API contracts that should be reflected in the
    permanent reference documentation.

    Args:
        filename: The name of the file (e.g., 'dd_user_profile.md'). If the file doesn't
                  exist, it will be created.
        content: The complete, updated Markdown content of the document. Do not provide
                  snippets; provide the full file content.
        reason: A concise technical explanation of why this documentation update is
                required.
    """
    # Robust argument extraction to handle common model hallucinations (path, summary)
    fname = filename or kwargs.get("path")
    resn = reason or kwargs.get("summary") or kwargs.get("reasoning")

    logger.info(
        f"update_ref_doc: Request received. filename={fname}, reason_len={len(resn) if resn else 0}, content_len={len(content) if content else 0}"
    )

    if not fname:
        logger.error(f"update_ref_doc: Missing filename. kwargs={kwargs}")
        return "Error: filename is required."

    if content is None:
        logger.error(f"update_ref_doc: Missing content for {fname}")
        return "Error: content is required."

    if not resn:
        logger.warning(f"update_ref_doc: Missing reason for {fname}. Using default.")
        resn = "No reason provided."

    # Strip directory prefix if the agent provided one (we always force DOC_DIR)
    fname = os.path.basename(fname)

    try:
        pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    except Exception as e:
        logger.error(f"update_ref_doc: Failed to fetch pipeline {pipeline_id}: {e}")
        return f"Error: {str(e)}"

    if not pipeline or not pipeline.workspace_abs_path:
        logger.error(
            f"update_ref_doc: Workspace root missing for pipeline {pipeline_id}"
        )
        return "Error: Workspace root missing."

    doc_path = safe_join(pipeline.workspace_abs_path, DOC_DIR)
    os.makedirs(doc_path, exist_ok=True)

    file_path = safe_join(doc_path, fname)
    logger.info(f"update_ref_doc: Writing to {file_path}")

    try:
        with open(file_path, "w") as f:
            f.write(content)

        logger.info(f"update_ref_doc: Successfully updated {fname}. Reason: {resn}")
        return f"Successfully updated {DOC_DIR}/{fname}."
    except Exception as e:
        logger.error(f"update_ref_doc: Failed to write {file_path}: {e}")
        return f"Error writing file: {str(e)}"


@register_doc_tool()
async def no_doc_update_needed(reason: str = "No reason provided") -> str:
    """
    Signals that the analysis is complete and no documentation updates are required.

    Call this tool when a change is purely an implementation detail, a bug fix that
    doesn't change the design, or is already sufficiently covered by existing
    documentation.

    Args:
        reason: A brief explanation of why no documentation update is necessary for this
                change.
    """
    logger.info(f"DocBot decided no update needed. Reason: {reason}")
    return "No documentation update performed."
