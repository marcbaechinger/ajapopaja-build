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

"""Regression test: accepting chained Gitea pull requests.

In ``gitea_pr`` mode the default branch is kept clean and each accepted patch is
committed onto its own feature branch. A chained CoderBot PR carries a patch that
is a delta relative to its predecessor's commit, so accepting it on the clean
default branch fails with errors such as
``src/main.tsx: does not exist in index``. The second queued task of a batch must
instead stack its feature branch on the predecessor's accepted feature branch.
"""

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


@pytest.fixture
async def mongomock_db():
    # mongomock's list_collection_names doesn't accept the kwargs beanie passes.
    from mongomock import Database as _MMDB

    _orig_list_collection_names = _MMDB.list_collection_names

    def _patched(self, *args, **kwargs):
        kwargs.pop("authorizedCollections", None)
        kwargs.pop("nameOnly", None)
        return _orig_list_collection_names(self, *args, **kwargs)

    _MMDB.list_collection_names = _patched

    client = AsyncMongoMockClient()
    db = client["test_accept_chained_pr_gitea"]
    await init_beanie(
        database=db,
        document_models=[Pipeline, Task, PullRequest, PiSession],
    )
    yield db
    client.close()


def _init_repo(path):
    repo = git.Repo.init(path, initial_branch="main")
    with repo.config_writer() as cw:
        cw.set_value("user", "name", "Test Bot")
        cw.set_value("user", "email", "bot@test.local")
    return repo


def _make_patches(tmp_path):
    """Return (pr1_patch, pr2_patch) where pr2's patch assumes pr1 applied."""
    gen = tmp_path / "patchgen"
    gen.mkdir(parents=True)
    repo = _init_repo(gen)
    (gen / "README.md").write_text("base\n", encoding="utf-8")
    repo.index.add(["README.md"])
    base = repo.index.commit("base")

    (gen / "src").mkdir()
    (gen / "src" / "main.tsx").write_text("one\n", encoding="utf-8")
    repo.index.add(["src/main.tsx"])
    c1 = repo.index.commit("c1")
    pr1_patch = repo.git.diff(base.hexsha, c1.hexsha)

    (gen / "src" / "main.tsx").write_text("two\n", encoding="utf-8")
    (gen / "src" / "App.test.tsx").write_text("test\n", encoding="utf-8")
    repo.index.add(["src/main.tsx", "src/App.test.tsx"])
    c2 = repo.index.commit("c2")
    pr2_patch = repo.git.diff(c1.hexsha, c2.hexsha)
    return pr1_patch, pr2_patch


@pytest.fixture
def workspace_and_patches(tmp_path, monkeypatch):
    """Pipeline workspace repo plus the two chained patches."""
    monkeypatch.setattr(config, "REMOTE_PR_MODE", "gitea_pr")
    monkeypatch.setattr(config, "REMOTE_WORKSPACES_ROOT", tmp_path)

    repo_dir = tmp_path / "myapp"
    repo_dir.mkdir(parents=True)
    repo = _init_repo(repo_dir)
    (repo_dir / "README.md").write_text("base\n", encoding="utf-8")
    repo.index.add(["README.md"])
    repo.index.commit("initial commit")

    pr1_patch, pr2_patch = _make_patches(tmp_path)
    return {"repo_dir": repo_dir, "pr1_patch": pr1_patch, "pr2_patch": pr2_patch}


@pytest.mark.asyncio
async def test_accept_chained_gitea_pr_stacks_on_predecessor(
    workspace_and_patches, mongomock_db
):
    repo_dir = workspace_and_patches["repo_dir"]

    mock_user = AsyncMock()
    mock_user.username = "testuser"
    app.dependency_overrides[get_current_user] = lambda: mock_user

    try:
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
            status=TaskStatus.PULL_REQUEST_AVAILABLE,
        )
        task2 = Task(
            title="Second task",
            pipeline_id=str(pipeline.id),
            status=TaskStatus.PULL_REQUEST_AVAILABLE,
        )
        await task1.insert()
        await task2.insert()

        # The second task's session chained onto the first task's session.
        predecessor = PiSession(
            uid="uid-1",
            kind=PiSessionKind.CODERBOT,
            status=PiSessionStatus.COMPLETED,
            pipeline_id=str(pipeline.id),
            task_id=str(task1.id),
            branch_name="coderbot/t1",
        )
        chained = PiSession(
            uid="uid-2",
            kind=PiSessionKind.CODERBOT,
            status=PiSessionStatus.COMPLETED,
            pipeline_id=str(pipeline.id),
            task_id=str(task2.id),
            branch_name="coderbot/t2",
            chained_from_session_uid="uid-1",
        )
        await predecessor.insert()
        await chained.insert()

        pr1 = PullRequest(
            pipeline_id=str(pipeline.id),
            task_id=str(task1.id),
            summary="first",
            subject="First task",
            branch_name="coderbot/t1",
            patch=workspace_and_patches["pr1_patch"],
            status=PullRequestStatus.OPEN,
            pi_session_uid="uid-1",
        )
        pr2 = PullRequest(
            pipeline_id=str(pipeline.id),
            task_id=str(task2.id),
            summary="second",
            subject="Second task",
            branch_name="coderbot/t2",
            patch=workspace_and_patches["pr2_patch"],
            status=PullRequestStatus.OPEN,
            pi_session_uid="uid-2",
        )
        await pr1.insert()
        await pr2.insert()

        async def _accept(client, pr):
            return await client.post(f"/api/pull_requests/{pr.id}/accept")

        with patch(
            "api.routes.pull_request.create_pipeline_pull_request",
            new_callable=AsyncMock,
            return_value="https://host/org/myapp/pulls/1",
        ):
            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                response1 = await _accept(client, pr1)
                response2 = await _accept(client, pr2)

        assert response1.status_code == 200, response1.text
        assert response2.status_code == 200, response2.text

        repo = git.Repo(repo_dir)

        # PR1's work landed on its own feature branch.
        repo.git.checkout("coderbot/t1")
        main_tsx = (repo_dir / "src" / "main.tsx").read_text(encoding="utf-8")
        assert main_tsx == "one\n"
        assert not (repo_dir / "src" / "App.test.tsx").exists()

        # The chained PR2 branch was stacked on PR1's branch, so its patch
        # (which references src/main.tsx added by PR1) applies cleanly.
        repo.git.checkout("coderbot/t2")
        assert (repo_dir / "src" / "main.tsx").read_text(encoding="utf-8") == "two\n"
        assert (repo_dir / "src" / "App.test.tsx").exists()

        # The default branch stays clean.
        repo.git.checkout("main")
        assert not (repo_dir / "src").exists()
        assert repo.head.commit.message.strip() == "initial commit"

        # Both PRs were submitted for external review.
        assert (await PullRequest.get(pr1.id)).status == PullRequestStatus.SUBMITTED
        assert (await PullRequest.get(pr2.id)).status == PullRequestStatus.SUBMITTED
    finally:
        app.dependency_overrides.clear()
