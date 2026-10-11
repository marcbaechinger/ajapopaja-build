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

import hashlib
import hmac
import json
from unittest.mock import AsyncMock, patch

import pytest

from api.git_hosting.branch_notifier import NotifyResult
from core import config

SECRET = "test-webhook-secret"


def _sign(payload: dict, secret: str = SECRET) -> tuple[bytes, str]:
    raw = json.dumps(payload).encode("utf-8")
    sig = hmac.new(secret.encode("utf-8"), raw, hashlib.sha256).hexdigest()
    return raw, sig


def _pr_payload(merged: bool = True):
    return {
        "action": "closed",
        "repository": {"full_name": "org/repo"},
        "pull_request": {
            "merged": merged,
            "merge_commit_sha": "merge-sha" if merged else None,
            "base": {"ref": "main"},
            "head": {"ref": "feature/x", "sha": "head-sha"},
        },
    }


@pytest.mark.asyncio
async def test_pr_state_valid_signed_pull_request(
    async_client, init_mock_db, monkeypatch
):
    monkeypatch.setattr(config, "GITEA_WEBHOOK_SECRET", SECRET)
    raw, sig = _sign(_pr_payload())

    with patch(
        "api.routes.git_hosting.PrStateNotifier.on_pr_state",
        new=AsyncMock(
            return_value=NotifyResult(
                status="mirrored",
                branch="main",
                commit_hash="merge-sha",
                pipeline_id="pipe-1",
                affected_task_ids=["task-1"],
            )
        ),
    ) as mock_notify:
        response = await async_client.post(
            "/api/git_hosting/pipelines/pipe-1/pr-state",
            content=raw,
            headers={
                "Content-Type": "application/json",
                "X-Gitea-Signature": sig,
            },
        )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "mirrored"
    assert body["pipeline_id"] == "pipe-1"
    assert body["branch"] == "main"
    assert body["state"] == "merged"
    mock_notify.assert_awaited_once()


@pytest.mark.asyncio
async def test_pr_state_unknown_pipeline_404(async_client, init_mock_db, monkeypatch):
    monkeypatch.setattr(config, "GITEA_WEBHOOK_SECRET", SECRET)
    raw, sig = _sign(_pr_payload())

    with patch(
        "api.routes.git_hosting.PrStateNotifier.on_pr_state",
        new=AsyncMock(return_value=NotifyResult(status="not_found")),
    ):
        response = await async_client.post(
            "/api/git_hosting/pipelines/unknown/pr-state",
            content=raw,
            headers={
                "Content-Type": "application/json",
                "X-Gitea-Signature": sig,
            },
        )

    assert response.status_code == 404


@pytest.mark.asyncio
async def test_pr_state_wrong_signature_401(async_client, init_mock_db, monkeypatch):
    monkeypatch.setattr(config, "GITEA_WEBHOOK_SECRET", SECRET)
    raw, _ = _sign(_pr_payload())

    with patch(
        "api.routes.git_hosting.PrStateNotifier.on_pr_state",
        new=AsyncMock(return_value=NotifyResult(status="mirrored")),
    ) as mock_notify:
        response = await async_client.post(
            "/api/git_hosting/pipelines/pipe-1/pr-state",
            content=raw,
            headers={
                "Content-Type": "application/json",
                "X-Gitea-Signature": "deadbeef",
            },
        )

    assert response.status_code == 401
    mock_notify.assert_not_awaited()


@pytest.mark.asyncio
async def test_pr_state_non_actionable_event_202(async_client, init_mock_db):
    raw = json.dumps({"action": "opened", "pull_request": {}}).encode("utf-8")

    with patch(
        "api.routes.git_hosting.PrStateNotifier.on_pr_state",
        new=AsyncMock(return_value=NotifyResult(status="mirrored")),
    ) as mock_notify:
        response = await async_client.post(
            "/api/git_hosting/pipelines/pipe-1/pr-state",
            content=raw,
            headers={"Content-Type": "application/json"},
        )

    assert response.status_code == 202
    assert response.json() == {"status": "ignored"}
    mock_notify.assert_not_awaited()


@pytest.mark.asyncio
async def test_pr_state_busy_202(async_client, init_mock_db, monkeypatch):
    monkeypatch.setattr(config, "GITEA_WEBHOOK_SECRET", SECRET)
    raw, sig = _sign(_pr_payload())

    with patch(
        "api.routes.git_hosting.PrStateNotifier.on_pr_state",
        new=AsyncMock(
            return_value=NotifyResult(status="busy", branch="main")
        ),
    ):
        response = await async_client.post(
            "/api/git_hosting/pipelines/pipe-1/pr-state",
            content=raw,
            headers={
                "Content-Type": "application/json",
                "X-Gitea-Signature": sig,
            },
        )

    assert response.status_code == 202
    assert response.json() == {"status": "busy", "branch": "main"}


@pytest.mark.asyncio
async def test_pr_state_commit_not_found_202(async_client, init_mock_db, monkeypatch):
    monkeypatch.setattr(config, "GITEA_WEBHOOK_SECRET", SECRET)
    raw, sig = _sign(_pr_payload())

    with patch(
        "api.routes.git_hosting.PrStateNotifier.on_pr_state",
        new=AsyncMock(
            return_value=NotifyResult(
                status="commit_not_found", branch="main", commit_hash="merge-sha"
            )
        ),
    ):
        response = await async_client.post(
            "/api/git_hosting/pipelines/pipe-1/pr-state",
            content=raw,
            headers={
                "Content-Type": "application/json",
                "X-Gitea-Signature": sig,
            },
        )

    assert response.status_code == 202
    assert response.json() == {"status": "commit_not_found", "branch": "main"}


@pytest.mark.asyncio
async def test_pr_state_normalized_body(async_client, init_mock_db, monkeypatch):
    monkeypatch.setattr(config, "GITEA_WEBHOOK_SECRET", SECRET)
    payload = {"repo": "org/repo", "branch": "main", "state": "closed"}
    raw, sig = _sign(payload)

    with patch(
        "api.routes.git_hosting.PrStateNotifier.on_pr_state",
        new=AsyncMock(
            return_value=NotifyResult(
                status="mirrored", branch="main", pipeline_id="pipe-1"
            )
        ),
    ) as mock_notify:
        response = await async_client.post(
            "/api/git_hosting/pipelines/pipe-1/pr-state",
            content=raw,
            headers={
                "Content-Type": "application/json",
                "X-Gitea-Signature": sig,
            },
        )

    assert response.status_code == 200
    assert response.json()["state"] == "closed"
    mock_notify.assert_awaited_once()
