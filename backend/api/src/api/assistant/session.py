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

import asyncio
import json
import logging
import ollama
from typing import List, Dict, Any, Optional, Callable, Awaitable
from core import config
from core.models.models import ChatMessage, UserChat
from .tool_registry import registry
from . import tools  # Ensure all tools in the package are imported and registered

logger = logging.getLogger(__name__)

READ_ONLY = "read_only"


class AssistantSession:
    def __init__(
        self,
        user_id: str,
        history: List[ChatMessage],
        on_update: Callable[[Dict], Awaitable[None]],
    ):
        self.user_id = user_id
        self.history = history
        self.on_update = on_update
        self.is_processing = False
        self.pending_tool_call: Optional[Dict] = None
        self.client = ollama.AsyncClient(host=config.OLLAMA_HOST)

    async def _save_history(self):
        chat = await UserChat.find_one(UserChat.user_id == self.user_id)
        if not chat:
            chat = UserChat(user_id=self.user_id, history=self.history)
        else:
            chat.history = self.history
        await chat.save()

    async def process_message(self, text: str):
        if self.is_processing:
            return

        self.is_processing = True
        self.history.append(ChatMessage(role="user", content=text))
        await self._save_history()

        try:
            await self._run_llm_loop()
        finally:
            self.is_processing = False

    async def confirm_tool(self, tool_call_id: str):
        pending_id = (self.pending_tool_call or {}).get("id") or "legacy_id"
        if not self.pending_tool_call or pending_id != tool_call_id:
            await self.on_update(
                {
                    "type": "error",
                    "message": f"No pending tool call found or ID mismatch. Expected {pending_id}, got {tool_call_id}",
                }
            )
            return

        tool_call = self.pending_tool_call
        self.pending_tool_call = None

        # Execute the tool
        result = await self._execute_tool(tool_call)

        # Append tool result to history
        self.history.append(
            ChatMessage(
                role="tool",
                content=json.dumps(result),
                tool_calls=[
                    {
                        "id": tool_call.get("id", "legacy_id"),
                        "type": "function",
                        "function": tool_call.get("function", {}),
                    }
                ],
            )
        )
        await self._save_history()

        # Continue LLM loop
        await self._run_llm_loop()


    async def reject_tool(self, tool_call_id: str):
        pending_id = (self.pending_tool_call or {}).get("id") or "legacy_id"
        if not self.pending_tool_call or pending_id != tool_call_id:
            await self.on_update(
                {
                    "type": "error",
                    "message": f"No pending tool call found or ID mismatch. Expected {pending_id}, got {tool_call_id}",
                }
            )
            return

        tool_call = self.pending_tool_call
        self.pending_tool_call = None

        # Add a rejection message as the tool result
        result = {"error": "Tool rejected by the user. Do not try again without asking the user for the reason of rejection."}

        # Append tool result to history
        self.history.append(
            ChatMessage(
                role="tool",
                content=json.dumps(result),
                tool_calls=[
                    {
                        "id": tool_call.get("id", "legacy_id"),
                        "type": "function",
                        "function": tool_call.get("function", {}),
                    }
                ],
            )
        )
        await self._save_history()

        # Continue LLM loop so it can react to the rejection
        await self._run_llm_loop()

    async def _run_llm_loop(self, retry_count: int = 0):
        if retry_count >= 3:
            await self.on_update({
                "type": "error",
                "message": "Assistant failed to produce a valid response after multiple attempts."
            })
            return

        # Convert history to Ollama format
        system_instruction = (
            "You are a helpful AI assistant connected to the Ajapopaja task management system. "
            "You can execute various tools to interact with pipelines, tasks, and the project workspace. "
            "IMPORTANT: If a tool call is rejected by the user, you MUST NOT retry the same tool call without first asking the user for the reason of rejection or for further instructions."
        )
        messages = [{"role": "system", "content": system_instruction}]
        
        for msg in self.history:
            m = {"role": msg.role, "content": msg.content}
            if msg.tool_calls:
                m["tool_calls"] = msg.tool_calls
            messages.append(m)

        # Ollama tools format
        ollama_tools = []
        registered_tools = registry.list_tools()
        for t in registered_tools:
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

        logger.info(
            f"Presenting {len(ollama_tools)} tools to Ollama model '{config.OLLAMA_MODEL}': {[t.name for t in registered_tools]}"
        )

        try:
            response = await self.client.chat(
                model=config.OLLAMA_MODEL,
                messages=messages,
                tools=ollama_tools,
                stream=True,
                think=True,
            )

            full_content = ""
            full_thought = ""
            tool_calls = []

            async for chunk in response:
                # Handle chunk being an object or a dict
                msg = getattr(chunk, "message", None)
                if not msg and isinstance(chunk, dict):
                    msg = chunk.get("message")

                if msg:
                    # Handle thinking streaming
                    thought = getattr(msg, "thought", "")
                    if not thought and hasattr(msg, "reasoning_content"):
                        thought = getattr(msg, "reasoning_content", "")
                    if not thought and isinstance(msg, dict):
                        thought = msg.get("thought", "") or msg.get("reasoning_content", "")

                    if thought:
                        full_thought += thought
                        await self.on_update({"type": "thinking", "content": thought})

                    # Handle text streaming
                    content = getattr(msg, "content", "")
                    if not content and isinstance(msg, dict):
                        content = msg.get("content", "")

                    if content:
                        full_content += content
                        await self.on_update({"type": "chunk", "content": content})

                    # Handle tool calls
                    tc = getattr(msg, "tool_calls", None)
                    if not tc and isinstance(msg, dict):
                        tc = msg.get("tool_calls", [])

                    if tc:
                        tool_calls.extend(tc)

            if full_content or full_thought or tool_calls:
                # Convert tool calls to dicts for Pydantic/Storage
                tool_calls_dicts = []
                for tc in tool_calls:
                    if hasattr(tc, "model_dump"):
                        tool_calls_dicts.append(tc.model_dump())
                    elif hasattr(tc, "dict"):
                        tool_calls_dicts.append(tc.dict())
                    elif isinstance(tc, dict):
                        tool_calls_dicts.append(tc)
                    else:
                        # Manual fallback if not a Pydantic model
                        tool_calls_dicts.append(
                            {
                                "id": getattr(tc, "id", None) or "legacy_id",
                                "type": getattr(tc, "type", "function"),
                                "function": {
                                    "name": tc.function.name,
                                    "arguments": tc.function.arguments,
                                },
                            }
                        )

                self.history.append(
                    ChatMessage(
                        role="assistant",
                        content=full_content,
                        thought=full_thought if full_thought else None,
                        tool_calls=tool_calls_dicts if tool_calls_dicts else None,
                    )
                )
                await self._save_history()

            if tool_calls:
                # For simplicity, handle first tool call for now
                # Use the dict version for our own logic
                tool_call_dict = tool_calls_dicts[0]

                tool_name = tool_call_dict.get("function", {}).get("name")
                if not tool_name:
                    return

                tool_def = registry.get_tool(tool_name)

                if not tool_def:
                    # Error handling
                    return

                if tool_def.type == READ_ONLY:
                    result = await self._execute_tool(tool_call_dict)
                    self.history.append(
                        ChatMessage(
                            role="tool",
                            content=json.dumps(result),
                            tool_calls=[tool_call_dict],
                        )
                    )
                    await self._save_history()
                    # Recursive call to continue loop
                    await self._run_llm_loop()
                else:
                    self.pending_tool_call = tool_call_dict
                    await self.on_update(
                        {
                            "type": "tool_request",
                            "id": tool_call_dict.get("id") or "legacy_id",
                            "tool": tool_name,
                            "arguments": tool_call_dict.get("function", {}).get(
                                "arguments"
                            ),
                        }
                    )
        except Exception as e:
            logger.error(f"LLM loop error: {e}")
            self.history.append(
                ChatMessage(
                    role="system",
                    content=f"Error: Your last response resulted in a syntax or parsing error. Details: {str(e)}. Please retry with a corrected tool call or response."
                )
            )
            await self._save_history()
            await self._run_llm_loop(retry_count + 1)

    async def _execute_tool(self, tool_call: Dict) -> Any:
        tool_name = tool_call["function"]["name"]
        args = tool_call["function"]["arguments"]

        logger.info(f"Ollama model called tool: '{tool_name}' with args: {args}")

        tool = registry.get_tool(tool_name)
        if not tool:
            logger.warning(f"Ollama tried to call an unknown tool: '{tool_name}'")
            return {"error": f"Tool {tool_name} not found."}

        try:
            # Handle potential variations in LLM input (args as string or dict)
            if isinstance(args, str):
                args = json.loads(args)

            logger.debug(f"Executing tool '{tool_name}' with parsed args: {args}")
            result = await tool.func(**args)
            logger.info(f"Tool '{tool_name}' execution successful")
            return result
        except Exception as e:
            logger.error(f"Error executing tool '{tool_name}': {str(e)}", exc_info=True)
            return {"error": str(e)}

    async def clear_history(self):
        self.history = []
        await self._save_history()
        await self.on_update({"type": "cleared"})

    async def emit_history(self):
        # Convert history to serializable dicts
        history_data = []
        for msg in self.history:
            history_data.append(msg.model_dump(mode="json"))

        await self.on_update({"type": "assistant_history", "messages": history_data})
