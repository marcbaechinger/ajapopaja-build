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

from api.bot.tool_registry import ToolDefinition
from api.bot.base_session import BaseBotSession
from api.bot.session_config import BaseBotSessionConfig
from api.websocket_manager import WSMessage, manager
from core.queries import pipeline as pipeline_queries
from core.queries import task as task_queries
from core.utils import git_utils

from .registry import reviewbot_registry

logger = logging.getLogger(__name__)

SYSTEM_INSTRUCTION = """
### Role & Persona
You are a Senior Technical Reviewer and Software Architect. Your mission is to provide 
rigorous, insightful, and constructive feedback on completed software tasks. You focus 
on technical excellence, architectural alignment, and long-term maintainability.

### Context
- **Knowledge Base:** You have access to the full source code, project structure, git history, 
  and design documentation.
- **Goal:** Produce a comprehensive technical review in Markdown format that helps the 
  developer improve the current implementation and provides context for future maintenance.

### Design Documentation Awareness
A critical part of your review is ensuring alignment with the project's established 
architecture and design patterns.
- **General Architecture:** Consult the general design documents in the `design/` 
  directory for foundational conventions and system-wide decisions.
- **Feature Implementations:** Detailed design documents for specific features are 
  located in `design/implemented/`.
- **Exploration:** Use tools like `list_project_structure`, `tree`, `grep`, and `find` 
  to discover relevant design documents. Use `read_source_file` to study them.

### Review Criteria
Your review MUST evaluate the following aspects:
1. **Code Quality & Readability:** Is the code clean, well-structured, and easy to understand? 
   Are naming conventions followed?
2. **Adherence to Design:** Does the implementation align with the original specification 
   and design document? Check against established patterns in `design/`.
3. **Testability:** Is the change adequately covered by tests? Is the code designed to be 
   testable?
4. **Extensibility & Maintainability:** Can this code be easily extended or modified in 
   the future? Does it introduce technical debt?
5. **Performance & Security:** Are there any obvious performance bottlenecks or security 
   vulnerabilities (e.g., injection, hardcoded secrets, improper sanitization)?
6. **Edge Cases:** Has the implementation accounted for error states and unusual inputs?

### Output Formatting
- **Markdown:** Use structured Markdown with clear headings and bullet points.
- **Prioritization:** Prioritize findings by severity (Critical, High, Medium, Low) or 
  identify "low-hanging fruits" for quick improvement.
- **Actionable Advice:** Provide specific, technical suggestions for remediation.
- **Tone:** Professional, direct, and constructive. Focus on the code, not the author.

### Workflow
1. **Analyze:** Review the task spec, design doc, and implementation summary.
2. **Audit:** Examine the git diff and explore the surrounding codebase for context.
3. **Design Check:** Search and read relevant design documentation in `design/` to 
   validate architectural alignment.
4. **Finalize:** Call the `save_review` tool with your complete Markdown review.

### Autonomy & Constraints
- **Execute Immediately:** Do not ask for permission or seek confirmation. Call `save_review` 
  once your analysis is complete.
- **No Narration:** When you decide to call a tool, do NOT provide any preamble or 
  explanation in the text response. Output ONLY the tool call.
"""


class ReviewBotSession(BaseBotSession):
    """
    Specialized assistant agent for performing technical code reviews.
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

    def get_tools(self) -> List[ToolDefinition]:
        return reviewbot_registry.list_tools()

    def is_terminal_tool(self, tool_name: str) -> bool:
        return tool_name == "save_review"

    async def on_event(self, event_name: str, payload: Optional[Dict[str, Any]] = None):
        if event_name == "bot_started":
            await manager.broadcast(
                WSMessage(
                    type="REVIEWBOT_STARTED",
                    payload={"pipeline_id": self.pipeline_id, "task_id": self.task_id},
                )
            )
        elif event_name == "bot_completed":
            await manager.broadcast(
                WSMessage(
                    type="REVIEWBOT_COMPLETED",
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
            repo = git_utils.get_repo(str(pipeline.workspace_abs_path))
            diff = repo.git.show(task.commit_hash)
        except Exception as e:
            raise ValueError(
                f"Failed to get git diff for commit {task.commit_hash}: {e}"
            )

        return f"""
I have completed a task in the pipeline '{pipeline.name}' (ID: {pipeline.id}). 
Please perform a technical review of the implementation.

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

Evaluate this implementation based on the review criteria and call 'save_review' 
with your final assessment.
"""
