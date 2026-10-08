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

from core import config


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
                    with patch(
                        "api.routes.system.check_pi_available", new_callable=AsyncMock
                    ) as mock_pi:
                        mock_pi.return_value = True

                        response = await async_client.get("/api/system/health")
                        assert response.status_code == status.HTTP_200_OK
                        data = response.json()
                        assert data["mongodb"]["status"] == "ok"
                        assert data["ollama"]["status"] == "ok"
                        assert data["nvim"]["status"] == "ok"
                        assert data["pi"]["status"] == "ok"


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
                        with patch(
                            "api.routes.system.check_pi_available",
                            new_callable=AsyncMock,
                        ) as mock_pi:
                            mock_pi.return_value = False
                            response = await async_client.get("/api/system/health")
                            assert response.status_code == status.HTTP_200_OK
                            data = response.json()
                            assert data["mongodb"]["status"] == "error"
                            assert data["ollama"]["status"] == "error"
                            assert data["nvim"]["status"] == "error"
                            assert data["pi"]["status"] == "error"


@pytest.mark.asyncio
async def test_config_properties_redact_secrets(
    async_client, init_mock_db, monkeypatch
):
    monkeypatch.setattr(config, "OLLAMA_API_KEY", "super-secret-api-key")
    monkeypatch.setattr(config, "GIT_PUSH_TOKEN", "")

    response = await async_client.get("/api/system/config")
    assert response.status_code == status.HTTP_200_OK

    properties = response.json()["properties"]
    by_key = {entry["key"]: entry for entry in properties}

    # A stored secret only reveals that it is stored, never its value.
    assert by_key["OLLAMA_API_KEY"]["confidential"] is True
    assert by_key["OLLAMA_API_KEY"]["value"] == "(stored)"

    # An empty secret is reported as unavailable.
    assert by_key["GIT_PUSH_TOKEN"]["confidential"] is True
    assert by_key["GIT_PUSH_TOKEN"]["value"] == "(not available)"

    # Regular properties expose their value.
    assert by_key["OLLAMA_MODEL"]["confidential"] is False
    assert by_key["OLLAMA_MODEL"]["value"]

    # The full response must never contain the secret value.
    assert "super-secret-api-key" not in response.text


@pytest.mark.asyncio
async def test_config_properties_cover_all_config_constants(async_client, init_mock_db):
    response = await async_client.get("/api/system/config")
    assert response.status_code == status.HTTP_200_OK

    keys = {entry["key"] for entry in response.json()["properties"]}
    # Spot-check a representative cross-section of the configuration.
    assert "WORKSPACES_ROOT" in keys
    assert "IGNORED_DIRECTORIES" in keys
    assert "BASEBOT_LOG_ENABLED" in keys
    assert "DEV_SERVER_PORT" in keys
