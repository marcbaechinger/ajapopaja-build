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

"""Integration test: user-edited PR summary is used as the commit message.

In Gitea-PR mode the patch is applied to a feature branch and pushed as a Gitea
pull request. The commit message on that branch must be the `commit_message`
the user sent via `AcceptPullRequestRequest` (i.e. the edited PR summary),
not the original summary captured at PR-creation time.
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
    db = client["test_accept_pr_user_summary"]
    await init_beanie(
        database=db,
        document_models=[Pipeline, Task, PullRequest],
    )
    yield db
    client.close()


@pytest.fixture
def remote_repo(tmp_path, monkeypatch):
    """A remote Gitea repo (local git repo living under REMOTE_WORKSPACES_ROOT)."""
    monkeypatch.setattr(config, "REMOTE_PR_MODE", "gitea_pr")
    monkeypatch.setattr(config, "REMOTE_WORKSPACES_ROOT", tmp_path)

    repo_dir = tmp_path / "myapp"
    repo_dir.mkdir(parents=True)

    # The container may not have a global git identity configured.
    env = {"GIT_AUTHOR_NAME": "Test Bot", "GIT_AUTHOR_EMAIL": "bot@test.local"}
    repo = git.Repo.init(repo_dir, initial_branch="main")
    with repo.config_writer() as cw:
        cw.set_value("user", "name", "Test Bot")
        cw.set_value("user", "email", "bot@test.local")
    (repo_dir / "hello.txt").write_text("hello\n")
    repo.index.add(["hello.txt"])
    repo.index.commit("initial commit")

    # Build the patch the PR would apply without dirtying the workspace.
    (repo_dir / "hello.txt").write_text("hello new feature\n")
    patch = repo.git.diff()
    repo.git.checkout("--", "hello.txt")
    assert not repo.is_dirty(untracked_files=True)

    return {"repo_dir": repo_dir, "patch": patch, "env": env}


@pytest.mark.asyncio
async def test_accept_pr_with_user_summary_gitea(
    remote_repo, mongomock_db, monkeypatch
):
    repo_dir = remote_repo["repo_dir"]
    patch_text = remote_repo["patch"]

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

        task = Task(
            title="Implement a new feature",
            pipeline_id=str(pipeline.id),
            status=TaskStatus.PULL_REQUEST_AVAILABLE,
        )
        await task.insert()

        pr = PullRequest(
            pipeline_id=str(pipeline.id),
            task_id=str(task.id),
            summary="Original summary",
            branch_name="feature/new-feature",
            patch=patch_text,
            status=PullRequestStatus.OPEN,
        )
        await pr.insert()

        with (
            patch(
                "api.routes.pull_request.git_utils.resolve_gitea_repo",
                return_value=("https://host", "org", "myapp"),
            ),
            patch(
                "api.routes.pull_request.git_utils.push_branch_with_auth"
            ) as mock_push,
            patch("api.routes.pull_request.GiteaClient") as mock_client_cls,
        ):
            mock_client = mock_client_cls.return_value
            mock_client.create_pull_request = AsyncMock(
                return_value="https://host/org/myapp/pulls/1"
            )
            mock_client.aclose = AsyncMock()

            async with AsyncClient(
                transport=ASGITransport(app=app), base_url="http://test"
            ) as client:
                response = await client.post(
                    f"/api/pull_requests/{pr.id}/accept",
                    json={
                        "commit_message": "Add new feature",
                        "failure_strategy": "revert",
                    },
                )

        assert response.status_code == 200
        body = response.json()
        assert body["status"] == "success"

        # The feature branch must carry a commit whose message is exactly the
        # user-edited summary.
        repo = git.Repo(repo_dir)
        repo.git.checkout("feature/new-feature")
        commit_message = repo.head.commit.message.strip()
        assert commit_message == "Add new feature"
        assert commit_message != pr.summary

        # PR was submitted for external review (not merged to default branch).
        updated_pr = await PullRequest.get(pr.id)
        assert updated_pr.status == PullRequestStatus.SUBMITTED
        assert updated_pr.remote_pr_url == "https://host/org/myapp/pulls/1"

        mock_push.assert_called_once()
        mock_client.create_pull_request.assert_awaited_once()
        title = mock_client.create_pull_request.await_args.kwargs.get("title")
        # PR description still reflects the PR summary, not the commit message.
        assert title == "Add new feature"
    finally:
        app.dependency_overrides.clear()
