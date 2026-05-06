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
from datetime import UTC, datetime
from typing import Any, Dict, Optional

from api.websocket_manager import WSMessage, manager as ws_manager
from core import config
from core.models.models import (
    Pipeline,
    PullRequest,
    PullRequestStatus,
    Task,
    TaskStatus,
)

from .git_helper import SandboxGitHelper

logger = logging.getLogger(__name__)


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

        timestamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
        self.log_filename = f"coderbot_{timestamp}.jsonl"
        self.log_dir = config.SANDBOX_ROOT / "logs" / task_id

    def _log_event(self, data: Dict[str, Any]):
        """Persists a structured event to the session log file."""
        if not config.BASEBOT_LOG_ENABLED:
            return

        try:
            self.log_dir.mkdir(parents=True, exist_ok=True)
            log_path = self.log_dir / self.log_filename

            event = {
                "timestamp": datetime.now(UTC).isoformat(),
                **data,
            }

            with open(log_path, "a", encoding="utf-8") as f:
                f.write(json.dumps(event) + "\n")
        except Exception as e:
            logger.error(f"Failed to log CoderBot event: {e}")

    async def get_initial_prompt(self, task: Task) -> str:
        design_doc = task.design_doc or "No design document provided."
        spec = task.spec or "No specification provided."

        return (
            f"Please implement the following task.\n\n"
            f"### Task: {task.title}\n\n"
            f"### Design Document\n{design_doc}\n\n"
            f"### Specification\n{spec}"
        )

    async def _handle_agent_end(self, messages: list):
        """Called when Pi finishes the task."""
        if not self.helper:
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

            repo = self.helper.get_repo()
            repo.git.add(A=True)
            commit_made = False
            try:
                repo.git.commit("-m", f"CoderBot (Pi): {summary[:200]}")
                commit_made = True
            except Exception:
                pass  # Nothing to commit

            if commit_made:
                # Use git diff to get a clean, structural patch without commit metadata
                patch = repo.git.diff("HEAD~1", "HEAD")
            else:
                patch = self.helper.get_patch()

            pr = PullRequest(
                pipeline_id=self.pipeline_id,
                task_id=self.task_id,
                summary=summary,
                branch_name=self.helper.branch_name,
                patch=patch,
                status=PullRequestStatus.OPEN,
            )
            await pr.insert()

            # Update task status
            task = await Task.get(self.task_id)
            if task:
                task.status = TaskStatus.PULL_REQUEST_AVAILABLE
                await task.save()

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
            logger.error(f"Error creating PR: {e}")
        finally:
            self.helper.cleanup()

    async def run(self):
        """Runs the Pi subprocess and manages the RPC communication."""
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

        self.helper = SandboxGitHelper(self.task_id, pipeline.workspace_abs_path)
        self.helper.setup_sandbox()

        initial_prompt = await self.get_initial_prompt(task)

        # Spawn Pi
        try:
            self.process = await asyncio.create_subprocess_exec(
                "pi",
                "--mode",
                "rpc",
                "--no-session",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
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

            self.process.stdin.write(prompt_cmd.encode("utf-8"))
            await self.process.stdin.drain()

            if not self.process.stdout:
                error_msg = "Failed to open stdout from Pi."
                logger.error(error_msg)
                self._log_event({"type": "error", "message": error_msg})
                return

            # Read events
            async for line in self.process.stdout:
                try:
                    raw_line = line.decode("utf-8").strip()
                    if not raw_line:
                        continue
                    event = json.loads(raw_line)
                    self._log_event({"type": "pi_rpc_event", "event": event})
                    event_type = event.get("type")

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
                                    },
                                )
                            )

                    elif event_type == "agent_end":
                        await self._handle_agent_end(event.get("messages", []))
                        break

                except json.JSONDecodeError:
                    continue

            # Wait for exit
            await self.process.wait()

        except Exception as e:
            error_msg = f"Error running Pi: {e}"
            logger.error(error_msg)
            self._log_event({"type": "error", "message": error_msg})
            if self.helper:
                self.helper.cleanup()
        finally:
            self._log_event({"type": "session_end"})
            await ws_manager.broadcast(
                WSMessage(
                    type="CODERBOT_COMPLETED",
                    payload={"pipeline_id": self.pipeline_id, "task_id": self.task_id},
                )
            )
