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

import json
import logging
from typing import Any, Dict, List

import ollama

from core import config

from .registry import docbot_registry

logger = logging.getLogger(__name__)

SYSTEM_INSTRUCTION = """
You are a Documentation Architect. Your task is to analyze a completed software
change and decide if the project's reference documentation (architecture,
design principles, API contracts) needs to be updated.
You have access to the source code, git history, and the current reference
documentation.

Follow these steps:
1. Review the task spec, implementation summary, and the git diff provided in
   the initial prompt.
2. Explore the codebase and existing documentation to understand the impact of
   the change.
3. If the change introduces new design patterns, modifies core architecture, or
   changes public-facing API contracts, update the relevant documentation
   using 'update_ref_doc'.
4. If the change is purely implementation details or consistent with existing
   documentation, call 'no_doc_update_needed'.

IMPORTANT: You must finish your analysis by calling either 'update_ref_doc' or
'no_doc_update_needed'.
Do not ask for permission or wait for user input. Act autonomously.
"""


class DocBotSession:
    def __init__(self):
        headers = {}
        if config.OLLAMA_API_KEY:
            headers["Authorization"] = f"Bearer {config.OLLAMA_API_KEY}"
        self.client = ollama.AsyncClient(host=config.OLLAMA_HOST, headers=headers)
        self.history: List[Dict[str, Any]] = [
            {"role": "system", "content": SYSTEM_INSTRUCTION}
        ]

    async def run(self, initial_prompt: str, max_iterations: int = 10):
        self.history.append({"role": "user", "content": initial_prompt})

        for i in range(max_iterations):
            logger.info(f"DocBot iteration {i + 1}/{max_iterations}")

            # Prepare tools
            ollama_tools = []
            for t in docbot_registry.list_tools():
                ollama_tools.append(
                    {
                        "type": "function",
                        "function": {
                            "name": t.name,
                            "description": t.description,
                            "parameters": t.parameters,
                        },
                    }
                )

            response = await self.client.chat(
                model=config.OLLAMA_MODEL,
                messages=self.history,
                tools=ollama_tools,
            )

            msg = response.message
            self.history.append(msg)

            if not msg.tool_calls:
                logger.info(f"DocBot iteration {i + 1}: No tool calls, agent responded with text.")
                # If no tool call, push the agent to finish
                self.history.append(
                    {
                        "role": "user",
                        "content": (
                            "Continue to analyze the recent change and then call the "
                            "tools to update the design document or signal that no "
                            "change is needed."
                        ),
                    }
                )
                continue

            # Process tool calls
            terminal_call = False
            for tool_call in msg.tool_calls:
                tool_name = tool_call.function.name
                args = tool_call.function.arguments

                logger.info(f"DocBot iteration {i + 1}: Agent calling tool '{tool_name}' with args: {args}")

                if tool_name in ["update_ref_doc", "no_doc_update_needed"]:
                    terminal_call = True
                    logger.info(f"DocBot reached terminal decision: {tool_name}")

                result = await self._execute_tool(tool_name, args)
                self.history.append(
                    {
                        "role": "tool",
                        "content": json.dumps(result),
                        "tool_calls": [tool_call],
                    }
                )

            if terminal_call:
                logger.info("DocBot finished analysis with terminal tool call.")
                return

        logger.warning("DocBot reached maximum iterations without terminal call.")

    async def _execute_tool(self, name: str, args: Dict[str, Any]) -> Any:
        tool = docbot_registry.get_tool(name)
        if not tool:
            return {"error": f"Tool {name} not found."}

        try:
            if isinstance(args, str):
                args = json.loads(args)
            return await tool.func(**args)
        except Exception as e:
            logger.error(f"DocBot tool error ({name}): {e}")
            return {"error": str(e)}
