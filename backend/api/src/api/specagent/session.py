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
from textwrap import dedent
from typing import Any, Dict, List, Optional

from api.bot.base_session import BaseBotSession
from api.bot.session_config import BaseBotSessionConfig
from api.bot.tool_registry import ToolDefinition
from api.websocket_manager import WSMessage, manager
from core.queries import task as task_queries

from .registry import specagent_registry

logger = logging.getLogger(__name__)

SYSTEM_INSTRUCTION = dedent("""\
    ### Role
    You are a Requirements Clarifier and Specification Editor. Turn a rough base
    spec into a brief, concrete specification that a human can review and accept.
    You are not an implementer: describe WHAT is required and WHY, never low-level
    HOW (no code or implementation plans).

    ### Output
    Produce a concise Markdown specification with a top-level heading (`# ...`).
    Choose only the sections that add value — none are mandatory. Useful sections:
    - **Intent** — expand the user's intent from the base spec, without inventing
      scope beyond it.
    - **Requirements** — the key points as clear, testable requirements.
    - **Context** — artifacts, examples, references and design docs that are
      important or useful for these requirements, grounded in the existing project.
    - **Acceptance criteria** — a short checklist of verifiable outcomes.

    ### Method
    1. Read the task's title, description and base spec.
    2. Explore the repository, git history and sibling tasks to find relevant
       artifacts, examples and existing solutions.
    3. Call `save_elaborated_spec` exactly once with the Markdown spec and a short
       rationale.

    ### Constraints
    - Execute immediately; do not ask for permission or seek confirmation.
    - When you decide to call a tool, output ONLY the tool call, with no preamble
      or explanation.
    """)


class SpecAgentSession(BaseBotSession):
    """
    Specialized read-only bot that turns a rough task spec into a concrete,
    reviewable specification. It is a requirements clarifier, not an
    implementer.
    """

    def __init__(
        self,
        pipeline_id: str,
        task_id: str,
        session_config: Optional[BaseBotSessionConfig] = None,
        requested_by: Optional[str] = None,
    ):
        super().__init__(pipeline_id, task_id, session_config)
        self.session_result: Optional[Dict[str, Any]] = None
        # Username that triggered the elaboration. Used to target the
        # completion notification; ``None`` means "broadcast".
        self.requested_by = requested_by

    def get_system_instruction(self) -> str:
        return SYSTEM_INSTRUCTION

    async def get_initial_prompt(self) -> str:
        task = await task_queries.get_task_by_id(self.task_id)
        if not task:
            return f"Error: Task {self.task_id} not found."

        return dedent(f"""\
            Please elaborate the specification for the following task:

            Title: {task.title}
            Description: {task.description or "No description provided."}
            Base spec:
            ```
            {task.spec or "No spec provided."}
            ```

            Start by exploring the codebase to understand how similar
            requirements are already handled and which artifacts (files, modules,
            docs, tasks) the change would affect. Then produce a concrete,
            reviewable specification and finalize it with the
            `save_elaborated_spec` tool.
            """)

    def get_tools(self) -> List[ToolDefinition]:
        return specagent_registry.list_tools()[:]

    def is_terminal_tool(self, tool_name: str) -> bool:
        return tool_name == "save_elaborated_spec"

    async def on_event(self, event_name: str, payload: Optional[Dict[str, Any]] = None):
        logger.info(
            f"[SpecAgent] (B0) on_event '{event_name}' pipeline={self.pipeline_id} "
            f"task={self.task_id}"
        )
        if event_name == "bot_started":
            await manager.broadcast(
                WSMessage(
                    type="SPECAGENT_STARTED",
                    payload={"pipeline_id": self.pipeline_id, "task_id": self.task_id},
                )
            )
        elif event_name == "bot_completed":
            # Broadcast the fresh task so the UI clears the in-progress banner
            # consistently with ArchBot. The spec itself is unchanged at this
            # point (persistence happens only on accept).
            logger.info(
                f"[SpecAgent] (B0) bot_completed session_result={self.session_result}"
            )
            task = await task_queries.get_task_by_id(self.task_id)
            if task:
                await manager.broadcast(
                    WSMessage(
                        type="SPECAGENT_COMPLETED",
                        payload=task.model_dump(mode="json"),
                    )
                )
            else:
                await manager.broadcast(
                    WSMessage(
                        type="SPECAGENT_COMPLETED",
                        payload={
                            "pipeline_id": self.pipeline_id,
                            "task_id": self.task_id,
                        },
                    )
                )
