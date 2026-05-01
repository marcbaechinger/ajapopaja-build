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
from typing import Any, List, Optional

import git

from api.assistant.tools.file_tools import list_project_structure, read_source_file
from api.assistant.tools.git_tools import git_show_commit
from api.assistant.tools.search_tools import grep
from api.websocket_manager import WSMessage, manager
from core.queries import pipeline as pipeline_queries
from core.utils.path_utils import safe_join

from .cache import DocBotPreview, set_preview
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
    Lists all reference documentation files available in the 'design/' directory,
    including subdirectories.

    This tool helps discover existing design documents, architectural diagrams,
    and specification files to understand the current state of the project's
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
    for root, _, filenames in os.walk(doc_path):
        for f in filenames:
            if f.endswith(".md"):
                rel_path = os.path.relpath(os.path.join(root, f), doc_path)
                files.append(rel_path)

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
        filename: The name of the file to read (e.g., 'dd_architecture.md' or
                  'implemented/dd_nvim_socket_config.md'). Paths relative to 'design/'
                  are supported.
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

    # Strip 'design/' prefix if the agent provided one
    if fname.startswith(f"{DOC_DIR}/"):
        fname = fname[len(DOC_DIR) + 1 :]
    elif fname.startswith(DOC_DIR) and len(fname) == len(DOC_DIR):
        return f"Error: '{DOC_DIR}' is a directory, please specify a file."

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

    try:
        doc_path = safe_join(pipeline.workspace_abs_path, DOC_DIR)
        file_path = safe_join(doc_path, fname)
        logger.info(f"read_ref_doc: Full file path: {file_path}")
    except ValueError as e:
        logger.error(f"read_ref_doc: Invalid path '{fname}': {e}")
        return f"Error: Invalid filename '{fname}'."

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
    task_id: Optional[str] = None,
    session: Optional[Any] = None,
    **kwargs,
) -> str:
    """
    Updates an existing documentation file or creates a new one in the 'design/'
    directory.

    This tool MUST be called when a software change introduces new features, modifies
    architecture, or changes public API contracts that should be reflected in the
    permanent reference documentation.

    Args:
        filename: The name of the file (e.g., 'dd_user_profile.md' or
                  'implemented/dd_nvim_socket_config.md'). If the file doesn't
                  exist, it will be created. Paths relative to 'design/' are supported.
        content: The complete, updated Markdown content of the document. Do not provide
                  snippets; provide the full file content.
        reason: A concise technical explanation of why this documentation update is
                required.
    """
    # Robust argument extraction to handle common model hallucinations (path, summary)
    fname = filename or kwargs.get("path")
    resn = reason or kwargs.get("summary") or kwargs.get("reasoning")
    tid = task_id or kwargs.get("task_id")

    reason_len = len(resn) if resn else 0
    logger.info(
        f"update_ref_doc: Request received. filename={fname}, reason_len={reason_len}, "
        f"content_len={len(content) if content else 0}, task_id={tid}"
    )

    if not fname:
        logger.error(f"update_ref_doc: Missing filename. kwargs={kwargs}")
        return "Error: filename is required."

    if not content:
        logger.error(f"update_ref_doc: Missing content for {fname}")
        return "Error: content is required."

    if not resn:
        logger.warning(f"update_ref_doc: Missing reason for {fname}. Using default.")
        resn = "No reason provided."

    # Strip 'design/' prefix if the agent provided one
    if fname.startswith(f"{DOC_DIR}/"):
        fname = fname[len(DOC_DIR) + 1 :]

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

    try:
        doc_path = safe_join(pipeline.workspace_abs_path, DOC_DIR)
        file_path = safe_join(doc_path, fname)
        logger.info(f"update_ref_doc: Writing to {file_path}")

        # Ensure parent directory exists
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
    except ValueError as e:
        logger.error(f"update_ref_doc: Invalid path '{fname}': {e}")
        return f"Error: Invalid filename '{fname}'."

    try:
        with open(file_path, "w") as f:
            f.write(content)

        logger.info(f"update_ref_doc: Successfully updated {fname}. Reason: {resn}")

        # Capture diff and cache preview if task_id is available
        if tid:
            try:
                repo = git.Repo(pipeline.workspace_abs_path)

                # Intent-to-add so untracked files show up in diff
                repo.git.add(file_path, N=True)

                # Capture diff for this specific file
                # Use --unified=3 for standard context
                diff = repo.git.diff("--unified=3", file_path)

                # Derived commit message
                commit_msg = f"[doc] Update {fname}\n\n{resn}"

                set_preview(
                    tid,
                    DocBotPreview(
                        task_id=tid,
                        pipeline_id=pipeline_id,
                        diff=diff,
                        commit_msg=commit_msg,
                        file_path=str(file_path),
                        filename=fname,
                    ),
                )

                if session and hasattr(session, "session_result"):
                    session.session_result = {
                        "status": "update_needed",
                        "filename": fname,
                        "reason": resn,
                    }

                # WebSocket notification
                await manager.broadcast(
                    WSMessage(type="DOCBOT_PREVIEW_READY", payload={"task_id": tid})
                )
                logger.info(f"update_ref_doc: Preview cached and notified for {tid}")
            except Exception as e:
                logger.error(f"update_ref_doc: Failed to capture diff/notify: {e}")

        return f"Successfully updated {DOC_DIR}/{fname}."
    except Exception as e:
        logger.error(f"update_ref_doc: Failed to write {file_path}: {e}")
        return f"Error writing file: {str(e)}"


@register_doc_tool()
async def no_doc_update_needed(
    reason: str = "No reason provided", session: Optional[Any] = None
) -> str:
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
    if session and hasattr(session, "session_result"):
        session.session_result = {"status": "no_update_needed", "reason": reason}
    return "No documentation update performed."
