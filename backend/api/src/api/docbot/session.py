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

import inspect
import json
import logging
from typing import Any, Dict, List

import ollama

from core import config

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
"""


class DocBotSession:
    def __init__(self, pipeline_id: str, task_id: str):
        self.pipeline_id = pipeline_id
        self.task_id = task_id
        headers = {}
        if config.OLLAMA_API_KEY:
            headers["Authorization"] = f"Bearer {config.OLLAMA_API_KEY}"
        self.client = ollama.AsyncClient(host=config.OLLAMA_HOST, headers=headers)
        self.history: List[Dict[str, Any]] = [
            {"role": "system", "content": SYSTEM_INSTRUCTION}
        ]

    async def run(self, initial_prompt: str, max_iterations: int = 50):
        self.history.append({"role": "user", "content": initial_prompt})

        for i in range(max_iterations):
            logger.info(f"DocBot iteration {i + 1}/{max_iterations}")

            # Prepare tools
            ollama_tools = []
            for t in docbot_registry.list_tools():
                # Extract parameters, but remove 'pipeline_id' and 'task_id' if present
                # as we will inject them automatically
                parameters = t.parameters.copy()
                properties = parameters.get("properties", {}).copy()

                injected_params = ["pipeline_id", "task_id"]
                for p in injected_params:
                    if p in properties:
                        del properties[p]

                parameters["properties"] = properties

                if "required" in parameters:
                    required = [
                        r for r in parameters["required"] if r not in injected_params
                    ]
                    parameters["required"] = required

                ollama_tools.append(
                    {
                        "type": "function",
                        "function": {
                            "name": t.name,
                            "description": t.description,
                            "parameters": parameters,
                        },
                    }
                )

            response = await self.client.chat(
                model=config.OLLAMA_MODEL,
                messages=self.history,
                tools=ollama_tools,
            )
            # ... (rest of the method remains the same until _execute_tool call)

            msg = response.message

            # Store as dictionary for next turn
            assistant_msg = {"role": "assistant", "content": msg.content or ""}
            if msg.tool_calls:
                assistant_msg["tool_calls"] = [
                    {
                        "type": "function",
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments,
                        },
                    }
                    for tc in msg.tool_calls
                ]
            self.history.append(assistant_msg)

            if not msg.tool_calls:
                logger.info(
                    f"DocBot iteration {i + 1}: No tool calls, agent responded with "
                    f"text: {msg.content}"
                )
                # If no tool call, push the agent to finish
                feedback = (
                    "Continue to analyze the recent change and then call the "
                    "tools to update the design document or signal that no "
                    "change is needed. Remember to use the formal tool calling "
                    "mechanism."
                )
                self.history.append(
                    {
                        "role": "user",
                        "content": feedback,
                    }
                )
                continue

            # Process tool calls
            terminal_call = False
            for tool_call in msg.tool_calls:
                tool_name = tool_call.function.name
                args = tool_call.function.arguments

                logger.info(
                    f"DocBot iteration {i + 1}: Agent calling tool '{tool_name}' "
                    f"with args: {args}"
                )

                if tool_name in ["update_ref_doc", "no_doc_update_needed"]:
                    terminal_call = True
                    logger.info(f"DocBot reached terminal decision: {tool_name}")

                result = await self._execute_tool(tool_name, args)

                # Append tool result to history
                self.history.append(
                    {
                        "role": "tool",
                        "content": json.dumps(result),
                        "name": tool_name,
                    }
                )

                if terminal_call:
                    is_error = False
                    if isinstance(result, str) and result.startswith("Error"):
                        is_error = True
                    elif isinstance(result, dict) and "error" in result:
                        is_error = True

                    if is_error:
                        logger.warning(
                            f"DocBot terminal tool '{tool_name}' failed with "
                            f"{result}. Forcing retry."
                        )
                        terminal_call = False

            if terminal_call:
                logger.info("DocBot finished analysis with terminal tool call.")
                return

        logger.warning("DocBot reached maximum iterations without terminal call.")

    async def _execute_tool(self, name: str, args: Dict[str, Any]) -> Any:
        tool = docbot_registry.get_tool(name)
        if not tool:
            return f"Error: Tool {name} not found."

        try:
            if isinstance(args, str):
                args = json.loads(args)

            # Inject pipeline_id and task_id if the tool expects them
            sig = inspect.signature(tool.func)
            if "pipeline_id" in sig.parameters:
                args["pipeline_id"] = self.pipeline_id
            if "task_id" in sig.parameters:
                args["task_id"] = self.task_id

            return await tool.func(**args)
        except Exception as e:
            logger.error(f"DocBot tool error ({name}): {e}")
            return f"Error: {type(e).__name__} - {str(e)}"
