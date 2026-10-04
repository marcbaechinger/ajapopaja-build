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

"""Tools for the SpecAgent.

The SpecAgent has **read-only** access to the repository, git history and
tasks. Its only "write" is the terminal :func:`save_elaborated_spec` tool,
which stores a proposal in :mod:`api.specagent.cache` and broadcasts it to the
UI. It deliberately does **not** touch ``task.spec``; the human accepts or
rejects the proposal first.
"""

import logging
from typing import Any, Optional

from api.archbot.markdown_validator import MarkdownValidator
from api.assistant.tools.file_tools import (
    list_project_structure,
    read_source_file,
)
from api.assistant.tools.git_tools import (
    git_blame,
    git_diff,
    git_log,
    git_show_commit,
    git_status,
)
from api.assistant.tools.search_tools import find, grep, tree
from api.assistant.tools.task_tools import get_task, list_tasks
from api.websocket_manager import WSMessage, manager

from .cache import SpecProposal, set_proposal
from .registry import specagent_registry

logger = logging.getLogger(__name__)

# Re-register the read-only tools from the shared assistant library so the bot
# can inspect repo files, git history and tasks.
specagent_registry.register_tool(list_project_structure)
specagent_registry.register_tool(tree)
specagent_registry.register_tool(read_source_file)
specagent_registry.register_tool(grep)
specagent_registry.register_tool(find)
specagent_registry.register_tool(git_log)
specagent_registry.register_tool(git_show_commit)
specagent_registry.register_tool(git_status)
specagent_registry.register_tool(git_blame)
specagent_registry.register_tool(git_diff)
specagent_registry.register_tool(get_task)
specagent_registry.register_tool(list_tasks)


async def save_elaborated_spec(
    pipeline_id: str,
    task_id: str,
    spec_md: str,
    rationale: str = "",
    session: Optional[Any] = None,
) -> str:
    """
    Finalize the elaborated specification. This is the terminal tool.

    This tool MUST be called to finish the session. It stores the elaborated
    spec as a pending proposal for the user to accept or reject; it does NOT
    update the task specification itself.

    Args:
        spec_md: The complete elaborated specification in Markdown format.
        rationale: Brief note on the gaps closed and artifacts found.
    """
    logger.info(f"save_elaborated_spec: Saving proposal for task {task_id}")

    if not isinstance(spec_md, str):
        return f"Error: spec_md must be a string, got {type(spec_md).__name__}."

    if not spec_md.strip():
        return "Error: spec_md cannot be empty or only whitespace."

    # Validate Markdown content.
    if not MarkdownValidator.has_top_level_heading(spec_md):
        return "Error: spec_md must contain at least one top-level heading (# Heading)."

    # Sanitize content (strip raw HTML tags) before storing.
    sanitized_md = MarkdownValidator.sanitize(spec_md)

    try:
        await set_proposal(
            task_id,
            SpecProposal(
                task_id=task_id,
                pipeline_id=pipeline_id,
                spec_md=sanitized_md,
                rationale=rationale or "",
            ),
        )

        if session and hasattr(session, "session_result"):
            session.session_result = {
                "status": "spec_proposal_ready",
                "task_id": task_id,
            }

        # Notify the UI that a fresh proposal is available. The spec itself is
        # fetched through the proposal endpoint so the payload stays small.
        await manager.broadcast(
            WSMessage(
                type="SPECAGENT_SPEC_READY",
                payload={"pipeline_id": pipeline_id, "task_id": task_id},
            )
        )
        logger.info(f"save_elaborated_spec: Proposal stored for {task_id}")

        return f"Successfully saved elaborated specification proposal for {task_id}."
    except Exception as e:
        logger.error(f"save_elaborated_spec: Failed for {task_id}: {e}")
        return f"Error saving elaborated specification: {str(e)}"


# Register the terminal tool.
specagent_registry.register_tool(save_elaborated_spec)
