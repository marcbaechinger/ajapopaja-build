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

import time
from typing import Dict, Optional, Callable, Awaitable
from core.models.models import UserChat
from .session import AssistantSession

class AssistantManager:
    def __init__(self):
        self.sessions: Dict[str, AssistantSession] = {}
        self.last_access: Dict[str, float] = {}
        self.session_ttl = 30 * 60  # 30 minutes

    async def get_or_create_session(self, user_id: str, on_update: Callable[[Dict], Awaitable[None]]) -> AssistantSession:
        self._cleanup_sessions()
        
        if user_id in self.sessions:
            # Update callback because WebSocket might be different
            self.sessions[user_id].on_update = on_update
            self.last_access[user_id] = time.time()
            return self.sessions[user_id]

        # Load history from DB
        chat = await UserChat.find_one(UserChat.user_id == user_id)
        history = chat.history if chat else []

        session = AssistantSession(user_id, history, on_update)
        self.sessions[user_id] = session
        self.last_access[user_id] = time.time()
        return session

    def _cleanup_sessions(self):
        now = time.time()
        to_delete = [uid for uid, last in self.last_access.items() if now - last > self.session_ttl]
        for uid in to_delete:
            del self.sessions[uid]
            del self.last_access[uid]

manager = AssistantManager()
