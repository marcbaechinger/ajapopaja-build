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

import stat
from unittest.mock import MagicMock, patch

import msgpack
import pytest

from api.assistant.tools import nvim_tools
from api.assistant.tools.nvim_tools import (
    nvim_open_file,
    nvim_open_selection,
    nvim_set_quickfix,
    nvim_show_diff,
)
from core.models.models import Pipeline


@pytest.fixture(autouse=True)
def reset_nvim_cache():
    """Reset the module-level cache before and after each test."""
    nvim_tools._nvim_available = None
    yield
    nvim_tools._nvim_available = None


@pytest.mark.asyncio
async def test_nvim_open_file_success(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline", workspace_path="/tmp/test_ws")
    await pipeline.insert()
    pipeline_id = str(pipeline.id)

    # Mock os.path.exists and os.stat for the socket
    with patch("os.path.exists", return_value=True), patch("os.stat") as mock_stat:
        mock_stat.return_value.st_mode = stat.S_IFSOCK
        # Mock socket.socket
        mock_socket_instance = MagicMock()
        mock_socket_instance.__enter__.return_value = mock_socket_instance
        # Response format: [type, msgid, error, result] (Type 1 is Response)
        mock_socket_instance.recv.return_value = msgpack.packb([1, 1, None, None])

        with patch("socket.socket", return_value=mock_socket_instance):
            result = await nvim_open_file(pipeline_id, "src/main.py", 10)

            assert result["success"] is True, f"Error: {result.get('error')}"
            mock_socket_instance.connect.assert_called_with("/tmp/nvimsocket")

            # Verify command sent
            sent_data = mock_socket_instance.sendall.call_args[0][0]
            payload = msgpack.unpackb(sent_data)
            # Request format: [type, msgid, method, params] (Type 0 is Request)
            assert payload[0] == 0
            assert payload[2] == "nvim_command"
            assert "src/main.py" in payload[3][0]
            assert "10" in payload[3][0]


@pytest.mark.asyncio
async def test_nvim_open_file_no_socket(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline", workspace_path="/tmp/test_ws")
    await pipeline.insert()
    pipeline_id = str(pipeline.id)

    with patch("os.path.exists", return_value=False):
        result = await nvim_open_file(pipeline_id, "src/main.py")
        assert result["success"] is False
        assert "Neovim socket not found" in result["error"]


@pytest.mark.asyncio
async def test_nvim_set_quickfix_success(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline", workspace_path="/tmp/test_ws")
    await pipeline.insert()
    pipeline_id = str(pipeline.id)

    matches = [
        {"filename": "src/main.py", "lnum": 10, "text": "error 1"},
        {"filename": "src/utils.py", "lnum": 5, "text": "error 2"},
    ]

    with patch("os.path.exists", return_value=True), patch("os.stat") as mock_stat:
        mock_stat.return_value.st_mode = stat.S_IFSOCK
        mock_socket_instance = MagicMock()
        mock_socket_instance.__enter__.return_value = mock_socket_instance
        mock_socket_instance.recv.return_value = msgpack.packb([1, 1, None, None])

        with patch("socket.socket", return_value=mock_socket_instance):
            result = await nvim_set_quickfix(pipeline_id, matches, "Test Results")

            assert result["success"] is True, f"Error: {result.get('error')}"
            mock_socket_instance.connect.assert_called_with("/tmp/nvimsocket")

            # Verify payload
            sent_data = mock_socket_instance.sendall.call_args[0][0]
            payload = msgpack.unpackb(sent_data)
            assert payload[2] == "nvim_exec_lua"
            assert len(payload[3]) == 2

            # Verify paths were resolved
            passed_matches = payload[3][1][0]
            passed_title = payload[3][1][1]
            assert passed_title == "Test Results"
            assert passed_matches[0]["filename"] == "/tmp/test_ws/src/main.py"
            assert passed_matches[1]["filename"] == "/tmp/test_ws/src/utils.py"


@pytest.mark.asyncio
async def test_nvim_show_diff_success(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline", workspace_path="/tmp/test_ws")
    await pipeline.insert()
    pipeline_id = str(pipeline.id)

    with (
        patch("os.path.exists", return_value=True),
        patch("os.path.isfile", return_value=True),
        patch("os.stat") as mock_stat,
    ):
        mock_stat.return_value.st_mode = stat.S_IFSOCK
        mock_socket_instance = MagicMock()
        mock_socket_instance.__enter__.return_value = mock_socket_instance
        mock_socket_instance.recv.return_value = msgpack.packb([1, 1, None, None])

        with patch("socket.socket", return_value=mock_socket_instance):
            result = await nvim_show_diff(pipeline_id, "src/main.py", "HEAD~1")

            assert result["success"] is True, f"Error: {result.get('error')}"

            # Verify payload
            sent_data = mock_socket_instance.sendall.call_args[0][0]
            payload = msgpack.unpackb(sent_data)
            assert payload[2] == "nvim_exec_lua"
            lua_script = payload[3][0]
            assert "DiffviewOpen HEAD~1^..HEAD~1 -- src/main.py" in lua_script
            assert "cd /tmp/test_ws" in lua_script


@pytest.mark.asyncio
async def test_nvim_show_diff_file_not_found(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline", workspace_path="/tmp/test_ws")
    await pipeline.insert()
    pipeline_id = str(pipeline.id)

    with patch("os.path.exists", return_value=False):
        result = await nvim_show_diff(pipeline_id, "non-existent.py")
        assert result["success"] is False
        assert "File does not exist" in result["error"]


@pytest.mark.asyncio
async def test_nvim_show_diff_not_a_file(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline", workspace_path="/tmp/test_ws")
    await pipeline.insert()
    pipeline_id = str(pipeline.id)

    with (
        patch("os.path.exists", return_value=True),
        patch("os.path.isfile", return_value=False),
    ):
        result = await nvim_show_diff(pipeline_id, "some_directory")
        assert result["success"] is False
        assert "Path is not a file" in result["error"]


@pytest.mark.asyncio
async def test_nvim_show_diff_invalid_path(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline", workspace_path="/tmp/test_ws")
    await pipeline.insert()
    pipeline_id = str(pipeline.id)

    result = await nvim_show_diff(pipeline_id, "../../outside.py")
    assert result["success"] is False
    assert "Invalid path" in result["error"]


@pytest.mark.asyncio
async def test_nvim_open_selection_success(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline", workspace_path="/tmp/test_ws")
    await pipeline.insert()
    pipeline_id = str(pipeline.id)

    with patch("os.path.exists", return_value=True), patch("os.stat") as mock_stat:
        mock_stat.return_value.st_mode = stat.S_IFSOCK
        mock_socket_instance = MagicMock()
        mock_socket_instance.__enter__.return_value = mock_socket_instance
        mock_socket_instance.recv.return_value = msgpack.packb([1, 1, None, None])

        with patch("socket.socket", return_value=mock_socket_instance):
            result = await nvim_open_selection(pipeline_id, "src/main.py", 10, 15)

            assert result["success"] is True, f"Error: {result.get('error')}"
            mock_socket_instance.connect.assert_called_with("/tmp/nvimsocket")

            sent_data = mock_socket_instance.sendall.call_args[0][0]
            payload = msgpack.unpackb(sent_data)
            assert payload[0] == 0
            assert payload[2] == "nvim_command"
            assert "src/main.py" in payload[3][0]
            assert "10" in payload[3][0]
            assert "normal! V15G" in payload[3][0]
