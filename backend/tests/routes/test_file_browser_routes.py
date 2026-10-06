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
import subprocess
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import status

from api.auth import get_current_user
from api.main import app
from core.services import file_search
from core.services.file_browser import MAX_TEXT_BYTES
from core.services.file_search import FileSearchIndexManager

RUN_GIT_ENV = {
    "GIT_AUTHOR_NAME": "Test User",
    "GIT_AUTHOR_EMAIL": "test@example.com",
    "GIT_COMMITTER_NAME": "Test User",
    "GIT_COMMITTER_EMAIL": "test@example.com",
}


def _git(cwd, args):
    return subprocess.run(
        ["git"] + args,
        cwd=cwd,
        check=True,
        capture_output=True,
        text=True,
        env={**os.environ, **RUN_GIT_ENV},
    )


@pytest.fixture(autouse=True)
def mock_auth():
    mock_user = MagicMock()
    mock_user.username = "testuser"
    app.dependency_overrides[get_current_user] = lambda: mock_user
    yield
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def reset_search_manager():
    """Keep each route test on a fresh, isolated search index cache."""
    manager = FileSearchIndexManager()
    original = file_search.get_index_manager()
    file_search.set_index_manager(manager)
    yield
    file_search.set_index_manager(original)


def _make_repo(tmp_path):
    """Create a repo with a mixture of git statuses and return its path."""
    repo = tmp_path / "repo"
    repo.mkdir()
    _git(repo, ["init", "-b", "main"])

    (repo / ".gitignore").write_text("ignored.txt\n")
    (repo / "clean.txt").write_text("clean\n")
    (repo / "zeta.txt").write_text("z\n")
    (repo / "sub").mkdir()
    (repo / "sub" / "nested.txt").write_text("nested\n")
    _git(repo, ["add", "."])
    _git(repo, ["commit", "-m", "Initial commit"])

    # modified tracked file
    (repo / "clean.txt").write_text("changed\n")
    # untracked file
    (repo / "untracked.txt").write_text("new\n")
    # ignored file
    (repo / "ignored.txt").write_text("ignored\n")
    # staged (added) file
    (repo / "staged.txt").write_text("staged\n")
    _git(repo, ["add", "staged.txt"])
    # modified file inside a directory so the directory aggregates to modified
    (repo / "sub" / "nested.txt").write_text("changed nested\n")

    return repo


def _mock_pipeline(repo):
    pipeline = MagicMock()
    pipeline.id = "p1"
    pipeline.workspace_abs_path = repo
    return pipeline


def _patch_pipeline(repo):
    return patch(
        "api.routes.file_browser.pipeline_queries.get_pipeline_by_id",
        new_callable=AsyncMock,
        return_value=_mock_pipeline(repo),
    )


@pytest.mark.asyncio
async def test_root_listing_sorted_and_excludes_git(async_client, tmp_path):
    repo = _make_repo(tmp_path)
    with _patch_pipeline(repo):
        response = await async_client.get("/api/pipelines/p1/files/")

    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    assert data["path"] == ""
    assert data["parent"] is None
    names = [e["name"] for e in data["entries"]]
    assert ".git" not in names
    # Directories first, then files, each case-insensitively natural-sorted.
    assert names == [
        "sub",
        ".gitignore",
        "clean.txt",
        "ignored.txt",
        "staged.txt",
        "untracked.txt",
        "zeta.txt",
    ]


@pytest.mark.asyncio
async def test_nested_listing_and_trailing_slash(async_client, tmp_path):
    repo = _make_repo(tmp_path)
    with _patch_pipeline(repo):
        response = await async_client.get(
            "/api/pipelines/p1/files/", params={"path": "sub/"}
        )

    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    assert data["path"] == "sub"
    assert data["parent"] == ""
    assert [e["name"] for e in data["entries"]] == ["nested.txt"]
    entry = data["entries"][0]
    assert entry["is_dir"] is False
    assert entry["size"] is not None
    assert entry["modified_at"] is not None


@pytest.mark.asyncio
async def test_directory_has_children_flag(async_client, tmp_path):
    repo = _make_repo(tmp_path)
    empty = repo / "empty"
    empty.mkdir()
    with _patch_pipeline(repo):
        response = await async_client.get("/api/pipelines/p1/files/")

    entries = {e["name"]: e for e in response.json()["entries"]}
    assert entries["sub"]["has_children"] is True
    assert entries["empty"]["has_children"] is False
    assert entries["clean.txt"]["has_children"] is None


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "path",
    ["../outside", "/etc/passwd", "sub/../../outside"],
)
async def test_path_traversal_rejected(async_client, tmp_path, path):
    repo = _make_repo(tmp_path)
    with _patch_pipeline(repo):
        response = await async_client.get(
            "/api/pipelines/p1/files/", params={"path": path}
        )
    assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.asyncio
async def test_encoded_traversal_rejected(async_client, tmp_path):
    repo = _make_repo(tmp_path)
    with _patch_pipeline(repo):
        response = await async_client.get(
            "/api/pipelines/p1/files/content?path=..%2f..%2fetc%2fpasswd"
        )
    assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.asyncio
async def test_symlink_escape_rejected(async_client, tmp_path):
    repo = _make_repo(tmp_path)
    outside = tmp_path / "outside.txt"
    outside.write_text("secret\n")
    (repo / "escape.txt").symlink_to(outside)

    with _patch_pipeline(repo):
        response = await async_client.get(
            "/api/pipelines/p1/files/content", params={"path": "escape.txt"}
        )
    assert response.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.asyncio
async def test_git_directory_is_hidden(async_client, tmp_path):
    repo = _make_repo(tmp_path)
    with _patch_pipeline(repo):
        listing = await async_client.get(
            "/api/pipelines/p1/files/", params={"path": ".git"}
        )
        content = await async_client.get(
            "/api/pipelines/p1/files/content", params={"path": ".git/config"}
        )
    assert listing.status_code == status.HTTP_404_NOT_FOUND
    assert content.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.asyncio
async def test_read_text_file_with_git_status(async_client, tmp_path):
    repo = _make_repo(tmp_path)
    with _patch_pipeline(repo):
        response = await async_client.get(
            "/api/pipelines/p1/files/content", params={"path": "clean.txt"}
        )

    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    assert data["name"] == "clean.txt"
    assert data["path"] == "clean.txt"
    assert data["content"] == "changed\n"
    assert data["is_binary"] is False
    assert data["truncated"] is False
    assert data["encoding"] == "utf-8"
    assert data["git_status"] == "modified"


@pytest.mark.asyncio
async def test_read_directory_as_content_rejected(async_client, tmp_path):
    repo = _make_repo(tmp_path)
    with _patch_pipeline(repo):
        response = await async_client.get(
            "/api/pipelines/p1/files/content", params={"path": "sub"}
        )
    assert response.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.asyncio
async def test_read_missing_file_returns_404(async_client, tmp_path):
    repo = _make_repo(tmp_path)
    with _patch_pipeline(repo):
        response = await async_client.get(
            "/api/pipelines/p1/files/content", params={"path": "nope.txt"}
        )
    assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.asyncio
async def test_binary_file_returns_no_content(async_client, tmp_path):
    repo = _make_repo(tmp_path)
    (repo / "bin.dat").write_bytes(b"\x00\x01\x02binary")
    with _patch_pipeline(repo):
        response = await async_client.get(
            "/api/pipelines/p1/files/content", params={"path": "bin.dat"}
        )

    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    assert data["is_binary"] is True
    assert data["content"] is None
    assert data["encoding"] is None


@pytest.mark.asyncio
async def test_oversized_file_is_truncated(async_client, tmp_path):
    repo = _make_repo(tmp_path)
    (repo / "big.txt").write_text("a" * (MAX_TEXT_BYTES + 128))
    with _patch_pipeline(repo):
        response = await async_client.get(
            "/api/pipelines/p1/files/content", params={"path": "big.txt"}
        )

    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    assert data["truncated"] is True
    assert len(data["content"]) == MAX_TEXT_BYTES


@pytest.mark.asyncio
async def test_git_status_mapping_in_listing(async_client, tmp_path):
    repo = _make_repo(tmp_path)
    with _patch_pipeline(repo):
        response = await async_client.get("/api/pipelines/p1/files/")

    entries = {e["name"]: e for e in response.json()["entries"]}
    assert entries["clean.txt"]["git_status"] == "modified"
    assert entries["untracked.txt"]["git_status"] == "untracked"
    assert entries["ignored.txt"]["git_status"] == "ignored"
    assert entries["staged.txt"]["git_status"] == "added"
    assert entries[".gitignore"]["git_status"] == "clean"
    # A directory aggregates the status of its descendants.
    assert entries["sub"]["git_status"] == "modified"


@pytest.mark.asyncio
async def test_meta_endpoint(async_client, tmp_path):
    repo = _make_repo(tmp_path)
    with _patch_pipeline(repo):
        response = await async_client.get(
            "/api/pipelines/p1/files/meta", params={"path": "clean.txt"}
        )

    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    assert data["is_dir"] is False
    assert data["path"] == "clean.txt"
    assert data["git_status"] == "modified"


@pytest.mark.asyncio
async def test_missing_workspace_returns_404(async_client, tmp_path):
    pipeline = MagicMock()
    pipeline.id = "p1"
    pipeline.workspace_abs_path = tmp_path / "does-not-exist"
    with patch(
        "api.routes.file_browser.pipeline_queries.get_pipeline_by_id",
        new_callable=AsyncMock,
        return_value=pipeline,
    ):
        response = await async_client.get("/api/pipelines/p1/files/")
    assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.asyncio
async def test_listing_without_git_repo_still_renders(async_client, tmp_path):
    plain = tmp_path / "plain"
    plain.mkdir()
    (plain / "a.txt").write_text("a\n")
    with _patch_pipeline(plain):
        response = await async_client.get("/api/pipelines/p1/files/")

    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    assert [e["name"] for e in data["entries"]] == ["a.txt"]
    assert data["entries"][0]["git_status"] is None


@pytest.mark.asyncio
async def test_search_endpoint_returns_ranked_relative_results(async_client, tmp_path):
    repo = _make_repo(tmp_path)
    (repo / "src" / "ui").mkdir(parents=True)
    (repo / "src" / "ui" / "FileBrowseView.ts").write_text("x\n")
    with _patch_pipeline(repo):
        response = await async_client.get(
            "/api/pipelines/p1/files/search", params={"q": "FileBrowse"}
        )

    assert response.status_code == status.HTTP_200_OK
    data = response.json()
    assert data["query"] == "FileBrowse"
    assert data["index_ready"] is True
    paths = [r["path"] for r in data["results"]]
    assert "src/ui/FileBrowseView.ts" in paths
    for result in data["results"]:
        assert not result["path"].startswith("/")
        assert str(repo) not in result["path"]


@pytest.mark.asyncio
async def test_search_endpoint_requires_a_query(async_client, tmp_path):
    repo = _make_repo(tmp_path)
    with _patch_pipeline(repo):
        response = await async_client.get("/api/pipelines/p1/files/search")
    assert response.status_code == 422


@pytest.mark.asyncio
async def test_search_endpoint_no_match_returns_empty(async_client, tmp_path):
    repo = _make_repo(tmp_path)
    with _patch_pipeline(repo):
        response = await async_client.get(
            "/api/pipelines/p1/files/search", params={"q": "does-not-exist"}
        )

    assert response.status_code == status.HTTP_200_OK
    assert response.json()["results"] == []


@pytest.mark.asyncio
async def test_search_endpoint_missing_workspace_returns_404(async_client, tmp_path):
    pipeline = MagicMock()
    pipeline.id = "p1"
    pipeline.workspace_abs_path = tmp_path / "does-not-exist"
    with patch(
        "api.routes.file_browser.pipeline_queries.get_pipeline_by_id",
        new_callable=AsyncMock,
        return_value=pipeline,
    ):
        response = await async_client.get(
            "/api/pipelines/p1/files/search", params={"q": "a"}
        )
    assert response.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.asyncio
async def test_search_endpoint_requires_authentication(async_client, tmp_path):
    repo = _make_repo(tmp_path)
    app.dependency_overrides.clear()
    with _patch_pipeline(repo):
        response = await async_client.get(
            "/api/pipelines/p1/files/search", params={"q": "a"}
        )
    assert response.status_code == status.HTTP_401_UNAUTHORIZED
