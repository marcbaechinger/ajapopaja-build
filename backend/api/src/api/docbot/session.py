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
from typing import Any, Dict, List, Optional

from api.assistant.tool_registry import ToolDefinition
from api.bot.base_session import BaseBotSession
from api.websocket_manager import WSMessage, manager
from core.queries import pipeline as pipeline_queries
from core.queries import task as task_queries
from core.utils import git_utils

from .registry import docbot_registry

logger = logging.getLogger(__name__)

SYSTEM_INSTRUCTION = """
### Role & Persona
You are a Documentation Architect. Your mission is to maintain the structural integrity 
and factual accuracy of a project's reference documentation (Architecture, Design
Principles, API Contracts). You act as the bridge between code implementation and
conceptual design.

### Context
- **Knowledge Base:** You have access to source code, git history, and existing
  documentation.
- **Documentation Root:** All reference materials are stored in the `design/`
  directory (e.g., `dd_backend.md`, `dd_frontend.md`).
- **Cold Start:** If the `design/` directory is missing and the current change
  is architecturally significant, you are responsible for initializing it.

### Evaluation Workflow
1. **Analyze:** Critically review the task specification, implementation summary, and
   git diff. 
2. **Audit:** Explore the codebase and existing docs to identify drift between the new
   implementation and current design definitions.
3. **Execute:** 
    - **If updates are required:** Call `update_ref_doc`. You MUST provide: `filename`,
      `content`, and `reason`.
    - **If the design remains intact:** Call `no_doc_update_needed`.

### Composition Rules (The "Evergreen" Mandate)
- **Seamless Integration:** Never use temporal language like "now," "newly added,"
  "recently implemented," or "updated." Write in the present tense as if the feature or
  pattern has been a fundamental part of the system since its inception.
- **Technical Precision:** Focus on the *how* and *why* of the architecture rather than
  a play-by-play of the code changes.
- **Autonomy:** Do not seek confirmation, ask for permission, or wait for user feedback.
  Execute the necessary tool calls immediately.
- **No Narration:** When you decide to call a tool, do NOT provide any preamble, 
  explanation, or narration in the text response. Output ONLY the tool call.
"""


class DocBotSession(BaseBotSession):
    """
    Specialized assistant agent for maintaining project documentation.
    """

    def __init__(self, pipeline_id: str, task_id: str):
        super().__init__(pipeline_id, task_id)
        self.session_result: Optional[Dict[str, Any]] = None

    def get_system_instruction(self) -> str:
        return SYSTEM_INSTRUCTION

    def get_tools(self) -> List[ToolDefinition]:
        return docbot_registry.list_tools()

    def is_terminal_tool(self, tool_name: str) -> bool:
        return tool_name in ["update_ref_doc", "no_doc_update_needed"]

    async def on_event(self, event_name: str, payload: Optional[Dict[str, Any]] = None):
        if event_name == "bot_started":
            await manager.broadcast(
                WSMessage(
                    type="DOCBOT_STARTED",
                    payload={"pipeline_id": self.pipeline_id, "task_id": self.task_id},
                )
            )
        elif event_name == "bot_completed":
            await manager.broadcast(
                WSMessage(
                    type="DOCBOT_COMPLETED",
                    payload={
                        "pipeline_id": self.pipeline_id,
                        "task_id": self.task_id,
                        "result": self.session_result,
                    },
                )
            )

    async def get_initial_prompt(self) -> str:
        task = await task_queries.get_task_by_id(self.task_id)
        if not task:
            raise ValueError(f"Task {self.task_id} not found.")

        if not task.commit_hash:
            raise ValueError(f"Task {self.task_id} completed without a commit hash.")

        pipeline = await pipeline_queries.get_pipeline_by_id(self.pipeline_id)
        if not pipeline or not pipeline.workspace_abs_path:
            raise ValueError(
                f"Pipeline {self.pipeline_id} not found or has no workspace path."
            )

        try:
            repo = git_utils.get_repo(pipeline.workspace_abs_path)
            diff = repo.git.show(task.commit_hash)
        except Exception as e:
            raise ValueError(
                f"Failed to get git diff for commit {task.commit_hash}: {e}"
            )

        return f"""
I have completed a task in the pipeline '{pipeline.name}' (ID: {pipeline.id}).

TASK DETAILS:
- Title: {task.title}
- Description: {task.description or "N/A"}
- Spec: {task.spec or "N/A"}
- Design Doc: {task.design_doc or "N/A"}
- Completion Summary: {task.completion_info or "N/A"}
- Commit Hash: {task.commit_hash}

GIT DIFF:
```diff
{diff}
```

Please analyze if this change requires an update to the reference
documentation in the 'design/' directory.
"""
