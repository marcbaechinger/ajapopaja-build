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
import json
import logging
import re
import traceback
from datetime import UTC, datetime
from typing import Any, Dict, Optional, TextIO

from api.assistant.tools.command_runner import run_command_sequence
from api.websocket_manager import WSMessage, manager as ws_manager
from core import config
from core.models.models import (
    Pipeline,
    PullRequest,
    PullRequestStatus,
    Task,
    TaskStatus,
)
from core.queries import task as task_queries

from api.bot.git_helper import SandboxGitHelper

logger = logging.getLogger(__name__)

# Default test commands for the post-run verification hook, mirroring the
# commands documented in the project README.md. Kept centralized so future
# changes are a one-line edit. These are generic (they cd into the sub-parts
# of the monorepo and run the documented suite) and work for any project whose
# README documents these commands.
DEFAULT_TEST_COMMANDS = [
    # Backend
    ["sh", "-c", "cd backend && uv run pytest"],
    # Frontend
    ["sh", "-c", "cd frontend && CI=true npm run test"],
]

# Instructions appended to the initial task prompt. They are generic and refer
# to README.md as the authoritative source for the project's test commands, so
# they remain correct for any project.
TEST_INSTRUCTION = """\
### Mandatory Verification
This repository is a monorepo. Before finishing, you MUST run the full project
test suite exactly as documented in README.md, fix any failures your changes
cause, and re-run until green. The required commands are:

- Backend: `cd backend && uv run pytest`
- Frontend: `cd frontend && CI=true npm run test`

Do NOT report the task as complete until these tests pass (or, if a failure is
pre-existing and unrelated to your change, explain it in your summary
instead). Include the test commands you ran and their outcome in your final
completion summary.
"""


def slugify(task_id: str) -> str:
    """Sanitize task_id for safe use in file paths.

    Replaces invalid path characters with underscores, removes leading/trailing
    whitespace and non-alphanumeric characters, and ensures the result is not
    empty or a reserved name.

    Args:
        task_id: The original task identifier string.

    Returns:
        A sanitized string safe for use in file system paths.
    """
    if not task_id:
        return "unknown_task"

    # Replace common problematic characters with underscores
    sanitized = re.sub(r"[^a-zA-Z0-9_-]", "_", str(task_id))

    # Collapse multiple underscores
    sanitized = re.sub(r"_+", "_", sanitized)

    # Remove leading/trailing underscores
    sanitized = sanitized.strip("_")

    # Truncate to a reasonable length to avoid path issues
    sanitized = sanitized[:100]

    # Ensure we don't end up with an empty string
    if not sanitized:
        sanitized = "unknown_task"

    return sanitized


def _read_start_time(log_dir) -> Optional[str]:
    """Read the start timestamp of the most recent CoderBot session for a task.

    Each session logs a ``session_start`` event (with the timestamp attached by
    ``_log_event``) as its first line. Because log files are named with a
    monotonically increasing timestamp, the newest log file holds the most recent
    session; within that file the ``session_start`` line captures when the session
    began. The wall-clock timestamp (ISO-8601 string) is returned so the UI can
    resume its "Running since" elapsed-time display across re-mounts.
    """
    if not log_dir.exists():
        return None

    for log_file in sorted(log_dir.glob("coderbot_*.jsonl"), reverse=True):
        try:
            with open(log_file, "r", encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if data.get("type") == "session_start":
                        return data.get("timestamp")
        except Exception as e:
            logger.error(f"Failed to read CoderBot log {log_file}: {e}")
    return None


def read_session_history(task_id: str) -> tuple:
    """Replay the persisted Pi RPC events of a CoderBot session for a task.

    Each session writes its events as JSONL lines (``type == "pi_rpc_event"``)
    under ``SANDBOX_ROOT/logs/{slugify(task_id)}``. Returns a ``(events, start_time)``
    tuple where ``events`` is the ordered list of raw RPC events (the same shape the
    ``CODERBOT_RPC_EVENT`` websocket message carries) so the client can reduce them
    into its activity log, and ``start_time`` is the ISO-8601 timestamp of when the
    most recent session started. Reads the most recent log file(s) so the latest run
    of a task wins.
    """
    log_dir = config.SANDBOX_ROOT / "logs" / slugify(task_id)
    events: list = []
    if not log_dir.exists():
        return events, None

    for log_file in sorted(log_dir.glob("coderbot_*.jsonl"), reverse=True):
        try:
            with open(log_file, "r", encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if data.get("type") == "pi_rpc_event" and isinstance(
                        data.get("event"), dict
                    ):
                        events.append(data["event"])
        except Exception as e:
            logger.error(f"Failed to read CoderBot log {log_file}: {e}")
    return events, _read_start_time(log_dir)


class CoderBotSession:
    """
    Orchestrates the Pi coding agent via its headless RPC mode.
    """

    def __init__(
        self,
        pipeline_id: str,
        task_id: str,
        model: Optional[str] = None,
    ):
        self.pipeline_id = pipeline_id
        self.task_id = task_id
        self.model = model
        self.process: Optional[asyncio.subprocess.Process] = None
        self.helper: Optional[SandboxGitHelper] = None
        self.pipeline: Optional[Pipeline] = None
        self.log_file: Optional[TextIO] = None
        # Wall-clock time the session started running. Captured in ``run()`` and
        # exposed to the UI (via the manager/API) so the elapsed-time indicator can
        # resume from the real session start instead of when the PiView was mounted.
        self.start_time: Optional[datetime] = None

        timestamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
        self.log_filename = f"coderbot_{timestamp}.jsonl"
        self.log_dir = config.SANDBOX_ROOT / "logs" / slugify(task_id)
        self._log_lock = asyncio.Lock()

        self._open_log_file()

    def _open_log_file(self):
        """Opens the log file handle for the session."""
        if not config.BASEBOT_LOG_ENABLED:
            return

        try:
            self.log_dir.mkdir(parents=True, exist_ok=True)
            log_path = self.log_dir / self.log_filename
            self.log_file = open(log_path, "a", encoding="utf-8")
        except Exception as e:
            logger.error(f"Failed to open log file: {e}")
            self.log_file = None

    def _log_event(self, data: Dict[str, Any]):
        """Persists a structured event to the session log file (synchronous)."""
        if not config.BASEBOT_LOG_ENABLED or not self.log_file:
            return

        try:
            event = {
                "timestamp": datetime.now(UTC).isoformat(),
                **data,
            }
            log_line = json.dumps(event) + "\n"
            self.log_file.write(log_line)
            self.log_file.flush()
        except Exception as e:
            logger.error(f"Failed to write log event: {e}")

    async def _close_log_file(self):
        """Closes the log file."""
        if not self.log_file:
            return

        try:
            if not self.log_file.closed:
                self.log_file.close()
                self.log_file = None
        except Exception as e:
            logger.error(f"Failed to close log file: {e}")

    def stop(self):
        """Terminates the running Pi subprocess."""
        if self.process and self.process.returncode is None:
            self.process.terminate()
            logger.info(f"Terminated CoderBot process for task {self.task_id}")

    def _build_test_instruction(self) -> str:
        """Build the "Mandatory Verification" block listing the test commands
        that are configured for this pipeline (falling back to the defaults)."""
        commands = self.get_resolved_verification_commands()
        lines = "\n".join(f"- `{' '.join(c)}`" for c in commands)
        return (
            f"### Mandatory Verification\n"
            f"This repository is a monorepo. Before finishing, you MUST run the full project\n"
            f"test suite exactly as documented in README.md, fix any failures your changes\n"
            f"cause, and re-run until green. The required commands are:\n\n"
            f"{lines}\n\n"
            f"Do NOT report the task as complete until these tests pass (or, if a failure is\n"
            f"pre-existing and unrelated to your change, explain it in your summary\n"
            f"instead). Include the test commands you ran and their outcome in your final\n"
            f"completion summary."
        )

    async def get_initial_prompt(self, task: Task) -> str:
        design_doc = task.design_doc or "No design document provided."
        spec = task.spec or "No specification provided."

        return (
            f"Please implement the following task.\n\n"
            f"### Task: {task.title}\n\n"
            f"### Specification\n{spec}\n\n"
            f"### Design Document\n{design_doc}\n\n"
            f"{self._build_test_instruction()}"
        )

    def get_resolved_verification_commands(self) -> list:
        """Resolve the argv lists for the post-run test verification.

        Priority:
          1. Per-pipeline ``Pipeline.test_commands`` override when set.
          2. Global ``CODERBOT_TEST_COMMANDS_JSON`` override when set.
          3. The README-documented ``DEFAULT_TEST_COMMANDS``.

        Returns:
            A list of argv lists (e.g. ``[["sh", "-c", "..."], ...]``).
        """
        pipeline_commands = getattr(self.pipeline, "test_commands", None)
        if pipeline_commands:
            return list(pipeline_commands)
        return self._get_global_verification_commands()

    def _get_global_verification_commands(self) -> list:
        """Returns global config commands or the README-documented defaults."""

        raw = getattr(config, "CODERBOT_TEST_COMMANDS_JSON", "") or ""
        if raw:
            try:
                parsed = json.loads(raw)
                if isinstance(parsed, list):
                    commands = [c for c in parsed if isinstance(c, list) and c]
                    if commands:
                        return commands
                logger.warning(
                    "CODERBOT_TEST_COMMANDS_JSON is not a non-empty list; "
                    "falling back to default test commands."
                )
            except (json.JSONDecodeError, ValueError) as e:
                logger.warning(
                    "Invalid CODERBOT_TEST_COMMANDS_JSON (%s); falling back "
                    "to default test commands.",
                    e,
                )
        return list(DEFAULT_TEST_COMMANDS)

    def _get_verification_commands(self, test_commands=None):
        """Resolves the argv lists for the post-run test verification.

        Historically this was driven solely by the global config override. It now
        also honours a caller-provided per-pipeline override list (which takes
        precedence over the global config). When neither is set/valid the
        README-documented default commands are used.

        Args:
            test_commands: Optional list of argv lists from a Pipeline. When it
                is a non-empty list of valid lists it wins over the global
                ``CODERBOT_TEST_COMMANDS_JSON`` override.

        Returns:
            A list of argv lists (e.g. ``[["sh", "-c", "..."], ...]``).
        """
        if test_commands:
            commands = [c for c in test_commands if isinstance(c, list) and c]
            if commands:
                return list(commands)
            logger.warning(
                "Pipeline test_commands is not a non-empty list; falling back "
                "to global/test-command defaults."
            )
        return self._get_global_verification_commands()

    async def _run_verification(self) -> Dict[str, Any]:
        """Runs the project test commands in the sandbox and returns results.

        The PR is created regardless of the outcome, but the returned dict flags
        any failing command so a human can see the suite was red.

        Delegates execution to ``CommandRunner.run_command_sequence`` (shared
        with the assistant ``run_tests``/``run_lint`` pipeline tools) so the
        sandboxed test-running logic lives in a single place. Each command runs
        in its own process group under ``CODERBOT_VERIFICATION_TIMEOUT``; a
        command only counts as green when it exited with code 0 (timeouts and
        spawn failures record a ``None`` exit code which marks the verification
        as failed).

        Returns:
            A dict ``{"commands": [...], "passed": bool}`` where each command
            entry contains the argv, the exit code and the tail of its output.
        """
        commands = self.get_resolved_verification_commands()
        return await run_command_sequence(commands, str(self.helper.sandbox_path))

    async def _broadcast_rpc(self, event: Dict[str, Any]):
        """Broadcasts a parsed Pi RPC event to connected websocket clients.

        Forwards the full, unmodified event so that the client can render it in a
        structured, human-readable way without the backend needing to know about
        every possible Pi RPC event type.

        Args:
            event: A single parsed Pi RPC JSONL event (the `type` field identifies
                its kind).
        """
        await ws_manager.broadcast(
            WSMessage(
                type="CODERBOT_RPC_EVENT",
                payload={
                    "task_id": self.task_id,
                    "pipeline_id": self.pipeline_id,
                    "bot_type": "coderbot",
                    "event": event,
                },
            )
        )

    async def _handle_agent_end(self, messages: list):
        """Called when Pi finishes the task."""
        logger.info(f"Handling agent_end for task {self.task_id}")
        if not self.helper:
            logger.warning("No helper found in _handle_agent_end")
            return

        try:
            # Look for completion summary in assistant messages
            summary = "Task completed by Pi."
            for msg in reversed(messages):
                if msg.get("role") == "assistant":
                    content = msg.get("content", [])
                    # Just grab the last text chunk
                    for block in reversed(content):
                        if block.get("type") == "text":
                            summary = block.get("text", summary)[:2000]
                            break
                    break

            logger.info(f"Summary extracted: {summary[:50]}...")
            repo = self.helper.get_repo()
            # Capture the hash of the commit onto which CoderBot's new commit will
            # be created (i.e. the previous HEAD). It may be None when the repo has
            # no commits yet (fresh clone with an unborn branch).
            try:
                parent_commit_hash = repo.head.commit.hexsha
            except Exception:
                parent_commit_hash = None

            repo.git.add(A=True)
            commit_made = False
            try:
                # Use --no-verify to bypass pre-commit hooks in the sandbox environment
                repo.git.commit("-m", f"CoderBot (Pi): {summary[:200]}", "--no-verify")
                commit_made = True
                logger.info("Git commit created in sandbox.")
            except Exception as e:
                logger.info(f"Nothing to commit or commit failed: {e}")

            # The hash of the commit on which the verification is executed is the
            # new (CoderBot) commit now at HEAD, when a commit was actually made.
            try:
                head_commit_hash = repo.head.commit.hexsha
            except Exception:
                head_commit_hash = None

            if commit_made:
                # Use git diff to get a clean, structural patch without commit
                # metadata. --binary is required so binary files (e.g. images)
                # are included in the patch and can be applied later via
                # `git apply --3way`.
                #
                # Guard against the first/only commit: when the repo was
                # cloned empty and this is the very first commit, there is no
                # HEAD~1 parent ref to diff against. Fall back to diffing the
                # commit against the empty tree.
                empty_tree = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
                try:
                    patch = repo.git.diff("HEAD~1", "HEAD", binary=True)
                except Exception:
                    patch = repo.git.diff(empty_tree, "HEAD", binary=True)
                logger.info(f"Generated patch from commit. Length: {len(patch)}")
            else:
                patch = self.helper.get_patch()
                logger.info(f"Generated patch from diff. Length: {len(patch)}")

            if not patch:
                logger.warning("Generated patch is empty.")
            elif not patch.endswith("\n"):
                patch += "\n"

            # Optional post-run verification: run the documented test suite in the
            # sandbox before creating the PR. This is a hard guarantee that
            # catches cases where Pi left the suite red. The PR is still created,
            # but its summary flags any failing command.
            verification_results = None
            if config.CODERBOT_RUN_TESTS:
                # Broadcast that the post-run verification is starting so PiView
                # can tell the user the mandatory test suite is running, before we
                # kick off the (potentially slow) test commands.
                await ws_manager.broadcast(
                    WSMessage(
                        type="CODERBOT_VERIFICATION_STARTED",
                        payload={
                            "task_id": self.task_id,
                            "pipeline_id": self.pipeline_id,
                            "bot_type": "coderbot",
                        },
                    )
                )
                verification_results = await self._run_verification()
                self._log_event(
                    {"type": "coderbot_verification", "result": verification_results}
                )
                await ws_manager.broadcast(
                    WSMessage(
                        type="CODERBOT_VERIFICATION",
                        payload={
                            "task_id": self.task_id,
                            "pipeline_id": self.pipeline_id,
                            "bot_type": "coderbot",
                            "result": verification_results,
                        },
                    )
                )
                if verification_results.get("passed"):
                    logger.info("Post-run verification passed.")
                else:
                    logger.warning(
                        "Post-run verification FAILED: %s", verification_results
                    )

            # Load the task first so we can capture its title as the PR subject.
            task = await Task.get(self.task_id)
            task_title = task.title if task else ""

            # Include the task ID and the relevant commit hashes in the PR summary
            # so a human can see exactly which version of the code was verified. The
            # task ID, the hash of the commit the verification ran on (HEAD after
            # CoderBot's commit) and the hash of the commit on top of which the new
            # commit was created (the previous HEAD, if any) are reported.
            #
            # NOTE: the "Verified commit (HEAD)" is the hash of the commit created
            # and tested inside CoderBot's isolated sandbox. That sandbox (and its
            # commit) is deleted when the session ends, and when the PR is later
            # accepted the patch is re-applied and committed in the repository,
            # which yields a *different* commit hash. So this value is only
            # meaningful while the PR is pending review; the acceptance endpoint
            # rewrites this line to point at the actual commit that lands in the
            # repository.
            pr_summary = summary
            summary_meta = [
                "",
                "### Verification",
                f"Task ID: **{self.task_id}**",
            ]
            if head_commit_hash:
                summary_meta.append(f"Verified commit (HEAD): `{head_commit_hash}`")
            if parent_commit_hash:
                summary_meta.append(f"Parent commit (base): `{parent_commit_hash}`")
            if verification_results and verification_results.get("commands"):
                status = "PASSED" if verification_results.get("passed") else "FAILED"
                summary_meta.append(f"Status: **{status}**")
                for entry in verification_results["commands"]:
                    exit_code = entry.get("exit_code")
                    summary_meta.append(
                        f"- `{entry.get('cmd')}` -> exit code {exit_code}"
                    )
                if not verification_results.get("passed"):
                    for entry in verification_results["commands"]:
                        if entry.get("exit_code") not in (0, None):
                            tail = entry.get("output_tail", "").rstrip()
                            if tail:
                                summary_meta.append(
                                    f"\nOutput tail of `{entry.get('cmd')}`:\n"
                                    "```\n"
                                    f"{tail}"
                                    "\n```"
                                )
            pr_summary = summary + "\n".join(summary_meta)

            pr = PullRequest(
                pipeline_id=self.pipeline_id,
                task_id=self.task_id,
                subject=task_title,
                summary=pr_summary,
                branch_name=self.helper.branch_name,
                patch=patch,
                status=PullRequestStatus.OPEN,
            )
            await pr.insert()
            logger.info(f"PullRequest {pr.id} created in DB.")

            # Update task status
            if task and task.status == TaskStatus.INPROGRESS:
                await task_queries.transition_task(
                    str(task.id), TaskStatus.PULL_REQUEST_AVAILABLE, actor="coderbot"
                )
                logger.info(
                    f"Task {self.task_id} status updated to PULL_REQUEST_AVAILABLE."
                )

            await ws_manager.broadcast(
                WSMessage(
                    type="PULL_REQUEST_CREATED",
                    payload={
                        "id": str(pr.id),
                        "pipeline_id": self.pipeline_id,
                        "task_id": self.task_id,
                        "summary": summary,
                    },
                )
            )
        except Exception as e:
            logger.error(f"Error creating PR: {e}", exc_info=True)
        finally:
            logger.info("Cleaning up sandbox.")
            self.helper.cleanup()

    async def run(self):
        """Runs the Pi subprocess and manages the RPC communication."""
        logger.info(f"Starting run() for task {self.task_id}")
        self.start_time = datetime.now(UTC)
        self._log_event(
            {
                "type": "session_start",
                "pipeline_id": self.pipeline_id,
                "task_id": self.task_id,
            }
        )

        await ws_manager.broadcast(
            WSMessage(
                type="CODERBOT_STARTED",
                payload={"pipeline_id": self.pipeline_id, "task_id": self.task_id},
            )
        )

        task = await Task.get(self.task_id)
        if not task:
            error_msg = f"Task {self.task_id} not found."
            logger.error(error_msg)
            self._log_event({"type": "error", "message": error_msg})
            return

        # Move the task to INPROGRESS when CoderBot starts executing it.
        if task.status == TaskStatus.SCHEDULED or task.status == TaskStatus.CREATED:
            updated_task = await task_queries.transition_task(
                str(task.id), TaskStatus.INPROGRESS, actor="coderbot"
            )
            # Broadcast so the UI moves the TaskView card into the In Progress column.
            await ws_manager.broadcast(
                WSMessage(
                    type="TASK_STATUS_UPDATED",
                    payload=updated_task.model_dump(mode="json"),
                )
            )

        pipeline = await Pipeline.get(self.pipeline_id)
        if not pipeline or not pipeline.workspace_abs_path:
            error_msg = "Pipeline or workspace path not found."
            logger.error(error_msg)
            self._log_event({"type": "error", "message": error_msg})
            return

        self.pipeline = pipeline

        logger.info(f"Setting up sandbox for task {self.task_id}")
        self.helper = SandboxGitHelper(
            "coderbot", self.task_id, pipeline.workspace_abs_path
        )
        self.helper.setup_sandbox()

        initial_prompt = await self.get_initial_prompt(task)

        # Spawn Pi
        try:
            logger.info("Spawning 'pi' subprocess...")
            cmd = ["pi", "--mode", "rpc", "--no-session"]
            if self.model is not None:
                logger.info(f"--model for pi coding agent: {self.model}")
                cmd.extend(["--model", self.model])

            self.process = await asyncio.create_subprocess_exec(
                *cmd,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                cwd=str(self.helper.sandbox_path),
                limit=10 * 1024 * 1024,  # 10MB buffer limit
            )

            # Send prompt
            prompt_cmd = (
                json.dumps({"id": "req-1", "type": "prompt", "message": initial_prompt})
                + "\n"
            )

            if not self.process.stdin:
                error_msg = "Failed to open stdin to Pi."
                logger.error(error_msg)
                self._log_event({"type": "error", "message": error_msg})
                return

            logger.info("Sending initial prompt to Pi...")
            self.process.stdin.write(prompt_cmd.encode("utf-8"))
            await self.process.stdin.drain()

            if not self.process.stdout:
                error_msg = "Failed to open stdout from Pi."
                logger.error(error_msg)
                self._log_event({"type": "error", "message": error_msg})
                return

            # Read events
            agent_end_event = None
            logger.info("Entering RPC event loop...")
            async for line in self.process.stdout:
                try:
                    raw_line = line.decode("utf-8").strip()
                    if not raw_line:
                        continue
                    event = json.loads(raw_line)
                    self._log_event({"type": "pi_rpc_event", "event": event})
                    event_type = event.get("type")

                    logger.debug(f"Received event: {event_type}")

                    # Forward the full RPC event to the client via the websocket so
                    # the UI can render the whole CoderBot activity stream.
                    await self._broadcast_rpc(event)

                    if event_type == "message_update":
                        delta = event.get("assistantMessageEvent", {})
                        delta_type = delta.get("type")

                        # Route text/thinking to assistant stream
                        if delta_type in ["text_delta", "thinking_delta"]:
                            await ws_manager.broadcast(
                                WSMessage(
                                    type="ASSISTANT_STREAM",
                                    payload={
                                        "content": delta.get("delta", ""),
                                        "task_id": self.task_id,
                                        "pipeline_id": self.pipeline_id,
                                        "bot_type": "coderbot",
                                    },
                                )
                            )
                        elif delta_type == "toolcall_start":
                            tool_call = delta.get("partial", {}).get("toolCall", {})
                            name = tool_call.get("name", "tool")
                            await ws_manager.broadcast(
                                WSMessage(
                                    type="ASSISTANT_STREAM",
                                    payload={
                                        "content": f"\n\n> Calling {name}...\n",
                                        "task_id": self.task_id,
                                        "pipeline_id": self.pipeline_id,
                                        "bot_type": "coderbot",
                                    },
                                )
                            )

                    elif event_type == "agent_end":
                        logger.info(
                            "Received 'agent_end' from Pi. Signaling EOF to stdin."
                        )
                        agent_end_event = event
                        # Signal Pi to exit by closing stdin
                        if self.process.stdin.can_write_eof():
                            self.process.stdin.write_eof()

                except json.JSONDecodeError:
                    logger.debug(f"Non-JSON line from Pi: {line}")
                    continue

            logger.info("Subprocess stdout stream closed. Waiting for process exit...")
            # Wait for exit
            exit_code = await self.process.wait()
            logger.info(f"Pi process exited with code {exit_code}")

            if agent_end_event:
                await self._handle_agent_end(agent_end_event.get("messages", []))
            else:
                logger.warning("Process exited without receiving 'agent_end' event.")

        except Exception as e:
            error_msg = f"Error running Pi: {e}"
            error_timestamp = datetime.now(UTC).isoformat()
            logger.error(error_msg, exc_info=True)
            self._log_event(
                {
                    "type": "error",
                    "timestamp": error_timestamp,
                    "error": traceback.format_exc(),
                }
            )
            # Mark the task as FAILED if it was in progress.
            try:
                task = await Task.get(self.task_id)
                if task and task.status == TaskStatus.INPROGRESS:
                    await task_queries.transition_task(
                        str(task.id), TaskStatus.FAILED, actor="coderbot"
                    )
            except Exception:
                logger.warning(
                    f"Failed to mark task {self.task_id} as FAILED", exc_info=True
                )
            if self.helper:
                self.helper.cleanup()
        finally:
            logger.info(f"Finalizing session for task {self.task_id}")
            self._log_event({"type": "session_end"})
            await self._close_log_file()
            await ws_manager.broadcast(
                WSMessage(
                    type="CODERBOT_COMPLETED",
                    payload={"pipeline_id": self.pipeline_id, "task_id": self.task_id},
                )
            )
