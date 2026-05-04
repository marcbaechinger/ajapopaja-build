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
from typing import Any, Optional

from api.assistant.tools.file_tools import (
    list_project_structure,
    read_source_file,
    read_source_file_by_range,
)
from api.assistant.tools.search_tools import grep, find, tree
from core.queries import task as task_queries

from api.bot.utils import generate_execution_report
from .markdown_validator import MarkdownValidator
from .registry import archbot_registry

logger = logging.getLogger(__name__)

# Re-register existing tools for archbot
archbot_registry.register_tool(list_project_structure)
archbot_registry.register_tool(tree)
archbot_registry.register_tool(read_source_file)
archbot_registry.register_tool(read_source_file_by_range)
archbot_registry.register_tool(grep)
archbot_registry.register_tool(find)


async def save_design_doc(
    pipeline_id: str,
    task_id: str,
    design_doc_md: str,
    session: Optional[Any] = None,
) -> str:
    """
    Saves the design document for a task.

    This tool MUST be called to finalize the design process. The design document
    should follow the requested format: Background, Proposed Changes,
    Implementation Plan, Alternatives (optional), and Test Strategy.

    Args:
        design_doc_md: The complete design document in Markdown format.
    """
    logger.info(f"save_design_doc: Saving design doc for task {task_id}")

    if not isinstance(design_doc_md, str):
        return f"Error: design_doc_md must be a string, got {type(design_doc_md).__name__}."

    if not design_doc_md.strip():
        return "Error: design_doc_md cannot be empty or only whitespace."

    # Validate Markdown content
    if not MarkdownValidator.has_top_level_heading(design_doc_md):
        return "Error: design_doc_md must contain at least one top-level heading (# Heading)."

    # Sanitize content
    sanitized_md = MarkdownValidator.sanitize(design_doc_md)

    # Append execution report if session is available
    if session:
        report = generate_execution_report(session)
        sanitized_md += report

    try:
        task = await task_queries.get_task_by_id(task_id)
        if not task:
            return f"Error: Task {task_id} not found."

        # Update the task with the design doc
        task.design_doc = sanitized_md
        # If the task was CREATED, moving it to PROPOSED seems logical if it now has a design doc
        # but the spec says "only be started from the TaskItem when in state CREATED".
        # In ajapopaja, usually adding a design doc moves it to 'proposed' if want_design_doc is True.
        # Here we just save it.
        await task.save()

        if session and hasattr(session, "session_result"):
            session.session_result = {
                "status": "design_doc_saved",
                "task_id": task_id,
            }

        logger.info(f"save_design_doc: Design doc saved for {task_id}")
        return f"Successfully saved design document for task {task_id}."
    except Exception as e:
        logger.error(f"save_design_doc: Failed to save design doc for {task_id}: {e}")
        return f"Error saving design document: {str(e)}"


# Register the save_design_doc tool
archbot_registry.register_tool(save_design_doc)
