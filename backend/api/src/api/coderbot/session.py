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

from api.websocket_manager import WSMessage, manager as ws_manager
from core import config
from core.models.models import (
    Pipeline,
    PullRequest,
    PullRequestStatus,
    Task,
    TaskStatus,
)

from api.bot.git_helper import SandboxGitHelper

logger = logging.getLogger(__name__)


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


class CoderBotSession:
    """
    Orchestrates the Pi coding agent via its headless RPC mode.
    """

    def __init__(
        self,
        pipeline_id: str,
        task_id: str,
    ):
        self.pipeline_id = pipeline_id
        self.task_id = task_id
        self.process: Optional[asyncio.subprocess.Process] = None
        self.helper: Optional[SandboxGitHelper] = None
        self.log_file: Optional[TextIO] = None

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

    async def get_initial_prompt(self, task: Task) -> str:
        design_doc = task.design_doc or "No design document provided."
        spec = task.spec or "No specification provided."

        return (
            f"Please implement the following task.\n\n"
            f"### Task: {task.title}\n\n"
            f"### Specification\n{spec}\n\n"
            f"### Design Document\n{design_doc}"
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
            repo.git.add(A=True)
            commit_made = False
            try:
                # Use --no-verify to bypass pre-commit hooks in the sandbox environment
                repo.git.commit("-m", f"CoderBot (Pi): {summary[:200]}", "--no-verify")
                commit_made = True
                logger.info("Git commit created in sandbox.")
            except Exception as e:
                logger.info(f"Nothing to commit or commit failed: {e}")

            if commit_made:
                # Use git diff to get a clean, structural patch without commit metadata
                patch = repo.git.diff("HEAD~1", "HEAD")
                logger.info(f"Generated patch from commit. Length: {len(patch)}")
            else:
                patch = self.helper.get_patch()
                logger.info(f"Generated patch from diff. Length: {len(patch)}")

            if not patch:
                logger.warning("Generated patch is empty.")
            elif not patch.endswith("\n"):
                patch += "\n"

            pr = PullRequest(
                pipeline_id=self.pipeline_id,
                task_id=self.task_id,
                summary=summary,
                branch_name=self.helper.branch_name,
                patch=patch,
                status=PullRequestStatus.OPEN,
            )
            await pr.insert()
            logger.info(f"PullRequest {pr.id} created in DB.")

            # Update task status
            task = await Task.get(self.task_id)
            if task:
                task.status = TaskStatus.PULL_REQUEST_AVAILABLE
                await task.save()
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

        pipeline = await Pipeline.get(self.pipeline_id)
        if not pipeline or not pipeline.workspace_abs_path:
            error_msg = "Pipeline or workspace path not found."
            logger.error(error_msg)
            self._log_event({"type": "error", "message": error_msg})
            return

        logger.info(f"Setting up sandbox for task {self.task_id}")
        self.helper = SandboxGitHelper(
            "coderbot", self.task_id, pipeline.workspace_abs_path
        )
        self.helper.setup_sandbox()

        initial_prompt = await self.get_initial_prompt(task)

        # Spawn Pi
        try:
            logger.info("Spawning 'pi' subprocess...")
            self.process = await asyncio.create_subprocess_exec(
                "pi",
                "--mode",
                "rpc",
                "--model",
                "deepseek-v4-flash:cloud",
                "--no-session",
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
