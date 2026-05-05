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
import logging

from core.models.models import Task

from .session import CoderBotSession

logger = logging.getLogger(__name__)


class CoderBotManager:
    """
    Manager for CoderBotSession instances.
    Ensures that only one Pi subprocess runs at a time via a queue.
    """

    def __init__(self):
        self._queue = asyncio.Queue()
        self._worker_task = None

    async def process_task(self, task: Task):
        """Enqueues a new CoderBotSession for the given task."""
        session = CoderBotSession(
            pipeline_id=str(task.pipeline_id), task_id=str(task.id)
        )
        await self._queue.put(session)
        logger.info(
            f"Enqueued CoderBotSession for pipeline {session.pipeline_id}, task {session.task_id}."
        )

        if self._worker_task is None or self._worker_task.done():
            self._worker_task = asyncio.create_task(self._process_queue())

    async def _process_queue(self):
        """Processes the CoderBot queue sequentially."""
        while not self._queue.empty():
            session = await self._queue.get()
            try:
                logger.info(f"Starting CoderBot execution for task {session.task_id}.")
                await session.run()
            except Exception as e:
                logger.error(
                    f"CoderBot execution failed for task {session.task_id}: {e}",
                    exc_info=True,
                )
            finally:
                self._queue.task_done()
                logger.info(f"Completed CoderBot execution for task {session.task_id}.")


coderbot_manager = CoderBotManager()
