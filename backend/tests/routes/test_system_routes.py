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
