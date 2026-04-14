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
from typing import List, Dict, Any, Callable, Awaitable
from pydantic import BaseModel, Field
import json
import logging

logger = logging.getLogger(__name__)

class WSMessage(BaseModel):
    type: str
    id: str = Field(default="")
    payload: Any = Field(default_factory=dict)

MessageHandler = Callable[[WSMessage, WebSocket], Awaitable[None]]

class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.handlers: Dict[str, MessageHandler] = {}

    async def connect(self, websocket: WebSocket, client_id: str):
        await websocket.accept()
        self.active_connections[client_id] = websocket
        logger.info(f"New WebSocket connection: {client_id}. Total: {len(self.active_connections)}")

    async def add_connection(self, websocket: WebSocket, client_id: str):
        """Adds an already accepted connection."""
        self.active_connections[client_id] = websocket
        logger.info(f"Accepted connection added: {client_id}. Total: {len(self.active_connections)}")

    def disconnect(self, websocket: WebSocket, client_id: str = None):
        if client_id and client_id in self.active_connections:
            if self.active_connections[client_id] == websocket:
                del self.active_connections[client_id]
                logger.info(f"WebSocket disconnected: {client_id}. Total: {len(self.active_connections)}")
                return

        # Fallback if client_id is not provided or doesn't match
        to_remove = [cid for cid, ws in self.active_connections.items() if ws == websocket]
        for cid in to_remove:
            del self.active_connections[cid]
            logger.info(f"WebSocket disconnected: {cid}. Total: {len(self.active_connections)}")

    async def broadcast(self, message: WSMessage):
        """Send a message to all connected clients."""
        data = message.model_dump_json()
        for client_id, connection in self.active_connections.items():
            try:
                await connection.send_text(data)
            except Exception as e:
                logger.error(f"Error broadcasting message to {client_id}: {e}")

    def register_handler(self, message_type: str, handler: MessageHandler):
        self.handlers[message_type] = handler

    async def handle_message(self, message_text: str, websocket: WebSocket):
        try:
            data = json.loads(message_text)
            message = WSMessage(**data)
            handler = self.handlers.get(message.type)
            if handler:
                await handler(message, websocket)
            else:
                logger.warning(f"No handler for message type: {message.type}")
        except Exception as e:
            logger.error(f"Error handling WebSocket message: {e}")

# Global instance
manager = ConnectionManager()
