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

from fastapi import WebSocket
from api.websocket_manager import manager, WSMessage
from api.auth import get_current_user_from_token
from .manager import manager as assistant_manager
import logging

logger = logging.getLogger(__name__)

async def handle_assistant_message(message: WSMessage, websocket: WebSocket):
    token = message.payload.get("token")
    user = await get_current_user_from_token(token)
    if not user:
        await websocket.send_text(WSMessage(type="assistant_error", payload={"message": "Unauthorized"}).model_dump_json())
        return

    session = await assistant_manager.get_or_create_session(str(user.id), lambda data: websocket.send_text(WSMessage(type="assistant_response", payload=data).model_dump_json()))
    
    text = message.payload.get("text")
    if text:
        await session.process_message(text)

async def handle_assistant_confirm(message: WSMessage, websocket: WebSocket):
    token = message.payload.get("token")
    user = await get_current_user_from_token(token)
    if not user:
        return

    tool_call_id = message.payload.get("tool_call_id")
    session = await assistant_manager.get_or_create_session(str(user.id), lambda data: websocket.send_text(WSMessage(type="assistant_response", payload=data).model_dump_json()))
    await session.confirm_tool(tool_call_id)

async def handle_assistant_clear(message: WSMessage, websocket: WebSocket):
    token = message.payload.get("token")
    user = await get_current_user_from_token(token)
    if not user:
        return

    session = await assistant_manager.get_or_create_session(str(user.id), lambda data: websocket.send_text(WSMessage(type="assistant_response", payload=data).model_dump_json()))
    await session.clear_history()

def register_assistant_handlers():
    manager.register_handler("assistant_message", handle_assistant_message)
    manager.register_handler("assistant_confirm", handle_assistant_confirm)
    manager.register_handler("assistant_clear", handle_assistant_clear)
