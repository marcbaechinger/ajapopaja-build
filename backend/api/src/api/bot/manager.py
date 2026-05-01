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

from api.ollama_utils import is_ollama_available

from .base_session import BaseBotSession

logger = logging.getLogger(__name__)


class BotManager:
    """
    Generic manager for bots inheriting from BaseBotSession.
    Ensures that only one bot processes at a time via a queue.
    """

    def __init__(self):
        self._queue = asyncio.Queue()
        self._worker_task = None

    async def enqueue(self, session: BaseBotSession):
        """Adds a bot session to the execution queue."""
        if not await is_ollama_available():
            logger.info(
                f"Ollama is not available. Skipping {session.__class__.__name__}."
            )
            return

        await self._queue.put(session)
        logger.info(
            f"Enqueued {session.__class__.__name__} for pipeline {session.pipeline_id}, task {session.task_id}."
        )

        if self._worker_task is None or self._worker_task.done():
            self._worker_task = asyncio.create_task(self._process_queue())

    async def _process_queue(self):
        """Processes the queue sequentially."""
        while not self._queue.empty():
            session = await self._queue.get()
            try:
                logger.info(
                    f"Starting {session.__class__.__name__} execution for task {session.task_id}."
                )
                await session.run()
            except Exception as e:
                logger.error(
                    f"{session.__class__.__name__} execution failed for task {session.task_id}: {e}",
                    exc_info=True,
                )
            finally:
                self._queue.task_done()
                logger.info(
                    f"Completed {session.__class__.__name__} execution for task {session.task_id}."
                )


# Global instance
bot_manager = BotManager()
