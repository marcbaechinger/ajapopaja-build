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
from typing import Awaitable, Callable, Dict, Optional

from api.assistant.session import AssistantSession
from core.models.models import UserChat
from core.queries.pipeline import get_pipeline_by_id
from core.services.model_resolver import resolve_model


class AssistantManager:
    def __init__(self):
        self.sessions: Dict[str, AssistantSession] = {}
        self.last_access: Dict[str, float] = {}
        self.session_ttl = 30 * 60  # 30 minutes

    async def _resolve_assistant_model(
        self, pipeline_id: Optional[str]
    ) -> Optional[str]:
        """Resolve the assistant model for the active pipeline (or config)."""
        pipeline = None
        if pipeline_id:
            try:
                pipeline = await get_pipeline_by_id(str(pipeline_id))
            except Exception:
                pipeline = None
        return resolve_model("assistant", pipeline)

    async def get_or_create_session(
        self,
        user_id: str,
        on_update: Callable[[Dict], Awaitable[None]],
        pipeline_id: Optional[str] = None,
    ) -> AssistantSession:
        self._cleanup_sessions()

        if user_id in self.sessions:
            session = self.sessions[user_id]
            # Update callback because WebSocket might be different
            session.on_update = on_update
            self.last_access[user_id] = time.time()
            # Assistant sessions are long-lived; refresh the model whenever the
            # active pipeline is supplied so a pipeline override takes effect.
            if pipeline_id:
                session.model = await self._resolve_assistant_model(pipeline_id)
            return session

        # Load history from DB
        chat = await UserChat.find_one(UserChat.user_id == user_id)
        history = chat.history if chat else []

        model = await self._resolve_assistant_model(pipeline_id)
        session = AssistantSession(user_id, history, on_update, model=model)
        self.sessions[user_id] = session
        self.last_access[user_id] = time.time()
        return session

    def _cleanup_sessions(self):
        now = time.time()
        to_delete = [
            uid
            for uid, last in self.last_access.items()
            if now - last > self.session_ttl
        ]
        for uid in to_delete:
            del self.sessions[uid]
            del self.last_access[uid]


manager = AssistantManager()
