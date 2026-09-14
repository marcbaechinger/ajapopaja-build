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

import pytest

from api.coderbot.session import DEFAULT_TEST_COMMANDS, CoderBotSession
from api.websocket_manager import WSMessage
from core import config
from core.models.models import (
    Pipeline,
    PullRequest,
    PullRequestStatus,
    Task,
    TaskStatus,
)


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

            mock_proc = AsyncMock()
            mock_proc.stdin = MagicMock()
            mock_proc.stdin.write = MagicMock()
            mock_proc.stdin.drain = AsyncMock()
            mock_proc.stdin.can_write_eof.return_value = True
            mock_proc.stdin.write_eof = MagicMock()

            # Simulate stdout returning a single 'agent_end' event
            async def mock_stdout_stream():
                yield (
                    json.dumps({"type": "agent_end", "messages": []}).encode("utf-8")
                    + b"\n"
                )

            mock_proc.stdout.__aiter__.side_effect = lambda: mock_stdout_stream()
            mock_proc.wait = AsyncMock()

            mock_exec.return_value = mock_proc

            await session.run()

            mock_helper_cls.assert_called_once()
            mock_helper.setup_sandbox.assert_called_once()

            # Check subprocess was created with 'pi', 10MB limit and stderr redirect
            # Default model is None, so --model flag is omitted
            mock_exec.assert_called_once_with(
                "pi",
                "--mode",
                "rpc",
                "--no-session",
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
                cwd=str(mock_helper.sandbox_path),
                limit=10 * 1024 * 1024,
            )

            # Verify stdin was written to
            mock_proc.stdin.write.assert_called_once()
            written_data = mock_proc.stdin.write.call_args[0][0].decode("utf-8")
            assert "prompt" in written_data
            assert "Test Task" in written_data

            # Verify EOF was signaled
            mock_proc.stdin.write_eof.assert_called_once()
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

            mock_proc = AsyncMock()
            mock_proc.stdin = MagicMock()
            mock_proc.stdin.write = MagicMock()
            mock_proc.stdin.drain = AsyncMock()
            mock_proc.stdin.can_write_eof.return_value = True
            mock_proc.stdin.write_eof = MagicMock()

            async def mock_stdout_stream():
                yield (
                    json.dumps({"type": "agent_end", "messages": []}).encode("utf-8")
                    + b"\n"
                )

            mock_proc.stdout.__aiter__.side_effect = lambda: mock_stdout_stream()
            mock_proc.wait = AsyncMock()

            mock_exec.return_value = mock_proc

            await session.run()

            # Check subprocess was created with the injected --model flag
            mock_exec.assert_called_once_with(
                "pi",
                "--mode",
                "rpc",
                "--no-session",
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

        mock_proc = AsyncMock()
        mock_proc.stdin = MagicMock()
        mock_proc.stdin.write = MagicMock()
        mock_proc.stdin.drain = AsyncMock()

        # Simulate stdout returning one event
        async def mock_stdout_stream():
            yield json.dumps({"type": "agent_start"}).encode("utf-8") + b"\n"
            yield (
                json.dumps({"type": "agent_end", "messages": []}).encode("utf-8")
                + b"\n"
            )

        mock_proc.stdout.__aiter__.side_effect = lambda: mock_stdout_stream()
        mock_proc.wait = AsyncMock()
        mock_exec.return_value = mock_proc

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

        mock_proc = AsyncMock()
        mock_proc.stdin = MagicMock()
        mock_proc.stdin.write = MagicMock()
        mock_proc.stdin.drain = AsyncMock()
        mock_proc.stdin.can_write_eof.return_value = True
        mock_proc.stdin.write_eof = MagicMock()

        async def mock_stdout_stream():
            yield (
                json.dumps({"type": "agent_end", "messages": []}).encode("utf-8")
                + b"\n"
            )

        mock_proc.stdout.__aiter__.side_effect = lambda: mock_stdout_stream()
        mock_proc.wait = AsyncMock()
        mock_exec.return_value = mock_proc

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
        "api.coderbot.session.asyncio.create_subprocess_exec",
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
            "api.coderbot.session.asyncio.create_subprocess_exec",
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
        patch(
            "core.queries.task.transition_task", new_callable=AsyncMock
        ) as mock_transition,
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

    # The PR must be created with an annotated summary flagging the failure.
    prs = await PullRequest.find(PullRequest.task_id == str(task.id)).to_list()
    assert len(prs) == 1
    assert "Verification" in prs[0].summary
    assert "FAILED" in prs[0].summary
    assert "boom output" in prs[0].summary

    # The pull request status is recorded.
    assert prs[0].status == PullRequestStatus.OPEN


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
