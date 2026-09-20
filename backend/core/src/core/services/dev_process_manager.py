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
"""

import asyncio
import logging
import os
import signal
import uuid
from dataclasses import dataclass, field
from typing import Dict, List, Optional

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
class ProcessInfo:
    """State tracked for one pipeline's dev process.

    ``process`` and ``task`` are populated while the process runs; ``stdout``,
    ``stderr`` and ``exit_code`` are filled in when it terminates.
    """

    run_id: str = ""
    commands: List[List[str]] = field(default_factory=list)
    process: Optional[asyncio.subprocess.Process] = None
    task: Optional[asyncio.Task] = None
    stdout: str = ""
    stderr: str = ""
    exit_code: Optional[int] = None
    started_event: asyncio.Event = field(default_factory=asyncio.Event)


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

    @classmethod
    def instance(cls) -> "DevProcessManager":
        """Returns the process-wide singleton instance."""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @classmethod
    def _lock_for(cls, pipeline_id: str) -> asyncio.Lock:
        """Returns (creating if needed) the per-pipeline mutation lock."""
        lock = cls._locks.get(pipeline_id)
        if lock is None:
            lock = asyncio.Lock()
            cls._locks[pipeline_id] = lock
        return lock

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

    async def start(self, pipeline_id: str, commands: List[List[str]]) -> Dict:
        """Starts the dev process for ``pipeline_id``.

        ``commands`` is an ordered list of argv lists (as stored on
        ``Pipeline.serve_commands``). They are executed sequentially in the
        pipeline workspace; the first non-zero exit stops the sequence.

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

            workspace = await self._resolve_workspace(pipeline_id)
            info = ProcessInfo(run_id=uuid.uuid4().hex, commands=list(commands))
            self._processes[pipeline_id] = info
            info.task = asyncio.create_task(
                self._run_commands(pipeline_id, commands, workspace)
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
            }

    async def _run_commands(
        self, pipeline_id: str, commands: List[List[str]], workspace: str
    ) -> None:
        """Runs the command sequence in the background, capturing output."""
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
                if not info.started_event.is_set():
                    info.started_event.set()

                stdout, stderr = await proc.communicate()
                info.stdout = (stdout or b"").decode(errors="replace")
                info.stderr = (stderr or b"").decode(errors="replace")
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
            if info.process is not None and info.process.returncode is None:
                await _terminate_proc_tree(info.process)
            raise
        except Exception as e:  # noqa: BLE001 - surface any spawn failure
            logger.error(
                "Dev process for pipeline %s failed: %s", pipeline_id, e, exc_info=True
            )
            info.stderr = (info.stderr or "") + str(e)
            info.exit_code = -1
        finally:
            # Make sure a spawning/await caller is never left blocked.
            if not info.started_event.is_set():
                info.started_event.set()

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
            }
        running = info.task is not None and not info.task.done()
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


__all__ = [
    "DevProcessManager",
    "DevProcessError",
    "DevProcessAlreadyRunningError",
    "DevProcessNotFoundError",
    "ProcessInfo",
]
