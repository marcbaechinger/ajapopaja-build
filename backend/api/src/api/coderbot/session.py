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

from api.assistant.tools.command_runner import run_verification_sequence
from api.websocket_manager import WSMessage, manager as ws_manager
from core import config
from core.models.models import (
    Pipeline,
    PiSession,
    PiSessionStatus,
    PullRequest,
    PullRequestStatus,
    Task,
    TaskStatus,
)
from core.queries import pi_session as pi_session_queries
from core.queries import task as task_queries

from api.bot.git_helper import SandboxBase, SandboxGitHelper

from .pi_parsers import (
    extract_final_summary,
    extract_text_delta,
    extract_thinking_delta,
    extract_tool_call_name,
)
from .pi_rpc_process import DEFAULT_COMMAND_TIMEOUT, PiRpcProcess  # noqa: F401
from .pi_session_store import (
    SessionEventLog,
    ensure_session_dir,
    pi_sessions_dir,
    read_session_events,
    recover_session_file,
    workspace_dir as pi_workspace_dir,
    write_meta,
)

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


async def read_session_history(task_id: str, session_uid: Optional[str] = None) -> list:
    """Replay the persisted Pi RPC events of a CoderBot session for a task.

    The task's ``pi_session_uid`` is resolved (when not supplied explicitly) and
    the session's on-disk ``events.jsonl`` under ``PI_SESSIONS_ROOT`` is
    preferred. Otherwise the legacy per-task
    ``SANDBOX_ROOT/logs/{slugify(task_id)}`` files are read, so existing
    installations keep working without a migration.

    Note: the session start time is deliberately NOT read back from the files here.
    It is delivered for the active (or last) session via the ``/coderbot/session``
    endpoint straight from the in-memory :class:`CoderBotManager`, which lets the
    history replay avoid the extra, comparatively expensive file scan that used to
    be needed just to recover the start timestamp.
    """
    if session_uid is None:
        try:
            task = await Task.get(task_id)
            if task is not None:
                session_uid = getattr(task, "pi_session_uid", None)
        except Exception:  # pragma: no cover - DB unavailable
            session_uid = None

    if session_uid:
        events = read_session_events(session_uid)
        if events:
            return events

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


async def read_task_session_history(task_id: str) -> list:
    """Backwards-compatible alias for :func:`read_session_history`."""
    return await read_session_history(task_id)


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
        session_uid: Optional[str] = None,
        session_record: Optional[PiSession] = None,
        resume_session_file: Optional[str] = None,
        persist: Optional[bool] = None,
        base: Optional[SandboxBase] = None,
    ):
        self.session_uid = session_uid or (
            getattr(session_record, "uid", None) if session_record else None
        )
        self.session_record = session_record
        # When a durable record is supplied, its stored model is authoritative:
        # this keeps a resumed session on the model chosen while it was paused
        # even when the caller does not pass one explicitly.
        if model is None and session_record is not None:
            model = getattr(session_record, "model", None)
        if self.session_uid and config.PI_SESSION_PERSISTENCE_ENABLED:
            self.session_dir: Optional[str] = str(pi_sessions_dir(self.session_uid))
            ensure_session_dir(self.session_uid)
        else:
            self.session_dir = None

        if resume_session_file is None and session_record is not None:
            resume_session_file = getattr(session_record, "pi_session_file", None)
        if resume_session_file is None and self.session_uid:
            resume_session_file = recover_session_file(self.session_uid)
        self.resume_session_file = resume_session_file

        if persist is None:
            persist = config.PI_SESSION_PERSISTENCE_ENABLED

        super().__init__(
            model=model,
            skill_names=config.CODERBOT_SKILLS,
            session_dir=self.session_dir,
            resume_session_file=resume_session_file,
            persist=persist,
        )
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
        # When resuming a completed session in place we must not re-clone the
        # sandbox: the retained working tree is reused as-is.
        self.resume_in_place = False
        self.resume_message: Optional[str] = None
        # Ordered branch chaining: when set, the sandbox is branched from this
        # base (the predecessor's retained commit) instead of the default
        # branch. ``base_session_uid`` records which session it chained from for
        # audit. Resolved in ``run()`` unless the session is resumed in place.
        self.base: Optional[SandboxBase] = base
        self.base_session_uid: Optional[str] = None
        # The ``agent_end`` record captured by ``_handle_event``. ``run()`` reads
        # its ``messages`` payload after the process has exited.
        self.agent_end_event: Optional[Dict[str, Any]] = None
        self.helper: Optional[SandboxGitHelper] = None
        self.pipeline: Optional[Pipeline] = None
        self.log_file: Optional[TextIO] = None
        # Best-effort retained event log for UI replay (separate from the legacy
        # per-task ``coderbot_*.jsonl`` log).
        self.event_log: Optional[SessionEventLog] = (
            SessionEventLog(self.session_uid) if self.session_uid else None
        )
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
        """Build the "Mandatory Verification" block listing the build, lint and
        test commands that are configured for this pipeline.

        The commands are grouped by category (build -> lint -> test). Build and
        lint are optional: when the pipeline does not configure them they are
        simply omitted. Tests fall back to the global/default commands exactly
        like the post-run verification resolver does.
        """
        groups: list[tuple[str, list]] = []
        build_commands = self.get_resolved_build_commands()
        if build_commands:
            groups.append(("Build", build_commands))
        lint_commands = self.get_resolved_lint_commands()
        if lint_commands:
            groups.append(("Lint", lint_commands))
        test_commands = self.get_resolved_verification_commands()
        if test_commands:
            groups.append(("Test", test_commands))

        blocks = []
        for label, commands in groups:
            lines = "\n".join(f"- `{' '.join(c)}`" for c in commands)
            blocks.append(f"**{label}**\n{lines}")
        command_block = "\n\n".join(blocks)

        return (
            f"### Mandatory Verification\n"
            f"This repository is a monorepo. Before finishing, you MUST run the full project\n"
            f"build, lint and test suite exactly as documented in README.md, fix any\n"
            f"failures your changes cause, and re-run until green. The required commands\n"
            f"are:\n\n"
            f"{command_block}\n\n"
            f"Do NOT report the task as complete until every configured command passes (or,\n"
            f"if a failure is pre-existing and unrelated to your change, explain it in your\n"
            f"summary instead). Include the commands you ran and their outcome in your final\n"
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
        pipeline_commands = self._get_pipeline_command_list("test_commands")
        if pipeline_commands:
            return pipeline_commands
        return self._get_global_verification_commands()

    def get_resolved_build_commands(self) -> list:
        """Resolve the pipeline's build commands for post-run verification.

        Build commands have no global/default fallback: when the pipeline does
        not configure any they are simply not part of the verification run.

        Returns:
            A list of argv lists, or ``[]`` when build is not configured.
        """
        return self._get_pipeline_command_list("build_commands")

    def get_resolved_lint_commands(self) -> list:
        """Resolve the pipeline's lint commands for post-run verification.

        Lint commands have no global/default fallback: when the pipeline does
        not configure any they are simply not part of the verification run.

        Returns:
            A list of argv lists, or ``[]`` when lint is not configured.
        """
        return self._get_pipeline_command_list("lint_commands")

    def _get_pipeline_command_list(self, attr: str) -> list:
        """Return a validated copy of a per-pipeline command list attribute.

        Only an actual non-empty list counts as configured; ``None``, empty
        lists and non-list values (e.g. auto-created ``MagicMock`` attributes in
        tests) mean "not configured".
        """
        commands = getattr(self.pipeline, attr, None)
        if isinstance(commands, list) and commands:
            return list(commands)
        return []

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
        """Runs the project build, lint and test commands in the sandbox.

        The PR is created regardless of the outcome, but the returned dict flags
        any failing command so a human can see the suite was red.

        Commands are resolved per category via explicit resolvers and executed in
        the deterministic order **build -> lint -> test**. Every configured
        category runs even when an earlier one fails, so a single run gives the
        full picture. Build and lint have no fallback: when the pipeline does not
        configure them they are skipped. Tests keep their global/default
        fallback.

        Delegates execution to ``run_verification_sequence`` (shared with the
        assistant ``run_build``/``run_lint``/``run_tests`` pipeline tools) so the
        sandboxed command-running logic lives in a single place. Each command runs
        in its own process group under ``CODERBOT_VERIFICATION_TIMEOUT``; a
        command only counts as green when it exited with code 0 (timeouts and
        spawn failures record a ``None`` exit code which marks the verification
        as failed).

        Returns:
            A dict ``{"commands": [...], "passed": bool, "duration_ms": int,
            "durations": {...}}`` where each command entry contains the argv,
            its category (``kind``), the exit code and the tail of its output.
            ``duration_ms`` is the total wall-clock time of the run and
            ``durations`` maps each category (build/lint/test) to how long it
            took, so PiView can show the timing of every run.
        """
        categories: list = []
        build_commands = self.get_resolved_build_commands()
        if build_commands:
            categories.append(("build", build_commands))
        lint_commands = self.get_resolved_lint_commands()
        if lint_commands:
            categories.append(("lint", lint_commands))
        test_commands = self.get_resolved_verification_commands()
        if test_commands:
            categories.append(("test", test_commands))

        return await run_verification_sequence(
            categories, str(self.helper.sandbox_path)
        )

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
                    "session_uid": self.session_uid,
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
                    "session_uid": self.session_uid,
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
        if self.event_log is not None:
            self.event_log.append(event)
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

            # Include the task ID, the model used for the implementation and the
            # relevant commit hashes in the PR summary so a human can see exactly
            # which version of the code was verified. The task ID, the model, the
            # hash of the commit the verification ran on (HEAD after CoderBot's
            # commit) and the hash of the commit on top of which the new commit was
            # created (the previous HEAD, if any) are reported.
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
                f"Model: **{self.model}**",
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
                    kind = entry.get("kind")
                    label = f"[{kind}] " if kind else ""
                    summary_meta.append(
                        f"- {label}`{entry.get('cmd')}` -> exit code {exit_code}"
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
                if self.session_uid:
                    self.pr.pi_session_uid = self.session_uid
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
                    pi_session_uid=self.session_uid,
                )
                await pr.insert()
                logger.info(f"PullRequest {pr.id} created in DB.")
                pr_id = str(pr.id)

            # Link the task and session record so the run can later be resumed.
            if task is not None and self.session_uid:
                try:
                    task.pi_session_uid = self.session_uid
                    await task.save()
                except Exception:  # pragma: no cover - defensive
                    logger.debug("Failed to link task to Pi session", exc_info=True)
            await self._save_session_record(
                status=PiSessionStatus.COMPLETED,
                base_commit=parent_commit_hash,
                head_commit=head_commit_hash,
                chained_from_session_uid=self.base_session_uid,
                branch_name=self.helper.branch_name,
                pull_request_ids=(
                    (list(self.session_record.pull_request_ids) + [pr_id])
                    if self.session_record is not None
                    and pr_id not in (self.session_record.pull_request_ids or [])
                    else [pr_id]
                ),
                last_active_at=datetime.now(UTC),
            )

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
            await self._save_session_record(
                status=PiSessionStatus.FAILED, last_error=str(e)
            )
        finally:
            if self._should_retain_workspace():
                logger.info(
                    "Retaining sandbox workspace for session %s.", self.session_uid
                )
            else:
                logger.info("Cleaning up sandbox.")
                self.helper.cleanup()

    def _should_retain_workspace(self) -> bool:
        """Whether the sandbox tree must survive this session for a resume."""
        return bool(self.session_uid) and config.PI_SESSION_RETAIN_BATCH_WORKSPACE

    async def _save_session_record(self, **fields) -> None:
        """Best-effort update of the durable Pi session record."""
        record = self.session_record
        if record is None:
            return
        for key, value in fields.items():
            if hasattr(record, key):
                setattr(record, key, value)
        record.updated_at = datetime.now(UTC)
        try:
            await record.save()
        except Exception:  # pragma: no cover - DB unavailable
            logger.debug("Failed to save Pi session record", exc_info=True)
        write_meta(record)

    async def _resolve_chain_base(self) -> Optional[SandboxBase]:
        """Resolve the predecessor sandbox base for ordered branch chaining.

        The newest eligible *still-pending* predecessor session for this pipeline
        is turned into a :class:`SandboxBase` pointing at its retained workspace
        and branch tip. Returns ``None`` when there is no eligible predecessor, in
        which case the caller keeps whatever base it already had (normally
        ``None``) and branches from the default branch.
        """
        before_created_at = getattr(self.session_record, "created_at", None)
        try:
            predecessor = await pi_session_queries.find_previous_pending_batch_session(
                self.pipeline_id, before_created_at=before_created_at
            )
        except Exception:
            logger.debug(
                "Failed to resolve chaining predecessor for pipeline %s",
                self.pipeline_id,
                exc_info=True,
            )
            return None
        if predecessor is None:
            return None

        repo_path = predecessor.workspace_path
        branch_name = predecessor.branch_name
        if not repo_path or not branch_name:
            return None
        try:
            commit = git.Repo(str(repo_path)).commit(branch_name).hexsha
        except Exception:
            logger.debug(
                "Predecessor session %s branch %s is not resolvable; falling "
                "back to the default branch",
                predecessor.uid,
                branch_name,
                exc_info=True,
            )
            return None

        self.base_session_uid = predecessor.uid
        logger.info(
            "Chaining task %s onto session %s (%s @ %s)",
            self.task_id,
            predecessor.uid,
            branch_name,
            commit,
        )
        return SandboxBase(
            repo_path=str(repo_path),
            ref=f"refs/heads/{branch_name}",
            commit=commit,
        )

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
                payload={
                    "pipeline_id": self.pipeline_id,
                    "task_id": self.task_id,
                    "session_uid": self.session_uid,
                    "model": self.model,
                },
            )
        )

        task = await Task.get(self.task_id)
        if not task:
            error_msg = f"Task {self.task_id} not found."
            logger.error(error_msg)
            self._log_event({"type": "error", "message": error_msg})
            return

        # Seed the durable session label from the task title when it is still
        # unset (e.g. records created before this behaviour existed or sessions
        # constructed directly). A user-set label is never overwritten.
        if (
            self.session_record is not None
            and not self.session_record.label
            and isinstance(task.title, str)
            and task.title.strip()
        ):
            self.session_record.label = task.title

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

        if not self.resume_in_place and not self.iteration_mode:
            # Ordered branch chaining: branch this task from its still-pending
            # predecessor's commit (when one exists) so its PR only carries its
            # own delta. Resolved here, at sandbox-setup time, because only now
            # is the predecessor guaranteed to have finished. Iteration runs must
            # NOT chain: they re-apply an existing PR patch on a fresh base.
            resolved_base = await self._resolve_chain_base()
            if resolved_base is not None:
                self.base = resolved_base

        retain_workspace = self._should_retain_workspace()
        workspace_path = (
            str(pi_workspace_dir(self.session_uid)) if retain_workspace else None
        )
        await self._save_session_record(
            status=PiSessionStatus.RUNNING,
            cwd=workspace_path or str(pipeline.workspace_abs_path),
            workspace_path=workspace_path,
            model=self.model,
            pipeline_id=self.pipeline_id,
            task_id=self.task_id,
            chained_from_session_uid=self.base_session_uid,
        )

        logger.info(f"Setting up sandbox for task {self.task_id}")
        self.helper = SandboxGitHelper(
            "coderbot",
            self.task_id,
            pipeline.workspace_abs_path,
            workspace_path=workspace_path,
            base=self.base,
        )
        if self.resume_in_place:
            # A previously persisted batch workspace is reused as-is so the
            # agent's branch, files and unstaged state match what it last saw.
            self.helper.reuse_existing()
        else:
            self.helper.setup_sandbox()

        if self.iteration_mode:
            # In iteration mode the existing PR patch is already present in the
            # tree as unstaged changes (nothing committed) and the agent is asked
            # to address the user's review comments.
            self._apply_existing_patch()
            initial_prompt = await self.get_iteration_prompt(task)
        elif self.resume_in_place and self.resume_message:
            initial_prompt = await self.get_resume_prompt(task, self.resume_message)
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

            if self.session_uid and self.should_persist:
                # Capture Pi's native session identity right after spawn so the
                # record can be resumed even if the run crashes later.
                try:
                    await self.capture_session_identity()
                    await self._save_session_record(
                        pi_session_id=self.session_id,
                        pi_session_file=self.session_file,
                        session_dir=self.session_dir,
                    )
                except Exception:  # pragma: no cover - defensive
                    logger.warning(
                        "Failed to capture Pi session identity for %s",
                        self.session_uid,
                        exc_info=True,
                    )

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
            if self.helper and not self._should_retain_workspace():
                self.helper.cleanup()
        finally:
            logger.info(f"Finalizing session for task {self.task_id}")
            self._log_event({"type": "session_end"})
            await self._close_log_file()
            await self._finish_session_record()
            await ws_manager.broadcast(
                WSMessage(
                    type="CODERBOT_COMPLETED",
                    payload={
                        "pipeline_id": self.pipeline_id,
                        "task_id": self.task_id,
                        "session_uid": self.session_uid,
                    },
                )
            )

    async def _finish_session_record(self) -> None:
        """Ensure the durable record is not left dangling in ``RUNNING``."""
        record = self.session_record
        if record is None:
            return
        if record.status == PiSessionStatus.RUNNING:
            await self._save_session_record(status=PiSessionStatus.FAILED)

    async def get_resume_prompt(self, task: Task, message: str) -> str:
        """Build the prompt used when resuming a completed batch session.

        The retained workspace already contains the agent's previous changes, so
        the user's instruction is appended to the standard task information
        instead of re-explaining the whole task.
        """
        design_doc = task.design_doc or "No design document provided."
        spec = task.spec or "No specification provided."
        return (
            f"Please continue working on the following task.\n\n"
            f"### Task: {task.title}\n\n"
            f"### Specification\n{spec}\n\n"
            f"### Design Document\n{design_doc}\n\n"
            f"### Follow-up Instruction\n{message}\n\n"
            f"The working tree contains your previous changes for this task. "
            f"Continue from that state, address the follow-up instruction and "
            f"produce a new commit and pull request.\n\n"
            f"{self._build_repo_scope_instruction()}\n\n"
            f"{self._build_test_instruction()}"
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
        session_uid: Optional[str] = None,
        session_record: Optional[PiSession] = None,
        resume_session_file: Optional[str] = None,
        persist: Optional[bool] = None,
        env: Optional[Dict[str, str]] = None,
    ):
        self.session_uid = session_uid or (
            getattr(session_record, "uid", None) if session_record else None
        )
        self.session_record = session_record
        # Mirror ``CoderBotSession``: a supplied durable record's stored model is
        # the authoritative model for a resume, so honour it when the caller does
        # not pass an explicit ``model``.
        if model is None and session_record is not None:
            model = getattr(session_record, "model", None)
        if self.session_uid and config.PI_SESSION_PERSISTENCE_ENABLED:
            self.session_dir: Optional[str] = str(pi_sessions_dir(self.session_uid))
            ensure_session_dir(self.session_uid)
        else:
            self.session_dir = None

        if resume_session_file is None and session_record is not None:
            resume_session_file = getattr(session_record, "pi_session_file", None)
        if resume_session_file is None and self.session_uid:
            resume_session_file = recover_session_file(self.session_uid)
        self.resume_session_file = resume_session_file

        if persist is None:
            persist = config.PI_SESSION_PERSISTENCE_ENABLED

        super().__init__(
            model=model,
            cwd=cwd,
            command_timeout=command_timeout,
            skill_names=config.INTERACTIVE_SKILLS,
            session_dir=self.session_dir,
            resume_session_file=resume_session_file,
            persist=persist,
            env=env,
        )
        self.pipeline_id = pipeline_id
        self.bot_type = bot_type
        # Wall-clock time the session started running. Captured in
        # ``start_interactive`` and exposed to the UI so the reused PiView can
        # resume its "Running since" timer from the real session start.
        self.start_time: Optional[datetime] = None
        self.event_log: Optional[SessionEventLog] = (
            SessionEventLog(self.session_uid) if self.session_uid else None
        )
        self._queue: "asyncio.Queue[Any]" = asyncio.Queue()
        # Public alias so callers/tests can inspect the active-turn queue.
        self.queue = self._queue
        # Guards so the lifecycle broadcasts emitted here and by the manager can
        # never duplicate when both layers participate in the same transition.
        self._started_broadcast = False
        self._stopped_broadcast = False

    def build_command(self) -> list:
        """Return the argv used to spawn the interactive Pi RPC process.

        Extends the base command with ``--append-system-prompt`` so the
        repository/search scope and task-management instruction are installed
        once, before the first user turn. Passing the instruction as a process
        argument (rather than as a prompt message) keeps it out of the
        user-authored chat history.
        """
        cmd = super().build_command()
        cmd.extend(["--append-system-prompt", self._build_system_instruction()])
        return cmd

    def _build_system_instruction(self) -> str:
        """Build the system instruction appended to interactive Pi sessions.

        Unlike the batch :class:`CoderBotSession`, which runs in an isolated
        sandbox, an interactive session works directly in the user's live
        repository. The instruction therefore pins the agent to that
        repository, forbids filesystem-wide searches and points it at the
        bundled ``ajapopaja`` skill for pipeline task management.

        The Pipeline UID is the ``pipeline_id`` the session was started for;
        the agent passes it when reading tasks from that pipeline.
        """
        pipeline_uid = self.pipeline_id or "unknown"
        return (
            "### Repository Scope\n"
            "You work exclusively inside the Git repository that is your current "
            "working directory. Every file you may read, search or edit lives "
            "inside it. You MUST NOT read, search or edit anything outside that "
            "directory. If you need something outside the repository, ask the "
            "user first.\n\n"
            "### Search Scope\n"
            "Run every search (`grep`, `rg`, `find`, `ls`, glob, …) only inside "
            "the repository working directory. Never search the filesystem root "
            "(`/`), the home directory or any absolute path outside the "
            "repository: those searches are slow and return no relevant results. "
            "Run commands from the repository root and keep paths relative to "
            "it.\n\n"
            "### Ajapopaja Skill\n"
            "The bundled `ajapopaja` skill is available and can be used to read "
            "and manage tasks for this pipeline: `get-task <pipeline_id>`, "
            "`get-task-details <task_id>`, `search-tasks`, "
            "`update-task-design-doc` (`update-design-doc`) and `complete-task`. "
            "Once you have committed your work, it can also open a pull request "
            'with `create-pull-request <pipeline_id> --title "…" [--body "…"] '
            "[--task <task_id>]`: the server pushes your current branch and "
            "creates the Gitea pull request. "
            "The skill is located in this repository at "
            "`.pi/skills/ajapopaja/SKILL.md`. Pi discovers project skills from "
            "the `.pi/skills/` directory and global skills from "
            "`~/.pi/agent/skills/` (the bare `~/.pi/skills` path is not a Pi "
            "skill location). Read `.pi/skills/ajapopaja/SKILL.md` directly for "
            "details instead of searching the filesystem for `SKILL.md`.\n\n"
            "### Pipeline UID\n"
            "The UID of the Pipeline this session was started for is "
            f"**`{pipeline_uid}`**. Pass it when reading tasks from this "
            f"pipeline, e.g. `get-task {pipeline_uid}`."
        )

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
                    "session_uid": self.session_uid,
                    "start_time": (
                        self.start_time.isoformat() if self.start_time else None
                    ),
                    "model": self.model,
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
                    "session_uid": self.session_uid,
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
                    "session_uid": self.session_uid,
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
        if self.session_uid and self.should_persist:
            try:
                await self.capture_session_identity()
            except Exception:  # pragma: no cover - defensive
                logger.warning(
                    "Failed to capture interactive Pi session identity for %s",
                    self.session_uid,
                    exc_info=True,
                )
        await self._broadcast_started()
        return process

    async def resume_interactive(self, cwd: Optional[str] = None):
        """Respawn Pi with the stored session file and re-apply the system prompt.

        Identical to :meth:`start_interactive`; named separately for call-site
        clarity and to bump the manager's ``resume_count``.
        """
        return await self.start_interactive(cwd=cwd)

    async def _handle_event(self, event: Dict[str, Any]):
        """Push text deltas for the active turn and mark settled turns.

        The raw event is additionally broadcast so the reused PiView can render
        it structurally. ``agent_end`` is deliberately ignored: it only marks the
        end of one low-level run and retries/compaction can still follow.
        ``agent_settled`` is the signal that Pi will not continue automatically.
        """
        event_type = event.get("type")
        if self.event_log is not None:
            self.event_log.append(event)
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
