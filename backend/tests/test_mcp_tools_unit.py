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
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from ajapopaja_mcp.server import (
    complete_task,
    get_next_task,
    get_task_details,
    get_task_status,
    search_tasks,
    update_task_design_doc,
)


@pytest.mark.asyncio
async def test_search_tasks_unit():
    mock_task = MagicMock()
    mock_task.id = "task-id"
    mock_task.title = "Search Result"
    mock_task.status = "scheduled"
    mock_task.spec = "Some spec"
    mock_task.version = 1

    with (
        patch("ajapopaja_mcp.server.init_db", new_callable=AsyncMock) as mock_init_db,
        patch(
            "ajapopaja_mcp.server.task_queries.search_tasks", new_callable=AsyncMock
        ) as mock_search,
    ):
        mock_search.return_value = ([mock_task], 1)

        result = await search_tasks(keywords="Search", statuses=["scheduled"])

        mock_init_db.assert_awaited_once()
        # Actual enum conversion is tested in integration tests.
        mock_search.assert_awaited_once()

        assert result["total_count"] == 1
        assert result["tasks"][0]["title"] == "Search Result"
        assert result["tasks"][0]["spec"] == "Some spec"


@pytest.mark.asyncio
async def test_get_task_details_unit():
    task_id = "task-id"
    mock_task = MagicMock()
    mock_task.id = task_id
    mock_task.title = "Task Title"
    mock_task.description = "Task Description"
    mock_task.status = "inprogress"
    mock_task.type = "manual"
    mock_task.spec = "Task Spec"
    mock_task.design_doc = "Design Doc"
    mock_task.want_design_doc = True
    mock_task.version = 2
    mock_task.commit_hash = "abc1234"
    mock_task.completion_info = "Completed info"
    mock_task.verification = {"success": True}
    mock_task.history = []
    mock_task.created_at.isoformat.return_value = "2024-01-01T00:00:00Z"
    mock_task.updated_at.isoformat.return_value = "2024-01-01T01:00:00Z"

    with (
        patch("ajapopaja_mcp.server.init_db", new_callable=AsyncMock) as mock_init_db,
        patch(
            "ajapopaja_mcp.server.task_queries.get_task_by_id", new_callable=AsyncMock
        ) as mock_get_task,
    ):
        mock_get_task.return_value = mock_task

        result = await get_task_details(task_id)

        mock_init_db.assert_awaited_once()
        mock_get_task.assert_awaited_once_with(task_id)
        assert result["id"] == task_id
        assert result["title"] == "Task Title"
        assert result["status"] == "inprogress"
        assert result["spec"] == "Task Spec"
        assert result["design_doc"] == "Design Doc"
        assert result["commit_hash"] == "abc1234"
        assert result["created_at"] == "2024-01-01T00:00:00Z"
        assert result["updated_at"] == "2024-01-01T01:00:00Z"


@pytest.mark.asyncio
async def test_get_next_task_unit():
    pipeline_id = "test-pipeline-id"
    mock_task = MagicMock()
    mock_task.id = "task-id"
    mock_task.title = "Task Title"
    mock_task.description = "Task Description"
    mock_task.design_doc = "Design Doc"
    mock_task.spec = "Task Spec"
    mock_task.want_design_doc = True
    mock_task.version = 1

    with (
        patch("ajapopaja_mcp.server.init_db", new_callable=AsyncMock) as mock_init_db,
        patch(
            "ajapopaja_mcp.server.task_queries.get_next_task", new_callable=AsyncMock
        ) as mock_get_next,
        patch(
            "ajapopaja_mcp.server.manager.notify_task_update", new_callable=AsyncMock
        ) as mock_notify,
    ):
        mock_get_next.return_value = mock_task

        result = await get_next_task(pipeline_id)

        mock_init_db.assert_awaited_once()
        mock_get_next.assert_awaited_once_with(pipeline_id, actor="mcp")
        mock_notify.assert_awaited_once_with("task-id")

        assert result["id"] == "task-id"
        assert result["title"] == "Task Title"
        assert result["design_doc_ready"] is True


@pytest.mark.asyncio
async def test_get_next_task_empty_unit():
    pipeline_id = "empty-pipeline"

    with (
        patch("ajapopaja_mcp.server.init_db", new_callable=AsyncMock) as mock_init_db,
        patch(
            "ajapopaja_mcp.server.task_queries.get_next_task", new_callable=AsyncMock
        ) as mock_get_next,
    ):
        mock_get_next.return_value = None

        result = await get_next_task(pipeline_id)

        mock_init_db.assert_awaited_once()
        assert "error" in result
        assert "No scheduled tasks found" in result["error"]


@pytest.mark.asyncio
async def test_update_task_design_doc_unit():
    task_id = "task-id"
    design_doc = "New Design"
    version = 1

    with (
        patch("ajapopaja_mcp.server.init_db", new_callable=AsyncMock) as mock_init_db,
        patch(
            "ajapopaja_mcp.server.task_queries.update_task_details",
            new_callable=AsyncMock,
        ) as mock_update,
        patch(
            "ajapopaja_mcp.server.manager.notify_task_update", new_callable=AsyncMock
        ) as mock_notify,
    ):
        result = await update_task_design_doc(task_id, design_doc, version)

        mock_init_db.assert_awaited_once()
        mock_update.assert_awaited_once_with(
            task_id=task_id, version=version, design_doc=design_doc
        )
        mock_notify.assert_awaited_once_with(task_id)
        assert "updated successfully" in result


@pytest.mark.asyncio
async def test_complete_task_unit():
    task_id = "task-id"
    commit_hash = "abcdef123456"
    completion_info = "Done"
    version = 1

    mock_task = MagicMock()
    mock_task.id = task_id
    mock_task.verification = {"success": True}

    with (
        patch("ajapopaja_mcp.server.init_db", new_callable=AsyncMock) as mock_init_db,
        patch(
            "ajapopaja_mcp.server.task_queries.complete_task", new_callable=AsyncMock
        ) as mock_complete,
        patch(
            "ajapopaja_mcp.server.manager.notify_task_update", new_callable=AsyncMock
        ) as mock_notify,
        patch(
            "ajapopaja_mcp.server.DocBotManager.process_completed_task",
            new_callable=AsyncMock,
        ) as mock_docbot,
    ):
        mock_complete.return_value = mock_task

        result = await complete_task(task_id, commit_hash, completion_info, version)

        mock_init_db.assert_awaited_once()
        mock_complete.assert_awaited_once_with(
            task_id=task_id,
            version=version,
            commit_hash=commit_hash,
            completion_info=completion_info,
            actor="mcp",
        )
        mock_notify.assert_awaited_once_with(task_id)

        # DocBot is triggered via asyncio.create_task, so it might not be awaited yet.
        # But since we patched it as AsyncMock, we can check if it was called.
        # We might need to give the event loop a chance to run.
        await asyncio.sleep(0)
        mock_docbot.assert_called_once_with(mock_task)

        assert "completed successfully" in result


@pytest.mark.asyncio
async def test_get_task_status_unit():
    task_id = "task-id"
    mock_task = MagicMock()
    mock_task.id = task_id
    mock_task.status = "inprogress"
    mock_task.version = 2
    mock_task.verification = None

    with (
        patch("ajapopaja_mcp.server.init_db", new_callable=AsyncMock) as mock_init_db,
        patch(
            "ajapopaja_mcp.server.task_queries.get_task_by_id", new_callable=AsyncMock
        ) as mock_get_task,
    ):
        mock_get_task.return_value = mock_task

        result = await get_task_status(task_id)

        mock_init_db.assert_awaited_once()
        mock_get_task.assert_awaited_once_with(task_id)
        assert result["id"] == task_id
        assert result["status"] == "inprogress"
