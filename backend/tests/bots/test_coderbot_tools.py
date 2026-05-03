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

from unittest.mock import MagicMock, patch

import pytest

from api.coderbot import tools
from core.models.models import Pipeline, PullRequest


@pytest.mark.asyncio
async def test_write_file_tool(tmp_path, monkeypatch):
    monkeypatch.setattr("core.config.SANDBOX_ROOT", tmp_path)
    task_id = "task1"
    sandbox_path = tmp_path / task_id
    sandbox_path.mkdir()

    res = await tools.write_file("p1", task_id, "test.txt", "hello world")
    assert "Successfully wrote to test.txt" in res
    assert (sandbox_path / "test.txt").read_text() == "hello world"


@pytest.mark.asyncio
async def test_write_file_partially_tool(tmp_path, monkeypatch):
    monkeypatch.setattr("core.config.SANDBOX_ROOT", tmp_path)
    task_id = "task2"
    sandbox_path = tmp_path / task_id
    sandbox_path.mkdir()
    test_file = sandbox_path / "test.txt"
    test_file.write_text("hello world")

    res = await tools.write_file_partially("p1", task_id, "test.txt", "world", "coder")
    assert "Successfully updated test.txt" in res
    assert test_file.read_text() == "hello coder"


@pytest.mark.asyncio
async def test_task_completed_tool(init_mock_db, tmp_path, monkeypatch):
    monkeypatch.setattr("core.config.SANDBOX_ROOT", tmp_path)

    pipeline = Pipeline(name="Test Pipeline", workspace_path="test")
    await pipeline.insert()

    task_id = "task3"
    sandbox_path = tmp_path / task_id
    sandbox_path.mkdir()

    with patch("api.coderbot.tools.SandboxGitHelper") as mock_helper_cls:
        mock_helper = MagicMock()
        mock_helper_cls.return_value = mock_helper
        mock_helper.get_patch.return_value = "fake patch"
        mock_helper.branch_name = "coderbot/task3"

        res = await tools.task_completed(str(pipeline.id), task_id, "Done!")
        assert "Pull Request created successfully" in res

        pr = await PullRequest.find_one(PullRequest.task_id == task_id)
        assert pr is not None
        assert pr.summary == "Done!"
        assert pr.patch == "fake patch"
        mock_helper.cleanup.assert_called_once()


@pytest.mark.asyncio
async def test_path_validation_invalid_paths(tmp_path, monkeypatch):
    monkeypatch.setattr("core.config.SANDBOX_ROOT", tmp_path)
    task_id = "task4"

    # Absolute path
    res = await tools.write_file("p1", task_id, "/etc/passwd", "evil")
    assert "Security error" in res

    # Directory traversal
    res = await tools.write_file("p1", task_id, "../outside.txt", "evil")
    assert "Security error" in res

    # Valid path should work
    res = await tools.write_file("p1", task_id, "subdir/ok.txt", "good")
    assert "Successfully wrote to subdir/ok.txt" in res
    sandbox_path = (tmp_path / task_id).resolve()
    assert (sandbox_path / "subdir/ok.txt").exists()


@pytest.mark.asyncio
async def test_path_validation_exhaustive(tmp_path, monkeypatch):
    monkeypatch.setattr("core.config.SANDBOX_ROOT", tmp_path)
    task_id = "task_edge"

    # Leading slash
    res = await tools.write_file("p1", task_id, "/root_file.txt", "content")
    assert "Security error" in res

    # Empty string path
    res = await tools.write_file("p1", task_id, "", "content")
    assert "Relative path cannot be empty or root." in res

    # Dot path
    res = await tools.write_file("p1", task_id, ".", "content")
    assert "Relative path cannot be empty or root." in res

    # Extremely long path component
    long_name = "a" * 300
    res = await tools.write_file("p1", task_id, long_name, "content")
    assert ("Error writing file" in res) or ("Security error" in res)

    # Complex traversal
    res = await tools.write_file_partially(
        "p1", task_id, "a/../../etc/passwd", "old", "new"
    )
    assert "Security error" in res

    # Re-testing partially with invalid path
    res = await tools.write_file_partially("p1", task_id, "/abs/path", "old", "new")
    assert "Security error" in res


@pytest.mark.asyncio
async def test_task_completed_robust_cleanup(init_mock_db, tmp_path, monkeypatch):
    monkeypatch.setattr("core.config.SANDBOX_ROOT", tmp_path)

    pipeline = Pipeline(name="Test Pipeline", workspace_path="test")
    await pipeline.insert()

    task_id = "task_cleanup_fail"
    sandbox_path = tmp_path / task_id
    sandbox_path.mkdir()

    with (
        patch("api.coderbot.tools.SandboxGitHelper") as mock_helper_cls,
        patch("api.coderbot.tools.PullRequest.insert") as mock_insert,
    ):
        mock_helper = MagicMock()
        mock_helper_cls.return_value = mock_helper
        mock_helper.get_patch.return_value = "fake patch"
        mock_helper.branch_name = "coderbot/task_cleanup_fail"

        # Simulate DB failure during PR insertion
        mock_insert.side_effect = Exception("DB Connection Failed")

        res = await tools.task_completed(
            str(pipeline.id), task_id, "Attempting work..."
        )

        assert "Error completing task" in res
        assert "DB Connection Failed" in res

        # Verify cleanup was still called despite the exception
        mock_helper.cleanup.assert_called_once()
