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

import json
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import status

from core.models.models import Task, TaskStatus, User


@pytest.mark.asyncio
async def test_open_quickfix_success(async_client, init_mock_db):
    from api.auth import get_current_user
    from api.main import app

    mock_user = User(
        username="testuser", email="test@example.com", hashed_password="pw"
    )
    app.dependency_overrides[get_current_user] = lambda: mock_user

    try:
        with (
            patch(
                "api.routes.editor_commands.task_queries.get_task_by_id",
                new_callable=AsyncMock,
            ) as mock_get,
            patch(
                "api.routes.editor_commands.git_commit_hunks", new_callable=AsyncMock
            ) as mock_git,
            patch(
                "api.routes.editor_commands.nvim_set_quickfix", new_callable=AsyncMock
            ) as mock_nvim,
        ):
            task = Task(
                title="Fix Bug",
                pipeline_id="p1",
                status=TaskStatus.IMPLEMENTED,
                commit_hash="sha123",
            )
            mock_get.return_value = task
            hunks = [
                {
                    "file": "src/main.py",
                    "first_line": 10,
                    "last_line": 12,
                    "type": "change",
                }
            ]
            mock_git.return_value = json.dumps(hunks)
            mock_nvim.return_value = {"success": True}

            response = await async_client.post("/api/editor/quickfix/t1")

            assert response.status_code == status.HTTP_200_OK
            assert response.json() == {"status": "ok"}

            mock_git.assert_called_once_with("p1", "sha123")
            mock_nvim.assert_called_once()
            args, kwargs = mock_nvim.call_args
            assert args[0] == "p1"
            assert args[1] == [
                {"filename": "src/main.py", "lnum": 10, "text": "[change] Fix Bug"}
            ]
            assert kwargs["title"] == "Task: Fix Bug"
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_call_quickfix_success(async_client, init_mock_db):
    from api.auth import get_current_user
    from api.main import app

    mock_user = User(
        username="testuser", email="test@example.com", hashed_password="pw"
    )
    app.dependency_overrides[get_current_user] = lambda: mock_user

    try:
        with (
            patch(
                "api.routes.editor_commands.task_queries.get_task_by_id",
                new_callable=AsyncMock,
            ) as mock_get,
            patch(
                "api.routes.editor_commands.git_commit_hunks", new_callable=AsyncMock
            ) as mock_git,
            patch(
                "api.routes.editor_commands.nvim_set_quickfix", new_callable=AsyncMock
            ) as mock_nvim,
        ):
            task = Task(
                title="Fix Bug",
                pipeline_id="p1",
                status=TaskStatus.IMPLEMENTED,
                commit_hash="sha123",
            )
            mock_get.return_value = task
            hunks = [
                {
                    "file": "src/main.py",
                    "first_line": 10,
                    "last_line": 12,
                    "type": "change",
                }
            ]
            mock_git.return_value = json.dumps(hunks)
            mock_nvim.return_value = {"success": True}

            response = await async_client.post(
                "/api/editor/call/quickfix", json={"task_id": "t1"}
            )

            assert response.status_code == status.HTTP_200_OK
            assert response.json() == {"status": "ok"}

            mock_git.assert_called_once_with("p1", "sha123")
            mock_nvim.assert_called_once()
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_call_unknown_command(async_client, init_mock_db):
    from api.auth import get_current_user
    from api.main import app

    app.dependency_overrides[get_current_user] = lambda: AsyncMock()

    try:
        response = await async_client.post(
            "/api/editor/call/unknown", json={"task_id": "t1"}
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        assert "Unknown editor command" in response.json()["detail"]
    finally:
        app.dependency_overrides.clear()
