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

"""Background development-server process management.

``DevProcessManager`` owns the lifecycle of the long-running ``serve`` process
of a :class:`~core.models.models.Pipeline`. It is intentionally decoupled from
the REST layer: the ``dev_server`` router (and any agent tool or other module)
talks to this service, which encapsulates subprocess creation, output capture,
single-instance enforcement and process termination.

Only one dev process may run per pipeline at a time. A second ``start`` while a
process is still running raises :class:`DevProcessAlreadyRunningError`.

Captured output is appended incrementally to a bounded
:class:`ProcessLogBuffer`, which lets API-layer consumers tail the live log while
the process is still running (see :meth:`DevProcessManager.stream`). Process
lifecycle transitions are announced through an optional *event sink* hook so the
API layer can broadcast them without the ``core`` layer importing from ``api``.
"""

import asyncio
import logging
import os
import signal
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from typing import Awaitable, Callable, Deque, Dict, List, Optional

from core import config
from core.exceptions import EntityNotFoundError
from core.queries import pipeline as pipeline_queries
from core.utils import git_utils

logger = logging.getLogger(__name__)


class DevProcessError(Exception):
    """Base error for dev-process management."""


class DevProcessAlreadyRunningError(DevProcessError):
    """Raised when a dev process is already running for a pipeline."""


class DevProcessNotFoundError(DevProcessError):
    """Raised when no dev process is known for a pipeline."""


@dataclass
class LogChunk:
    """A single, ordered piece of captured process output."""

    seq: int
    stream: str  # "stdout" | "stderr"
    text: str


class ProcessLogBuffer:
    """Bounded, append-only log with async notification for tailers.

    Chunks are retained in a fixed-size deque so a chatty dev server cannot
    exhaust memory. When the oldest chunk is evicted ``_base_seq`` advances so a
    consumer can detect that part of the history has been dropped.
    """

    def __init__(self, max_chunks: int = 5000):
        self._chunks: Deque[LogChunk] = deque(maxlen=max_chunks)
        self._next_seq = 0
        self._base_seq = 0
        # Wake-up signal for streaming consumers. Appending sets it; a tailer
        # clears it after it has drained the snapshot, so new data never
        # busy-polls.
        self._updated = asyncio.Event()

    @property
    def base_seq(self) -> int:
        """Sequence number of the oldest retained chunk."""
        return self._base_seq

    @property
    def next_seq(self) -> int:
        """Sequence number that will be assigned to the next appended chunk."""
        return self._next_seq

    @property
    def max_chunks(self) -> Optional[int]:
        """Configured capacity (or ``None`` for an unbounded deque)."""
        return self._chunks.maxlen

    def append(self, stream: str, text: str) -> None:
        """Appends a chunk, evicting the oldest when the buffer is full."""
        if not text:
            return
        maxlen = self._chunks.maxlen
        if maxlen is not None and len(self._chunks) == maxlen and self._chunks:
            self._base_seq = self._chunks[0].seq + 1
        self._chunks.append(LogChunk(seq=self._next_seq, stream=stream, text=text))
        self._next_seq += 1
        self._updated.set()

    def snapshot(self, since_seq: int = 0) -> List[LogChunk]:
        """Returns retained chunks with ``seq >= since_seq`` in order."""
        return [chunk for chunk in self._chunks if chunk.seq >= since_seq]

    async def wait_for_data(self, timeout: float) -> bool:
        """Waits until new data is appended or ``timeout`` elapses.

        Returns ``True`` when the wake-up was caused by an append and ``False``
        on timeout (which callers use as a heartbeat).
        """
        try:
            await asyncio.wait_for(self._updated.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            return False
        self._updated.clear()
        return True


@dataclass
class ProcessInfo:
    """State tracked for one pipeline's dev process.

    ``process`` and ``task`` are populated while the process runs; the buffer
    accumulates output incrementally, and ``stdout``/``stderr``/``exit_code``
    are finalised when it terminates.
    """

    run_id: str = ""
    commands: List[List[str]] = field(default_factory=list)
    process: Optional[asyncio.subprocess.Process] = None
    task: Optional[asyncio.Task] = None
    stdout: str = ""
    stderr: str = ""
    exit_code: Optional[int] = None
    started_event: asyncio.Event = field(default_factory=asyncio.Event)
    buffer: ProcessLogBuffer = field(default_factory=ProcessLogBuffer)
    user: str = ""
    started_at: float = field(default_factory=time.time)
    status: str = "starting"
    target: Optional[str] = None
    workspace: Optional[str] = None
    task_id: Optional[str] = None
    branch: Optional[str] = None
    commit_hash: Optional[str] = None


#: Signature of the optional lifecycle event sink. It receives the event type
#: (e.g. ``"DEV_PROCESS_STARTED"``) and a JSON-serialisable payload.
EventSink = Callable[[str, dict], Awaitable[None]]


async def _terminate_proc_tree(proc: asyncio.subprocess.Process) -> None:
    """Terminates a subprocess and its whole process group.

    ``sh -c`` spawns a child shell which in turn spawns grandchildren (e.g. a
    reload watcher). The process is started in its own session/process group so
    the whole tree can be killed together. Escalates to ``SIGKILL`` when the
    process does not exit within a short grace period.
    """
    if proc is None or proc.returncode is not None:
        return
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except (ProcessLookupError, PermissionError, AttributeError):
        logger.warning("Could not SIGTERM dev process group (pid=%s).", proc.pid)
    try:
        await asyncio.wait_for(proc.wait(), timeout=5)
        return
    except (asyncio.TimeoutError, ProcessLookupError):
        pass
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError, AttributeError):
        logger.warning("Could not SIGKILL dev process group (pid=%s).", proc.pid)
    try:
        await asyncio.wait_for(proc.wait(), timeout=5)
    except asyncio.TimeoutError:
        logger.error("Dev process (pid=%s) did not die after SIGKILL.", proc.pid)


class DevProcessManager:
    """Singleton managing the dev process for every pipeline.

    The class-level ``_processes`` and ``_locks`` maps make the manager a
    process-wide singleton: every caller (REST router, agent tool, ...) sees the
    same process state, so single-instance enforcement holds across modules.
    """

    _instance: Optional["DevProcessManager"] = None
    _processes: Dict[str, ProcessInfo] = {}
    _locks: Dict[str, asyncio.Lock] = {}
    _event_sink: Optional[EventSink] = None

    @classmethod
    def instance(cls) -> "DevProcessManager":
        """Returns the process-wide singleton instance."""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @classmethod
    def set_event_sink(cls, sink: Optional[EventSink]) -> None:
        """Installs the lifecycle event sink (default ``None`` = no-op).

        The API layer wires this to ``ConnectionManager.broadcast`` so lifecycle
        transitions reach every client. Kept as a dependency-inversion hook so
        the ``core`` layer never imports from ``api``.
        """
        cls._event_sink = sink

    async def _emit(self, event_type: str, payload: dict) -> None:
        """Best-effort lifecycle event emission; never breaks the process."""
        sink = type(self)._event_sink
        if sink is None:
            return
        try:
            await sink(event_type, payload)
        except Exception:  # noqa: BLE001 - broadcasting must not kill the process
            logger.warning(
                "Dev-process event sink failed for %s.", event_type, exc_info=True
            )

    @classmethod
    def _lock_for(cls, pipeline_id: str) -> asyncio.Lock:
        """Returns (creating if needed) the per-pipeline mutation lock."""
        lock = cls._locks.get(pipeline_id)
        if lock is None:
            lock = asyncio.Lock()
            cls._locks[pipeline_id] = lock
        return lock

    @staticmethod
    def _is_running(info: ProcessInfo) -> bool:
        return info.task is not None and not info.task.done()

    def _info_public(self, info: ProcessInfo, pipeline_id: str) -> Dict:
        """Public view of a process used by the streaming bridge header."""
        running = self._is_running(info)
        pid = (
            info.process.pid
            if running and info.process is not None and info.process.returncode is None
            else None
        )
        return {
            "pipeline_id": pipeline_id,
            "run_id": info.run_id,
            "pid": pid,
            "user": info.user,
            "port": config.DEV_SERVER_PORT,
            "status": info.status,
            "started_at": info.started_at,
            "commands": info.commands,
            "target": info.target,
            "task_id": info.task_id,
            "branch": info.branch,
            "commit_hash": info.commit_hash,
        }

    async def _resolve_workspace(self, pipeline_id: str) -> str:
        """Resolves the absolute working directory for a pipeline.

        Remote repositories are cloned on first use. Raises
        :class:`EntityNotFoundError` when the pipeline has no workspace.
        """
        pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
        await git_utils.ensure_repo_cloned(pipeline)
        workspace = pipeline.workspace_abs_path
        if not workspace:
            raise EntityNotFoundError(
                f"Workspace path not found for pipeline {pipeline_id}"
            )
        return str(workspace)

    async def start(
        self,
        pipeline_id: str,
        commands: List[List[str]],
        user: str = "",
        *,
        workspace: Optional[str] = None,
        target: Optional[str] = None,
        task_id: Optional[str] = None,
    ) -> Dict:
        """Starts the dev process for ``pipeline_id``.

        ``commands`` is an ordered list of argv lists (as stored on
        ``Pipeline.serve_commands``). They are executed sequentially in the
        pipeline workspace; the first non-zero exit stops the sequence.

        ``user`` is recorded on the process so the UI header can show who
        started it.

        ``workspace`` optionally overrides the working directory (used by the
        pull-request-scoped dev server to run in a PR checkout); when ``None``
        the pipeline workspace is resolved as usual. ``target`` is a
        human-readable label (e.g. a branch name) surfaced to the UI.
        ``task_id`` is an optional task identifier (default ``None``) surfaced
        to the UI alongside the branch.

        Raises :class:`DevProcessAlreadyRunningError` when a process is already
        running for the pipeline.
        """
        if not commands:
            raise DevProcessError("No serve commands configured")

        async with self._lock_for(pipeline_id):
            existing = self._processes.get(pipeline_id)
            if (
                existing is not None
                and existing.task is not None
                and not existing.task.done()
            ):
                raise DevProcessAlreadyRunningError(
                    f"A dev process is already running for pipeline {pipeline_id}"
                )

            resolved_workspace = (
                workspace if workspace is not None
                else await self._resolve_workspace(pipeline_id)
            )
            branch, commit_hash = git_utils.get_head_branch_and_commit(
                resolved_workspace
            )
            # A patch-applied PR worktree may be detached; fall back to the
            # logical branch label so the UI still shows where the server runs.
            if branch is None:
                branch = target
            info = ProcessInfo(
                run_id=uuid.uuid4().hex,
                commands=list(commands),
                user=user,
                target=target,
                workspace=resolved_workspace,
                task_id=task_id,
                branch=branch,
                commit_hash=commit_hash,
            )
            self._processes[pipeline_id] = info
            info.task = asyncio.create_task(
                self._run_commands(pipeline_id, commands, resolved_workspace)
            )

            # Wait briefly for the first process to spawn so the caller gets a
            # pid. The event is also set on spawn failure, so this never hangs.
            try:
                await asyncio.wait_for(info.started_event.wait(), timeout=10)
            except asyncio.TimeoutError:  # pragma: no cover - defensive
                logger.warning(
                    "Timed out waiting for dev process of pipeline %s to start.",
                    pipeline_id,
                )

            pid = (
                info.process.pid
                if info.process is not None and info.process.returncode is None
                else None
            )
            return {
                "status": "started",
                "pipeline_id": pipeline_id,
                "run_id": info.run_id,
                "pid": pid,
                "port": config.DEV_SERVER_PORT,
                "user": info.user,
                "started_at": info.started_at,
                "target": info.target,
                "task_id": info.task_id,
                "branch": info.branch,
                "commit_hash": info.commit_hash,
            }

    async def _run_commands(
        self, pipeline_id: str, commands: List[List[str]], workspace: str
    ) -> None:
        """Runs the command sequence in the background, streaming output."""
        info = self._processes.get(pipeline_id)
        if info is None:  # pragma: no cover - defensive
            return
        # Build an explicit child environment. Overriding PORT/DEV_SERVER_PORT
        # only here (never in the parent) keeps the API's own PORT untouched
        # while making zero-config dev servers bind to the published port.
        env = {
            **os.environ,
            "DEV_SERVER_PORT": str(config.DEV_SERVER_PORT),
            # Many frameworks (Vite/CRA, uvicorn --port, express) read PORT; set
            # it so user serve commands bind to the published port by default.
            "PORT": str(config.DEV_SERVER_PORT),
        }

        async def _drain(stream, name: str) -> None:
            """Reads a pipe in chunks and appends each chunk to the buffer."""
            while True:
                chunk = await stream.read(4096)
                if not chunk:
                    break
                info.buffer.append(name, chunk.decode(errors="replace"))
                if not info.started_event.is_set():
                    info.started_event.set()

        started_emitted = False
        try:
            for entry in commands:
                proc = await asyncio.create_subprocess_exec(
                    *entry,
                    cwd=workspace,
                    env=env,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    # Own session/process group so descendants die with it.
                    start_new_session=True,
                )
                info.process = proc
                info.status = "running"
                if not info.started_event.is_set():
                    info.started_event.set()
                if not started_emitted:
                    started_emitted = True
                    await self._emit(
                        "DEV_PROCESS_STARTED",
                        {
                            "pipeline_id": pipeline_id,
                            "run_id": info.run_id,
                            "pid": proc.pid,
                            "port": config.DEV_SERVER_PORT,
                            "user": info.user,
                            "status": "running",
                            "target": info.target,
                            "task_id": info.task_id,
                            "branch": info.branch,
                            "commit_hash": info.commit_hash,
                        },
                    )

                # Concurrently drain stdout/stderr so output is observable as it
                # is produced instead of being buffered until exit.
                await asyncio.gather(
                    _drain(proc.stdout, "stdout"),
                    _drain(proc.stderr, "stderr"),
                    proc.wait(),
                )
                info.exit_code = proc.returncode
                if proc.returncode != 0:
                    logger.warning(
                        "Dev command %s for pipeline %s exited with code %s.",
                        entry,
                        pipeline_id,
                        proc.returncode,
                    )
                    break
        except asyncio.CancelledError:
            info.status = "stopped"
            if info.process is not None and info.process.returncode is None:
                await _terminate_proc_tree(info.process)
            raise
        except Exception as e:  # noqa: BLE001 - surface any spawn failure
            logger.error(
                "Dev process for pipeline %s failed: %s", pipeline_id, e, exc_info=True
            )
            info.buffer.append("stderr", str(e))
            info.status = "failed"
            info.exit_code = -1
        finally:
            # Make sure a spawning/await caller is never left blocked.
            if not info.started_event.is_set():
                info.started_event.set()

            if info.exit_code is None and info.process is not None:
                info.exit_code = info.process.returncode
            if info.status not in ("stopped", "failed"):
                info.status = "exited" if info.exit_code == 0 else "failed"

            # Finalise the legacy strings from the (bounded) buffer.
            chunks = info.buffer.snapshot(0)
            info.stdout = "".join(c.text for c in chunks if c.stream == "stdout")
            info.stderr = "".join(c.text for c in chunks if c.stream == "stderr")

            await self._emit(
                "DEV_PROCESS_EXITED",
                {
                    "pipeline_id": pipeline_id,
                    "run_id": info.run_id,
                    "exit_code": info.exit_code,
                    "status": info.status,
                },
            )

    async def stream(
        self, pipeline_id: str, run_id: Optional[str] = None
    ) -> "asyncio.AsyncGenerator[Dict, None]":
        """Async generator that replays then tails a process's log.

        Yields a ``status`` event (the header), then ``chunk`` events for every
        buffered/observed chunk, and finally a single ``exit`` event. A
        ``run_id`` mismatch (e.g. the process was restarted in between) yields
        only the terminal ``exit`` event so the consumer detaches cleanly.
        """
        info = self._processes.get(pipeline_id)
        if info is None or (run_id and info.run_id != run_id):
            yield {"type": "exit", "exit_code": None}
            return

        yield {"type": "status", **self._info_public(info, pipeline_id)}
        seq = 0
        while True:
            for chunk in info.buffer.snapshot(seq):
                yield {
                    "type": "chunk",
                    "seq": chunk.seq,
                    "stream": chunk.stream,
                    "text": chunk.text,
                }
                seq = chunk.seq + 1
            if not self._is_running(info):
                yield {"type": "exit", "exit_code": info.exit_code}
                return
            await info.buffer.wait_for_data(timeout=15.0)

    async def status(self, pipeline_id: str) -> Dict:
        """Returns the current status of a pipeline's dev process."""
        info = self._processes.get(pipeline_id)
        if info is None:
            return {
                "pipeline_id": pipeline_id,
                "running": False,
                "status": "not_started",
                "pid": None,
                "exit_code": None,
                "run_id": None,
                "port": config.DEV_SERVER_PORT,
                "user": "",
                "started_at": None,
                "target": None,
                "task_id": None,
                "branch": None,
                "commit_hash": None,
            }
        running = self._is_running(info)
        pid = (
            info.process.pid
            if running and info.process is not None and info.process.returncode is None
            else None
        )
        return {
            "pipeline_id": pipeline_id,
            "running": running,
            "status": "running" if running else "stopped",
            "pid": pid,
            "exit_code": info.exit_code,
            "run_id": info.run_id,
            "port": config.DEV_SERVER_PORT,
            "user": info.user,
            "started_at": info.started_at,
            "target": info.target,
            "task_id": info.task_id,
            "branch": info.branch,
            "commit_hash": info.commit_hash,
        }

    async def stop(self, pipeline_id: str) -> Dict:
        """Stops the running dev process for a pipeline and clears its state.

        Raises :class:`DevProcessNotFoundError` when no process is tracked for
        the pipeline.
        """
        async with self._lock_for(pipeline_id):
            info = self._processes.get(pipeline_id)
            if info is None:
                raise DevProcessNotFoundError(
                    f"No dev process found for pipeline {pipeline_id}"
                )

            if info.process is not None and info.process.returncode is None:
                await _terminate_proc_tree(info.process)

            task = info.task
            if task is not None and not task.done():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass

            exit_code = info.exit_code
            self._processes.pop(pipeline_id, None)
            return {
                "status": "stopped",
                "pipeline_id": pipeline_id,
                "running": False,
                "pid": None,
                "exit_code": exit_code,
            }

    async def stop_all(self) -> None:
        """Stops every tracked dev process. Useful on application shutdown."""
        for pipeline_id in list(self._processes.keys()):
            try:
                await self.stop(pipeline_id)
            except DevProcessError:
                logger.warning(
                    "Could not stop dev process for pipeline %s during shutdown.",
                    pipeline_id,
                )

    @classmethod
    def reset(cls) -> None:
        """Clears all tracked state. Intended for tests."""
        cls._processes.clear()
        cls._locks.clear()
        cls._event_sink = None


__all__ = [
    "DevProcessManager",
    "DevProcessError",
    "DevProcessAlreadyRunningError",
    "DevProcessNotFoundError",
    "ProcessInfo",
    "ProcessLogBuffer",
    "LogChunk",
]
