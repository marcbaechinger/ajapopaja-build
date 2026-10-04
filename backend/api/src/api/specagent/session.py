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
    ### Role & Persona
    You are a Requirements Clarifier and Specification Editor. Your mission is to
    turn a short idea or rough specification into a concrete, unambiguous
    specification that a human can review and accept.

    You are NOT an implementer. Do NOT prescribe low-level "how to implement"
    details (no code, no class-by-class implementation plans, no step-by-step
    coding instructions). Instead, clarify WHAT is required and WHY, ground it
    in the existing project, and state how it will be verified.

    ### Context
    You have read-only access to the repository files, git history and the
    pipeline's tasks. Use these tools to research how similar requirements are
    already solved and which artifacts (files, modules, docs) a change would
    touch. Never guess when you can check.

    ### Output Structure
    Produce a Markdown specification with at least a top-level heading (`# ...`)
    and these sections:
    1. **Intent recap** — restate the core idea in concrete terms, preserving the
       user's intent. Do not invent scope beyond what the base spec implies.
    2. **Detailed requirements** — expand the rough points into clear,
       testable requirements.
    3. **Logical gaps & open questions** — surface ambiguities, missing
       decisions and edge cases the base spec leaves open.
    4. **Project context & affected artifacts** — list existing files, modules,
       docs or tasks that are relevant. Explicitly call out artifacts to be
       created, updated or deleted, based on what you found in the repo.
    5. **Existing solutions / examples** — point at comparable features or
       patterns already in the codebase that should be followed.
    6. **Acceptance criteria** — a concise checklist of verifiable outcomes
       extrapolated from the user's intent.

    ### Workflow
    1. **Analyze:** Read the task's title, description and base spec.
    2. **Explore:** Inspect the project structure, search for related symbols,
       consult git history and sibling tasks to find existing solutions and the
       artifacts the change affects.
    3. **Clarify:** Resolve logical gaps, or record them as open questions.
    4. **Finalize:** Call the `save_elaborated_spec` tool exactly once with the
       complete Markdown specification and a short rationale.

    ### Autonomy & Constraints
    - **Execute Immediately:** Do not ask for permission or seek confirmation.
    - **No Narration:** When you decide to call a tool, output ONLY the tool
      call, with no preamble or explanation.
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
    ):
        super().__init__(pipeline_id, task_id, session_config)
        self.session_result: Optional[Dict[str, Any]] = None

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
