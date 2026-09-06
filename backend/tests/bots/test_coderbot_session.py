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

from api.coderbot.session import CoderBotSession
from core import config
from core.models.models import Pipeline, Task, TaskStatus


@pytest.fixture(autouse=True)
def enable_logging():
    original = config.BASEBOT_LOG_ENABLED
    config.BASEBOT_LOG_ENABLED = True
    yield
    config.BASEBOT_LOG_ENABLED = original


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

        session = CoderBotSession(pipeline_id=str(pipeline.id), task_id=str(task.id))

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
