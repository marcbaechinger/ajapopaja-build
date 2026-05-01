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
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

import ollama

from api.assistant.tool_registry import ToolDefinition
from core import config

logger = logging.getLogger(__name__)


class BaseBotSession(ABC):
    """
    Base class for autonomous assistant agents.

    Provides the core autonomous loop, Ollama client management,
    and tool execution infrastructure.
    """

    def __init__(self, pipeline_id: str, task_id: str):
        self.pipeline_id = pipeline_id
        self.task_id = task_id
        headers = {}
        if config.OLLAMA_API_KEY:
            headers["Authorization"] = f"Bearer {config.OLLAMA_API_KEY}"
        self.client = ollama.AsyncClient(host=config.OLLAMA_HOST, headers=headers)
        self.history: List[Dict[str, Any]] = [
            {"role": "system", "content": self.get_system_instruction()}
        ]

    @abstractmethod
    def get_system_instruction(self) -> str:
        """Returns the system instruction for this agent."""
        pass

    @abstractmethod
    async def get_initial_prompt(self) -> str:
        """Generates the initial prompt for the session."""
        pass

    @abstractmethod
    def get_tools(self) -> List[ToolDefinition]:
        """Returns the list of tools available to this agent."""
        pass

    @abstractmethod
    def is_terminal_tool(self, tool_name: str) -> bool:
        """Determines if a tool call should terminate the autonomous loop."""
        pass

    async def on_event(self, event_name: str, payload: Optional[Dict[str, Any]] = None):
        """Lifecycle event hook."""
        pass

    async def run(self, max_iterations: int = 50):
        """
        Runs the autonomous loop until a terminal tool is called or
        max_iterations is reached.
        """
        await self.on_event("bot_started")
        try:
            initial_prompt = await self.get_initial_prompt()
            self.history.append({"role": "user", "content": initial_prompt})

            for i in range(max_iterations):
                logger.info(
                    f"{self.__class__.__name__} iteration {i + 1}/{max_iterations}"
                )

                # Prepare tools for Ollama
                ollama_tools = self._prepare_ollama_tools()

                try:
                    response = await self.client.chat(
                        model=config.OLLAMA_MODEL,
                        messages=self.history,
                        tools=ollama_tools,
                        stream=True,
                        think=True,
                    )

                    full_content = ""
                    full_thought = ""
                    tool_calls = []

                    async for chunk in response:
                        msg = getattr(chunk, "message", None)
                        if not msg and isinstance(chunk, dict):
                            msg = chunk.get("message")

                        if msg:
                            # Handle thinking
                            thought = getattr(msg, "thought", "")
                            if not thought and hasattr(msg, "reasoning_content"):
                                thought = getattr(msg, "reasoning_content", "")
                            if not thought and isinstance(msg, dict):
                                thought = msg.get("thought", "") or msg.get(
                                    "reasoning_content", ""
                                )

                            if thought:
                                full_thought += thought

                            # Handle text
                            content = getattr(msg, "content", "")
                            if not content and isinstance(msg, dict):
                                content = msg.get("content", "")
                            if content:
                                full_content += content

                            # Handle tool calls
                            tc = getattr(msg, "tool_calls", None)
                            if not tc and isinstance(msg, dict):
                                tc = msg.get("tool_calls", [])
                            if tc:
                                tool_calls.extend(tc)

                    if full_thought:
                        logger.info(
                            f"{self.__class__.__name__} iteration {i + 1} thinking: "
                            f"{full_thought[:100]}..."
                        )

                    # Store assistant response in history
                    assistant_msg = {"role": "assistant", "content": full_content}
                    if tool_calls:
                        assistant_msg["tool_calls"] = [
                            {
                                "type": "function",
                                "function": {
                                    "name": tc.function.name,
                                    "arguments": tc.function.arguments,
                                },
                            }
                            for tc in tool_calls
                        ]
                    self.history.append(assistant_msg)

                    if not tool_calls:
                        logger.info(
                            f"{self.__class__.__name__} iteration {i + 1}: No tool calls."
                        )
                        if full_content:
                            logger.info(
                                f"{self.__class__.__name__} responded with text: "
                                f"{full_content[:100]}..."
                            )

                        # If no tool call, push the agent to finish
                        feedback = (
                            "Continue to analyze and then call the tools to finalize your "
                            "task. Remember to use the formal tool calling mechanism."
                        )
                        self.history.append({"role": "user", "content": feedback})
                        continue

                    # Process tool calls
                    terminal_call = False
                    for tool_call in tool_calls:
                        tool_name = tool_call.function.name
                        args = tool_call.function.arguments

                        logger.info(
                            f"{self.__class__.__name__} iteration {i + 1}: "
                            f"Calling tool '{tool_name}'"
                        )

                        if self.is_terminal_tool(tool_name):
                            terminal_call = True

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
                            if self._is_tool_error(result):
                                logger.warning(
                                    f"Terminal tool '{tool_name}' failed. Forcing retry."
                                )
                                terminal_call = False

                    if terminal_call:
                        logger.info(
                            f"{self.__class__.__name__} finished with terminal call."
                        )
                        return

                except Exception as e:
                    logger.error(f"Ollama chat error: {e}")
                    # Add error to history so model can potentially see it
                    self.history.append(
                        {
                            "role": "system",
                            "content": (
                                "Error: Your last response resulted in a parsing error. "
                                f"Details: {str(e)}. Please retry with a formal tool call "
                                "and NO preamble."
                            ),
                        }
                    )
                    continue

            logger.warning(f"{self.__class__.__name__} reached maximum iterations.")
        finally:
            await self.on_event("bot_completed")

    def _prepare_ollama_tools(self) -> List[Dict[str, Any]]:
        """Maps registry tool definitions to Ollama function format."""
        ollama_tools = []
        for t in self.get_tools():
            parameters = t.parameters.copy()
            properties = parameters.get("properties", {}).copy()

            # Injectable params that we handle automatically
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
        return ollama_tools

    async def _execute_tool(self, name: str, args: Dict[str, Any]) -> Any:
        """Executes a tool by name with parameter injection."""
        tool_def = self._find_tool_definition(name)
        if not tool_def:
            return f"Error: Tool {name} not found."

        try:
            if isinstance(args, str):
                args = json.loads(args)

            # Inject pipeline_id and task_id if the tool expects them
            sig = inspect.signature(tool_def.func)
            if "pipeline_id" in sig.parameters:
                args["pipeline_id"] = self.pipeline_id
            if "task_id" in sig.parameters:
                args["task_id"] = self.task_id
            if "session" in sig.parameters:
                args["session"] = self

            return await tool_def.func(**args)
        except Exception as e:
            logger.error(f"Tool error ({name}): {e}")
            return f"Error: {type(e).__name__} - {str(e)}"

    def _find_tool_definition(self, name: str) -> Optional[ToolDefinition]:
        """Finds a tool definition in the agent's tools."""
        for t in self.get_tools():
            if t.name == name:
                return t
        return None

    def _is_tool_error(self, result: Any) -> bool:
        """Heuristic to detect if a tool result represents an error."""
        if isinstance(result, str) and result.startswith("Error"):
            return True
        if isinstance(result, dict) and "error" in result:
            return True
        return False
