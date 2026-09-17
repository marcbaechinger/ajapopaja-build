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

from . import tools  # noqa: F401
from .session import DocBotSession

logger = logging.getLogger(__name__)


class DocBotManager:
    @staticmethod
    async def process_completed_task(task: Task):
        """
        Triggers an autonomous DocBot session by adding it to the bot manager queue.
        """
        logger.info(f"Queueing DocBot session for task {task.id}")
        config = BaseBotSessionConfig(
            model=config_mod.DOCBOT_MODEL,
            host=config_mod.DOCBOT_HOST,
            api_key=config_mod.DOCBOT_API_KEY,
        )
        session = DocBotSession(
            pipeline_id=str(task.pipeline_id),
            task_id=str(task.id),
            session_config=config,
        )
        await bot_manager.enqueue(session)
