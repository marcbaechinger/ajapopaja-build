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

import logging
from typing import Optional

from api.bot.manager import bot_manager
from api.bot.session_config import BaseBotSessionConfig
from core import config as config_mod
from core.models.models import Task
from core.queries import pipeline as pipeline_queries
from core.services.model_resolver import resolve_model

from .session import ArchBotSession

logger = logging.getLogger(__name__)


class ArchBotManager:
    @staticmethod
    async def process_task(task: Task, user_prompt: Optional[str] = None):
        """
        Enqueues an ArchBotSession for the given task.

        Args:
            task: The task to process.
            user_prompt: Optional comments/feedback to address when iterating on
                an existing design document.
        """
        logger.info(f"ArchBotManager: Enqueueing ArchBot for task {task.id}")
        pipeline = None
        try:
            pipeline = await pipeline_queries.get_pipeline_by_id(str(task.pipeline_id))
        except Exception:
            # A missing pipeline must not block the bot; fall back to config.
            pipeline = None
        config = BaseBotSessionConfig(
            model=resolve_model("archbot", pipeline),
            host=config_mod.ARCHBOT_HOST,
            api_key=config_mod.ARCHBOT_API_KEY,
        )
        session = ArchBotSession(
            pipeline_id=str(task.pipeline_id),
            task_id=str(task.id),
            user_prompt=user_prompt,
            session_config=config,
        )
        await bot_manager.enqueue(session)
