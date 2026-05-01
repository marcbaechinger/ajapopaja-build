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
from unittest.mock import patch

import pytest

import api.assistant.tools.nvim_tools as nvim_tools
from api.assistant.tool_registry import ToolRegistry


@pytest.fixture(autouse=True)
def reset_nvim_cache():
    """Reset the module-level cache before and after each test."""
    nvim_tools._nvim_available = None
    yield
    nvim_tools._nvim_available = None


def test_is_nvim_available_no_file():
    with patch("os.path.exists", return_value=False):
        assert nvim_tools.is_nvim_available() is False


def test_is_nvim_available_not_a_socket():
    with patch("os.path.exists", return_value=True):
        with patch("os.stat") as mock_stat:
            # Not a socket (e.g., a regular file)
            mock_stat.return_value.st_mode = stat.S_IFREG
            assert nvim_tools.is_nvim_available() is False


def test_is_nvim_available_success():
    with patch("os.path.exists", return_value=True):
        with patch("os.stat") as mock_stat:
            # A socket
            mock_stat.return_value.st_mode = stat.S_IFSOCK
            assert nvim_tools.is_nvim_available() is True


def test_is_nvim_available_caching():
    with patch("os.path.exists") as mock_exists:
        mock_exists.return_value = True
        with patch("os.stat") as mock_stat:
            mock_stat.return_value.st_mode = stat.S_IFSOCK

            # First call triggers check
            assert nvim_tools.is_nvim_available() is True
            assert mock_exists.call_count == 1

            # Second call uses cache
            assert nvim_tools.is_nvim_available() is True
            assert mock_exists.call_count == 1


def test_tool_registry_filtering():
    registry = ToolRegistry()

    # Tool 1: Always available
    def tool1():
        pass

    registry.register_tool(tool1, name="tool1")

    # Tool 2: Conditionally available (True)
    def tool2():
        pass

    registry.register_tool(tool2, name="tool2", is_available=lambda: True)

    # Tool 3: Conditionally available (False)
    def tool3():
        pass

    registry.register_tool(tool3, name="tool3", is_available=lambda: False)

    available_tools = registry.list_tools()
    names = [t.name for t in available_tools]

    assert "tool1" in names
    assert "tool2" in names
    assert "tool3" not in names
    assert len(available_tools) == 2


def test_nvim_tools_registered_with_availability():
    # This test checks if the actual nvim tools in nvim_tools.py
    # are registered with the is_nvim_available function.
    # We check the global registry.
    from api.assistant.tool_registry import registry

    tool = registry.get_tool("nvim_open_file")
    assert tool is not None
    assert tool.is_available == nvim_tools.is_nvim_available
