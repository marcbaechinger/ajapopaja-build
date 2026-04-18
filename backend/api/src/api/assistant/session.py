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
import ollama
from typing import List, Dict, Any, Optional, Callable, Awaitable
from core.models.models import ChatMessage, UserChat
from .tools import TOOLS, TOOL_MAP, READ_ONLY, get_tool_definition

MODEL_NAME = "qwen3.5:9b"  # Or any model that supports tool calling


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

    async def _run_llm_loop(self):
        # Convert history to Ollama format
        messages = []
        for msg in self.history:
            m = {"role": msg.role, "content": msg.content}
            if msg.tool_calls:
                m["tool_calls"] = msg.tool_calls
            messages.append(m)

        # Ollama tools format
        ollama_tools = []
        for t in TOOLS:
            ollama_tools.append(
                {
                    "type": "function",
                    "function": {
                        "name": t["name"],
                        "description": t["description"],
                        "parameters": t["parameters"],
                    },
                }
            )

        response = await asyncio.to_thread(
            ollama.chat,
            model=MODEL_NAME,
            messages=messages,
            tools=ollama_tools,
            stream=True,
        )

        full_content = ""
        tool_calls = []

        for chunk in response:
            # Handle chunk being an object or a dict
            msg = getattr(chunk, 'message', None)
            if not msg and isinstance(chunk, dict):
                msg = chunk.get("message")
            
            if msg:
                # Handle text streaming
                content = getattr(msg, 'content', '')
                if not content and isinstance(msg, dict):
                    content = msg.get("content", "")
                
                if content:
                    full_content += content
                    await self.on_update({"type": "chunk", "content": content})

                # Handle tool calls
                tc = getattr(msg, 'tool_calls', None)
                if not tc and isinstance(msg, dict):
                    tc = msg.get("tool_calls", [])
                
                if tc:
                    tool_calls.extend(tc)

        if full_content or tool_calls:
            # Convert tool calls to dicts for Pydantic/Storage
            tool_calls_dicts = []
            for tc in tool_calls:
                if hasattr(tc, 'model_dump'):
                    tool_calls_dicts.append(tc.model_dump())
                elif hasattr(tc, 'dict'):
                    tool_calls_dicts.append(tc.dict())
                elif isinstance(tc, dict):
                    tool_calls_dicts.append(tc)
                else:
                    # Manual fallback if not a Pydantic model
                    tool_calls_dicts.append({
                        "id": getattr(tc, 'id', None) or "legacy_id",
                        "type": getattr(tc, 'type', 'function'),
                        "function": {
                            "name": tc.function.name,
                            "arguments": tc.function.arguments
                        }
                    })

            self.history.append(ChatMessage(
                role="assistant", 
                content=full_content,
                tool_calls=tool_calls_dicts if tool_calls_dicts else None
            ))
            await self._save_history()

        if tool_calls:
            # For simplicity, handle first tool call for now
            # Use the dict version for our own logic
            tool_call_dict = tool_calls_dicts[0]
            
            tool_name = tool_call_dict.get("function", {}).get("name")
            if not tool_name:
                 return

            tool_def = get_tool_definition(tool_name)

            if not tool_def:
                # Error handling
                return

            if tool_def["type"] == READ_ONLY:
                result = await self._execute_tool(tool_call_dict)
                self.history.append(
                    ChatMessage(
                        role="tool", 
                        content=json.dumps(result), 
                        tool_calls=[tool_call_dict]
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
                        "arguments": tool_call_dict.get("function", {}).get("arguments"),
                    }
                )

    async def _execute_tool(self, tool_call: Dict) -> Any:
        tool_name = tool_call["function"]["name"]
        args = tool_call["function"]["arguments"]

        func = TOOL_MAP.get(tool_name)
        if not func:
            return {"error": f"Tool {tool_name} not found."}

        try:
            # Handle potential variations in LLM input (args as string or dict)
            if isinstance(args, str):
                args = json.loads(args)

            result = await func(**args)
            return result
        except Exception as e:
            return {"error": str(e)}

    async def clear_history(self):
        self.history = []
        await self._save_history()
        await self.on_update({"type": "cleared"})
