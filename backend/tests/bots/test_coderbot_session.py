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
from unittest.mock import AsyncMock, MagicMock, patch

import git
import pytest

from api.coderbot.session import DEFAULT_TEST_COMMANDS, CoderBotSession
from api.websocket_manager import WSMessage
from core import config
from core.models.models import (
    Pipeline,
    PiSession,
    PiSessionKind,
    PiSessionStatus,
    PullRequest,
    PullRequestStatus,
    Task,
    TaskStatus,
)


class _FakeStdin:
    """Minimal stdin double that feeds a matching response + scripted events."""

    def __init__(self, process):
        self._process = process
        self.writes = []
        self.eof = False

    def write(self, data):
        self.writes.append(data)
        self._process.feed_for(data)

    async def drain(self):
        pass

    def can_write_eof(self):
        return True

    def write_eof(self):
        self.eof = True

    def close(self):
        self.eof = True

    def is_closing(self):
        return self.eof


class _FakeStdout:
    def __init__(self, process):
        self._process = process

    async def readline(self):
        return await self._process.next_line()


class FakePiProcess:
    """Fake Pi process that acknowledges commands and yields scripted events."""

    def __init__(self, events=None):
        self._queue = asyncio.Queue()
        self._events = list(events or [])
        self._events_sent = False
        self.stdin = _FakeStdin(self)
        self.stdout = _FakeStdout(self)
        self.returncode = None
        self.pid = 4242
        self.terminated = False

    def feed_for(self, data):
        command = json.loads(data.decode("utf-8"))
        self._queue.put_nowait(
            (
                json.dumps(
                    {
                        "id": command.get("id"),
                        "type": "response",
                        "command": command.get("type"),
                        "success": True,
                    }
                )
                + "\n"
            ).encode("utf-8")
        )
        # Only the actual run (the ``prompt`` command) emits the scripted events
        # and closes stdout. Session-identity capture sends ``get_state`` first;
        # closing the stream there would make the following ``prompt`` wait for
        # the full command timeout without ever being acknowledged.
        if command.get("type") == "prompt" and not self._events_sent:
            self._events_sent = True
            for event in self._events:
                self._queue.put_nowait((json.dumps(event) + "\n").encode("utf-8"))
            # Signal EOF so the background read loop terminates.
            self._queue.put_nowait(b"")

    async def next_line(self):
        return await self._queue.get()

    async def wait(self):
        self.returncode = 0
        return 0

    def terminate(self):
        self.terminated = True
        self.returncode = -15


@pytest.fixture(autouse=True)
def enable_logging():
    original = config.BASEBOT_LOG_ENABLED
    config.BASEBOT_LOG_ENABLED = True
    yield
    config.BASEBOT_LOG_ENABLED = original


@pytest.mark.asyncio
async def test_coderbot_broadcasts_rpc_event(init_mock_db):
    """Each parsed Pi RPC event is forwarded to clients as CODERBOT_RPC_EVENT."""
    session = CoderBotSession(pipeline_id="p1", task_id="t1")
    with patch(
        "api.coderbot.session.ws_manager.broadcast", new_callable=AsyncMock
    ) as mock_broadcast:
        await session._broadcast_rpc({"type": "agent_settled"})

        mock_broadcast.assert_awaited_once()
        msg = mock_broadcast.await_args.args[0]
        assert msg.type == "CODERBOT_RPC_EVENT"
        assert msg.payload["bot_type"] == "coderbot"
        assert msg.payload["task_id"] == "t1"
        assert msg.payload["pipeline_id"] == "p1"
        assert msg.payload["event"] == {"type": "agent_settled"}


@pytest.mark.asyncio
async def test_coderbot_session_initialization(init_mock_db):
    task = Task(
        title="Test Task",
        pipeline_id="some_id",
        design_doc="Design",
        spec="Spec",
    )

    session = CoderBotSession(pipeline_id="some_id", task_id="some_task_id")

    prompt = await session.get_initial_prompt(task)

    assert "Test Task" in prompt
    assert "Design" in prompt
    assert "Spec" in prompt


@pytest.mark.asyncio
async def test_coderbot_run_spawns_pi(init_mock_db):
    pipeline = Pipeline(
        name="Test Pipeline", workspace_path="test", workspace_abs_path="/tmp"
    )
    await pipeline.insert()

    task = Task(
        title="Test Task",
        pipeline_id=str(pipeline.id),
        design_doc="Design",
        spec="Spec",
    )
    await task.insert()

    original_run_tests = config.CODERBOT_RUN_TESTS
    config.CODERBOT_RUN_TESTS = False
    try:
        with (
            patch("api.coderbot.session.SandboxGitHelper") as mock_helper_cls,
            patch("api.coderbot.session.ws_manager.broadcast", new_callable=AsyncMock),
            patch("api.coderbot.session.asyncio.create_subprocess_exec") as mock_exec,
            patch("builtins.open", MagicMock()),
            patch("pathlib.Path.mkdir"),
        ):
            mock_helper = MagicMock()
            mock_helper.branch_name = "test-branch"
            mock_helper.get_patch.return_value = "test-patch"
            mock_repo = MagicMock()
            mock_repo.git.diff.return_value = "test-patch"
            mock_repo.git.show.return_value = "diff --git a/file b/file\n+new line"
            mock_helper.get_repo.return_value = mock_repo
            mock_helper_cls.return_value = mock_helper

            session = CoderBotSession(
                pipeline_id=str(pipeline.id), task_id=str(task.id)
            )

            fake_proc = FakePiProcess(events=[{"type": "agent_end", "messages": []}])
            mock_exec.return_value = fake_proc

            await session.run()

            mock_helper_cls.assert_called_once()
            mock_helper.setup_sandbox.assert_called_once()

            # Check subprocess was created with 'pi', 10MB limit and stderr redirect
            # Default model is None, so --model flag is omitted
            mock_exec.assert_called_once_with(
                "pi",
                "--mode",
                "rpc",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                cwd=str(mock_helper.sandbox_path),
                limit=10 * 1024 * 1024,
            )

            # Verify stdin was written to
            assert len(fake_proc.stdin.writes) == 1
            written_data = fake_proc.stdin.writes[0].decode("utf-8")
            assert "prompt" in written_data
            assert "Test Task" in written_data

            # Verify EOF was signaled
            assert fake_proc.stdin.eof is True
    finally:
        config.CODERBOT_RUN_TESTS = original_run_tests


@pytest.mark.asyncio
async def test_coderbot_run_seeds_session_label_from_task_title(init_mock_db):
    """A batch session without a label gets the task title when it runs."""
    pipeline = Pipeline(
        name="Test Pipeline", workspace_path="test", workspace_abs_path="/tmp"
    )
    await pipeline.insert()

    task = Task(
        title="Seed the session label",
        pipeline_id=str(pipeline.id),
        design_doc="Design",
        spec="Spec",
    )
    await task.insert()

    record = PiSession(
        uid="u-label",
        kind=PiSessionKind.CODERBOT,
        status=PiSessionStatus.STARTING,
        pipeline_id=str(pipeline.id),
        task_id=str(task.id),
        bot_type="coderbot",
    )
    await record.insert()

    original_run_tests = config.CODERBOT_RUN_TESTS
    config.CODERBOT_RUN_TESTS = False
    try:
        with (
            patch("api.coderbot.session.SandboxGitHelper") as mock_helper_cls,
            patch("api.coderbot.session.ws_manager.broadcast", new_callable=AsyncMock),
            patch("api.coderbot.session.asyncio.create_subprocess_exec") as mock_exec,
            patch("builtins.open", MagicMock()),
            patch("pathlib.Path.mkdir"),
        ):
            mock_helper = MagicMock()
            mock_helper.branch_name = "test-branch"
            mock_helper.get_patch.return_value = "test-patch"
            mock_repo = MagicMock()
            mock_repo.git.diff.return_value = "test-patch"
            # A real hash so the completed session record can be serialized
            # (``base_commit`` is typed ``Optional[str]``).
            mock_repo.head.commit.hexsha = "a" * 40
            mock_helper.get_repo.return_value = mock_repo
            mock_helper_cls.return_value = mock_helper

            session = CoderBotSession(
                pipeline_id=str(pipeline.id),
                task_id=str(task.id),
                session_uid=record.uid,
                session_record=record,
            )

            fake_proc = FakePiProcess(events=[{"type": "agent_end", "messages": []}])
            mock_exec.return_value = fake_proc

            await session.run()

            reloaded = await PiSession.find_one(PiSession.uid == record.uid)
            assert reloaded is not None
            assert reloaded.label == "Seed the session label"
    finally:
        config.CODERBOT_RUN_TESTS = original_run_tests


@pytest.mark.asyncio
async def test_coderbot_run_with_model_includes_model_flag(init_mock_db):
    pipeline = Pipeline(
        name="Test Pipeline", workspace_path="test", workspace_abs_path="/tmp"
    )
    await pipeline.insert()

    task = Task(
        title="Test Task",
        pipeline_id=str(pipeline.id),
        design_doc="Design",
        spec="Spec",
    )
    await task.insert()

    original_run_tests = config.CODERBOT_RUN_TESTS
    config.CODERBOT_RUN_TESTS = False
    try:
        with (
            patch("api.coderbot.session.SandboxGitHelper") as mock_helper_cls,
            patch("api.coderbot.session.ws_manager.broadcast", new_callable=AsyncMock),
            patch("api.coderbot.session.asyncio.create_subprocess_exec") as mock_exec,
            patch("builtins.open", MagicMock()),
            patch("pathlib.Path.mkdir"),
        ):
            mock_helper = MagicMock()
            mock_helper.branch_name = "test-branch"
            mock_helper.get_patch.return_value = "test-patch"
            mock_repo = MagicMock()
            mock_repo.git.diff.return_value = "test-patch"
            mock_repo.git.show.return_value = "diff --git a/file b/file\n+new line"
            mock_helper.get_repo.return_value = mock_repo
            mock_helper_cls.return_value = mock_helper

            session = CoderBotSession(
                pipeline_id=str(pipeline.id),
                task_id=str(task.id),
                model="custom-model:cloud",
            )

            fake_proc = FakePiProcess(events=[{"type": "agent_end", "messages": []}])
            mock_exec.return_value = fake_proc

            await session.run()

            # Check subprocess was created with the injected --model flag
            mock_exec.assert_called_once_with(
                "pi",
                "--mode",
                "rpc",
                "--model",
                "custom-model:cloud",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                cwd=str(mock_helper.sandbox_path),
                limit=10 * 1024 * 1024,
            )
    finally:
        config.CODERBOT_RUN_TESTS = original_run_tests


@pytest.mark.asyncio
async def test_coderbot_run_logs_events(init_mock_db):
    pipeline = Pipeline(
        name="Test Pipeline", workspace_path="test", workspace_abs_path="/tmp"
    )
    await pipeline.insert()

    task = Task(
        title="Test Task",
        pipeline_id=str(pipeline.id),
        design_doc="Design",
        spec="Spec",
    )
    await task.insert()

    with (
        patch("api.coderbot.session.SandboxGitHelper") as mock_helper_cls,
        patch("api.coderbot.session.ws_manager.broadcast", new_callable=AsyncMock),
        patch("api.coderbot.session.asyncio.create_subprocess_exec") as mock_exec,
        patch("builtins.open", new_callable=MagicMock) as mock_open,
        patch("pathlib.Path.mkdir"),
    ):
        mock_helper = MagicMock()
        mock_helper.branch_name = "test-branch"
        mock_helper.get_patch.return_value = "test-patch"
        mock_repo = MagicMock()
        mock_repo.git.diff.return_value = "test-patch"
        mock_repo.git.show.return_value = "diff --git a/file b/file\n+new line"
        mock_helper.get_repo.return_value = mock_repo
        mock_helper_cls.return_value = mock_helper

        session = CoderBotSession(pipeline_id=str(pipeline.id), task_id=str(task.id))

        fake_proc = FakePiProcess(
            events=[{"type": "agent_start"}, {"type": "agent_end", "messages": []}]
        )
        mock_exec.return_value = fake_proc

        await session.run()

        # Verify log file was opened (initialization)
        assert mock_open.call_count >= 1

        # Check content of writes
        written_lines = []
        for call in mock_open.return_value.write.call_args_list:
            written_lines.append(json.loads(call[0][0].strip()))

        assert any(record["type"] == "session_start" for record in written_lines)
        assert any(
            record["type"] == "pi_rpc_event"
            and record["event"]["type"] == "agent_start"
            for record in written_lines
        )
        assert any(record["type"] == "session_end" for record in written_lines)


@pytest.mark.asyncio
async def test_coderbot_run_logs_error_with_traceback(init_mock_db):
    """Test that errors in run() include full stack traces."""
    pipeline = Pipeline(
        name="Test Pipeline", workspace_path="test", workspace_abs_path="/tmp"
    )
    await pipeline.insert()

    task = Task(
        title="Test Task",
        pipeline_id=str(pipeline.id),
        design_doc="Design",
        spec="Spec",
    )
    await task.insert()

    with (
        patch("api.coderbot.session.SandboxGitHelper") as mock_helper_cls,
        patch("api.coderbot.session.ws_manager.broadcast", new_callable=AsyncMock),
        patch("api.coderbot.session.asyncio.create_subprocess_exec") as mock_exec,
        patch("builtins.open", new_callable=MagicMock) as mock_open,
        patch("pathlib.Path.mkdir"),
    ):
        mock_helper = MagicMock()
        mock_helper_cls.return_value = mock_helper

        session = CoderBotSession(pipeline_id=str(pipeline.id), task_id=str(task.id))

        # Make subprocess creation raise an exception
        mock_exec.side_effect = RuntimeError("Failed to spawn subprocess")

        await session.run()

        # Check content of writes for error events
        written_lines = []
        for call in mock_open.return_value.write.call_args_list:
            written_lines.append(json.loads(call[0][0].strip()))

        # Find the error event
        error_events = [r for r in written_lines if r.get("type") == "error"]
        assert len(error_events) >= 1

        # Verify error event schema has both timestamp and error (stack trace) fields
        error_event = error_events[0]
        assert "timestamp" in error_event
        assert "error" in error_event
        # Verify the error field contains a stack trace
        assert "Traceback" in error_event["error"]
        assert "RuntimeError" in error_event["error"]
        assert "Failed to spawn subprocess" in error_event["error"]


@pytest.mark.asyncio
async def test_coderbot_run_transitions_task_state(init_mock_db):
    pipeline = Pipeline(
        name="Test Pipeline", workspace_path="test", workspace_abs_path="/tmp"
    )
    await pipeline.insert()

    task = Task(
        title="Test Task",
        pipeline_id=str(pipeline.id),
        design_doc="Design",
        spec="Spec",
        status=TaskStatus.SCHEDULED,
    )
    await task.insert()

    with (
        patch("api.coderbot.session.SandboxGitHelper") as mock_helper_cls,
        patch(
            "api.coderbot.session.ws_manager.broadcast", new_callable=AsyncMock
        ) as mock_broadcast,
        patch("api.coderbot.session.asyncio.create_subprocess_exec") as mock_exec,
        patch("builtins.open", MagicMock()),
        patch("pathlib.Path.mkdir"),
    ):
        mock_helper = MagicMock()
        mock_helper.branch_name = "test-branch"
        mock_helper.get_patch.return_value = "test-patch"
        mock_repo = MagicMock()
        mock_repo.git.diff.return_value = "test-patch"
        mock_repo.git.show.return_value = "diff --git a/file b/file\n+new line"
        mock_helper.get_repo.return_value = mock_repo
        mock_helper_cls.return_value = mock_helper

        session = CoderBotSession(pipeline_id=str(pipeline.id), task_id=str(task.id))

        fake_proc = FakePiProcess(events=[{"type": "agent_end", "messages": []}])
        mock_exec.return_value = fake_proc

        await session.run()

        # Reload the task and verify the state transitions were recorded.
        updated = await Task.get(str(task.id))
        assert updated.status == TaskStatus.PULL_REQUEST_AVAILABLE
        transitions = [(t.from_status, t.to_status, t.by) for t in updated.history]
        assert (TaskStatus.SCHEDULED, TaskStatus.INPROGRESS, "coderbot") in transitions
        assert (
            TaskStatus.INPROGRESS,
            TaskStatus.PULL_REQUEST_AVAILABLE,
            "coderbot",
        ) in transitions

        # The INPROGRESS transition must be broadcast so the UI moves the card.
        status_msgs = [
            c
            for c in mock_broadcast.await_args_list
            if isinstance(c.args[0], WSMessage)
            and c.args[0].type == "TASK_STATUS_UPDATED"
        ]
        assert status_msgs, "Expected a TASK_STATUS_UPDATED broadcast"
        assert any(
            msg.args[0].payload["status"] == TaskStatus.INPROGRESS
            and msg.args[0].payload["id"] == str(task.id)
            for msg in status_msgs
        )


@pytest.mark.asyncio
async def test_coderbot_initial_prompt_includes_test_instruction(init_mock_db):
    """The initial prompt must instruct Pi to run the full test suite."""
    task = Task(title="Test Task", pipeline_id="p1", design_doc="D", spec="S")
    session = CoderBotSession(pipeline_id="p1", task_id="t1")

    prompt = await session.get_initial_prompt(task)

    assert "uv run pytest" in prompt
    assert "CI=true npm run test" in prompt
    assert "run the full project" in prompt
    assert "test suite" in prompt


@pytest.mark.asyncio
async def test_coderbot_initial_prompt_includes_repo_scope(init_mock_db):
    """The initial prompt must confine Pi to the sandbox repository, naming the
    repository path and the branch and forbidding searches outside of it."""
    task = Task(title="Test Task", pipeline_id="p1", design_doc="D", spec="S")
    session = CoderBotSession(pipeline_id="p1", task_id="t1")
    session.helper = MagicMock()
    session.helper.sandbox_path = "/tmp/sandbox/coderbot/t1"
    session.helper.branch_name = "coderbot/t1"

    prompt = await session.get_initial_prompt(task)

    assert "Repository Scope" in prompt
    assert "/tmp/sandbox/coderbot/t1" in prompt
    assert "coderbot/t1" in prompt
    assert "MUST only search" in prompt
    assert "edit files within the repository" in prompt


def test_coderbot_repo_scope_instruction_without_helper():
    """Without a configured helper the scope block is still emitted (only the
    concrete path/branch are omitted)."""
    session = CoderBotSession(pipeline_id="p1", task_id="t1")
    instruction = session._build_repo_scope_instruction()
    assert "Repository Scope" in instruction
    assert "MUST only search" in instruction


@pytest.mark.asyncio
async def test_coderbot_iteration_prompt_includes_repo_scope(init_mock_db):
    """Iteration runs are confined to the repository just like initial runs."""
    task = Task(title="Test Task", pipeline_id="p1", design_doc="D", spec="S")
    pr = PullRequest(
        pipeline_id="p1",
        task_id="t1",
        subject="s",
        summary="",
        branch_name="coderbot/t1",
        patch="diff",
        status=PullRequestStatus.OPEN,
    )
    session = CoderBotSession(pipeline_id="p1", task_id="t1", pr=pr, comments="fix it")
    session.helper = MagicMock()
    session.helper.sandbox_path = "/tmp/sandbox/coderbot/t1"
    session.helper.branch_name = "coderbot/t1"

    prompt = await session.get_iteration_prompt(task)

    assert "Repository Scope" in prompt
    assert "/tmp/sandbox/coderbot/t1" in prompt
    assert "coderbot/t1" in prompt


def test_coderbot_get_verification_commands_defaults():
    """Without an override, the README-documented commands are used."""
    session = CoderBotSession(pipeline_id="p1", task_id="t1")
    with patch.object(config, "CODERBOT_TEST_COMMANDS_JSON", ""):
        commands = session._get_verification_commands()
    assert commands == list(DEFAULT_TEST_COMMANDS)
    assert any("uv run pytest" in " ".join(c) for c in commands)
    assert any("CI=true npm run test" in " ".join(c) for c in commands)


def test_coderbot_get_verification_commands_override():
    """A valid JSON override replaces the defaults."""
    session = CoderBotSession(pipeline_id="p1", task_id="t1")
    override = json.dumps([["pytest", "-q"]])
    with patch.object(config, "CODERBOT_TEST_COMMANDS_JSON", override):
        commands = session._get_verification_commands()
    assert commands == [["pytest", "-q"]]


def test_coderbot_get_verification_commands_invalid_override_falls_back():
    """An invalid override falls back to the defaults."""
    session = CoderBotSession(pipeline_id="p1", task_id="t1")
    with patch.object(config, "CODERBOT_TEST_COMMANDS_JSON", "not-json"):
        commands = session._get_verification_commands()
    assert commands == list(DEFAULT_TEST_COMMANDS)


def test_coderbot_pipeline_test_commands_override_global():
    """Per-pipeline test_commands take precedence over the global override."""
    session = CoderBotSession(pipeline_id="p1", task_id="t1")
    session.pipeline = MagicMock(test_commands=[["make", "test"]])
    with patch.object(config, "CODERBOT_TEST_COMMANDS_JSON", '[["global-cmd"]]'):
        assert session.get_resolved_verification_commands() == [["make", "test"]]
        # The explicit-arg form also honours the pipeline list when passed.
        assert session._get_verification_commands([["make", "test"]]) == [
            ["make", "test"]
        ]


def test_coderbot_pipeline_without_test_commands_uses_global():
    """A pipeline without test_commands falls back to the global override."""
    session = CoderBotSession(pipeline_id="p1", task_id="t1")
    session.pipeline = MagicMock(test_commands=None)
    with patch.object(config, "CODERBOT_TEST_COMMANDS_JSON", '[["global-cmd"]]'):
        assert session.get_resolved_verification_commands() == [["global-cmd"]]


def test_coderbot_pipeline_empty_test_commands_uses_global():
    """An empty pipeline test_commands list falls back to the global override."""
    session = CoderBotSession(pipeline_id="p1", task_id="t1")
    session.pipeline = MagicMock(test_commands=[])
    with patch.object(config, "CODERBOT_TEST_COMMANDS_JSON", '[["global-cmd"]]'):
        assert session.get_resolved_verification_commands() == [["global-cmd"]]


@pytest.mark.asyncio
async def test_coderbot_run_verification_aggregates_exit_codes():
    """_run_verification aggregates exit codes from all commands."""
    session = CoderBotSession(pipeline_id="p1", task_id="t1")
    session.helper = MagicMock()
    session.helper.sandbox_path = "/tmp/sandbox"

    success_proc = AsyncMock()
    success_proc.communicate = AsyncMock(return_value=(b"all green\n", b""))
    success_proc.returncode = 0

    fail_proc = AsyncMock()
    fail_proc.communicate = AsyncMock(return_value=(b"boom\n", b""))
    fail_proc.returncode = 1

    with patch(
        "api.assistant.tools.command_runner.asyncio.create_subprocess_exec",
        new_callable=AsyncMock,
        side_effect=[success_proc, fail_proc],
    ) as mock_exec:
        results = await session._run_verification()

    assert mock_exec.await_count == 2
    assert results["passed"] is False
    assert len(results["commands"]) == 2
    assert results["commands"][0]["exit_code"] == 0
    assert results["commands"][1]["exit_code"] == 1
    assert "boom" in results["commands"][1]["output_tail"]


@pytest.mark.asyncio
async def test_coderbot_run_verification_timeout_terminates_process_group():
    """A command that exceeds the timeout is killed (whole process group) and
    reported as a failure instead of hanging forever."""
    session = CoderBotSession(pipeline_id="p1", task_id="t1")
    session.helper = MagicMock()
    session.helper.sandbox_path = "/tmp/sandbox"
    # A single configured command, so the timeout path is exercised exactly once.
    session.pipeline = MagicMock(test_commands=[["npm", "run", "test"]])

    hung_proc = AsyncMock()
    hung_proc.pid = 4242
    hung_proc.communicate = AsyncMock(side_effect=asyncio.TimeoutError())
    hung_proc.returncode = None
    hung_proc.wait = AsyncMock(return_value=0)

    with (
        patch(
            "api.assistant.tools.command_runner.asyncio.create_subprocess_exec",
            new_callable=AsyncMock,
            return_value=hung_proc,
        ) as mock_exec,
        patch("os.killpg") as mock_killpg,
        patch.object(config, "CODERBOT_VERIFICATION_TIMEOUT", 3),
    ):
        results = await session._run_verification()

    # The command must have been spawned in its own process group so its
    # children can be killed together.
    assert mock_exec.await_count == 1
    kwargs = mock_exec.await_args.kwargs
    assert kwargs.get("start_new_session") is True

    # Both a SIGTERM and the escalation path must be attempted against the
    # process group.
    term_signals = [c.args for c in mock_killpg.call_args_list]
    assert (4242, 15) in term_signals  # SIGTERM

    # Verification must be reported as failed with a None exit code and a
    # timeout message, and no hang occurs.
    assert results["passed"] is False
    assert len(results["commands"]) == 1
    assert results["commands"][0]["exit_code"] is None
    assert "timed out" in results["commands"][0]["output_tail"]


def test_coderbot_resolves_build_and_lint_commands():
    """Build/lint/test categories resolve to the pipeline's own commands."""
    session = CoderBotSession(pipeline_id="p1", task_id="t1")
    session.pipeline = MagicMock(
        build_commands=[["make", "build"]],
        lint_commands=[["make", "lint"]],
        test_commands=[["make", "test"]],
    )
    assert session.get_resolved_build_commands() == [["make", "build"]]
    assert session.get_resolved_lint_commands() == [["make", "lint"]]
    assert session.get_resolved_verification_commands() == [["make", "test"]]


def test_coderbot_build_and_lint_have_no_default_fallback():
    """Build/lint are only run when the pipeline configures them; tests keep
    their global fallback."""
    session = CoderBotSession(pipeline_id="p1", task_id="t1")
    session.pipeline = MagicMock(
        build_commands=None, lint_commands=[], test_commands=None
    )
    with patch.object(config, "CODERBOT_TEST_COMMANDS_JSON", '[["global-test"]]'):
        assert session.get_resolved_build_commands() == []
        assert session.get_resolved_lint_commands() == []
        assert session.get_resolved_verification_commands() == [["global-test"]]


@pytest.mark.asyncio
async def test_coderbot_run_verification_runs_build_lint_test_in_order():
    """All configured categories run in build -> lint -> test order and every
    entry is tagged with its kind."""
    session = CoderBotSession(pipeline_id="p1", task_id="t1")
    session.helper = MagicMock()
    session.helper.sandbox_path = "/tmp/sandbox"
    session.pipeline = MagicMock(
        build_commands=[["make", "build"]],
        lint_commands=[["make", "lint"]],
        test_commands=[["make", "test"]],
    )

    def _ok_proc():
        proc = AsyncMock()
        proc.communicate = AsyncMock(return_value=(b"ok\n", b""))
        proc.returncode = 0
        return proc

    with patch(
        "api.assistant.tools.command_runner.asyncio.create_subprocess_exec",
        new_callable=AsyncMock,
        side_effect=[_ok_proc(), _ok_proc(), _ok_proc()],
    ) as mock_exec:
        results = await session._run_verification()

    # The full configured set ran, in the required order.
    assert [c.args[1] for c in mock_exec.await_args_list] == [
        "build",
        "lint",
        "test",
    ]
    assert results["passed"] is True
    assert [e["kind"] for e in results["commands"]] == ["build", "lint", "test"]


@pytest.mark.asyncio
async def test_coderbot_run_verification_tests_only_has_no_build_lint():
    """A tests-only pipeline runs exactly the test commands (no fallback build
    or lint) and tags them as tests."""
    session = CoderBotSession(pipeline_id="p1", task_id="t1")
    session.helper = MagicMock()
    session.helper.sandbox_path = "/tmp/sandbox"
    session.pipeline = MagicMock(
        build_commands=None,
        lint_commands=None,
        test_commands=[["make", "test"]],
    )

    ok_proc = AsyncMock()
    ok_proc.communicate = AsyncMock(return_value=(b"ok\n", b""))
    ok_proc.returncode = 0

    with patch(
        "api.assistant.tools.command_runner.asyncio.create_subprocess_exec",
        new_callable=AsyncMock,
        return_value=ok_proc,
    ) as mock_exec:
        results = await session._run_verification()

    assert mock_exec.await_count == 1
    assert mock_exec.await_args.args == ("make", "test")
    assert results["commands"][0]["kind"] == "test"


@pytest.mark.asyncio
async def test_coderbot_run_verification_failing_build_does_not_abort():
    """A failing build is reported but lint/test still run so one run gives the
    full picture."""
    session = CoderBotSession(pipeline_id="p1", task_id="t1")
    session.helper = MagicMock()
    session.helper.sandbox_path = "/tmp/sandbox"
    session.pipeline = MagicMock(
        build_commands=[["make", "build"]],
        lint_commands=[["make", "lint"]],
        test_commands=[["make", "test"]],
    )

    def _proc(exit_code, out):
        proc = AsyncMock()
        proc.communicate = AsyncMock(return_value=(out, b""))
        proc.returncode = exit_code
        return proc

    with patch(
        "api.assistant.tools.command_runner.asyncio.create_subprocess_exec",
        new_callable=AsyncMock,
        side_effect=[
            _proc(2, b"build broke\n"),
            _proc(0, b"lint ok\n"),
            _proc(0, b"tests ok\n"),
        ],
    ) as mock_exec:
        results = await session._run_verification()

    assert mock_exec.await_count == 3
    assert results["passed"] is False
    assert [e["kind"] for e in results["commands"]] == ["build", "lint", "test"]
    assert results["commands"][0]["exit_code"] == 2


def test_coderbot_test_instruction_lists_configured_categories():
    """The mandatory verification prompt groups and lists build/lint/test."""
    session = CoderBotSession(pipeline_id="p1", task_id="t1")
    session.pipeline = MagicMock(
        build_commands=[["make", "build"]],
        lint_commands=[["make", "lint"]],
        test_commands=[["make", "test"]],
    )
    instruction = session._build_test_instruction()
    assert "Mandatory Verification" in instruction
    assert "**Build**" in instruction
    assert "**Lint**" in instruction
    assert "**Test**" in instruction
    assert "`make build`" in instruction
    assert "`make lint`" in instruction
    assert "`make test`" in instruction


@pytest.mark.asyncio
async def test_coderbot_handle_agent_end_falls_back_after_first_commit(
    init_mock_db,
):
    """When the sandbox has only one commit (e.g. a freshly cloned empty repo),
    diffing against 'HEAD~1' fails; the patch should fall back to diffing the
    commit against the empty tree."""
    task = Task(title="Test Task", pipeline_id="p1", design_doc="D", spec="S")
    await task.insert()

    session = CoderBotSession(pipeline_id="p1", task_id=str(task.id))
    session.helper = MagicMock()
    session.helper.branch_name = "branch"

    repo = MagicMock()
    repo.git.add = MagicMock()
    repo.git.commit.return_value = "ok"  # commit succeeds

    def fake_diff(*args, **kwargs):
        if args[0] == "HEAD~1":
            raise Exception("fatal: ambiguous argument 'HEAD~1': unknown revision")
        return "fallback-patch"

    repo.git.diff.side_effect = fake_diff
    session.helper.get_repo.return_value = repo
    session.helper.get_patch.return_value = "unused"

    original = config.CODERBOT_RUN_TESTS
    config.CODERBOT_RUN_TESTS = False
    try:
        with (
            patch("api.coderbot.session.ws_manager.broadcast", new_callable=AsyncMock),
            patch(
                "api.coderbot.session.Task.get", new_callable=AsyncMock
            ) as mock_task_get,
            patch("core.queries.task.transition_task", new_callable=AsyncMock),
        ):
            mock_task_get.return_value = task
            await session._handle_agent_end(
                [
                    {
                        "role": "assistant",
                        "content": [{"type": "text", "text": "done."}],
                    }
                ]
            )
    finally:
        config.CODERBOT_RUN_TESTS = original

    # The fallback diff (against the empty tree) must have been produced.
    prs = await PullRequest.find(PullRequest.task_id == str(task.id)).to_list()
    assert len(prs) == 1
    assert prs[0].patch == "fallback-patch\n"  # newline appended by session.py
    # Ensure the fallback diff call used the empty tree as its base.
    calls = [c.args for c in repo.git.diff.call_args_list]
    assert ("4b825dc642cb6eb9a060e54bf8d69288fbee4904", "HEAD") in calls


@pytest.mark.asyncio
async def test_coderbot_handle_agent_end_runs_verification_and_annotates_pr(
    init_mock_db,
):
    """Verification runs before PR creation, broadcasts results and annotates
    the PR summary when a command fails."""
    task = Task(title="Test Task", pipeline_id="p1", design_doc="D", spec="S")
    await task.insert()

    session = CoderBotSession(pipeline_id="p1", task_id=str(task.id))
    session.helper = MagicMock()
    session.helper.branch_name = "branch"
    repo = MagicMock()
    repo.git.add = MagicMock()
    repo.git.commit.return_value = "ok"
    repo.git.diff.return_value = "test-patch"
    session.helper.get_repo.return_value = repo

    fail_proc = AsyncMock()
    fail_proc.communicate = AsyncMock(return_value=(b"boom output\n", b""))
    fail_proc.returncode = 1

    with (
        patch(
            "api.coderbot.session.asyncio.create_subprocess_exec",
            new_callable=AsyncMock,
            return_value=fail_proc,
        ),
        patch(
            "api.coderbot.session.ws_manager.broadcast", new_callable=AsyncMock
        ) as mock_broadcast,
        patch("api.coderbot.session.Task.get", new_callable=AsyncMock) as mock_task_get,
        patch("core.queries.task.transition_task", new_callable=AsyncMock),
    ):
        mock_task_get.return_value = task
        await session._handle_agent_end(
            [
                {
                    "role": "assistant",
                    "content": [{"type": "text", "text": "Task complete."}],
                }
            ]
        )

    # A CODERBOT_VERIFICATION event must be broadcast.
    verif_msgs = [
        c
        for c in mock_broadcast.await_args_list
        if isinstance(c.args[0], WSMessage)
        and c.args[0].type == "CODERBOT_VERIFICATION"
    ]
    assert verif_msgs, "Expected a CODERBOT_VERIFICATION broadcast"
    assert verif_msgs[0].args[0].payload["result"]["passed"] is False

    # A CODERBOT_VERIFICATION_STARTED event must be broadcast before the tests
    # run so the frontend can tell the user the verification is starting.
    started_msgs = [
        c
        for c in mock_broadcast.await_args_list
        if isinstance(c.args[0], WSMessage)
        and c.args[0].type == "CODERBOT_VERIFICATION_STARTED"
    ]
    assert started_msgs, "Expected a CODERBOT_VERIFICATION_STARTED broadcast"
    assert started_msgs[0].args[0].payload["task_id"] == str(task.id)
    assert started_msgs[0].args[0].payload["pipeline_id"] == "p1"

    # The start notification must be emitted before the verification itself.
    started_idx = next(
        i
        for i, c in enumerate(mock_broadcast.await_args_list)
        if isinstance(c.args[0], WSMessage)
        and c.args[0].type == "CODERBOT_VERIFICATION_STARTED"
    )
    verif_idx = next(
        i
        for i, c in enumerate(mock_broadcast.await_args_list)
        if isinstance(c.args[0], WSMessage)
        and c.args[0].type == "CODERBOT_VERIFICATION"
    )
    assert started_idx < verif_idx

    # The PR must be created with an annotated summary flagging the failure.
    prs = await PullRequest.find(PullRequest.task_id == str(task.id)).to_list()
    assert len(prs) == 1
    assert "Verification" in prs[0].summary
    assert "FAILED" in prs[0].summary
    assert "boom output" in prs[0].summary

    # The pull request status is recorded.
    assert prs[0].status == PullRequestStatus.OPEN


@pytest.mark.asyncio
async def test_coderbot_pr_summary_lists_verification_categories(
    init_mock_db,
):
    """The `### Verification` PR summary section tags every executed command
    with its category and flips to FAILED when any category fails."""
    task = Task(title="Test Task", pipeline_id="p1", design_doc="D", spec="S")
    await task.insert()

    session = CoderBotSession(pipeline_id="p1", task_id=str(task.id))
    session.pipeline = MagicMock(
        build_commands=[["make", "build"]],
        lint_commands=[["make", "lint"]],
        test_commands=[["make", "test"]],
    )
    session.helper = MagicMock()
    session.helper.branch_name = "branch"
    repo = MagicMock()
    repo.git.add = MagicMock()
    repo.git.commit.return_value = "ok"
    repo.git.diff.return_value = "test-patch"
    session.helper.get_repo.return_value = repo

    fail_proc = AsyncMock()
    fail_proc.communicate = AsyncMock(return_value=(b"build broke\n", b""))
    fail_proc.returncode = 1

    with (
        patch(
            "api.coderbot.session.asyncio.create_subprocess_exec",
            new_callable=AsyncMock,
            return_value=fail_proc,
        ),
        patch("api.coderbot.session.ws_manager.broadcast", new_callable=AsyncMock),
        patch("api.coderbot.session.Task.get", new_callable=AsyncMock) as mock_task_get,
        patch("core.queries.task.transition_task", new_callable=AsyncMock),
    ):
        mock_task_get.return_value = task
        await session._handle_agent_end(
            [
                {
                    "role": "assistant",
                    "content": [{"type": "text", "text": "done."}],
                }
            ]
        )

    prs = await PullRequest.find(PullRequest.task_id == str(task.id)).to_list()
    assert len(prs) == 1
    summary = prs[0].summary
    assert "### Verification" in summary
    assert "Status: **FAILED**" in summary
    assert "[build]" in summary
    assert "[lint]" in summary
    assert "[test]" in summary


@pytest.mark.asyncio
async def test_coderbot_handle_agent_end_reports_task_id_and_commit_hashes(
    init_mock_db,
):
    """The PR summary reports the task ID, the hash of the commit on which the
    verification ran (HEAD after CoderBot's commit) and the base commit hash on
    top of which the new commit was created."""
    task = Task(title="Test Task", pipeline_id="p1", design_doc="D", spec="S")
    await task.insert()

    session = CoderBotSession(pipeline_id="p1", task_id=str(task.id))
    session.helper = MagicMock()
    session.helper.branch_name = "branch"

    # Fake repo.head so the parent (first read) and head (second read) commit
    # hashes are distinct and deterministic, mirroring _handle_agent_end's
    # capture order.
    hashes = iter(["parent-base-hash", "verified-head-hash"])

    class _FakeCommit:
        def __init__(self, hexsha):
            self.hexsha = hexsha

    class _FakeHead:
        @property
        def commit(self):
            return _FakeCommit(next(hashes))

    repo = MagicMock()
    repo.git.add = MagicMock()
    repo.git.commit.return_value = "ok"
    repo.git.diff.return_value = "test-patch"
    repo.head = _FakeHead()
    session.helper.get_repo.return_value = repo

    ok_proc = AsyncMock()
    ok_proc.communicate = AsyncMock(return_value=(b"ok output\n", b""))
    ok_proc.returncode = 0

    with (
        patch(
            "api.coderbot.session.asyncio.create_subprocess_exec",
            new_callable=AsyncMock,
            return_value=ok_proc,
        ),
        patch("api.coderbot.session.ws_manager.broadcast", new_callable=AsyncMock),
        patch("api.coderbot.session.Task.get", new_callable=AsyncMock) as mock_task_get,
        patch("core.queries.task.transition_task", new_callable=AsyncMock),
    ):
        mock_task_get.return_value = task
        await session._handle_agent_end(
            [
                {
                    "role": "assistant",
                    "content": [{"type": "text", "text": "Task complete."}],
                }
            ]
        )

    prs = await PullRequest.find(PullRequest.task_id == str(task.id)).to_list()
    assert len(prs) == 1
    summary = prs[0].summary
    assert "### Verification" in summary
    assert f"Task ID: **{task.id}**" in summary
    assert "Verified commit (HEAD): `verified-head-hash`" in summary
    assert "Parent commit (base): `parent-base-hash`" in summary
    assert "Status: **PASSED**" in summary


@pytest.mark.asyncio
async def test_coderbot_handle_agent_end_skips_verification_when_disabled(
    init_mock_db,
):
    """When CODERBOT_RUN_TESTS is false, no verification runs and no
    CODERBOT_VERIFICATION event is emitted."""
    task = Task(title="Test Task", pipeline_id="p1", design_doc="D", spec="S")
    await task.insert()

    session = CoderBotSession(pipeline_id="p1", task_id=str(task.id))
    session.helper = MagicMock()
    session.helper.branch_name = "branch"
    repo = MagicMock()
    repo.git.add = MagicMock()
    repo.git.commit.return_value = "ok"
    repo.git.diff.return_value = "test-patch"
    session.helper.get_repo.return_value = repo

    original = config.CODERBOT_RUN_TESTS
    config.CODERBOT_RUN_TESTS = False
    try:
        with (
            patch(
                "api.coderbot.session.asyncio.create_subprocess_exec",
                new_callable=AsyncMock,
                side_effect=AssertionError("should not be called"),
            ),
            patch(
                "api.coderbot.session.ws_manager.broadcast", new_callable=AsyncMock
            ) as mock_broadcast,
            patch(
                "api.coderbot.session.Task.get", new_callable=AsyncMock
            ) as mock_task_get,
            patch("core.queries.task.transition_task", new_callable=AsyncMock),
        ):
            mock_task_get.return_value = task
            await session._handle_agent_end(
                [
                    {
                        "role": "assistant",
                        "content": [{"type": "text", "text": "done."}],
                    }
                ]
            )

        verif_msgs = [
            c
            for c in mock_broadcast.await_args_list
            if isinstance(c.args[0], WSMessage)
            and c.args[0].type == "CODERBOT_VERIFICATION"
        ]
        assert not verif_msgs, "No CODERBOT_VERIFICATION event expected"
    finally:
        config.CODERBOT_RUN_TESTS = original


@pytest.mark.asyncio
async def test_coderbot_iteration_prompt_includes_comments_and_instruction(
    init_mock_db,
):
    """The iteration prompt carries the task info, the user's review comments,
    the alternative iteration instruction and the verification block, and does
    not regress the initial prompt."""
    task = Task(
        title="Iterate me",
        pipeline_id="p1",
        design_doc="Design doc",
        spec="Spec text",
    )
    pr = PullRequest(
        pipeline_id="p1",
        task_id="t1",
        subject="Iterate me",
        summary="",
        branch_name="coderbot/t1",
        patch="diff --git a/a b/a\n+change\n",
        status=PullRequestStatus.OPEN,
    )
    session = CoderBotSession(
        pipeline_id="p1", task_id="t1", pr=pr, comments="Please fix the edge case."
    )

    prompt = await session.get_iteration_prompt(task)

    assert "Iterate me" in prompt
    assert "Spec text" in prompt
    assert "Design doc" in prompt
    assert "Please fix the edge case." in prompt
    assert "Review Comments" in prompt
    assert "Current Patch Present as Unstaged Changes" in prompt
    assert "Iteration" in prompt
    assert "uv run pytest" in prompt
    assert "CI=true npm run test" in prompt

    # The initial prompt must remain unchanged (no comments / iteration text).
    initial = await session.get_initial_prompt(task)
    assert "Please fix the edge case." not in initial
    assert "Current Patch Present as Unstaged Changes" not in initial


def test_coderbot_iteration_instruction_mentions_unstaged_patch():
    pr = PullRequest(
        pipeline_id="p1",
        task_id="t1",
        subject="s",
        summary="",
        branch_name="coderbot/t1",
        patch="diff",
        status=PullRequestStatus.OPEN,
    )
    session = CoderBotSession(pipeline_id="p1", task_id="t1", pr=pr)
    instruction = session.get_iteration_instruction()
    assert "unstaged changes" in instruction
    assert "review" in instruction.lower()


def test_coderbot_iteration_mode_flag():
    assert (
        CoderBotSession(
            pipeline_id="p1", task_id="t1", pr=MagicMock(), comments="cc"
        ).iteration_mode
        is True
    )
    assert CoderBotSession(pipeline_id="p1", task_id="t1").iteration_mode is False


@pytest.mark.asyncio
async def test_coderbot_apply_existing_patch_applies_without_commit(init_mock_db):
    """_apply_existing_patch invokes git apply --3way with the PR patch and does
    not leave anything committed (no git commit call)."""
    session = CoderBotSession(pipeline_id="p1", task_id="t1")
    session.helper = MagicMock()
    repo = MagicMock()
    session.helper.get_repo.return_value = repo

    pr = PullRequest(
        pipeline_id="p1",
        task_id="t1",
        subject="s",
        summary="",
        branch_name="coderbot/t1",
        patch="diff --git a/a b/a\n+change",
        status=PullRequestStatus.OPEN,
    )
    session.pr = pr

    with patch("api.coderbot.session.tempfile.NamedTemporaryFile") as mock_tmp:
        mock_tmp.return_value.__enter__.return_value.name = "/tmp/iter.patch"
        session._apply_existing_patch()

    # The patch file content was written via the tempfile handle.
    handle = mock_tmp.return_value.__enter__.return_value
    handle.write.assert_called_once_with("diff --git a/a b/a\n+change\n")
    # git apply --3way is used, and no commit is issued.
    repo.git.apply.assert_called_once_with("--3way", "/tmp/iter.patch")
    repo.git.commit.assert_not_called()


@pytest.mark.asyncio
async def test_coderbot_apply_existing_patch_propagates_git_error(init_mock_db):
    """When the stored patch no longer applies (concurrent edit to the same
    files), git.exc.GitCommandError propagates so the session fails cleanly
    rather than proceeding on a corrupt tree."""
    session = CoderBotSession(pipeline_id="p1", task_id="t1")
    session.helper = MagicMock()
    repo = MagicMock()
    session.helper.get_repo.return_value = repo

    pr = PullRequest(
        pipeline_id="p1",
        task_id="t1",
        subject="s",
        summary="",
        branch_name="coderbot/t1",
        patch="diff --git a/a b/a\n+change",
        status=PullRequestStatus.OPEN,
    )
    session.pr = pr
    repo.git.apply.side_effect = git.exc.GitCommandError("apply", 1)

    with (
        patch("api.coderbot.session.tempfile.NamedTemporaryFile") as mock_tmp,
        pytest.raises(git.exc.GitCommandError),
    ):
        mock_tmp.return_value.__enter__.return_value.name = "/tmp/iter.patch"
        session._apply_existing_patch()


@pytest.mark.asyncio
async def test_coderbot_apply_existing_patch_requires_pr_patch(init_mock_db):
    session = CoderBotSession(pipeline_id="p1", task_id="t1")
    session.helper = MagicMock()
    session.pr = PullRequest(
        pipeline_id="p1",
        task_id="t1",
        subject="s",
        summary="",
        branch_name="coderbot/t1",
        patch="",
        status=PullRequestStatus.OPEN,
    )
    with pytest.raises(ValueError):
        session._apply_existing_patch()


@pytest.mark.asyncio
async def test_coderbot_handle_agent_end_updates_existing_pr(init_mock_db):
    """In iteration mode _handle_agent_end updates the existing PR (same id)
    with the new patch, subject, summary, branch and updated_at, rather than
    inserting a new one, and broadcasts PULL_REQUEST_CREATED."""
    task = Task(title="Iterated Task", pipeline_id="p1", design_doc="D", spec="S")
    await task.insert()

    pr = PullRequest(
        pipeline_id="p1",
        task_id=str(task.id),
        subject="old",
        summary="old summary",
        branch_name="coderbot/t1",
        patch="old patch",
        status=PullRequestStatus.OPEN,
    )
    await pr.insert()

    session = CoderBotSession(
        pipeline_id="p1",
        task_id=str(task.id),
        pr=pr,
        comments="Make it better",
    )
    session.iteration_mode = True
    session.helper = MagicMock()
    session.helper.branch_name = "coderbot/t1"
    repo = MagicMock()
    repo.git.add = MagicMock()
    repo.git.commit.return_value = "ok"
    repo.git.diff.return_value = "new patch!"
    session.helper.get_repo.return_value = repo

    original_run_tests = config.CODERBOT_RUN_TESTS
    config.CODERBOT_RUN_TESTS = False
    try:
        with (
            patch(
                "api.coderbot.session.ws_manager.broadcast", new_callable=AsyncMock
            ) as mock_broadcast,
            patch(
                "api.coderbot.session.Task.get", new_callable=AsyncMock
            ) as mock_task_get,
            patch("core.queries.task.transition_task", new_callable=AsyncMock),
        ):
            mock_task_get.return_value = task
            await session._handle_agent_end(
                [
                    {
                        "role": "assistant",
                        "content": [{"type": "text", "text": "Revised."}],
                    }
                ]
            )
    finally:
        config.CODERBOT_RUN_TESTS = original_run_tests

    # The PR must be updated with the new content on the same id.
    prs = await PullRequest.find(PullRequest.task_id == str(task.id)).to_list()
    assert len(prs) == 1
    updated = prs[0]
    assert str(updated.id) == str(pr.id)
    assert updated.patch == "new patch!\n"
    assert updated.subject == "Iterated Task"
    assert "Revised." in updated.summary
    assert updated.branch_name == "coderbot/t1"
    # updated_at is refreshed when the PR is rewritten.
    assert updated.updated_at is not None

    # PULL_REQUEST_CREATED is broadcast with the same pr id.
    created_msgs = [
        c
        for c in mock_broadcast.await_args_list
        if isinstance(c.args[0], WSMessage) and c.args[0].type == "PULL_REQUEST_CREATED"
    ]
    assert created_msgs, "Expected a PULL_REQUEST_CREATED broadcast"
    assert created_msgs[0].args[0].payload["id"] == str(pr.id)
