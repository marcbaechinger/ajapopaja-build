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
import os
import re
import tempfile
import traceback
from datetime import UTC, datetime
from typing import Any, Dict, Optional, TextIO

import git

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

from .pi_parsers import (
    extract_final_summary,
    extract_text_delta,
    extract_thinking_delta,
    extract_tool_call_name,
)
from .pi_rpc_process import DEFAULT_COMMAND_TIMEOUT, PiRpcProcess  # noqa: F401

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


def read_session_history(task_id: str) -> list:
    """Replay the persisted Pi RPC events of a CoderBot session for a task.

    Each session writes its events as JSONL lines (``type == "pi_rpc_event"``)
    under ``SANDBOX_ROOT/logs/{slugify(task_id)}``. Returns the ordered list of raw
    RPC events (the same shape the ``CODERBOT_RPC_EVENT`` websocket message carries)
    so the client can reduce them into its activity log. Reads the most recent log
    file(s) so the latest run of a task wins.

    Note: the session start time is deliberately NOT read back from the files here.
    It is delivered for the active (or last) session via the ``/coderbot/session``
    endpoint straight from the in-memory :class:`CoderBotManager`, which lets the
    history replay avoid the extra, comparatively expensive file scan that used to
    be needed just to recover the start timestamp.
    """
    log_dir = config.SANDBOX_ROOT / "logs" / slugify(task_id)
    events: list = []
    if not log_dir.exists():
        return events

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
    return events


class CoderBotSession(PiRpcProcess):
    """
    Orchestrates the Pi coding agent via its headless RPC mode.
    """

    def __init__(
        self,
        pipeline_id: str,
        task_id: str,
        model: Optional[str] = None,
        pr: Optional[PullRequest] = None,
        comments: Optional[str] = None,
    ):
        super().__init__(model=model)
        self.pipeline_id = pipeline_id
        self.task_id = task_id
        self.model = model
        self.pr = pr
        self.comments = comments
        # Iteration mode is active whenever an existing PullRequest is provided.
        # In this mode CoderBot re-runs on a fresh branch with the current PR
        # patch applied as unstaged changes and writes the updated result back
        # onto the same PR document instead of inserting a new one.
        self.iteration_mode = pr is not None
        # The ``agent_end`` record captured by ``_handle_event``. ``run()`` reads
        # its ``messages`` payload after the process has exited.
        self.agent_end_event: Optional[Dict[str, Any]] = None
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

    def _build_repo_scope_instruction(self) -> str:
        """Build the instruction that confines Pi to the sandbox repository.

        CoderBot/Pi has a tendency to run recursive searches (e.g. ``grep -r``)
        from the filesystem root or the user's home directory. Those searches are
        slow, usually return nothing relevant and pollute the context with
        unrelated files. This block tells Pi the exact repository it owns, the
        branch it is working on and that it MUST restrict every search and edit
        to that directory.
        """
        if self.helper is not None:
            repo_path = str(self.helper.sandbox_path)
            branch_name = self.helper.branch_name
            location = (
                f"- Repository root: `{repo_path}`\n"
                f"- Working branch: `{branch_name}`\n\n"
            )
        else:
            location = ""

        return (
            "### Repository Scope\n"
            "You work exclusively inside the Git repository that is your current "
            "working directory. Every file you may read, search or edit lives "
            "inside it.\n\n"
            f"{location}"
            "You MUST only search (e.g. `grep`, `rg`, `find`, `ls`, glob) and "
            "edit files within the repository. Do NOT search the whole machine, "
            "the filesystem root (`/`) or your home directory, and do NOT use "
            "absolute paths outside the repository: those searches are slow and "
            "return no relevant results. Run every command from the repository "
            "root and keep all paths relative to it."
        )

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
            f"{self._build_repo_scope_instruction()}\n\n"
            f"{self._build_test_instruction()}"
        )

    def get_iteration_instruction(self) -> str:
        """Return an alternative system instruction for PR-iteration runs.

        The working tree already contains the existing pull-request patch applied
        as *unstaged changes* on top of a fresh branch. Pi must review that diff
        and modify it to address the user's review comments while keeping the
        changes consistent and running the verification suite.
        """
        return (
            "## System Instruction (Iteration)\n"
            "You are iterating on an existing pull request in response to the "
            "review comments below. The working tree already contains the current "
            "pull-request patch applied as unstaged changes (nothing is committed "
            "on this branch yet).\n\n"
            "- Inspect the existing unstaged diff (`git diff`) to understand the "
            "current implementation.\n"
            "- Address every review comment by editing the working tree so the "
            "resulting diff resolves the feedback (fix bugs, add tests, adjust "
            "design, etc.).\n"
            "- Keep changes focused and consistent with the existing diff and the "
            "project conventions.\n"
            "- Do NOT overwrite unrelated parts of the tree and do NOT revert "
            "already-correct pieces of the patch.\n"
            "- Run the verification suite and ensure everything is green before "
            "reporting completion."
        )

    async def get_iteration_prompt(self, task: Task) -> str:
        """Build the prompt for a PR-iteration run.

        Includes the same task information (title, specification, design document)
        as the initial prompt, followed by the user's review comments verbatim and
        guidance that the existing patch is already present as unstaged changes.
        """
        design_doc = task.design_doc or "No design document provided."
        spec = task.spec or "No specification provided."
        comments = self.comments or ""

        return (
            f"Please iterate on the following pull request.\n\n"
            f"### Task: {task.title}\n\n"
            f"### Specification\n{spec}\n\n"
            f"### Design Document\n{design_doc}\n\n"
            f"### Review Comments\n{comments}\n\n"
            f"### Current Patch Present as Unstaged Changes\n"
            f"The diff of the current pull request is already applied in the "
            f"working tree as unstaged changes. It is NOT committed. You should "
            f"edit these files to resolve the review comments above, keeping the "
            f"changes consistent with the existing implementation. The final "
            f"result should be a diff that incorporates the review feedback.\n\n"
            f"{self.get_iteration_instruction()}\n\n"
            f"{self._build_repo_scope_instruction()}\n\n"
            f"{self._build_test_instruction()}"
        )

    def _apply_existing_patch(self):
        """Apply the existing PullRequest patch into the working tree as unstaged
        changes (no commit) before spawning Pi for an iteration run.

        Uses a real three-way merge (`git apply --3way`) so that blob pre-image
        IDs recorded in the diff are merged against the current working-tree
        files. When the surrounding lines no longer match the blobs the patch
        expects, git returns a non-zero exit code and we surface the failure so the
        session falls cleanly into the existing error/FAILED path.
        """
        if not self.pr or not self.pr.patch:
            raise ValueError("Cannot apply existing patch: PullRequest has no patch")

        repo = self.helper.get_repo()
        patch_content = self.pr.patch
        if not patch_content.endswith("\n"):
            patch_content += "\n"

        patch_path = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="w", suffix=".patch", delete=False
            ) as f:
                f.write(patch_content)
                patch_path = f.name
            logger.info(
                f"Applying existing PR patch (iteration) for task {self.task_id}"
            )
            repo.git.apply("--3way", patch_path)
        except git.exc.GitCommandError as e:
            logger.error(
                f"Failed to apply existing patch for PR iteration "
                f"({self.pr.id}): {e.stderr}",
                exc_info=True,
            )
            raise
        finally:
            if patch_path and os.path.exists(patch_path):
                os.remove(patch_path)

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

    async def _broadcast_assistant_stream(self, content: str):
        """Broadcasts a chunk of streamed assistant output for this task."""
        if not content:
            return
        await ws_manager.broadcast(
            WSMessage(
                type="ASSISTANT_STREAM",
                payload={
                    "content": content,
                    "task_id": self.task_id,
                    "pipeline_id": self.pipeline_id,
                    "bot_type": "coderbot",
                },
            )
        )

    async def _handle_event(self, event: Dict[str, Any]):
        """Handle one asynchronous Pi RPC session event.

        Persists the raw event, forwards it to connected clients and derives the
        streamed assistant text/tool-call updates. When Pi reports ``agent_end``
        the session signals EOF to the child so it can exit; the post-run work
        (commit, verification, PR) happens in :meth:`run` once the process has
        stopped.
        """
        event_type = event.get("type")
        logger.debug(f"Received event: {event_type}")

        self._log_event({"type": "pi_rpc_event", "event": event})
        await self._broadcast_rpc(event)

        if event_type == "message_update":
            text_delta = extract_text_delta(event)
            if text_delta:
                await self._broadcast_assistant_stream(text_delta)
                return

            thinking_delta = extract_thinking_delta(event)
            if thinking_delta:
                await self._broadcast_assistant_stream(thinking_delta)
                return

            tool_name = extract_tool_call_name(event)
            if tool_name:
                await self._broadcast_assistant_stream(
                    f"\n\n> Calling {tool_name}...\n"
                )
        elif event_type == "agent_end":
            logger.info("Received 'agent_end' from Pi. Signaling EOF to stdin.")
            self.agent_end_event = event
            await self.close(graceful=True)

    async def _handle_agent_end(self, messages: list):
        """Called when Pi finishes the task."""
        logger.info(f"Handling agent_end for task {self.task_id}")
        if not self.helper:
            logger.warning("No helper found in _handle_agent_end")
            return

        try:
            summary = extract_final_summary(messages)

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

            if self.iteration_mode and self.pr:
                # Iteration mode: write the updated patch/summary/subject/branch
                # back onto the existing PullRequest document instead of inserting
                # a new one. The PR keeps its id/shape (only content is refreshed)
                # so the frontend PullRequestSection and PullRequestDialog "just
                # work" with the updated patch.
                self.pr.summary = pr_summary
                self.pr.subject = task_title
                self.pr.author = config.GIT_USER_NAME
                self.pr.branch_name = self.helper.branch_name
                self.pr.patch = patch
                self.pr.updated_at = datetime.now(UTC)
                await self.pr.save()
                logger.info(f"PullRequest {self.pr.id} updated in DB.")
                pr = self.pr
                pr_id = str(self.pr.id)
            else:
                pr = PullRequest(
                    pipeline_id=self.pipeline_id,
                    task_id=self.task_id,
                    subject=task_title,
                    author=config.GIT_USER_NAME,
                    summary=pr_summary,
                    branch_name=self.helper.branch_name,
                    patch=patch,
                    status=PullRequestStatus.OPEN,
                )
                await pr.insert()
                logger.info(f"PullRequest {pr.id} created in DB.")
                pr_id = str(pr.id)

            # Update task status.
            # In iteration mode the task is already PULL_REQUEST_AVAILABLE, so the
            # guard below harmlessly does not fire; it exists for the initial-run
            # path where the task transitions INPROGRESS -> PULL_REQUEST_AVAILABLE.
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
                        "id": pr_id,
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

        if self.iteration_mode:
            # In iteration mode the existing PR patch is already present in the
            # tree as unstaged changes (nothing committed) and the agent is asked
            # to address the user's review comments.
            self._apply_existing_patch()
            initial_prompt = await self.get_iteration_prompt(task)
        else:
            initial_prompt = await self.get_initial_prompt(task)

        # Spawn Pi and drive one run to completion. The base class owns the
        # subprocess, JSONL framing and command/response correlation; this class
        # only supplies the sandbox cwd and reacts to events via _handle_event.
        try:
            logger.info("Spawning 'pi' subprocess...")
            if self.model is not None:
                logger.info(f"--model for pi coding agent: {self.model}")

            await self.start(cwd=str(self.helper.sandbox_path))

            if not self.process or not self.process.stdin:
                error_msg = "Failed to open stdin to Pi."
                logger.error(error_msg)
                self._log_event({"type": "error", "message": error_msg})
                return

            logger.info("Sending initial prompt to Pi...")
            await self.prompt(initial_prompt)

            logger.info("Subprocess stdout stream closed. Waiting for process exit...")
            exit_code = await self.process.wait()
            logger.info(f"Pi process exited with code {exit_code}")

            # Make sure the background read loop has drained every buffered event
            # (including the final agent_end) before running the post-processing.
            if self._read_task is not None:
                try:
                    await self._read_task
                except asyncio.CancelledError:  # pragma: no cover - defensive
                    pass

            if self.agent_end_event:
                await self._handle_agent_end(self.agent_end_event.get("messages", []))
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


class InteractivePiSession(PiRpcProcess):
    """Stateful, multi-turn RPC session for user-driven chat.

    Unlike :class:`CoderBotSession`, which runs one batch task and then shuts
    the child down, an interactive session keeps the same Pi process alive for
    many turns. It never closes ``stdin`` on its own; the caller decides when to
    :meth:`close` the session.

    Events that belong to the active turn are pushed onto an
    :class:`asyncio.Queue`. :meth:`send_user_message` is an async generator that
    yields streamed text chunks and stops as soon as Pi reports
    ``agent_settled`` (i.e. it will not continue automatically).
    """

    # Marker pushed onto the queue once Pi has settled and the turn is over.
    SETTLED_MARKER: Dict[str, Any] = {"type": "settled"}

    def __init__(
        self,
        model: Optional[str] = None,
        cwd: Optional[str] = None,
        command_timeout: Optional[float] = None,
        pipeline_id: Optional[str] = None,
        bot_type: str = "interactive",
    ):
        super().__init__(model=model, cwd=cwd, command_timeout=command_timeout)
        self.pipeline_id = pipeline_id
        self.bot_type = bot_type
        # Wall-clock time the session started running. Captured in
        # ``start_interactive`` and exposed to the UI so the reused PiView can
        # resume its "Running since" timer from the real session start.
        self.start_time: Optional[datetime] = None
        self._queue: "asyncio.Queue[Any]" = asyncio.Queue()
        # Public alias so callers/tests can inspect the active-turn queue.
        self.queue = self._queue
        # Guards so the lifecycle broadcasts emitted here and by the manager can
        # never duplicate when both layers participate in the same transition.
        self._started_broadcast = False
        self._stopped_broadcast = False

    async def _broadcast_started(self):
        """Broadcast ``INTERACTIVE_STARTED`` once per session lifecycle."""
        if self.pipeline_id is None or self._started_broadcast:
            return
        self._started_broadcast = True
        await ws_manager.broadcast(
            WSMessage(
                type="INTERACTIVE_STARTED",
                payload={
                    "pipeline_id": self.pipeline_id,
                    "bot_type": self.bot_type,
                    "start_time": (
                        self.start_time.isoformat() if self.start_time else None
                    ),
                },
            )
        )

    async def _broadcast_stopped(self):
        """Broadcast ``INTERACTIVE_STOPPED`` once per session lifecycle."""
        if self.pipeline_id is None or self._stopped_broadcast:
            return
        self._stopped_broadcast = True
        await ws_manager.broadcast(
            WSMessage(
                type="INTERACTIVE_STOPPED",
                payload={
                    "pipeline_id": self.pipeline_id,
                    "bot_type": self.bot_type,
                },
            )
        )

    async def _broadcast_rpc(self, event: Dict[str, Any]):
        """Forward a raw Pi RPC event as ``INTERACTIVE_RPC_EVENT``.

        Skipped when no ``pipeline_id`` was supplied so pure unit tests remain
        side-effect free. Interactive sessions use a dedicated message type (not
        ``CODERBOT_RPC_EVENT``/``ASSISTANT_STREAM``) so their output can never
        leak into the batch CoderBot log.
        """
        if self.pipeline_id is None:
            return
        await ws_manager.broadcast(
            WSMessage(
                type="INTERACTIVE_RPC_EVENT",
                payload={
                    "pipeline_id": self.pipeline_id,
                    "bot_type": self.bot_type,
                    "event": event,
                },
            )
        )

    async def start_interactive(self, cwd: Optional[str] = None):
        """Spawn the long-lived Pi process and broadcast the start event."""
        self.start_time = datetime.now(UTC)
        self._started_broadcast = False
        self._stopped_broadcast = False
        process = await self.start(cwd=cwd)
        await self._broadcast_started()
        return process

    async def _handle_event(self, event: Dict[str, Any]):
        """Push text deltas for the active turn and mark settled turns.

        The raw event is additionally broadcast so the reused PiView can render
        it structurally. ``agent_end`` is deliberately ignored: it only marks the
        end of one low-level run and retries/compaction can still follow.
        ``agent_settled`` is the signal that Pi will not continue automatically.
        """
        event_type = event.get("type")
        await self._broadcast_rpc(event)
        if event_type == "message_update":
            delta = extract_text_delta(event)
            if delta:
                await self._queue.put(delta)
        elif event_type == "agent_settled":
            await self._queue.put(dict(self.SETTLED_MARKER))

    async def stop(self):
        """Forcefully terminate the process and broadcast the stop event."""
        super().stop()
        await self._broadcast_stopped()

    async def close(self, graceful: bool = True):
        """Close the session and broadcast the stop event."""
        await super().close(graceful=graceful)
        await self._broadcast_stopped()

    async def send_user_message(self, text: str):
        """Send one chat turn and stream the assistant text back.

        Yields the streamed text chunks in order until Pi emits
        ``agent_settled``. A prompt that Pi handled itself (disposition
        ``"handled"``) does not start a run, so no ``agent_settled`` event will
        follow and the generator returns without yielding.
        """
        response = await self.prompt(text)
        if not response or not response.get("success"):
            error = (response or {}).get("error", "Pi rejected the prompt.")
            logger.error(f"Interactive prompt was not accepted: {error}")
            return

        data = response.get("data") or {}
        if data.get("disposition") == "handled":
            # No run was started for this prompt, so no agent_settled follows.
            return

        while True:
            item = await self._queue.get()
            if (
                isinstance(item, dict)
                and item.get("type") == self.SETTLED_MARKER["type"]
            ):
                return
            yield item


# The design/refactor notes refer to the batch session as either
# ``CoderBotSession`` or ``PiSession``. Keep the shorter name available as an
# alias so callers can use whichever they prefer.
PiSession = CoderBotSession
