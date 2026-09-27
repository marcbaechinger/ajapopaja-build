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

from api.websocket_manager import WSMessage, manager as ws_manager
from core import config
from core.models.models import Pipeline, PullRequest, Task
from core.utils import git_utils

from .session import CoderBotSession, InteractivePiSession

logger = logging.getLogger(__name__)


class InteractiveSessionError(Exception):
    """Base error for interactive session lifecycle operations.

    Carries the HTTP status the router should map the outcome to so all
    lifecycle logic stays in the manager while the router only translates
    outcomes into HTTP errors.
    """

    status_code: int = 400


class InteractiveSessionAlreadyActiveError(InteractiveSessionError):
    """Raised when an interactive session is already running."""

    status_code = 409


class NoActiveInteractiveSessionError(InteractiveSessionError):
    """Raised when an operation requires an active interactive session."""

    status_code = 404


class InteractiveSessionBusyError(InteractiveSessionError):
    """Raised when a turn is already in flight for the active session."""

    status_code = 409


class InteractiveSessionNotSupportedError(InteractiveSessionError):
    """Raised when the pipeline cannot host an interactive session."""

    status_code = 400


class CoderBotManager:
    """
    Manager for CoderBotSession instances.
    Ensures that only one Pi subprocess runs at a time via a queue.

    Besides the queued batch :class:`CoderBotSession` runs, the manager owns a
    single, independent :class:`InteractivePiSession` slot. One batch and one
    interactive session may therefore run at the same time, but the manager
    enforces that only one session of each kind exists at any moment.
    """

    def __init__(self):
        self._queue = asyncio.Queue()
        self._worker_task = None
        self._active_session: Optional[CoderBotSession] = None
        self._last_session: Optional[CoderBotSession] = None
        self._default_model: Optional[str] = config.CODERBOT_MODEL

        # Interactive session slot (independent of the batch queue).
        self._interactive_session: Optional[InteractivePiSession] = None
        self._interactive_turn_task: Optional[asyncio.Task] = None
        self._interactive_monitor: Optional[asyncio.Task] = None
        # Guards start/stop atomicity so two concurrent requests cannot create
        # two interactive sessions (or race a stop against a start).
        self._interactive_lock = asyncio.Lock()

    # ------------------------------------------------------------------
    # Batch CoderBot session API
    # ------------------------------------------------------------------
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

    # ------------------------------------------------------------------
    # Interactive session API
    # ------------------------------------------------------------------
    def get_interactive_session(self) -> Optional[dict]:
        """Return the active interactive session for UI re-attachment, or None."""
        session = self._interactive_session
        if session is None:
            return None
        return self._interactive_session_info(session)

    def _interactive_session_info(self, session: InteractivePiSession) -> dict:
        turn_task = self._interactive_turn_task
        return {
            "pipeline_id": session.pipeline_id,
            "is_active": session is self._interactive_session,
            "start_time": (
                session.start_time.isoformat() if session.start_time else None
            ),
            "busy": turn_task is not None and not turn_task.done(),
        }

    async def start_interactive_session(self, pipeline: Pipeline) -> dict:
        """Start an interactive Pi session in the pipeline's remote repository.

        Only remote pipelines (``repo_uri`` set) are supported: the session runs
        directly in the actual repository clone (no sandbox, no branch). Exactly
        one interactive session may be active at a time.
        """
        async with self._interactive_lock:
            if self._interactive_session is not None:
                raise InteractiveSessionAlreadyActiveError(
                    "An interactive session is already active."
                )

            if not pipeline.repo_uri:
                raise InteractiveSessionNotSupportedError(
                    "Interactive sessions require a remote pipeline repository."
                )

            # Make sure the remote clone exists and is up to date. Unlike the
            # batch CoderBotSession this intentionally does NOT create a sandbox
            # or a branch: the agent works in the actual repository.
            await git_utils.ensure_repo_cloned(pipeline)

            workspace = pipeline.workspace_abs_path
            if workspace is None:
                raise InteractiveSessionNotSupportedError(
                    "Could not resolve the pipeline repository workspace."
                )

            session = InteractivePiSession(
                model=self._default_model,
                cwd=str(workspace),
                pipeline_id=str(pipeline.id),
            )

            # Publish the slot before spawning/broadcasting so a client that
            # reacts to the INTERACTIVE_STARTED event (and immediately queries
            # the session endpoint) observes the active session.
            self._interactive_session = session
            try:
                await session.start_interactive(cwd=str(workspace))
            except Exception:
                logger.error(
                    "Failed to start interactive Pi session for pipeline %s",
                    pipeline.id,
                    exc_info=True,
                )
                self._interactive_session = None
                # Best-effort cleanup so a failed start does not leak a process.
                try:
                    await session.stop()
                except Exception:
                    logger.debug(
                        "Failed to clean up interactive session", exc_info=True
                    )
                raise

            self._interactive_turn_task = None
            self._interactive_monitor = asyncio.create_task(
                self._watch_interactive_session(session)
            )

            logger.info(
                "Started interactive Pi session for pipeline %s (cwd=%s).",
                pipeline.id,
                workspace,
            )
            await self._broadcast_started(session)
            return self._interactive_session_info(session)

    async def send_interactive_message(self, text: str) -> None:
        """Send one chat turn to the active interactive session.

        The turn is driven in the background so the HTTP call returns
        immediately; its output streams to clients over the WebSocket. Only one
        turn may be in flight at a time.
        """
        async with self._interactive_lock:
            session = self._interactive_session
            if session is None:
                raise NoActiveInteractiveSessionError("No active interactive session.")

            turn_task = self._interactive_turn_task
            if turn_task is not None and not turn_task.done():
                raise InteractiveSessionBusyError(
                    "The interactive session is still processing the previous message."
                )

            self._interactive_turn_task = asyncio.create_task(
                self._drive_interactive_turn(session, text)
            )

    async def _drive_interactive_turn(
        self, session: InteractivePiSession, text: str
    ) -> None:
        """Drain one turn's streamed text and broadcast its outcome.

        The streamed text is already broadcast as ``INTERACTIVE_RPC_EVENT`` from
        the session's event handler, so this only needs to consume the generator
        and emit the turn-level lifecycle events.
        """
        try:
            async for _ in session.send_user_message(text):
                # Text is broadcast via INTERACTIVE_RPC_EVENT; nothing to do here.
                pass
        except asyncio.CancelledError:
            raise
        except Exception as e:  # pragma: no cover - defensive
            logger.error(
                "Interactive turn failed for pipeline %s: %s",
                session.pipeline_id,
                e,
                exc_info=True,
            )
            await self._broadcast_interactive_error(session, str(e))
        else:
            await self._broadcast_turn_ended(session)
        finally:
            self._interactive_turn_task = None

    async def stop_interactive_session(self) -> bool:
        """Stop the active interactive session and release its slot."""
        async with self._interactive_lock:
            session = self._interactive_session
            if session is None:
                return False

            # Clear the slot first so the monitor cannot double-handle the exit.
            self._interactive_session = None

            turn_task = self._interactive_turn_task
            self._interactive_turn_task = None
            if turn_task is not None and not turn_task.done():
                turn_task.cancel()
                try:
                    await turn_task
                except asyncio.CancelledError:
                    pass
                except Exception:
                    logger.debug(
                        "Interactive turn task raised during stop", exc_info=True
                    )

            monitor = self._interactive_monitor
            self._interactive_monitor = None
            if monitor is not None and not monitor.done():
                monitor.cancel()
                try:
                    await monitor
                except asyncio.CancelledError:
                    pass
                except Exception:
                    logger.debug(
                        "Interactive monitor raised during stop", exc_info=True
                    )

            stop_result = session.stop()
            if asyncio.iscoroutine(stop_result):
                await stop_result

            await self._broadcast_stopped(session)
            logger.info(
                "Stopped interactive Pi session for pipeline %s.",
                session.pipeline_id,
            )
            return True

    async def _watch_interactive_session(self, session: InteractivePiSession) -> None:
        """Detect an unexpected process exit and release the session slot.

        A normal stop clears ``self._interactive_session`` first, so this only
        acts when the process exited on its own (e.g. the agent crashed).
        """
        try:
            await session.wait()
        except asyncio.CancelledError:
            raise
        except Exception:  # pragma: no cover - defensive
            logger.debug(
                "Error while waiting for interactive Pi process", exc_info=True
            )
            return

        if self._interactive_session is not session:
            return

        logger.warning(
            "Interactive Pi process for pipeline %s exited unexpectedly.",
            session.pipeline_id,
        )
        self._interactive_session = None
        self._interactive_monitor = None
        turn_task = self._interactive_turn_task
        self._interactive_turn_task = None
        if turn_task is not None and not turn_task.done():
            turn_task.cancel()

        await self._broadcast_stopped(session)

    # ------------------------------------------------------------------
    # Interactive broadcast helpers
    # ------------------------------------------------------------------
    async def _broadcast_started(self, session: InteractivePiSession) -> None:
        """Broadcast ``INTERACTIVE_STARTED`` unless the session already did."""
        if getattr(session, "_started_broadcast", False) is True:
            return
        if getattr(session, "pipeline_id", None) is None:
            return
        await ws_manager.broadcast(
            WSMessage(
                type="INTERACTIVE_STARTED",
                payload={
                    "pipeline_id": session.pipeline_id,
                    "bot_type": getattr(session, "bot_type", "interactive"),
                    "start_time": (
                        session.start_time.isoformat()
                        if getattr(session, "start_time", None)
                        else None
                    ),
                },
            )
        )

    async def _broadcast_stopped(self, session: InteractivePiSession) -> None:
        """Broadcast ``INTERACTIVE_STOPPED`` unless the session already did."""
        if getattr(session, "_stopped_broadcast", False) is True:
            return
        if getattr(session, "pipeline_id", None) is None:
            return
        await ws_manager.broadcast(
            WSMessage(
                type="INTERACTIVE_STOPPED",
                payload={
                    "pipeline_id": session.pipeline_id,
                    "bot_type": getattr(session, "bot_type", "interactive"),
                },
            )
        )

    async def _broadcast_turn_ended(self, session: InteractivePiSession) -> None:
        if getattr(session, "pipeline_id", None) is None:
            return
        await ws_manager.broadcast(
            WSMessage(
                type="INTERACTIVE_TURN_ENDED",
                payload={
                    "pipeline_id": session.pipeline_id,
                    "bot_type": getattr(session, "bot_type", "interactive"),
                },
            )
        )

    async def _broadcast_interactive_error(
        self, session: InteractivePiSession, message: str
    ) -> None:
        if getattr(session, "pipeline_id", None) is None:
            return
        await ws_manager.broadcast(
            WSMessage(
                type="INTERACTIVE_ERROR",
                payload={
                    "pipeline_id": session.pipeline_id,
                    "bot_type": getattr(session, "bot_type", "interactive"),
                    "message": message,
                },
            )
        )


coderbot_manager = CoderBotManager()
