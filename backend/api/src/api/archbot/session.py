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
from typing import List, Optional, Dict, Any

from api.bot.base_session import BaseBotSession
from api.bot.tool_registry import ToolDefinition
from api.websocket_manager import WSMessage, manager
from core.queries import task as task_queries

from .registry import archbot_registry

logger = logging.getLogger(__name__)


class ArchBotSession(BaseBotSession):
    """
    Bot session for the ArchitectureBot.
    Creates a design document for a given task.
    """

    def get_system_instruction(self) -> str:
        return dedent("""\
            You are a Senior Software Architect. Your goal is to create a clear, concise,
            and technically sound design document for a given task.

            Follow this general design doc format for small to medium features:
            1. **Background**: Briefly explain the context and problem being solved.
            2. **Proposed Changes**: Describe the architectural changes, new classes, or
               modified logic. Use Object-Oriented Design principles.
            3. **Implementation Plan**: A step-by-step list of technical actions to take.
               Focus only on the preferred option.
            4. **Alternatives (Optional)**: Briefly mention other options considered.
            5. **Test Strategy**: How the changes will be verified (unit tests,
               integration tests, etc.).

            Be straight to the point and lean, but cover the technical challenges.
            Always use the `save_design_doc` tool to finalize your work.
            """)

    async def get_initial_prompt(self) -> str:
        task = await task_queries.get_task_by_id(self.task_id)
        if not task:
            return f"Error: Task {self.task_id} not found."

        return dedent(f"""\
            Please create a design document for the following task:

            Title: {task.title}
            Description: {task.description or "No description provided."}
            Spec: {task.spec or "No spec provided."}

            Start by exploring the codebase to understand the current implementation
            and how the new feature or fix should be integrated.
            """)

    def get_tools(self) -> List[ToolDefinition]:
        return archbot_registry.list_tools()[:]

    def is_terminal_tool(self, tool_name: str) -> bool:
        return tool_name == "save_design_doc"

    async def on_event(self, event_name: str, payload: Optional[Dict[str, Any]] = None):
        if event_name == "bot_started":
            await manager.broadcast(
                WSMessage(
                    type="ARCHBOT_STARTED",
                    payload={"pipeline_id": self.pipeline_id, "task_id": self.task_id},
                )
            )
        elif event_name == "bot_completed":
            # Broadcast completion to clear banners/status in UI.
            # Note: save_design_doc also broadcasts this, but we do it here as a safety measure
            # to ensure the UI is notified even if the tool wasn't called or failed.
            await manager.broadcast(
                WSMessage(
                    type="ARCHBOT_COMPLETED",
                    payload={"pipeline_id": self.pipeline_id, "task_id": self.task_id},
                )
            )
