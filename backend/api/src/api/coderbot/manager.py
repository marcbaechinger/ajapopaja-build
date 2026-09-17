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
from typing import Optional

from core import config
from core.models.models import PullRequest, Task

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
        self._active_session: Optional[CoderBotSession] = None
        self._last_session: Optional[CoderBotSession] = None
        self._default_model: Optional[str] = config.CODERBOT_DEFAULT_MODEL

    def get_active_session(self) -> Optional[dict]:
        """Return the current (or last) CoderBot session for UI re-attachment."""
        session = self._active_session or self._last_session
        if not session:
            return None
        return {
            "pipeline_id": session.pipeline_id,
            "task_id": session.task_id,
            "is_active": session is self._active_session,
            # Expose the session's wall-clock start time so the UI can resume its
            # elapsed-time display from the real session start on re-attach.
            "start_time": (
                session.start_time.isoformat() if session.start_time else None
            ),
        }

    def set_default_model(self, model: Optional[str]) -> None:
        """Updates the default model injected into session constructors."""
        self._default_model = model

    def _ensure_worker_running(self):
        """Start the queue-processing worker if it is not already running."""
        if self._worker_task is None or self._worker_task.done():
            self._worker_task = asyncio.create_task(self._process_queue())

    async def process_task(self, task: Task):
        """Enqueues a new CoderBotSession for the given task."""
        session = CoderBotSession(
            pipeline_id=str(task.pipeline_id),
            task_id=str(task.id),
            model=self._default_model,
        )
        await self._queue.put(session)
        logger.info(
            f"Enqueued CoderBotSession for pipeline {session.pipeline_id}, task {session.task_id}."
        )

        self._ensure_worker_running()

    async def process_pr_iteration(self, pr: PullRequest, comments: str):
        """Enqueues a CoderBotSession in iteration mode for the given PullRequest.

        The session re-runs CoderBot on a fresh branch with the current PR patch
        applied as unstaged changes and writes the updated result back onto the
        same PR document."""
        session = CoderBotSession(
            pipeline_id=pr.pipeline_id,
            task_id=pr.task_id,
            model=self._default_model,
            pr=pr,
            comments=comments,
        )
        await self._queue.put(session)
        logger.info(
            f"Enqueued CoderBotSession iteration for pipeline {session.pipeline_id}, "
            f"task {session.task_id}, pr {pr.id}."
        )

        self._ensure_worker_running()

    def stop_session(self, task_id: str) -> bool:
        """Stops the active session if it matches the task_id."""
        if self._active_session and self._active_session.task_id == task_id:
            self._active_session.stop()
            return True
        return False

    async def _process_queue(self):
        """Processes the CoderBot queue sequentially."""
        while not self._queue.empty():
            session = await self._queue.get()
            self._active_session = session
            try:
                logger.info(f"Starting CoderBot execution for task {session.task_id}.")
                await session.run()
            except Exception as e:
                logger.error(
                    f"CoderBot execution failed for task {session.task_id}: {e}",
                    exc_info=True,
                )
            finally:
                self._last_session = session
                self._active_session = None
                self._queue.task_done()
                logger.info(f"Completed CoderBot execution for task {session.task_id}.")


coderbot_manager = CoderBotManager()
