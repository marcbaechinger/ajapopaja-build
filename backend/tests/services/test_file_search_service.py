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

"""Unit tests for the in-memory file search service."""

import asyncio
import os
import time
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from core.services import file_search
from core.services.file_search import (
    FileSearchIndexManager,
    FileSearchService,
    _build_sync,
    _search_records,
)


def _pipeline(root: Path):
    pipeline = MagicMock()
    pipeline.id = "p1"
    pipeline.workspace_abs_path = root
    return pipeline


def _make_tree(root: Path) -> None:
    (root / "frontend" / "src" / "ui" / "components").mkdir(parents=True)
    (root / "frontend" / "src" / "ui" / "views").mkdir(parents=True)
    browse = root / "frontend" / "src" / "ui" / "components" / "FileBrowseView.ts"
    detail = root / "frontend" / "src" / "ui" / "views" / "PipelineDetailView.ts"
    browse.write_text("x")
    detail.write_text("x")
    (root / "backend" / "core").mkdir(parents=True)
    (root / "backend" / "core" / "file_search.py").write_text("x")
    # Ignored directories must never be indexed.
    (root / "node_modules" / "junk").mkdir(parents=True)
    (root / "node_modules" / "junk" / "bundle.js").write_text("x")
    (root / ".git").mkdir()
    (root / ".git" / "config").write_text("x")


@pytest.fixture(autouse=True)
async def installed_manager():
    """Install a fresh, isolated index manager around every test."""
    manager = FileSearchIndexManager()
    original = file_search.get_index_manager()
    file_search.set_index_manager(manager)
    yield manager
    file_search.set_index_manager(original)
    await manager.clear()


async def test_search_finds_basename_and_path(tmp_path):
    _make_tree(tmp_path)
    pipeline = _pipeline(tmp_path)

    response = await FileSearchService.search(pipeline, "FileBrowseView")

    paths = [r.path for r in response.results]
    assert paths[0] == "frontend/src/ui/components/FileBrowseView.ts"
    assert response.index_ready is True
    assert response.truncated is False


async def test_search_ignores_ignored_directories(tmp_path):
    _make_tree(tmp_path)
    pipeline = _pipeline(tmp_path)

    response = await FileSearchService.search(pipeline, "bundle")
    assert response.results == []


async def test_search_matches_path_segments(tmp_path):
    _make_tree(tmp_path)
    pipeline = _pipeline(tmp_path)

    response = await FileSearchService.search(pipeline, "ui/views")
    paths = [r.path for r in response.results]
    assert "frontend/src/ui/views/PipelineDetailView.ts" in paths


def test_name_matches_rank_before_path_matches(tmp_path):
    # ``core.py`` matches by name; ``core/file.py`` only by path.
    (tmp_path / "core").mkdir()
    (tmp_path / "core" / "file.py").write_text("x")
    (tmp_path / "core.py").write_text("x")
    records = _build_sync(tmp_path, 100, 10_000_000).records

    results, _ = _search_records(records, "core", 10)

    # Name matches must rank ahead of pure path matches.
    paths = [r.path for r in results]
    assert paths.index("core.py") < paths.index("core/file.py")
    # The directory ``core`` is itself a (shorter) name match and ranks first.
    assert paths[0] == "core"


async def test_search_supports_fuzzy_subsequence(tmp_path):
    _make_tree(tmp_path)
    pipeline = _pipeline(tmp_path)

    response = await FileSearchService.search(pipeline, "fbrv")
    paths = [r.path for r in response.results]
    assert "frontend/src/ui/components/FileBrowseView.ts" in paths


async def test_search_empty_query_returns_no_results(tmp_path):
    _make_tree(tmp_path)
    pipeline = _pipeline(tmp_path)

    response = await FileSearchService.search(pipeline, "   ")
    assert response.results == []


async def test_search_never_exposes_absolute_paths(tmp_path):
    _make_tree(tmp_path)
    pipeline = _pipeline(tmp_path)

    response = await FileSearchService.search(pipeline, "file_search")
    assert response.results
    for result in response.results:
        assert not Path(result.path).is_absolute()
        assert str(tmp_path) not in result.path


async def test_search_directories_are_included(tmp_path):
    _make_tree(tmp_path)
    pipeline = _pipeline(tmp_path)

    response = await FileSearchService.search(pipeline, "components")
    result = response.results[0]
    assert result.path == "frontend/src/ui/components"
    assert result.is_dir is True


def test_index_entry_cap_truncates(tmp_path):
    for index in range(20):
        (tmp_path / f"file_{index}.txt").write_text("x")

    index = _build_sync(tmp_path, max_entries=5, max_bytes=10_000_000)
    assert index.truncated is True
    assert len(index.records) == 5


def test_index_byte_cap_truncates(tmp_path):
    for index in range(20):
        (tmp_path / f"a_very_long_filename_number_{index}.txt").write_text("x")

    index = _build_sync(tmp_path, max_entries=100, max_bytes=64)
    assert index.truncated is True
    assert len(index.records) < 20


async def test_result_limit_is_bounded(tmp_path):
    _make_tree(tmp_path)
    pipeline = _pipeline(tmp_path)

    response = await FileSearchService.search(pipeline, "e", limit=2)
    assert len(response.results) <= 2
    assert response.truncated is True


async def test_index_is_cached_between_queries(tmp_path, installed_manager):
    _make_tree(tmp_path)
    pipeline = _pipeline(tmp_path)

    await FileSearchService.search(pipeline, "file")
    assert installed_manager.cached_count() == 1
    await FileSearchService.search(pipeline, "pipeline")
    assert installed_manager.cached_count() == 1


async def test_idle_ttl_evicts_and_rebuilds(tmp_path):
    _make_tree(tmp_path)
    manager = FileSearchIndexManager(idle_ttl=0.0)

    index1 = await manager.get_index(tmp_path)
    # With a zero idle TTL the very next access must drop the snapshot...
    index2 = await manager.get_index(tmp_path)
    assert index1 is not index2
    assert manager.cached_count() == 1
    await manager.clear()


async def test_lru_evicts_oldest_pipeline(tmp_path):
    manager = FileSearchIndexManager(max_pipelines=2)
    roots = []
    for name in ("a", "b", "c"):
        root = tmp_path / name
        root.mkdir()
        (root / "file.txt").write_text("x")
        roots.append(root)

    for root in roots:
        await manager.get_index(root)

    assert manager.cached_count() == 2
    await manager.clear()


async def test_stale_index_is_served_immediately(tmp_path):
    _make_tree(tmp_path)
    # A tiny soft TTL makes the snapshot stale right after the first query.
    manager = FileSearchIndexManager(soft_ttl=0.0)

    first = await manager.get_index(tmp_path)
    # The second access is answered from the (now stale) snapshot without
    # waiting for a rebuild, so the object is identical.
    second = await manager.get_index(tmp_path)
    assert first is second
    await manager.clear()


def test_freshness_probe_detects_git_index_change(tmp_path):
    root = tmp_path / "repo"
    root.mkdir()
    (root / ".git").mkdir()
    git_index = root / ".git" / "index"
    git_index.write_text("x")
    (root / "file.txt").write_text("x")

    manager = FileSearchIndexManager()
    index = _build_sync(root, 100, 10_000_000)

    assert manager._is_dirty_locked(index) is False
    # Bump the git index mtime past the recorded value.
    future = time.time() + 60
    os.utime(git_index, (future, future))
    assert manager._is_dirty_locked(index) is True


async def test_concurrent_cold_queries_share_one_build(tmp_path, monkeypatch):
    _make_tree(tmp_path)
    pipeline = _pipeline(tmp_path)

    calls = {"count": 0}
    original_build = file_search._build_sync

    def counting_build(root, max_entries, max_bytes):
        calls["count"] += 1
        return original_build(root, max_entries, max_bytes)

    monkeypatch.setattr(file_search, "_build_sync", counting_build)

    await asyncio.gather(
        FileSearchService.search(pipeline, "file"),
        FileSearchService.search(pipeline, "pipeline"),
        FileSearchService.search(pipeline, "core"),
    )
    assert calls["count"] == 1
