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

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import status


@pytest.mark.asyncio
async def test_health_check_all_ok(async_client, init_mock_db):
    with patch(
        "api.routes.system.AsyncMongoClient", new_callable=MagicMock
    ) as mock_client_cls:
        mock_client = AsyncMock()
        mock_client.admin.command = AsyncMock()
        mock_client_cls.return_value = mock_client

        with patch(
            "api.routes.system.is_ollama_available", new_callable=AsyncMock
        ) as mock_ollama:
            mock_ollama.return_value = True
            with patch("api.routes.system.is_nvim_available") as mock_nvim:
                mock_nvim.return_value = True
                with patch("api.routes.system.get_nvim_socket_path") as mock_socket:
                    mock_socket.return_value = "/tmp/nvim.sock"

                    response = await async_client.get("/api/system/health")
                    assert response.status_code == status.HTTP_200_OK
                    data = response.json()
                    assert data["mongodb"]["status"] == "ok"
                    assert data["ollama"]["status"] == "ok"
                    assert data["nvim"]["status"] == "ok"


@pytest.mark.asyncio
async def test_health_check_mixed_status(async_client, init_mock_db):
    with patch("api.routes.system.AsyncMongoClient", side_effect=Exception("DB Down")):
        with patch(
            "api.routes.system.is_ollama_available", new_callable=AsyncMock
        ) as mock_ollama:
            mock_ollama.return_value = False
            with patch("api.routes.system.is_nvim_available") as mock_nvim:
                mock_nvim.return_value = False
                with patch("api.routes.system.get_nvim_socket_path") as mock_socket:
                    mock_socket.return_value = "/tmp/nvim.sock"
                    with patch("os.path.exists", return_value=False):
                        response = await async_client.get("/api/system/health")
                        assert response.status_code == status.HTTP_200_OK
                        data = response.json()
                        assert data["mongodb"]["status"] == "error"
                        assert data["ollama"]["status"] == "error"
                        assert data["nvim"]["status"] == "error"


@pytest.mark.asyncio
async def test_get_git_status_ok(async_client, init_mock_db):
    pipeline_id = "p1"
    mock_pipeline = MagicMock()
    mock_pipeline.workspace_abs_path = "/tmp/workspace"

    with patch(
        "api.routes.system.pipeline_queries.get_pipeline_by_id", new_callable=AsyncMock
    ) as mock_get:
        mock_get.return_value = mock_pipeline
        with patch("api.routes.system.git.Repo") as mock_repo_cls:
            mock_repo = MagicMock()
            mock_repo.git.status.return_value = (
                "M  file1.txt\n M file2.txt\n?? file3.txt\nAM file4.txt"
            )
            mock_repo_cls.return_value = mock_repo

            response = await async_client.get(f"/api/system/git-status/{pipeline_id}")
            assert response.status_code == status.HTTP_200_OK
            data = response.json()
            # file1: M  -> staged:1, unstaged:0
            # file2:  M -> staged:0, unstaged:1
            # file3: ?? -> untracked:1
            # file4: AM -> staged:1, unstaged:1
            assert data["staged"] == 2
            assert data["unstaged"] == 2
            assert data["untracked"] == 1
