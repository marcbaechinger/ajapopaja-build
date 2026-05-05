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

from typing import Any, Dict, List, Optional

from api.bot.base_session import BaseBotSession
from api.bot.tool_registry import ToolDefinition
from api.websocket_manager import WSMessage, manager as ws_manager
from core import config
from core.models.models import Pipeline, Task

from .registry import coderbot_registry
from .git_helper import SandboxGitHelper


class CoderBotSession(BaseBotSession):
    @property
    def use_sandbox(self) -> bool:
        return True

    async def on_event(self, event_name: str, payload: Optional[Dict[str, Any]] = None):
        if event_name == "bot_started":
            await ws_manager.broadcast(
                WSMessage(
                    type="CODERBOT_STARTED",
                    payload={"pipeline_id": self.pipeline_id, "task_id": self.task_id},
                )
            )
        elif event_name == "bot_completed":
            await ws_manager.broadcast(
                WSMessage(
                    type="CODERBOT_COMPLETED",
                    payload={"pipeline_id": self.pipeline_id, "task_id": self.task_id},
                )
            )

    def get_system_instruction(self) -> str:
        return (
            "You are CoderBot, a Senior Software Engineer autonomous agent. "
            "Your goal is to implement the coding task described in the design document and specification.\n\n"
            "OPERATIONAL GUIDELINES:\n"
            "1. EXPLORE: Use 'tree', 'read_source_file', and 'grep' to understand the existing code and architecture.\n"
            "2. PLAN: Think through the implementation steps. Use the 'think' capability if available.\n"
            "3. IMPLEMENT: Use 'write_file' or 'write_file_partially' to apply changes. Follow the project's coding style and conventions.\n"
            "4. VERIFY: Always run 'lint' and 'test' after your changes to ensure quality and prevent regressions.\n"
            "5. FINALIZE: Once you are confident in your solution and all tests pass, call 'task_completed' with a clear summary of your work.\n\n"
            "IMPORTANT:\n"
            "- You are working in a SANDBOX. Changes are local to this sandbox until you call 'task_completed'.\n"
            "- Do not invent files or folders; use the exploration tools to find where to make changes.\n"
            "- If tests fail, analyze the output and fix your implementation."
        )

    async def get_initial_prompt(self) -> str:
        task = await Task.get(self.task_id)
        if not task:
            return "Task not found."

        pipeline = await Pipeline.get(self.pipeline_id)
        if not pipeline or not pipeline.workspace_abs_path:
            return "Pipeline or workspace path not found."

        # Initialize sandbox
        helper = SandboxGitHelper(self.task_id, pipeline.workspace_abs_path)
        helper.setup_sandbox()

        design_doc = task.design_doc or "No design document provided."
        spec = task.spec or "No specification provided."

        return (
            f"Please implement the following task in the sandbox.\n\n"
            f"### Task: {task.title}\n\n"
            f"### Design Document\n{design_doc}\n\n"
            f"### Specification\n{spec}"
        )

    def get_tools(self) -> List[ToolDefinition]:
        return coderbot_registry.list_tools()

    def is_terminal_tool(self, tool_name: str) -> bool:
        return tool_name == "task_completed"

    def get_log_directory(self) -> Optional[str]:
        return str(config.SANDBOX_ROOT / self.task_id)
