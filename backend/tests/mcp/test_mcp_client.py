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

"""Tests for the standalone MCP CLI client scripts.

The canonical client and its JSON-RPC helper live under
``backend/mcp/src/scripts`` and are not an installed package, so they are loaded
directly from their file paths.
"""

import importlib.util
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

SCRIPTS_DIR = Path(__file__).resolve().parents[2] / "mcp" / "src" / "scripts"


def _load_script(name: str, module_name: str):
    if str(SCRIPTS_DIR) not in sys.path:
        sys.path.insert(0, str(SCRIPTS_DIR))
    spec = importlib.util.spec_from_file_location(
        module_name, SCRIPTS_DIR / f"{name}.py"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


mcp_rpc = _load_script("mcp_rpc", "_test_mcp_rpc")
mcp_client = _load_script("mcp_client", "_test_mcp_client")


@pytest.mark.asyncio
async def test_run_create_pull_request_maps_arguments():
    client = MagicMock()
    client.call_tool = AsyncMock()

    await mcp_client.run_create_pull_request(client, "p1", "Add feature", "Body", "t1")

    client.call_tool.assert_awaited_once_with(
        "create_pull_request",
        {"pipeline_id": "p1", "title": "Add feature", "body": "Body", "task_id": "t1"},
    )


@pytest.mark.asyncio
async def test_run_create_pull_request_task_optional():
    client = MagicMock()
    client.call_tool = AsyncMock()

    await mcp_client.run_create_pull_request(client, "p1", "Add feature")

    client.call_tool.assert_awaited_once_with(
        "create_pull_request",
        {"pipeline_id": "p1", "title": "Add feature", "body": ""},
    )


class _FakeResponse:
    status_code = 200
    headers: dict = {}

    async def aread(self):
        return b""

    async def aiter_lines(self):
        if False:  # pragma: no cover - never yields
            yield ""


class _FakeStream:
    def __init__(self, response):
        self._response = response

    async def __aenter__(self):
        return self._response

    async def __aexit__(self, *args):
        return False


@pytest.mark.asyncio
async def test_rpc_helper_sets_authorization_header():
    captured: dict = {}

    def fake_stream(method, url, headers=None, json=None):
        captured["headers"] = headers
        return _FakeStream(_FakeResponse())

    client = MagicMock()
    client.stream = fake_stream

    rpc = mcp_rpc.RpcHelper("http://localhost/mcp/", client, auth_token="secret")
    await rpc.send("tools/list")

    assert captured["headers"]["Authorization"] == "Bearer secret"


@pytest.mark.asyncio
async def test_rpc_helper_omits_authorization_header_without_token():
    captured: dict = {}

    def fake_stream(method, url, headers=None, json=None):
        captured["headers"] = headers
        return _FakeStream(_FakeResponse())

    client = MagicMock()
    client.stream = fake_stream

    rpc = mcp_rpc.RpcHelper("http://localhost/mcp/", client)
    await rpc.send("tools/list")

    assert "Authorization" not in captured["headers"]
