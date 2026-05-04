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
from textwrap import dedent
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional

import ollama

from api.bot.conversation import ConversationTurn, create_log_turn
from api.bot.session_config import BaseBotSessionConfig
from api.bot.tool_registry import ToolDefinition
from core import config

logger = logging.getLogger(__name__)


class BaseBotSession(ABC):
    """
    Base class for autonomous assistant agents.

    Provides the core autonomous loop, Ollama client management,
    and tool execution infrastructure.
    """

    def __init__(
        self,
        pipeline_id: str,
        task_id: str,
        session_config: Optional[BaseBotSessionConfig] = None,
    ):
        self.pipeline_id = pipeline_id
        self.task_id = task_id
        self.config = session_config or BaseBotSessionConfig()

        headers = {}
        if self.config.api_key:
            headers["Authorization"] = f"Bearer {self.config.api_key}"

        self.client = ollama.AsyncClient(host=self.config.host, headers=headers)
        self.history: List[Dict[str, Any]] = [
            {"role": "system", "content": self.get_system_instruction()}
        ]
        self.conversation_log: List[ConversationTurn] = []
        self.finished_via_terminal_tool: bool = False
        self.reached_turn_warning: bool = False
        self.iterations_used: int = 0

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

    def get_turn_warning(self, remaining: int) -> Optional[str]:
        """
        Returns a warning message when turns are running low.
        Subclasses can override this to customize the messages.

        Args:
            remaining: Number of turns remaining.

        Returns:
            Warning message or None if no warning is needed.
        """
        if remaining == 5:
            return "Only 5 calls left. Please call the terminating tool."
        if remaining == 1:
            return (
                "Only 1 call left. Call the terminating tool NOW or the "
                "execution loop ends without a result.\n\n"
                f"pipeline ID: {self.pipeline_id}\n"
                f"task ID: {self.task_id}\n"
            )
        return None

    def get_default_feedback(
        self, pipeline_id: str, task_id: str, assistant_message: str
    ) -> str:
        """
        Return the default feedback message that is sent to the LLM when the
        assistant produces plain text. Sub‑classes can override this method
        to provide a different message, e.g. one that references the
        specific pipeline or task.

        Args:
            pipeline_id : Identifier (UID) of the current pipeline.
            task_id : Identifier (UID) of the current task.
            assistant_message: The message the assitant sent instead of a tool call.

        Returns: The feedback message.
        """
        return dedent(f"""\
            Continue to analyze and then call the tools to finalize your task.
            Remember to use the formal tool calling mechanism.

            Current pipeline ID: {pipeline_id}
            Current task ID: {task_id}
            """)

    async def on_event(self, event_name: str, payload: Optional[Dict[str, Any]] = None):
        """Lifecycle event hook."""
        pass

    def get_log_directory(self) -> Optional[str]:
        """Returns the directory where logs should be saved. Subclasses can override."""
        return str(config.SANDBOX_ROOT / "logs" / self.task_id)

    def _log_turn(self, turn: ConversationTurn):
        """Appends a turn to the conversation log and persists if enabled."""
        self.conversation_log.append(turn)
        if config.BASEBOT_LOG_ENABLED:
            log_dir = self.get_log_directory()
            if log_dir:
                try:
                    from pathlib import Path

                    log_path = Path(log_dir) / "__log.json"
                    log_path.parent.mkdir(parents=True, exist_ok=True)

                    # Serialize the whole log
                    with open(log_path, "w") as f:
                        # Convert turns to dicts
                        from dataclasses import asdict

                        serializable_log = [
                            {**asdict(t), "timestamp": t.timestamp.isoformat()}
                            for t in self.conversation_log
                        ]
                        json.dump(serializable_log, f, indent=2)
                except Exception as e:
                    logger.error(f"Failed to persist conversation log: {e}")

    def get_summary_stats(self) -> Dict[str, Any]:
        """Returns aggregate metrics of the conversation."""
        total_turns = len(self.conversation_log)
        tool_calls = [t for t in self.conversation_log if t.role == "tool"]
        num_tool_calls = len(tool_calls)
        successful_tools = [t for t in tool_calls if t.success]
        success_rate = (
            len(successful_tools) / num_tool_calls if num_tool_calls > 0 else 0
        )

        return {
            "total_turns": total_turns,
            "num_tool_calls": num_tool_calls,
            "success_rate": success_rate,
            "finished_via_terminal_tool": self.finished_via_terminal_tool,
            "reached_turn_warning": self.reached_turn_warning,
            "iterations_used": self.iterations_used,
            "max_iterations": self.config.max_iterations,
        }

    async def run(self, max_iterations: Optional[int] = None):
        """
        Runs the autonomous loop until a terminal tool is called or
        max_iterations is reached.
        """
        await self.on_event("bot_started")
        if max_iterations is None:
            max_iterations = self.config.max_iterations
        turn_id = 1
        try:
            initial_prompt = await self.get_initial_prompt()
            self.history.append({"role": "user", "content": initial_prompt})
            self._log_turn(create_log_turn(turn_id, "user", initial_prompt))
            turn_id += 1

            for i in range(max_iterations):
                self.iterations_used = i + 1
                logger.info(
                    f"{self.__class__.__name__} iteration {i + 1}/{max_iterations}"
                )

                # Prepare tools for Ollama
                ollama_tools = self._prepare_ollama_tools()

                try:
                    response = await self.client.chat(
                        model=self.config.model,
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
                    self._log_turn(
                        create_log_turn(
                            turn_id,
                            "assistant",
                            full_content,
                            tool_name=",".join([tc.function.name for tc in tool_calls])
                            if tool_calls
                            else None,
                        )
                    )
                    turn_id += 1

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
                        feedback = self.get_default_feedback(
                            self.pipeline_id, self.task_id, full_content
                        )
                        self.history.append({"role": "user", "content": feedback})
                        self._log_turn(create_log_turn(turn_id, "user", feedback))
                        turn_id += 1
                    else:
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
                            success = not self._is_tool_error(result)

                            # Append tool result to history
                            self.history.append(
                                {
                                    "role": "tool",
                                    "content": json.dumps(result),
                                    "name": tool_name,
                                }
                            )
                            self._log_turn(
                                create_log_turn(
                                    turn_id,
                                    "tool",
                                    json.dumps(result),
                                    tool_name=tool_name,
                                    tool_args=args,
                                    tool_result=result,
                                    success=success,
                                )
                            )
                            turn_id += 1

                            if terminal_call:
                                if self._is_tool_error(result):
                                    logger.warning(
                                        f"Terminal tool '{tool_name}' failed. Forcing retry."
                                    )
                                    terminal_call = False
                                else:
                                    self.finished_via_terminal_tool = True

                        # Inject warning AFTER processing tool results if not terminal
                        if not terminal_call:
                            remaining = max_iterations - (i + 1)
                            warning = self.get_turn_warning(remaining)
                            if warning:
                                logger.warning(f"Injecting turn warning: {warning}")
                                self.reached_turn_warning = True
                                self.history.append(
                                    {"role": "user", "content": warning}
                                )
                                self._log_turn(
                                    create_log_turn(turn_id, "user", warning)
                                )
                                turn_id += 1
                        else:
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
            else:
                # Work on a copy to avoid side effects on history (e.g. injecting 'session')
                args = args.copy()

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
