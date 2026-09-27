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
from typing import Any, Awaitable, Callable, Dict, Iterable

from fastapi import WebSocket
from pydantic import BaseModel, Field

from core.queries import task as task_queries

logger = logging.getLogger(__name__)


class WSMessage(BaseModel):
    type: str
    id: str = Field(default="")
    payload: Any = Field(default_factory=dict)


MessageHandler = Callable[[WSMessage, WebSocket], Awaitable[None]]


class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        # client_id -> username for targeted delivery. Populated from the JWT
        # ``sub`` when the WebSocket is accepted.
        self.connection_users: Dict[str, str] = {}
        self.handlers: Dict[str, MessageHandler] = {}

    async def connect(self, websocket: WebSocket, client_id: str, username: str = None):
        await websocket.accept()
        self.active_connections[client_id] = websocket
        if username:
            self.connection_users[client_id] = username
        logger.info(
            f"New WebSocket connection: {client_id}. Total: {len(self.active_connections)}"
        )

    async def add_connection(
        self, websocket: WebSocket, client_id: str, username: str = None
    ):
        """Adds an already accepted connection, remembering its user."""
        self.active_connections[client_id] = websocket
        if username:
            self.connection_users[client_id] = username
        logger.info(
            f"Accepted connection added: {client_id}. Total: {len(self.active_connections)}"
        )

    def disconnect(self, websocket: WebSocket, client_id: str = None):
        if client_id and client_id in self.active_connections:
            if self.active_connections[client_id] == websocket:
                del self.active_connections[client_id]
                self.connection_users.pop(client_id, None)
                logger.info(
                    f"WebSocket disconnected: {client_id}. Total: {len(self.active_connections)}"
                )
                return

        # Fallback if client_id is not provided or doesn't match
        to_remove = [
            cid for cid, ws in self.active_connections.items() if ws == websocket
        ]
        for cid in to_remove:
            del self.active_connections[cid]
            self.connection_users.pop(cid, None)
            logger.info(
                f"WebSocket disconnected: {cid}. Total: {len(self.active_connections)}"
            )

    async def broadcast(self, message: WSMessage):
        """Send a message to all connected clients."""
        data = message.model_dump_json()
        for client_id, connection in self.active_connections.items():
            try:
                await connection.send_text(data)
            except Exception as e:
                logger.error(f"Error broadcasting message to {client_id}: {e}")

    async def send_to_client(self, message: WSMessage, client_id: str):
        """Send a message to a single client. Best-effort."""
        connection = self.active_connections.get(client_id)
        if connection is None:
            logger.warning(f"No connection for client {client_id}; message dropped.")
            return
        try:
            await connection.send_text(message.model_dump_json())
        except Exception as e:
            logger.error(f"Error sending message to client {client_id}: {e}")

    async def send_to_users(self, message: WSMessage, usernames: Iterable[str]):
        """Send a message to every connection belonging to the given users.

        A user may have several tabs/connections; all matching sockets receive
        the message. Delivery is best-effort and one dropped socket does not
        abort the loop.
        """
        wanted = set(usernames)
        if not wanted:
            return
        data = message.model_dump_json()
        for client_id, connection in self.active_connections.items():
            if self.connection_users.get(client_id) not in wanted:
                continue
            try:
                await connection.send_text(data)
            except Exception as e:
                logger.error(
                    f"Error sending message to user {self.connection_users.get(client_id)} "
                    f"(client {client_id}): {e}"
                )

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

    async def notify_task_update(self, task_id: str):
        """Fetch updated task and broadcast to clients."""
        task = await task_queries.get_task_by_id(task_id)
        await self.broadcast(
            WSMessage(type="TASK_UPDATED", payload=task.model_dump(mode="json"))
        )


# Global instance
# Global instance
manager = ConnectionManager()
