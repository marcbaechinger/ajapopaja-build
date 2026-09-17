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

from api.bot.manager import bot_manager
from api.bot.session_config import BaseBotSessionConfig
from core import config as config_mod
from core.models.models import Task

from .session import ReviewBotSession

logger = logging.getLogger(__name__)


class ReviewBotManager:
    @staticmethod
    async def process_completed_task(task: Task):
        """
        Triggers an autonomous ReviewBot session by adding it to the bot manager queue.
        """
        logger.info(f"Queueing ReviewBot session for task {task.id}")
        config = BaseBotSessionConfig(
            model=config_mod.REVIEWBOT_MODEL,
            host=config_mod.REVIEWBOT_HOST,
            api_key=config_mod.REVIEWBOT_API_KEY,
        )
        session = ReviewBotSession(
            pipeline_id=str(task.pipeline_id),
            task_id=str(task.id),
            session_config=config,
        )
        await bot_manager.enqueue(session)
