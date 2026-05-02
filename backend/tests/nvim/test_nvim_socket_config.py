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

import os
import socket
from unittest.mock import patch

import pytest

from api.assistant.tools import nvim_tools
from api.bot.tool_registry import registry


@pytest.fixture(autouse=True)
def clear_env():
    """Clear NVIM_SOCKET from environment before each test."""
    original = os.environ.get("NVIM_SOCKET")
    if "NVIM_SOCKET" in os.environ:
        del os.environ["NVIM_SOCKET"]
    # Also reset the cache in nvim_tools
    nvim_tools._nvim_available = None
    yield
    if original is not None:
        os.environ["NVIM_SOCKET"] = original
    else:
        if "NVIM_SOCKET" in os.environ:
            del os.environ["NVIM_SOCKET"]
    nvim_tools._nvim_available = None


def test_default_socket_path():
    assert nvim_tools.get_nvim_socket_path() == "/tmp/nvimsocket"


def test_custom_socket_path():
    custom_path = "/tmp/custom_nvim_socket"
    os.environ["NVIM_SOCKET"] = custom_path
    assert nvim_tools.get_nvim_socket_path() == custom_path


def test_is_nvim_available_uses_custom_path():
    custom_path = "/tmp/custom_nvim_socket"
    os.environ["NVIM_SOCKET"] = custom_path

    with patch("os.path.exists") as mock_exists:
        mock_exists.return_value = False
        nvim_tools.is_nvim_available()
        mock_exists.assert_called_with(custom_path)


def test_tool_registry_includes_nvim_tools_when_socket_present(tmp_path):
    # Create a dummy socket
    sock_path = tmp_path / "nvim.sock"
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.bind(str(sock_path))

    os.environ["NVIM_SOCKET"] = str(sock_path)

    try:
        # tool registry list_tools should include nvim tools if socket is available
        tools = registry.list_tools()
        names = [t.name for t in tools]
        assert "nvim_open_file" in names
    finally:
        s.close()
        if sock_path.exists():
            sock_path.unlink()


def test_tool_registry_excludes_nvim_tools_when_socket_absent():
    # Set to a path that definitely doesn't exist
    os.environ["NVIM_SOCKET"] = "/tmp/definitely_not_there_12345"

    tools = registry.list_tools()
    names = [t.name for t in tools]
    assert "nvim_open_file" not in names
