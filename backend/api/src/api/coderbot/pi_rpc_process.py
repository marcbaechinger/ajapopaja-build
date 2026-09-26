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

"""Low-level transport for the Pi coding agent's headless RPC mode.

:class:`PiRpcProcess` owns the child process, JSONL framing and the
command/response correlation. Concrete subclasses only decide what to do with
the asynchronous session events by overriding :meth:`PiRpcProcess._handle_event`.
"""

import asyncio
import json
import logging
import uuid
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

# Upper bound for a single stdout line. Pi emits large tool payloads, so keep a
# generous buffer to avoid LimitOverrunError on stream reads.
STDIO_BUFFER_LIMIT = 10 * 1024 * 1024

# A command that never gets acknowledged must not hang the caller forever (for
# example when the agent crashes before processing the request).
DEFAULT_COMMAND_TIMEOUT = 30.0


class PiRpcProcess:
    """Spawns ``pi --mode rpc`` and speaks the JSONL RPC protocol with it.

    The class is deliberately agnostic about *why* Pi runs. ``CoderBotSession``
    uses it for a single batch task while ``InteractivePiSession`` keeps the
    process alive across many chat turns.
    """

    #: Default per-command acknowledgement timeout in seconds.
    COMMAND_TIMEOUT = DEFAULT_COMMAND_TIMEOUT

    def __init__(
        self,
        model: Optional[str] = None,
        cwd: Optional[str] = None,
        command_timeout: Optional[float] = None,
    ):
        self.model = model
        self.cwd = cwd
        self.command_timeout = (
            self.COMMAND_TIMEOUT if command_timeout is None else command_timeout
        )
        self.process: Optional[asyncio.subprocess.Process] = None
        self._pending_commands: Dict[str, asyncio.Future] = {}
        self._read_task: Optional[asyncio.Task] = None

    # ------------------------------------------------------------------
    # Process lifecycle
    # ------------------------------------------------------------------
    def build_command(self) -> list:
        """Return the argv used to spawn Pi in RPC mode."""
        cmd = ["pi", "--mode", "rpc", "--no-session"]
        if self.model is not None:
            cmd.extend(["--model", self.model])
        return cmd

    async def start(self, cwd: Optional[str] = None) -> asyncio.subprocess.Process:
        """Spawn the Pi subprocess and start the background read loop.

        Args:
            cwd: Working directory for the child process. Falls back to the
                ``cwd`` supplied at construction time.

        Returns:
            The spawned :class:`asyncio.subprocess.Process`.
        """
        if self.process is not None and self.process.returncode is None:
            return self.process

        effective_cwd = cwd if cwd is not None else self.cwd
        cmd = self.build_command()
        logger.info(
            "Spawning Pi RPC process: %s (cwd=%s)", " ".join(cmd), effective_cwd
        )

        self.process = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=effective_cwd,
            limit=STDIO_BUFFER_LIMIT,
        )
        self._read_task = asyncio.create_task(self._read_loop())
        return self.process

    async def _read_loop(self):
        """Continuously read bytes from stdout and route complete JSON records.

        Records are split strictly on LF (``b"\\n"``) by ``readline()``. A
        generic ``splitlines()`` based reader is intentionally avoided because
        it also splits on Unicode line/paragraph separators, which are valid
        inside JSON strings.
        """
        process = self.process
        if process is None or process.stdout is None:
            return

        try:
            while True:
                try:
                    line = await process.stdout.readline()
                except asyncio.CancelledError:
                    raise
                except Exception as exc:  # pragma: no cover - defensive
                    logger.debug("Error reading from Pi stdout: %s", exc)
                    break

                if not line:
                    # EOF: the child closed stdout / exited.
                    break

                try:
                    raw_line = line.decode("utf-8").strip()
                except UnicodeDecodeError:
                    logger.debug("Ignoring non-UTF8 line from Pi")
                    continue

                if not raw_line:
                    continue

                try:
                    event = json.loads(raw_line)
                except json.JSONDecodeError:
                    logger.debug("Ignoring non-JSON line from Pi: %s", raw_line[:200])
                    continue

                if not isinstance(event, dict):
                    continue

                await self._dispatch(event)
        finally:
            self._fail_pending_commands(
                RuntimeError("Pi process closed before responding.")
            )

    async def _dispatch(self, event: Dict[str, Any]):
        """Resolve command futures or delegate session events to the subclass."""
        if event.get("type") == "response":
            cmd_id = event.get("id")
            future = self._pending_commands.get(cmd_id) if cmd_id else None
            if future is not None and not future.done():
                future.set_result(event)
            return

        try:
            await self._handle_event(event)
        except asyncio.CancelledError:
            raise
        except Exception:  # pragma: no cover - defensive
            logger.error("Error handling Pi RPC event %s", event, exc_info=True)

    def _fail_pending_commands(self, error: Exception):
        """Fail any command still waiting when the process/stdout goes away."""
        for cmd_id, future in list(self._pending_commands.items()):
            if not future.done():
                future.set_exception(error)
            self._pending_commands.pop(cmd_id, None)

    # ------------------------------------------------------------------
    # Commands
    # ------------------------------------------------------------------
    async def send_command(
        self, command_type: str, payload: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Send one command and await its correlated ``response`` record.

        Every command carries a unique ``id``; the read loop resolves the
        matching future when Pi acknowledges it. A timeout guards against a
        crashed agent that never acknowledges the command.
        """
        if self.process is None or self.process.stdin is None:
            raise RuntimeError("Pi process is not running.")

        payload = payload or {}
        cmd_id = str(uuid.uuid4())
        command = {"id": cmd_id, "type": command_type, **payload}

        future = asyncio.get_running_loop().create_future()
        self._pending_commands[cmd_id] = future

        data = json.dumps(command).encode("utf-8") + b"\n"
        try:
            self.process.stdin.write(data)
            await self.process.stdin.drain()

            # CRITICAL: the timeout prevents an indefinite hang if Pi fails to
            # acknowledge the command (for example after a crash).
            response = await asyncio.wait_for(future, timeout=self.command_timeout)
            return response
        except asyncio.TimeoutError:
            logger.error(
                "Command %s (%s) timed out after %ss waiting for a response.",
                cmd_id,
                command_type,
                self.command_timeout,
            )
            raise
        finally:
            self._pending_commands.pop(cmd_id, None)

    async def prompt(self, message: str) -> Dict[str, Any]:
        """Send a user prompt to Pi and return its acknowledgement response."""
        return await self.send_command("prompt", {"message": message})

    # ------------------------------------------------------------------
    # Shutdown
    # ------------------------------------------------------------------
    async def close(self, graceful: bool = True) -> None:
        """Signal Pi to shut down.

        ``graceful=True`` closes stdin (EOF) so Pi can dispose its runtime and
        exit on its own. ``graceful=False`` terminates the process immediately.
        """
        process = self.process
        if process is None or process.returncode is not None:
            return

        if not graceful:
            self._terminate()
            return

        stdin = process.stdin
        if stdin is None:
            return
        try:
            if stdin.can_write_eof():
                stdin.write_eof()
            elif not stdin.is_closing():
                stdin.close()
        except Exception:  # pragma: no cover - defensive
            logger.debug("Failed to close Pi stdin", exc_info=True)

    def stop(self) -> None:
        """Forcefully terminate the running Pi subprocess."""
        self._terminate()

    def _terminate(self):
        process = self.process
        if process is None or process.returncode is not None:
            return
        try:
            process.terminate()
            logger.info("Terminated Pi RPC process")
        except ProcessLookupError:  # pragma: no cover - process already gone
            pass
        except Exception:  # pragma: no cover - defensive
            logger.debug("Failed to terminate Pi process", exc_info=True)

    async def wait(self):
        """Wait for the child process to exit."""
        if self.process is None:
            return None
        return await self.process.wait()

    # ------------------------------------------------------------------
    # Subclass hook
    # ------------------------------------------------------------------
    async def _handle_event(self, event: Dict[str, Any]) -> None:
        """Handle one asynchronous session event.

        Subclasses override this to react to Pi's streaming events. The base
        implementation raises :class:`NotImplementedError`; the read loop
        catches and logs it so a bare transport never crashes on an event it
        does not understand.
        """
        raise NotImplementedError
