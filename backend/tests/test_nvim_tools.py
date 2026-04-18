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

import pytest
import os
import json
import socket
from unittest.mock import patch, MagicMock, AsyncMock
from api.assistant.tools.nvim_tools import open_file_in_nvim
from core.models.models import Pipeline
from pathlib import Path

@pytest.mark.asyncio
async def test_open_file_in_nvim_success(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline", workspace_path="/tmp/test_ws")
    await pipeline.insert()
    pipeline_id = str(pipeline.id)

    # Mock os.path.exists for the socket
    with patch("os.path.exists", return_value=True):
        # Mock socket.socket
        mock_socket_instance = MagicMock()
        mock_socket_instance.__enter__.return_value = mock_socket_instance
        mock_socket_instance.recv.return_value = json.dumps({"jsonrpc": "2.0", "result": None, "id": 1}).encode("utf-8")
        
        with patch("socket.socket", return_value=mock_socket_instance):
            result = await open_file_in_nvim(pipeline_id, "src/main.py", 10)
            
            assert result["success"] is True, f"Error: {result.get('error')}"
            mock_socket_instance.connect.assert_called_with("/tmp/nvimsocket")
            
            # Verify command sent
            sent_data = mock_socket_instance.sendall.call_args[0][0].decode("utf-8")
            payload = json.loads(sent_data)
            assert payload["method"] == "nvim_command"
            assert "src/main.py" in payload["params"][0]
            assert "10" in payload["params"][0]

@pytest.mark.asyncio
async def test_open_file_in_nvim_no_socket(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline", workspace_path="/tmp/test_ws")
    await pipeline.insert()
    pipeline_id = str(pipeline.id)

    with patch("os.path.exists", return_value=False):
        result = await open_file_in_nvim(pipeline_id, "src/main.py")
        assert result["success"] is False
        assert "Neovim socket not found" in result["error"]
