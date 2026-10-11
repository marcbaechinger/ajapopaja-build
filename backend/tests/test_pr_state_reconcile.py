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

"""Integration: remote Gitea PR state is reconciled onto local PR/task state.

Mirrors the ``gitea_pr`` flow end-to-end: a submitted PR/task is flipped to
``ACCEPTED``/``IMPLEMENTED`` when Gitea reports a merge, and to
``REJECTED``/``CREATED`` when Gitea reports a close-without-merge. A chained
descendant of a remotely rejected PR is then blocked from being accepted.
"""

import hashlib
import hmac
import json
from unittest.mock import AsyncMock, patch

import git
import pytest
from beanie import init_beanie
from httpx import ASGITransport, AsyncClient
from mongomock_motor import AsyncMongoMockClient

from api.auth import get_current_user
from api.main import app
from core import config
from core.models.models import (
    Pipeline,
    PiSession,
    PiSessionKind,
    PiSessionStatus,
    PullRequest,
    PullRequestStatus,
    Task,
    TaskStatus,
)

SECRET = "reconcile-secret"


@pytest.fixture
async def mongomock_db():
    from mongomock import Database as _MMDB

    _orig = _MMDB.list_collection_names

    def _patched(self, *args, **kwargs):
        kwargs.pop("authorizedCollections", None)
        kwargs.pop("nameOnly", None)
        return _orig(self, *args, **kwargs)

    _MMDB.list_collection_names = _patched

    client = AsyncMongoMockClient()
    db = client["test_pr_state_reconcile"]
    await init_beanie(
        database=db,
        document_models=[Pipeline, Task, PullRequest, PiSession],
    )
    yield db
    client.close()


@pytest.fixture
def remote_repo(tmp_path, monkeypatch):
    """A remote + workspace clone under REMOTE_WORKSPACES_ROOT."""
    monkeypatch.setattr(config, "REMOTE_PR_MODE", "gitea_pr")
    monkeypatch.setattr(config, "REMOTE_WORKSPACES_ROOT", tmp_path)
    monkeypatch.setattr(config, "GITEA_WEBHOOK_SECRET", SECRET)

    remote_dir = tmp_path / "origin" / "myapp.git"
    remote_dir.mkdir(parents=True)
    git.Repo.init(str(remote_dir), bare=True)

    repo_dir = tmp_path / "myapp"
    repo_dir.mkdir(parents=True)
    repo = git.Repo.init(str(repo_dir), initial_branch="main")
    with repo.config_writer() as cw:
        cw.set_value("user", "name", "Test Bot")
        cw.set_value("user", "email", "bot@test.local")
    (repo_dir / "hello.txt").write_text("hello\n")
    repo.index.add(["hello.txt"])
    repo.index.commit("initial commit")
    repo.create_remote("origin", str(remote_dir))
    repo.git.push("origin", "main")

    return {"repo_dir": repo_dir, "remote_dir": remote_dir}


def _sign(payload: dict) -> tuple[bytes, str]:
    raw = json.dumps(payload).encode("utf-8")
    sig = hmac.new(SECRET.encode("utf-8"), raw, hashlib.sha256).hexdigest()
    return raw, sig


async def _post_pr_state(client, pipeline_id: str, payload: dict):
    raw, sig = _sign(payload)
    return await client.post(
        f"/api/git_hosting/pipelines/{pipeline_id}/pr-state",
        content=raw,
        headers={"Content-Type": "application/json", "X-Gitea-Signature": sig},
    )


@pytest.mark.asyncio
async def test_merge_push_reconciles_to_implemented(remote_repo, mongomock_db):
    repo_dir = remote_repo["repo_dir"]

    pipeline = Pipeline(
        name="myapp",
        repo_uri="https://host/org/myapp.git",
        repo_username="user",
        repo_token="tok",
    )
    await pipeline.insert()

    task = Task(
        title="Implement a feature",
        pipeline_id=str(pipeline.id),
        status=TaskStatus.SUBMITTED,
    )
    await task.insert()

    pr = PullRequest(
        pipeline_id=str(pipeline.id),
        task_id=str(task.id),
        summary="summary",
        subject="subject",
        branch_name="coderbot/t1",
        patch="patch",
        status=PullRequestStatus.SUBMITTED,
        base_branch="main",
        remote_pr_url="https://host/org/myapp/pulls/1",
    )
    await pr.insert()

    # Simulate a Gitea merge: add a commit to the workspace main branch and push.
    repo = git.Repo(str(repo_dir))
    (repo_dir / "hello.txt").write_text("merged\n")
    repo.index.add(["hello.txt"])
    repo.index.commit("merged feature")
    merged_sha = repo.head.commit.hexsha
    repo.git.push("origin", "main")

    payload = {
        "ref": "refs/heads/main",
        "after": merged_sha,
        "repository": {"full_name": "org/myapp"},
    }

    with patch(
        "api.git_hosting.branch_notifier.git_utils.ensure_repo_cloned",
        new=AsyncMock(),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await _post_pr_state(client, str(pipeline.id), payload)

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "mirrored"
    assert body["state"] == "merged"
    assert body["commit_hash"] == merged_sha

    assert (await PullRequest.get(pr.id)).status == PullRequestStatus.ACCEPTED
    updated_task = await Task.get(task.id)
    assert updated_task.status == TaskStatus.IMPLEMENTED
    assert updated_task.commit_hash == merged_sha

    # The clone's default branch now contains the merged commit.
    repo = git.Repo(str(repo_dir))
    assert merged_sha in {c.hexsha for c in repo.iter_commits("main")}


@pytest.mark.asyncio
async def test_close_without_merge_reconciles_to_rejected_and_blocks_descendant(
    remote_repo, mongomock_db
):
    pipeline = Pipeline(
        name="myapp",
        repo_uri="https://host/org/myapp.git",
        repo_username="user",
        repo_token="tok",
    )
    await pipeline.insert()

    task1 = Task(
        title="First task",
        pipeline_id=str(pipeline.id),
        status=TaskStatus.SUBMITTED,
    )
    await task1.insert()

    pr1 = PullRequest(
        pipeline_id=str(pipeline.id),
        task_id=str(task1.id),
        summary="first",
        subject="First task",
        branch_name="coderbot/t1",
        patch="patch",
        status=PullRequestStatus.SUBMITTED,
        base_branch="main",
        remote_pr_url="https://host/org/myapp/pulls/1",
        pi_session_uid="uid-1",
    )
    await pr1.insert()

    # A chained descendant (PR2) produced by a session that chained onto PR1's.
    predecessor = PiSession(
        uid="uid-1",
        kind=PiSessionKind.CODERBOT,
        status=PiSessionStatus.COMPLETED,
        pipeline_id=str(pipeline.id),
        task_id=str(task1.id),
        branch_name="coderbot/t1",
        pull_request_ids=[str(pr1.id)],
    )
    chained = PiSession(
        uid="uid-2",
        kind=PiSessionKind.CODERBOT,
        status=PiSessionStatus.COMPLETED,
        pipeline_id=str(pipeline.id),
        task_id="task2",
        branch_name="coderbot/t2",
        chained_from_session_uid="uid-1",
    )
    await predecessor.insert()
    await chained.insert()

    task2 = Task(
        title="Second task",
        pipeline_id=str(pipeline.id),
        status=TaskStatus.PULL_REQUEST_AVAILABLE,
    )
    await task2.insert()

    pr2 = PullRequest(
        pipeline_id=str(pipeline.id),
        task_id=str(task2.id),
        summary="second",
        subject="Second task",
        branch_name="coderbot/t2",
        patch="patch",
        status=PullRequestStatus.OPEN,
        base_branch="main",
        pi_session_uid="uid-2",
    )
    await pr2.insert()

    payload = {
        "action": "closed",
        "repository": {"full_name": "org/myapp"},
        "pull_request": {
            "merged": False,
            "base": {"ref": "main"},
            "head": {"ref": "coderbot/t1", "sha": "head-sha"},
        },
    }

    with patch(
        "api.git_hosting.branch_notifier.git_utils.ensure_repo_cloned",
        new=AsyncMock(),
    ):
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            response = await _post_pr_state(client, str(pipeline.id), payload)

    assert response.status_code == 200, response.text
    assert response.json()["state"] == "closed"

    assert (await PullRequest.get(pr1.id)).status == PullRequestStatus.REJECTED
    updated_task1 = await Task.get(task1.id)
    assert updated_task1.status == TaskStatus.CREATED

    # The chained descendant is now blocked from acceptance.
    mock_user = AsyncMock()
    mock_user.username = "testuser"
    app.dependency_overrides[get_current_user] = lambda: mock_user
    try:
        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://test"
        ) as client:
            accept = await client.post(f"/api/pull_requests/{pr2.id}/accept")

        assert accept.status_code == 409
        assert "rejected predecessor" in accept.json()["detail"].lower()
    finally:
        app.dependency_overrides.clear()
