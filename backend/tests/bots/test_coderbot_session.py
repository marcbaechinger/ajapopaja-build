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
from core.models.models import Pipeline, Task


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

    session = CoderBotSession(pipeline_id=str(pipeline.id), task_id=str(task.id))

    with (
        patch("api.coderbot.session.SandboxGitHelper") as mock_helper_cls,
        patch("api.coderbot.session.ws_manager.broadcast", new_callable=AsyncMock),
        patch("api.coderbot.session.asyncio.create_subprocess_exec") as mock_exec,
    ):
        mock_helper = MagicMock()
        mock_helper.branch_name = "test-branch"
        mock_helper.get_patch.return_value = "test-patch"
        mock_repo = MagicMock()
        mock_repo.git.diff.return_value = "test-patch"
        mock_repo.git.show.return_value = "diff --git a/file b/file\n+new line"
        mock_helper.get_repo.return_value = mock_repo
        mock_helper_cls.return_value = mock_helper

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

    session = CoderBotSession(pipeline_id=str(pipeline.id), task_id=str(task.id))

    with (
        patch("api.coderbot.session.SandboxGitHelper") as mock_helper_cls,
        patch("api.coderbot.session.ws_manager.broadcast", new_callable=AsyncMock),
        patch("api.coderbot.session.asyncio.create_subprocess_exec") as mock_exec,
        patch("builtins.open", new_callable=MagicMock) as mock_open,
        patch("pathlib.Path.mkdir"),
    ):
        mock_helper = MagicMock()
        mock_helper_cls.return_value = mock_helper

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

        # Verify log file was opened multiple times (start, events, end)
        assert mock_open.call_count >= 4  # start, agent_start, agent_end, session_end

        # Check content of one of the writes
        written_lines = []
        for call in mock_open.return_value.__enter__.return_value.write.call_args_list:
            written_lines.append(json.loads(call[0][0].strip()))

        assert any(record["type"] == "session_start" for record in written_lines)
        assert any(
            record["type"] == "pi_rpc_event"
            and record["event"]["type"] == "agent_start"
            for record in written_lines
        )
        assert any(record["type"] == "session_end" for record in written_lines)
