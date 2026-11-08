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

"""Smoke tests for the host-side ``ajapopaja`` skill CLI artifact commands."""

import importlib.util
import json
import subprocess
import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock
from urllib.parse import parse_qs, urlparse

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
SKILL_CLIENT = REPO_ROOT / ".pi" / "skills" / "ajapopaja" / "mcp_client.py"


def _load_skill_client():
    spec = importlib.util.spec_from_file_location(
        "_test_skill_mcp_client", SKILL_CLIENT
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules["_test_skill_mcp_client"] = module
    spec.loader.exec_module(module)
    return module


skill_client = _load_skill_client()

PIPELINE_ID = "0123456789abcdef01234567"
PAYLOAD = {
    "configured": True,
    "path": "dist/app-debug.apk",
    "exists": True,
    "size": 12,
    "sha256": "deadbeef",
    "download_url": f"/api/pipelines/{PIPELINE_ID}/artifact/download",
    "download_token": "artifact.token/value",
    "expires_in": 60,
}


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


class _FakeStream:
    def __init__(self, response):
        self._response = response

    async def __aenter__(self):
        return self._response

    async def __aexit__(self, *args):
        return False


def _tool_response(payload):
    return {"result": {"structuredContent": payload}}


@pytest.mark.asyncio
async def test_get_artifact_calls_tool_and_prints_json(capsys):
    client = MagicMock()
    client.call_tool = AsyncMock(return_value=_tool_response(PAYLOAD))

    result = await skill_client.run_get_artifact(client, PIPELINE_ID, as_json=True)

    client.call_tool.assert_awaited_once_with(
        "get_build_artifact", {"pipeline_id": PIPELINE_ID}
    )
    assert result == PAYLOAD
    printed = json.loads(capsys.readouterr().out.strip())
    assert printed["download_token"] == "artifact.token/value"
    assert printed["path"] == "dist/app-debug.apk"


@pytest.mark.asyncio
async def test_get_artifact_extracts_json_text_content(capsys):
    client = MagicMock()
    client.call_tool = AsyncMock(
        return_value={
            "result": {
                "content": [
                    {"type": "text", "text": json.dumps(PAYLOAD)},
                ]
            }
        }
    )

    result = await skill_client.run_get_artifact(client, PIPELINE_ID)

    assert result == PAYLOAD
    assert PAYLOAD["download_token"] in capsys.readouterr().out


@pytest.mark.asyncio
async def test_download_artifact_streams_token_url_to_output_file(tmp_path):
    chunks = [b"chunk-one", b"-chunk-two", b"\x00\xff"]
    response = _FakeDownloadResponse(chunks)
    client = MagicMock()
    client.base_url = "http://api.test"
    client.auth_token = "user-jwt"
    client.call_tool = AsyncMock(return_value=_tool_response(PAYLOAD))
    client.client.stream = MagicMock(return_value=_FakeStream(response))
    destination = tmp_path / "downloads" / "app.apk"
    destination.parent.mkdir()

    saved = await skill_client.run_download_artifact(
        client, PIPELINE_ID, output=str(destination)
    )

    assert saved == str(destination)
    assert destination.read_bytes() == b"".join(chunks)

    stream_args, stream_kwargs = client.client.stream.call_args
    assert stream_args[0] == "GET"
    parsed = urlparse(stream_args[1])
    assert parsed.path == f"/api/pipelines/{PIPELINE_ID}/artifact/download"
    assert parse_qs(parsed.query)["token"] == ["artifact.token/value"]
    assert stream_kwargs["headers"]["Authorization"] == "Bearer user-jwt"


@pytest.mark.asyncio
async def test_download_artifact_defaults_to_artifact_filename(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    response = _FakeDownloadResponse([b"apk"])
    client = MagicMock()
    client.base_url = "http://api.test"
    client.auth_token = None
    client.rpc = None
    client.call_tool = AsyncMock(return_value=_tool_response(PAYLOAD))
    client.client.stream = MagicMock(return_value=_FakeStream(response))

    saved = await skill_client.run_download_artifact(client, PIPELINE_ID)

    assert saved == "app-debug.apk"
    assert (tmp_path / "app-debug.apk").read_bytes() == b"apk"
    assert "headers" not in client.client.stream.call_args.kwargs


@pytest.mark.asyncio
async def test_download_artifact_rejects_metadata_without_token(tmp_path):
    client = MagicMock()
    client.call_tool = AsyncMock(
        return_value=_tool_response({"configured": True, "exists": False})
    )
    client.client.stream = MagicMock()
    destination = tmp_path / "nothing.bin"

    saved = await skill_client.run_download_artifact(
        client, PIPELINE_ID, output=str(destination)
    )

    assert saved is None
    assert not destination.exists()
    client.client.stream.assert_not_called()


@pytest.mark.asyncio
async def test_download_artifact_reports_http_error_without_writing(tmp_path):
    response = _FakeDownloadResponse([b"unauthorized body"])
    response.status_code = 403
    client = MagicMock()
    client.base_url = "http://api.test"
    client.auth_token = None
    client.rpc = None
    client.call_tool = AsyncMock(return_value=_tool_response(PAYLOAD))
    client.client.stream = MagicMock(return_value=_FakeStream(response))
    destination = tmp_path / "failed.bin"

    saved = await skill_client.run_download_artifact(
        client, PIPELINE_ID, output=str(destination)
    )

    assert saved is None
    assert not destination.exists()


def test_skill_cli_exposes_artifact_subcommands():
    completed = subprocess.run(
        [sys.executable, str(SKILL_CLIENT), "--help"],
        check=True,
        capture_output=True,
        text=True,
        cwd=str(REPO_ROOT),
    )
    assert "get-artifact" in completed.stdout
    assert "download-artifact" in completed.stdout
