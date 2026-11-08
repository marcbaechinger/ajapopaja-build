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

"""Tests for the host-side ``ajapopaja`` skill CLI.

The canonical MCP CLI lives in ``.pi/skills/ajapopaja/mcp_client.py`` and is not
an installed package, so it is loaded directly from its file path.
"""

import importlib.util
import subprocess
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
SKILL_CLIENT = REPO_ROOT / ".pi" / "skills" / "ajapopaja" / "mcp_client.py"


def _load_skill_client():
    spec = importlib.util.spec_from_file_location(
        "_test_skill_mcp_client_auth", SKILL_CLIENT
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules["_test_skill_mcp_client_auth"] = module
    spec.loader.exec_module(module)
    return module


skill_client = _load_skill_client()

PIPELINE_ID = "0123456789abcdef01234567"
ARTIFACT_PAYLOAD = {
    "configured": True,
    "path": "dist/app-debug.apk",
    "exists": True,
    "size": 12,
    "sha256": "deadbeef",
    "download_url": f"/api/pipelines/{PIPELINE_ID}/artifact/download",
    "download_token": "artifact.token/value",
    "expires_in": 60,
}


@pytest.mark.asyncio
async def test_run_create_pull_request_maps_arguments():
    client = MagicMock()
    client.call_tool = AsyncMock()

    await skill_client.run_create_pull_request(
        client, "p1", "Add feature", "Body", "t1"
    )

    client.call_tool.assert_awaited_once_with(
        "create_pull_request",
        {"pipeline_id": "p1", "title": "Add feature", "body": "Body", "task_id": "t1"},
    )


@pytest.mark.asyncio
async def test_run_create_pull_request_task_optional():
    client = MagicMock()
    client.call_tool = AsyncMock()

    await skill_client.run_create_pull_request(client, "p1", "Add feature")

    client.call_tool.assert_awaited_once_with(
        "create_pull_request",
        {"pipeline_id": "p1", "title": "Add feature", "body": ""},
    )


class _FakeRpcResponse:
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


def _capture_rpc_headers():
    captured: dict = {}

    def fake_stream(method, url, headers=None, json=None):
        captured["headers"] = headers
        return _FakeStream(_FakeRpcResponse())

    client = MagicMock()
    client.stream = fake_stream
    return client, captured


def _make_rpc_client(auth_token):
    client = object.__new__(skill_client.MCPHttpClient)
    client.base_url = "http://localhost"
    client.endpoint = "http://localhost/mcp/"
    client.auth_token = auth_token
    client.session_id = None
    return client


@pytest.mark.asyncio
async def test_rpc_sends_authorization_header_when_token_configured():
    http_client, captured = _capture_rpc_headers()
    client = _make_rpc_client("secret")
    client.client = http_client

    await client._send_rpc("tools/list")

    assert captured["headers"]["Authorization"] == "Bearer secret"


@pytest.mark.asyncio
async def test_rpc_omits_authorization_header_without_token():
    http_client, captured = _capture_rpc_headers()
    client = _make_rpc_client(None)
    client.client = http_client

    await client._send_rpc("tools/list")

    assert "Authorization" not in captured["headers"]


class _FakeDownloadResponse:
    status_code = 200
    headers: dict = {}

    def __init__(self, chunks):
        self._chunks = chunks

    async def aread(self):
        return b"".join(self._chunks)

    async def aiter_bytes(self):
        for chunk in self._chunks:
            yield chunk


def _download_client(auth_token):
    client = MagicMock()
    client.base_url = "http://api.test"
    client.auth_token = auth_token
    client.rpc = None
    client.call_tool = AsyncMock(
        return_value={"result": {"structuredContent": ARTIFACT_PAYLOAD}}
    )
    client.client.stream = MagicMock(
        return_value=_FakeStream(_FakeDownloadResponse([b"artifact"]))
    )
    return client


@pytest.mark.asyncio
async def test_artifact_download_sends_authorization_header_when_token_configured(
    tmp_path,
):
    client = _download_client("secret")
    destination = tmp_path / "app.apk"

    saved = await skill_client.run_download_artifact(
        client, PIPELINE_ID, output=str(destination)
    )

    assert saved == str(destination)
    assert client.client.stream.call_args.kwargs["headers"]["Authorization"] == (
        "Bearer secret"
    )


@pytest.mark.asyncio
async def test_artifact_download_omits_authorization_header_without_token(tmp_path):
    client = _download_client(None)
    destination = tmp_path / "app.apk"

    saved = await skill_client.run_download_artifact(
        client, PIPELINE_ID, output=str(destination)
    )

    assert saved == str(destination)
    assert "headers" not in client.client.stream.call_args.kwargs


def test_skill_cli_exposes_all_commands():
    completed = subprocess.run(
        [sys.executable, str(SKILL_CLIENT), "--help"],
        check=True,
        capture_output=True,
        text=True,
        cwd=str(REPO_ROOT),
    )
    for command in (
        "get-task",
        "get-task-status",
        "get-task-details",
        "search-tasks",
        "create-task",
        "complete-task",
        "update-design-doc",
        "update-task-spec",
        "create-pull-request",
        "get-artifact",
        "download-artifact",
        "list",
    ):
        assert command in completed.stdout
