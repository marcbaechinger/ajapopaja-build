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

"""Async test runner shared between the ``run_tests`` assistant tool and the
CoderBot post-run verification hook.

It runs each configured argv list against a workspace in its own process group
(so runaway commands and their descendants can be killed together) under a
timeout from ``config.CODERBOT_VERIFICATION_TIMEOUT``. Execution happens in a
dedicated background ``asyncio`` task so a long-running test suite never blocks
the event-loop thread of the tool call that scheduled it.
"""

import asyncio
import logging
import os
import signal
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
        logger.warning("Could not SIGTERM test process group for '%s'.", cmd_str)
    try:
        await asyncio.wait_for(proc.wait(), timeout=5)
        return
    except (asyncio.TimeoutError, ProcessLookupError):
        pass
    # Escalate to SIGKILL if it did not die in time.
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError, AttributeError):
        logger.warning("Could not SIGKILL test process group for '%s'.", cmd_str)
    try:
        await asyncio.wait_for(proc.wait(), timeout=5)
    except asyncio.TimeoutError:
        logger.error("Test command '%s' did not die after SIGKILL.", cmd_str)


def _verification_timeout() -> float:
    return float(getattr(config, "CODERBOT_VERIFICATION_TIMEOUT", 300))


async def run_single_command(entry: List[str], workspace_path: str) -> Dict[str, Any]:
    """Runs a single argv list as a test command under a timeout.

    Returns a command result dict with an exit code and an output tail. A
    ``None`` exit code signals a timeout or spawn failure (so the aggregate
    run is flagged as failed).
    """
    cmd_str = " ".join(entry)
    proc = None
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
        logger.info(
            "Test command '%s' finished with exit code %s.",
            cmd_str,
            exit_code,
        )
        return {
            "cmd": cmd_str,
            "exit_code": exit_code,
            "output_tail": tail,
        }
    except asyncio.TimeoutError:
        logger.error(
            "Test command '%s' timed out after %ss; terminating it and its children.",
            cmd_str,
            _verification_timeout(),
        )
        if proc is not None:
            await _terminate_proc_tree(proc, cmd_str)
        return {
            "cmd": cmd_str,
            "exit_code": None,
            "output_tail": (
                f"Test command timed out after {_verification_timeout()}s "
                f"and was terminated."
            ),
        }
    except Exception as e:
        logger.error(
            "Test command failed to run (%s): %s",
            cmd_str,
            e,
            exc_info=True,
        )
        return {
            "cmd": cmd_str,
            "exit_code": None,
            "output_tail": str(e)[-2000:],
        }


async def run_command_sequence(
    commands: Optional[List[List[str]]], workspace_path: str
) -> Dict[str, Any]:
    """Runs an ordered sequence of argv lists and aggregates the result.

    Returns a dict ``{"commands": [...], "passed": bool}`` where each command
    entry contains the argv, the exit code and the tail of its output. The run
    is only ``passed`` when every command exited with code 0.
    """
    results: Dict[str, Any] = {"commands": [], "passed": True}
    for entry in commands or []:
        result = await run_single_command(entry, workspace_path)
        results["commands"].append(result)
        if result["exit_code"] != 0:
            results["passed"] = False
    return results


class TestRunner:
    """Schedules async test runs and delivers their result via a callback.

    ``run_tests`` schedules ``TestRunner.dispatch`` as a background asyncio task
    and returns immediately. When the whole command sequence has finished, the
    registered ``on_complete`` handler (provided by the AssistantSession) is
    invoked with the aggregate result so it can be delivered back as the tool
    response.
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
            logger.error("Test run '%s' failed: %s", run_id, e, exc_info=True)
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
                logger.error("Test run '%s' completion handler failed: %s", run_id, e)
