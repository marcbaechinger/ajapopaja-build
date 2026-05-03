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
from core.models.models import Task

from .session import ArchBotSession

logger = logging.getLogger(__name__)


class ArchBotManager:
    @staticmethod
    async def process_task(task: Task):
        """
        Enqueues an ArchBotSession for the given task.
        """
        logger.info(f"ArchBotManager: Enqueueing ArchBot for task {task.id}")
        session = ArchBotSession(
            pipeline_id=str(task.pipeline_id), task_id=str(task.id)
        )
        await bot_manager.enqueue(session)
