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

"""Async command runner shared between assistant tools (e.g. the ``run_tests``
tool) and the CoderBot post-run verification hook.

It runs each configured argv list against a workspace in its own process group
(so runaway commands and their descendants can be killed together) under a
timeout from ``config.CODERBOT_VERIFICATION_TIMEOUT``. Execution happens in a
dedicated background ``asyncio`` task so a long-running command sequence never
blocks the event-loop thread of the tool call that scheduled it.
"""

import asyncio
import logging
import os
import signal
import time
from typing import Any, Awaitable, Callable, Dict, List, Optional

from core import config

logger = logging.getLogger(__name__)

CompletionHandler = Callable[
    [Dict[str, Any], Optional[Dict[str, Any]]], Awaitable[None]
]


async def _terminate_proc_tree(proc, cmd_str: str) -> None:
    """Terminates a subprocess and its whole process group.

    ``sh -c`` spawns a child shell that in turn spawns grandchildren (e.g. a
    vitest watcher). Terminating only the top-level shell could leave an
    orphaned child running and, worse, a pipe that keeps ``communicate()``
    from returning. Commands are therefore started in their own process group
    (``start_new_session``) and the whole group is killed together.
    """
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except (ProcessLookupError, PermissionError, AttributeError):
        logger.warning("Could not SIGTERM command process group for '%s'.", cmd_str)
    try:
        await asyncio.wait_for(proc.wait(), timeout=5)
        return
    except (asyncio.TimeoutError, ProcessLookupError):
        pass
    # Escalate to SIGKILL if it did not die in time.
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError, AttributeError):
        logger.warning("Could not SIGKILL command process group for '%s'.", cmd_str)
    try:
        await asyncio.wait_for(proc.wait(), timeout=5)
    except asyncio.TimeoutError:
        logger.error("Command '%s' did not die after SIGKILL.", cmd_str)


def _verification_timeout() -> float:
    return float(getattr(config, "CODERBOT_VERIFICATION_TIMEOUT", 300))


async def run_single_command(entry: List[str], workspace_path: str) -> Dict[str, Any]:
    """Runs a single argv list as a command under a timeout.

    Returns a command result dict with an exit code, an output tail and the
    wall-clock ``duration_ms`` the command took. A ``None`` exit code signals a
    timeout or spawn failure (so the aggregate run is flagged as failed).
    """
    cmd_str = " ".join(entry)
    proc = None
    started = time.monotonic()

    def _elapsed_ms() -> int:
        return int((time.monotonic() - started) * 1000)

    try:
        proc = await asyncio.create_subprocess_exec(
            *entry,
            cwd=str(workspace_path),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            # Own process group so descendants can be killed together.
            start_new_session=True,
        )
        timeout = _verification_timeout()
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        tail = out.decode(errors="replace")[-2000:]
        exit_code = proc.returncode
        duration_ms = _elapsed_ms()
        logger.info(
            "Command '%s' finished with exit code %s in %dms.",
            cmd_str,
            exit_code,
            duration_ms,
        )
        return {
            "cmd": cmd_str,
            "exit_code": exit_code,
            "output_tail": tail,
            "duration_ms": duration_ms,
        }
    except asyncio.TimeoutError:
        logger.error(
            "Command '%s' timed out after %ss; terminating it and its children.",
            cmd_str,
            _verification_timeout(),
        )
        if proc is not None:
            await _terminate_proc_tree(proc, cmd_str)
        return {
            "cmd": cmd_str,
            "exit_code": None,
            "output_tail": (
                f"Command timed out after {_verification_timeout()}s "
                f"and was terminated."
            ),
            "duration_ms": _elapsed_ms(),
        }
    except Exception as e:
        logger.error(
            "Command failed to run (%s): %s",
            cmd_str,
            e,
            exc_info=True,
        )
        return {
            "cmd": cmd_str,
            "exit_code": None,
            "output_tail": str(e)[-2000:],
            "duration_ms": _elapsed_ms(),
        }


async def run_command_sequence(
    commands: Optional[List[List[str]]],
    workspace_path: str,
    kind: Optional[str] = None,
) -> Dict[str, Any]:
    """Runs an ordered sequence of argv lists and aggregates the result.

    Returns a dict ``{"commands": [...], "passed": bool, "duration_ms": int}``
    where each command entry contains the argv, the exit code, the tail of its
    output and how long it took. The run is only ``passed`` when every command
    exited with code 0.

    Args:
        commands: Ordered argv lists to run. ``None``/empty runs nothing.
        workspace_path: Working directory all commands run in.
        kind: Optional category tag (e.g. ``"build"``/``"lint"``/``"test"``).
            When set, every command entry is tagged with it via a ``kind``
            field so callers can group the results by category.
    """
    results: Dict[str, Any] = {"commands": [], "passed": True, "duration_ms": 0}
    for entry in commands or []:
        result = await run_single_command(entry, workspace_path)
        if kind is not None:
            result["kind"] = kind
        results["commands"].append(result)
        results["duration_ms"] += result.get("duration_ms", 0)
        if result["exit_code"] != 0:
            results["passed"] = False
    return results


async def run_verification_sequence(
    categories: Optional[List[Any]], workspace_path: str
) -> Dict[str, Any]:
    """Runs several command categories in a single aggregated verification run.

    ``categories`` is an ordered list of ``(kind, commands)`` pairs. The
    categories are executed strictly in the given order (CoderBot uses
    ``build -> lint -> test``) and every configured category is run even when an
    earlier one fails, so one run reports the full picture. The aggregate keeps
    the same ``{"commands": [...], "passed": bool}`` shape as
    :func:`run_command_sequence` (plus a ``duration_ms`` total) and tags each
    command entry with its category. The per-category wall-clock duration is
    recorded under ``durations`` (keyed by category) so callers can report how
    long the build, lint and test runs each took.

    A category with no commands is skipped and does not affect ``passed``.
    """
    aggregate: Dict[str, Any] = {
        "commands": [],
        "passed": True,
        "duration_ms": 0,
        "durations": {},
    }
    for kind, commands in categories or []:
        if not commands:
            continue
        partial = await run_command_sequence(commands, workspace_path, kind=kind)
        aggregate["commands"].extend(partial["commands"])
        aggregate["duration_ms"] += partial.get("duration_ms", 0)
        aggregate["durations"][kind] = partial.get("duration_ms", 0)
        if not partial["passed"]:
            aggregate["passed"] = False
    return aggregate


class CommandRunner:
    """Schedules async command runs and delivers their result via a callback.

    Tools such as ``run_tests`` schedule ``CommandRunner.dispatch`` as a
    background asyncio task and return immediately. When the whole command
    sequence has finished, the registered ``on_complete`` handler (provided by
    the AssistantSession) is invoked with the aggregate result so it can be
    delivered back as the tool response.
    """

    _handlers: Dict[str, CompletionHandler] = {}
    _tool_refs: Dict[str, Optional[Dict[str, Any]]] = {}

    @classmethod
    def register_on_complete(
        cls,
        run_id: str,
        handler: CompletionHandler,
        tool_ref: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Registers a completion handler keyed by ``run_id``."""
        cls._handlers[run_id] = handler
        cls._tool_refs[run_id] = tool_ref

    @classmethod
    async def dispatch(
        cls,
        run_id: str,
        commands: Optional[List[List[str]]],
        workspace_path: str,
    ) -> None:
        """Runs the command sequence and notifies the registered handler."""
        try:
            results = await run_command_sequence(commands, workspace_path)
            results["run_id"] = run_id
        except Exception as e:
            logger.error("Command run '%s' failed: %s", run_id, e, exc_info=True)
            results = {
                "run_id": run_id,
                "commands": [],
                "passed": False,
                "error": str(e),
            }
        handler = cls._handlers.pop(run_id, None)
        tool_ref = cls._tool_refs.pop(run_id, None)
        if handler is not None:
            try:
                await handler(results, tool_ref)
            except Exception as e:
                logger.error(
                    "Command run '%s' completion handler failed: %s", run_id, e
                )
