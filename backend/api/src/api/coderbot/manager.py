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
import uuid as uuid_module
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Optional

from api.websocket_manager import WSMessage, manager as ws_manager
from core import config
from core.models.models import (
    PiSession,
    PiSessionKind,
    PiSessionStatus,
    Pipeline,
    PullRequest,
    Task,
    TaskStatus,
)
from core.queries import pipeline as pipeline_queries
from core.queries import task as task_queries
from core.services.model_resolver import resolve_model
from core.utils import git_utils

from . import pi_session_store
from .session import CoderBotSession, InteractivePiSession

logger = logging.getLogger(__name__)


def _session_label(value: object) -> Optional[str]:
    """Return a non-empty string session label for ``value`` or ``None``.

    Durable records reject non-string labels, so non-string task titles (e.g.
    ``MagicMock`` attributes in tests) must not be passed through verbatim.
    """
    if isinstance(value, str):
        cleaned = value.strip()
        if cleaned:
            return cleaned
    return None


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


class PiSessionNotFoundError(InteractiveSessionError):
    """Raised when a session UID does not resolve to a record."""

    status_code = 404


class PiSessionBusyError(InteractiveSessionError):
    """Raised when another session is running and ``pause_current=False``."""

    status_code = 409


class PiSessionNotResumableError(InteractiveSessionError):
    """Raised when a session cannot be resumed (e.g. discarded)."""

    status_code = 400


@dataclass
class PiSessionHandle:
    """Wraps a durable :class:`PiSession` record plus its live process state."""

    record: PiSession
    session: Optional[object] = None  # CoderBotSession | InteractivePiSession
    turn_task: Optional[asyncio.Task] = None
    monitor: Optional[asyncio.Task] = None

    def is_running(self) -> bool:
        """Whether the wrapped process is currently alive."""
        return (
            self.session is not None and self.record.status == PiSessionStatus.RUNNING
        )


class CoderBotManager:
    """
    Manager for CoderBotSession instances.

    Besides the queued batch :class:`CoderBotSession` runs, the manager owns a
    registry of durable :class:`PiSession` records (interactive and batch). At
    most one interactive process runs at a time; any number of sessions may be
    paused/completed and resumed later.
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

        # Durable session registry (uid -> handle) and the single-run guard.
        self._sessions: dict[str, PiSessionHandle] = {}
        self._running_uid: Optional[str] = None
        self._run_lock = asyncio.Lock()
        self._interactive_uid: Optional[str] = None

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
            "session_uid": getattr(session, "session_uid", None),
            # Expose the session's wall-clock start time so the UI can resume its
            # elapsed-time display from the real session start on re-attach.
            "start_time": (
                session.start_time.isoformat() if session.start_time else None
            ),
            # Expose the model id so the UI can show which model the session is
            # running with in its status overlay.
            "model": getattr(session, "model", None),
        }

    def set_default_model(self, model: Optional[str]) -> None:
        """Updates the default model injected into session constructors."""
        self._default_model = model

    async def _resolve_coderbot_model(
        self, pipeline_id: Optional[str]
    ) -> Optional[str]:
        """Resolve the CoderBot model from the pipeline or the manager default.

        The pipeline's ``coderbot_model`` override wins; otherwise the
        process-wide default (``set_default_model`` / ``config.CODERBOT_MODEL``)
        is used. A missing pipeline degrades to the default.
        """
        pipeline = None
        if pipeline_id:
            try:
                pipeline = await pipeline_queries.get_pipeline_by_id(
                    str(pipeline_id)
                )
            except Exception:
                pipeline = None
        return resolve_model("coderbot", pipeline, default=self._default_model)

    def _ensure_worker_running(self):
        """Start the queue-processing worker if it is not already running."""
        if self._worker_task is None or self._worker_task.done():
            self._worker_task = asyncio.create_task(self._process_queue())

    async def _mark_task_in_progress(self, task: Task) -> None:
        """Transition a task to INPROGRESS as soon as it is accepted into the queue.

        A queued task must no longer be shown in the backlog just because another
        session is still running. Only SCHEDULED and CREATED tasks are transitioned
        (matching the guard in CoderBotSession.run); any other status is left
        untouched so re-triggering a PULL_REQUEST_AVAILABLE/FAILED task cannot raise.
        Failures are non-fatal: the enqueue proceeds and CoderBotSession.run() still
        performs the transition when the session actually starts.
        """
        if task.status not in (TaskStatus.SCHEDULED, TaskStatus.CREATED):
            return
        try:
            updated_task = await task_queries.transition_task(
                str(task.id),
                TaskStatus.INPROGRESS,
                actor="coderbot",
                task=task,
            )
        except Exception:
            logger.warning(
                "Failed to mark task %s INPROGRESS on enqueue",
                task.id,
                exc_info=True,
            )
            return
        await ws_manager.broadcast(
            WSMessage(
                type="TASK_STATUS_UPDATED",
                payload=updated_task.model_dump(mode="json"),
            )
        )

    async def process_task(self, task: Task):
        """Enqueues a new CoderBotSession for the given task.

        The durable :class:`PiSession` record is seeded with the task title as
        its human readable ``label`` so the session manager can show a
        meaningful name instead of ``(untitled)`` for every batch run.
        """
        model = await self._resolve_coderbot_model(task.pipeline_id)
        record = PiSession(
            uid=str(uuid_module.uuid4()),
            kind=PiSessionKind.CODERBOT,
            status=PiSessionStatus.STARTING,
            pipeline_id=str(task.pipeline_id),
            task_id=str(task.id),
            model=model,
            skill_names=list(config.CODERBOT_SKILLS),
            bot_type="coderbot",
            label=_session_label(getattr(task, "title", None)),
        )
        await record.insert()
        pi_session_store.write_meta(record)

        # Mark the task INPROGRESS now so a queued task is no longer shown in the
        # backlog. This MUST run before the session is enqueued: if the worker is
        # between sessions it could otherwise pick the session up and run() would
        # transition first, making our later call an illegal INPROGRESS->INPROGRESS
        # transition.
        await self._mark_task_in_progress(task)

        session = CoderBotSession(
            pipeline_id=str(task.pipeline_id),
            task_id=str(task.id),
            model=model,
            session_uid=record.uid,
            session_record=record,
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
        task = await Task.get(pr.task_id) if pr.task_id else None
        label = _session_label(getattr(task, "title", None))
        if not label:
            label = _session_label(pr.subject)
        model = await self._resolve_coderbot_model(pr.pipeline_id)
        record = PiSession(
            uid=str(uuid_module.uuid4()),
            kind=PiSessionKind.CODERBOT,
            status=PiSessionStatus.STARTING,
            pipeline_id=pr.pipeline_id,
            task_id=pr.task_id,
            model=model,
            skill_names=list(config.CODERBOT_SKILLS),
            bot_type="coderbot",
            pull_request_ids=[str(pr.id)],
            label=label,
        )
        await record.insert()
        pi_session_store.write_meta(record)

        session = CoderBotSession(
            pipeline_id=pr.pipeline_id,
            task_id=pr.task_id,
            model=model,
            pr=pr,
            comments=comments,
            session_uid=record.uid,
            session_record=record,
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
            self._running_uid = getattr(session, "session_uid", None)
            self._register_batch_handle(session)
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
                if self._running_uid == getattr(session, "session_uid", None):
                    self._running_uid = None
                self._queue.task_done()
                logger.info(f"Completed CoderBot execution for task {session.task_id}.")

    def _register_batch_handle(self, session: CoderBotSession) -> None:
        """Register/refresh the durable handle for a running batch session."""
        uid = getattr(session, "session_uid", None)
        record = getattr(session, "session_record", None)
        if not uid or record is None:
            return
        handle = self._sessions.get(uid)
        if handle is None:
            handle = PiSessionHandle(record=record, session=session)
            self._sessions[uid] = handle
        else:
            handle.session = session
            handle.record = record

    # ------------------------------------------------------------------
    # Interactive session API (single active slot)
    # ------------------------------------------------------------------
    def get_interactive_session(self) -> Optional[dict]:
        """Return the active interactive session for UI re-attachment, or None."""
        session = self._interactive_session
        if session is None:
            return None
        return self._interactive_session_info(session)

    def _interactive_session_info(self, session) -> dict:
        turn_task = self._interactive_turn_task
        return {
            "pipeline_id": session.pipeline_id,
            "uid": getattr(session, "session_uid", None),
            "is_active": session is self._interactive_session,
            "start_time": (
                session.start_time.isoformat() if session.start_time else None
            ),
            "busy": turn_task is not None and not turn_task.done(),
            # Expose the model id so the UI can show which model the session is
            # running with in its status overlay.
            "model": getattr(session, "model", None),
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
            await self.create_interactive_session(pipeline)
            session = self._interactive_session
            return self._interactive_session_info(session)

    async def create_interactive_session(
        self, pipeline: Pipeline, owner: Optional[str] = None
    ) -> PiSession:
        """Create, spawn and register a new interactive Pi session.

        Returns the durable :class:`PiSession` record. The live process is
        available through the registry (``self._sessions[record.uid]``).
        """
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

        uid = str(uuid_module.uuid4())
        record = PiSession(
            uid=uid,
            kind=PiSessionKind.INTERACTIVE,
            status=PiSessionStatus.STARTING,
            owner=owner,
            pipeline_id=str(pipeline.id),
            cwd=str(workspace),
            model=self._default_model,
            skill_names=list(config.INTERACTIVE_SKILLS),
            bot_type="interactive",
        )
        await record.insert()
        pi_session_store.write_meta(record)

        session = InteractivePiSession(
            model=self._default_model,
            cwd=str(workspace),
            pipeline_id=str(pipeline.id),
            session_uid=uid,
            session_record=record,
            env=(
                {"MCP_AUTH_TOKEN": config.MCP_AUTH_TOKEN}
                if config.MCP_AUTH_TOKEN
                else None
            ),
        )
        handle = PiSessionHandle(record=record, session=session)
        self._sessions[uid] = handle

        # Publish the slot before spawning/broadcasting so a client that
        # reacts to the INTERACTIVE_STARTED event (and immediately queries
        # the session endpoint) observes the active session.
        self._interactive_session = session
        self._interactive_uid = uid
        try:
            await session.start_interactive(cwd=str(workspace))
        except Exception:
            logger.error(
                "Failed to start interactive Pi session for pipeline %s",
                pipeline.id,
                exc_info=True,
            )
            self._interactive_session = None
            self._interactive_uid = None
            record.status = PiSessionStatus.FAILED
            record.last_error = "Failed to start Pi process"
            await self._save_record(record)
            # Best-effort cleanup so a failed start does not leak a process.
            try:
                await session.stop()
            except Exception:
                logger.debug(
                    "Failed to clean up interactive session", exc_info=True
                )
            raise

        record.status = PiSessionStatus.RUNNING
        record.pi_session_id = session.session_id
        record.pi_session_file = session.session_file
        record.session_dir = session.session_dir
        record.last_active_at = datetime.now(UTC)
        await self._save_record(record)
        self._running_uid = uid

        self._interactive_turn_task = None
        self._interactive_monitor = asyncio.create_task(
            self._watch_interactive_session(session)
        )

        logger.info(
            "Started interactive Pi session %s for pipeline %s (cwd=%s).",
            uid,
            pipeline.id,
            workspace,
        )
        await self._broadcast_started(session)
        return record

    async def send_interactive_message(
        self, uid_or_text: str, text: Optional[str] = None
    ) -> None:
        """Send one chat turn to an interactive session.

        Accepts either ``(text)`` (legacy, targets the active slot) or
        ``(uid, text)`` (new registry API). The turn is driven in the background
        so the HTTP call returns immediately; its output streams to clients over
        the WebSocket. Only one turn may be in flight at a time.
        """
        async with self._interactive_lock:
            if text is None:
                session = self._interactive_session
                message = uid_or_text
            else:
                handle = self._sessions.get(uid_or_text)
                session = handle.session if handle else None
                message = text
                if session is None:
                    record = await PiSession.find_one(PiSession.uid == uid_or_text)
                    if record is None:
                        raise NoActiveInteractiveSessionError(
                            "No active interactive session."
                        )
                    # A paused session must be resumed before it accepts turns.
                    raise PiSessionNotResumableError(
                        "Session is not running; resume it first."
                    )

            if session is None:
                raise NoActiveInteractiveSessionError("No active interactive session.")

            turn_task = self._interactive_turn_task
            if turn_task is not None and not turn_task.done():
                raise InteractiveSessionBusyError(
                    "The interactive session is still processing the previous message."
                )

            self._interactive_turn_task = asyncio.create_task(
                self._drive_interactive_turn(session, message)
            )

    async def send_session_message(self, uid: str, text: str) -> None:
        """Send a follow-up prompt to any durable session.

        Interactive sessions receive the text as a chat turn when running. Batch
        sessions are resumed with the text as their follow-up instruction.
        """
        record = await self.get_session(uid)
        if record is None:
            raise PiSessionNotFoundError(f"Session {uid} not found.")

        if record.kind == PiSessionKind.CODERBOT:
            await self.resume_session(uid, message=text)
            return

        handle = self._sessions.get(uid)
        if (
            handle is not None
            and handle.session is not None
            and record.status == PiSessionStatus.RUNNING
        ):
            await self.send_interactive_message(uid, text)
            return

        # Not running: resume first; the message is delivered on the next turn.
        await self.resume_session(uid)

    async def _drive_interactive_turn(self, session, text: str) -> None:
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
            uid = getattr(session, "session_uid", None)
            if self._interactive_uid == uid:
                self._interactive_uid = None

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

            if uid and uid in self._sessions:
                record = self._sessions[uid].record
                record.status = PiSessionStatus.PAUSED
                record.last_active_at = datetime.now(UTC)
                await self._save_record(record)
            if self._running_uid == uid:
                self._running_uid = None

            await self._broadcast_stopped(session)
            logger.info(
                "Stopped interactive Pi session for pipeline %s.",
                session.pipeline_id,
            )
            return True

    async def _watch_interactive_session(self, session) -> None:
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
        self._interactive_uid = None
        self._interactive_monitor = None
        turn_task = self._interactive_turn_task
        self._interactive_turn_task = None
        if turn_task is not None and not turn_task.done():
            turn_task.cancel()

        await self._broadcast_stopped(session)

    # ------------------------------------------------------------------
    # Durable session registry / lifecycle
    # ------------------------------------------------------------------
    async def _save_record(self, record: PiSession) -> None:
        """Persist the record and refresh its best-effort ``meta.json`` sidecar."""
        record.updated_at = datetime.now(UTC)
        try:
            await record.save()
        except Exception:  # pragma: no cover - DB unavailable
            logger.debug("Failed to save Pi session %s", record.uid, exc_info=True)
        pi_session_store.write_meta(record)

    async def get_session(self, uid: str) -> Optional[PiSession]:
        """Return the durable record for ``uid`` (registry first, then DB)."""
        handle = self._sessions.get(uid)
        if handle is not None:
            return handle.record
        return await PiSession.find_one(PiSession.uid == uid)

    async def list_sessions(
        self,
        *,
        kind: Optional[PiSessionKind] = None,
        status: Optional[PiSessionStatus] = None,
        pipeline_id: Optional[str] = None,
        owner: Optional[str] = None,
    ) -> list:
        """List durable sessions, newest first, optionally filtered."""
        conditions = []
        if kind is not None:
            conditions.append(PiSession.kind == kind)
        if status is not None:
            conditions.append(PiSession.status == status)
        if pipeline_id is not None:
            conditions.append(PiSession.pipeline_id == pipeline_id)
        if owner is not None:
            conditions.append(PiSession.owner == owner)
        records = (
            await PiSession.find(*conditions)
            .sort(-PiSession.created_at)
            .to_list()
        )
        return records

    async def pause_session(self, uid: str) -> bool:
        """Persist and stop a running session, keeping it resumable."""
        handle = self._sessions.get(uid)
        if handle is None:
            record = await PiSession.find_one(PiSession.uid == uid)
            if record is None:
                raise PiSessionNotFoundError(f"Session {uid} not found.")
            handle = PiSessionHandle(record=record)
            self._sessions[uid] = handle

        session = handle.session
        if session is not None:
            # Cancel any in-flight turn/monitor for this handle.
            for task in (handle.turn_task, handle.monitor):
                if task is not None and not task.done():
                    task.cancel()
                    try:
                        await task
                    except asyncio.CancelledError:
                        pass
                    except Exception:  # pragma: no cover - defensive
                        logger.debug("Session task raised during pause", exc_info=True)
            handle.turn_task = None
            handle.monitor = None

            if session is self._interactive_session:
                self._interactive_session = None
                self._interactive_uid = None
                self._interactive_turn_task = None
                self._interactive_monitor = None
            try:
                result = session.stop()
                if asyncio.iscoroutine(result):
                    await result
            except Exception:  # pragma: no cover - defensive
                logger.debug("Failed to stop session %s", uid, exc_info=True)
            handle.session = None

        handle.record.status = PiSessionStatus.PAUSED
        handle.record.last_active_at = datetime.now(UTC)
        await self._save_record(handle.record)
        if self._running_uid == uid:
            self._running_uid = None
        await self._broadcast_stopped(session)
        return True

    async def resume_session(
        self, uid: str, *, pause_current: bool = True, message: Optional[str] = None
    ) -> PiSession:
        """Respawn Pi for a paused/completed/failed session using its stored file."""
        record = await PiSession.find_one(PiSession.uid == uid)
        if record is None:
            raise PiSessionNotFoundError(f"Session {uid} not found.")
        if record.status == PiSessionStatus.DISCARDED:
            raise PiSessionNotResumableError(f"Session {uid} has been discarded.")

        if (
            pause_current
            and self._running_uid
            and self._running_uid != uid
        ):
            await self.pause_session(self._running_uid)
        elif (
            not pause_current
            and self._running_uid
            and self._running_uid != uid
        ):
            raise PiSessionBusyError(
                f"Session {self._running_uid} is already running."
            )

        if record.kind == PiSessionKind.INTERACTIVE:
            session = InteractivePiSession(
                model=record.model,
                cwd=record.cwd,
                pipeline_id=record.pipeline_id,
                session_uid=record.uid,
                session_record=record,
                resume_session_file=record.pi_session_file,
            )
            handle = PiSessionHandle(record=record, session=session)
            self._sessions[uid] = handle
            self._interactive_session = session
            self._interactive_uid = uid
            try:
                await session.start_interactive(cwd=record.cwd)
            except Exception as e:
                logger.error("Failed to resume session %s: %s", uid, e, exc_info=True)
                record.status = PiSessionStatus.FAILED
                record.last_error = str(e)
                await self._save_record(record)
                self._interactive_session = None
                self._interactive_uid = None
                raise
            record.pi_session_id = session.session_id
            if session.session_file:
                record.pi_session_file = session.session_file
            record.session_dir = session.session_dir
            record.status = PiSessionStatus.RUNNING
            record.resume_count += 1
            record.last_active_at = datetime.now(UTC)
            await self._save_record(record)
            self._running_uid = uid
            self._interactive_turn_task = None
            self._interactive_monitor = asyncio.create_task(
                self._watch_interactive_session(session)
            )
            await self._broadcast_started(session)
            return record

        # Batch session resume: re-run in the retained workspace in place.
        task = await Task.get(record.task_id) if record.task_id else None
        if task is None:
            raise PiSessionNotResumableError(
                f"Task for session {uid} no longer exists."
            )
        session = CoderBotSession(
            pipeline_id=record.pipeline_id,
            task_id=record.task_id,
            model=record.model,
            session_uid=record.uid,
            session_record=record,
            resume_session_file=record.pi_session_file,
        )
        session.resume_in_place = True
        session.resume_message = message
        record.status = PiSessionStatus.RUNNING
        record.resume_count += 1
        record.last_active_at = datetime.now(UTC)
        await self._save_record(record)
        await self._queue.put(session)
        self._ensure_worker_running()
        return record

    async def discard_session(self, uid: str) -> bool:
        """Stop a session and release its workspace (and Pi session file)."""
        handle = self._sessions.get(uid)
        if handle is None:
            record = await PiSession.find_one(PiSession.uid == uid)
            if record is None:
                raise PiSessionNotFoundError(f"Session {uid} not found.")
            handle = PiSessionHandle(record=record)
            self._sessions[uid] = handle

        session = handle.session
        if session is not None:
            if session is self._interactive_session:
                self._interactive_session = None
                self._interactive_uid = None
                self._interactive_turn_task = None
                self._interactive_monitor = None
            try:
                result = session.stop()
                if asyncio.iscoroutine(result):
                    await result
            except Exception:  # pragma: no cover - defensive
                logger.debug("Failed to stop session %s", uid, exc_info=True)
            handle.session = None

        handle.record.status = PiSessionStatus.DISCARDED
        handle.record.discarded_at = datetime.now(UTC)
        await self._save_record(handle.record)
        pi_session_store.delete_session_dir(uid, delete_pi_session=True)
        self._sessions.pop(uid, None)
        if self._running_uid == uid:
            self._running_uid = None
        return True

    async def reconcile_on_startup(self) -> None:
        """Reconcile durable sessions after a backend restart.

        1. Every ``RUNNING`` record is flipped to ``PAUSED`` (its process did not
           survive the restart).
        2. Missing ``pi_session_file`` values are recovered from ``meta.json``.
        3. Expired workspaces are swept.
        4. Optionally the newest interactive session is auto-resumed.
        """
        try:
            running = await PiSession.find(
                PiSession.status == PiSessionStatus.RUNNING
            ).to_list()
        except Exception:  # pragma: no cover - DB unavailable
            running = []

        for record in running:
            record.status = PiSessionStatus.PAUSED
            record.last_error = "server restarted"
            await self._save_record(record)

        # Best-effort disk recovery of the Pi session file.
        try:
            all_records = await PiSession.find_all().to_list()
        except Exception:  # pragma: no cover - DB unavailable
            all_records = []
        for record in all_records:
            if not record.pi_session_file:
                recovered = pi_session_store.recover_session_file(record.uid)
                if recovered:
                    record.pi_session_file = recovered
                    await self._save_record(record)

        try:
            await pi_session_store.sweep_expired_workspaces()
        except Exception:  # pragma: no cover - defensive
            logger.debug("Workspace sweep failed", exc_info=True)

        if config.PI_SESSION_AUTO_RESUME:
            candidates = [
                r
                for r in all_records
                if r.kind == PiSessionKind.INTERACTIVE
                and r.status in (PiSessionStatus.PAUSED, PiSessionStatus.COMPLETED)
            ]
            if candidates:
                newest = max(
                    candidates,
                    key=lambda r: r.last_active_at or r.updated_at or r.created_at,
                )
                try:
                    await self.resume_session(newest.uid)
                except Exception:  # pragma: no cover - defensive
                    logger.warning(
                        "Auto-resume of session %s failed", newest.uid, exc_info=True
                    )

    # ------------------------------------------------------------------
    # Interactive broadcast helpers
    # ------------------------------------------------------------------
    async def _broadcast_started(self, session) -> None:
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
                    "session_uid": getattr(session, "session_uid", None),
                    "start_time": (
                        session.start_time.isoformat()
                        if getattr(session, "start_time", None)
                        else None
                    ),
                },
            )
        )

    async def _broadcast_stopped(self, session) -> None:
        """Broadcast ``INTERACTIVE_STOPPED`` unless the session already did."""
        if session is None:
            return
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
                    "session_uid": getattr(session, "session_uid", None),
                },
            )
        )

    async def _broadcast_turn_ended(self, session) -> None:
        if getattr(session, "pipeline_id", None) is None:
            return
        await ws_manager.broadcast(
            WSMessage(
                type="INTERACTIVE_TURN_ENDED",
                payload={
                    "pipeline_id": session.pipeline_id,
                    "bot_type": getattr(session, "bot_type", "interactive"),
                    "session_uid": getattr(session, "session_uid", None),
                },
            )
        )

    async def _broadcast_interactive_error(self, session, message: str) -> None:
        if getattr(session, "pipeline_id", None) is None:
            return
        await ws_manager.broadcast(
            WSMessage(
                type="INTERACTIVE_ERROR",
                payload={
                    "pipeline_id": session.pipeline_id,
                    "bot_type": getattr(session, "bot_type", "interactive"),
                    "session_uid": getattr(session, "session_uid", None),
                    "message": message,
                },
            )
        )


coderbot_manager = CoderBotManager()
