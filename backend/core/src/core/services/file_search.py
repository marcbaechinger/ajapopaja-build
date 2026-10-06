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

"""Fast, bounded in-memory path search for pipeline repositories.

The File Browser lets a user walk a repository directory by directory. That is
slow on large trees, so this module keeps a per-repository snapshot of every
file and directory path in memory and answers substring queries against it.
The service is deliberately decoupled from FastAPI (no HTTP concerns) so agent
tools can reuse it later.

Design summary
--------------

* A single ``os.walk`` builds an immutable :class:`PathIndex` snapshot per
  repository root; ignored directories are skipped and the walk never follows
  symlinked directories.
* ``FileSearchIndexManager`` is a process-wide cache with an LRU bound, a soft
  TTL (serve stale while a background rebuild runs) and an idle TTL (drop the
  snapshot to release memory).
* Building and matching happen in worker threads via ``asyncio.to_thread`` so
  the event loop is never blocked.
* Queries are ranked name-match first, then path-match, then (optionally) a
  subsequence/fuzzy match. Results are the top ``limit`` by a deterministic key.
* Read-only: only ``os.walk`` and ``stat`` are used; nothing is ever written.
"""

from __future__ import annotations

import asyncio
import heapq
import logging
import os
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Tuple

from core.config import IGNORED_DIRECTORIES
from core.models.models import FileSearchResponse, FileSearchResult, Pipeline
from core.services.file_browser import FileBrowserService, UnreadablePathError

logger = logging.getLogger(__name__)

# --- Cache knobs -----------------------------------------------------------

# Maximum number of repository indexes cached at once (LRU eviction).
MAX_CACHED_PIPELINES = 8
# Maximum number of path records stored per index (entry cap).
MAX_INDEX_ENTRIES = 100_000
# Maximum approximate number of text bytes stored per index (byte cap).
MAX_INDEX_BYTES = 32 * 1024 * 1024
# After this age the query is answered from the stale snapshot while a
# background rebuild runs (stale-while-revalidate).
SOFT_TTL_SECONDS = 20.0
# After this idle age the snapshot is dropped entirely (frees memory).
IDLE_TTL_SECONDS = 600.0
# Hard server-side cap on the number of results returned.
MAX_RESULTS = 50


@dataclass(frozen=True, slots=True)
class PathRecord:
    """The smallest useful tuple for one indexed path."""

    path: str  # repo-relative POSIX, e.g. "frontend/src/main.ts"
    name: str  # basename, e.g. "main.ts"
    is_dir: bool


@dataclass(frozen=True)
class PathIndex:
    """Immutable snapshot of every path under a repository root."""

    root: str
    records: Tuple[PathRecord, ...]
    built_at: float  # monotonic timestamp
    truncated: bool  # True when an entry/byte cap was hit
    # mtimes observed at build time, used by the cheap freshness probe. A
    # change means the working tree may have moved on and a rebuild is due.
    root_mtime: float = 0.0
    git_index_mtime: float = 0.0


@dataclass
class _IndexEntry:
    index: PathIndex
    last_used: float


@dataclass(order=True)
class _Ranked:
    """Ranking key for a match (ascending = better).

    Name matches (bucket 0) beat path matches (bucket 1) beat fuzzy matches
    (bucket 2). Within a bucket shorter names and paths come first, then the
    full path makes the order deterministic.
    """

    bucket: int
    name_len: int
    path_len: int
    path: str
    record: PathRecord = field(compare=False, default=None)  # type: ignore[assignment]


class _WorstFirst:
    """Reverse-order wrapper so a min-heap can evict the worst ranked item."""

    __slots__ = ("rank",)

    def __init__(self, rank: _Ranked) -> None:
        self.rank = rank

    def __lt__(self, other: "_WorstFirst") -> bool:  # pragma: no cover - trivial
        return self.rank > other.rank


def _capture_mtimes(root: Path) -> Tuple[float, float]:
    """Return ``(root_mtime, git_index_mtime)`` for the freshness probe."""

    def _mtime(path: Path) -> float:
        try:
            return path.stat().st_mtime
        except OSError:
            return 0.0

    return _mtime(root), _mtime(root / ".git" / "index")


def _is_subsequence(needle: str, haystack: str) -> bool:
    """True when every character of ``needle`` appears in order in ``haystack``."""
    if not needle:
        return True
    it = iter(haystack)
    return all(char in it for char in needle)


def _search_records(
    records: Tuple[PathRecord, ...], needle: str, limit: int
) -> Tuple[List[PathRecord], bool]:
    """Rank ``records`` against ``needle`` and return the top ``limit`` hits.

    Matching is a substring test on the basename (mandatory) and then on the
    full path. A cheap subsequence pass adds fuzzy matches only when the
    substring buckets did not already fill the limit.
    """
    heap: List[_WorstFirst] = []
    total = 0

    def consider(rank: _Ranked) -> None:
        nonlocal total
        total += 1
        if len(heap) < limit:
            heapq.heappush(heap, _WorstFirst(rank))
        elif rank < heap[0].rank:
            heapq.heapreplace(heap, _WorstFirst(rank))

    # Bucket 0 (name) and bucket 1 (path).
    for record in records:
        if needle in record.name.casefold():
            consider(
                _Ranked(0, len(record.name), len(record.path), record.path, record)
            )
        elif needle in record.path.casefold():
            consider(
                _Ranked(1, len(record.name), len(record.path), record.path, record)
            )

    # Bucket 2 (fuzzy subsequence) only when the limit is not yet full. This
    # keeps typo/abbreviation tolerance without scanning everything twice
    # during ordinary as-you-type searches.
    if total < limit and len(needle) >= 2:
        for record in records:
            folded_path = record.path.casefold()
            if needle in folded_path:
                continue
            if _is_subsequence(needle, folded_path):
                consider(
                    _Ranked(
                        2,
                        len(record.name),
                        len(record.path),
                        record.path,
                        record,
                    )
                )

    best = sorted((entry.rank for entry in heap))
    results = [entry.record for entry in best]
    return results, total > limit


def _build_sync(root: Path, max_entries: int, max_bytes: int) -> PathIndex:
    """Walk ``root`` and build an immutable, capped :class:`PathIndex`."""
    ignored = set(IGNORED_DIRECTORIES)
    records: List[PathRecord] = []
    total_bytes = 0
    truncated = False

    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        # Prune ignored directories in place so os.walk never descends into
        # them and they are never indexed.
        dirnames[:] = sorted(name for name in dirnames if name not in ignored)
        rel_dir = os.path.relpath(dirpath, root)
        if rel_dir == ".":
            rel_dir = ""

        for name in dirnames:
            rel = f"{rel_dir}/{name}" if rel_dir else name
            records.append(PathRecord(path=rel, name=name, is_dir=True))
            total_bytes += len(rel) + len(name) + 32
            if len(records) >= max_entries or total_bytes > max_bytes:
                truncated = True
                break
        if truncated:
            break

        for name in filenames:
            rel = f"{rel_dir}/{name}" if rel_dir else name
            records.append(PathRecord(path=rel, name=name, is_dir=False))
            total_bytes += len(rel) + len(name) + 32
            if len(records) >= max_entries or total_bytes > max_bytes:
                truncated = True
                break
        if truncated:
            break

    root_mtime, git_index_mtime = _capture_mtimes(root)
    return PathIndex(
        root=str(root),
        records=tuple(records),
        built_at=time.monotonic(),
        truncated=truncated,
        root_mtime=root_mtime,
        git_index_mtime=git_index_mtime,
    )


class FileSearchIndexManager:
    """Process-wide LRU/TTL cache of :class:`PathIndex` snapshots.

    All state is guarded by an ``asyncio.Lock``. Snapshots are immutable, so
    readers never observe a partially built index. Builds are single-flight per
    root and always run in a worker thread.
    """

    def __init__(
        self,
        *,
        max_pipelines: int = MAX_CACHED_PIPELINES,
        max_entries: int = MAX_INDEX_ENTRIES,
        max_bytes: int = MAX_INDEX_BYTES,
        soft_ttl: float = SOFT_TTL_SECONDS,
        idle_ttl: float = IDLE_TTL_SECONDS,
    ) -> None:
        self.max_pipelines = max_pipelines
        self.max_entries = max_entries
        self.max_bytes = max_bytes
        self.soft_ttl = soft_ttl
        self.idle_ttl = idle_ttl
        self._lock = asyncio.Lock()
        self._entries: "OrderedDict[str, _IndexEntry]" = OrderedDict()
        self._build_tasks: Dict[str, asyncio.Task] = {}

    # -- public API --------------------------------------------------------

    async def get_index(self, root: Path) -> PathIndex:
        """Return a (possibly stale) index for ``root``, building if needed.

        On a cache miss this awaits the first build. When a snapshot exists but
        is older than the soft TTL (or the cheap freshness probe detects a
        change) the stale snapshot is returned immediately and a background
        rebuild is scheduled.
        """
        key = str(root)
        while True:
            async with self._lock:
                entry = self._entries.get(key)
                now = time.monotonic()
                if entry is not None and now - entry.last_used <= self.idle_ttl:
                    entry.last_used = now
                    self._entries.move_to_end(key)
                    if (
                        now - entry.index.built_at > self.soft_ttl
                        or self._is_dirty_locked(entry.index)
                    ):
                        self._schedule_rebuild_locked(key, root)
                    return entry.index
                if entry is not None:
                    # Idle expiry: drop the snapshot and rebuild lazily.
                    self._entries.pop(key, None)

                task = self._build_tasks.get(key)
                if task is None:
                    task = asyncio.ensure_future(asyncio.to_thread(self._build, root))
                    self._build_tasks[key] = task

            try:
                index = await task
            except Exception:
                async with self._lock:
                    if self._build_tasks.get(key) is task:
                        self._build_tasks.pop(key, None)
                raise

            async with self._lock:
                if self._build_tasks.get(key) is task:
                    self._build_tasks.pop(key, None)
                self._store_locked(key, index)
            return index

    async def clear(self) -> None:
        """Drop every cached snapshot and cancel no in-flight build."""
        async with self._lock:
            self._entries.clear()

    def cached_count(self) -> int:
        """Number of currently cached indexes (test/diagnostic helper)."""
        return len(self._entries)

    # -- internals ---------------------------------------------------------

    def _build(self, root: Path) -> PathIndex:
        try:
            return _build_sync(root, self.max_entries, self.max_bytes)
        except OSError as exc:  # pragma: no cover - defensive
            raise UnreadablePathError("Failed to index the pipeline workspace") from exc

    def _store_locked(self, key: str, index: PathIndex) -> None:
        now = time.monotonic()
        self._entries[key] = _IndexEntry(index=index, last_used=now)
        self._entries.move_to_end(key)
        while len(self._entries) > self.max_pipelines:
            self._entries.popitem(last=False)

    def _is_dirty_locked(self, index: PathIndex) -> bool:
        """Cheap ``stat``-only freshness probe (never walks the tree)."""
        root = Path(index.root)
        root_mtime, git_index_mtime = _capture_mtimes(root)
        if root_mtime and root_mtime > index.root_mtime:
            return True
        if git_index_mtime and git_index_mtime > index.git_index_mtime:
            return True
        return False

    def _schedule_rebuild_locked(self, key: str, root: Path) -> None:
        if key in self._build_tasks:
            return

        async def _rebuild() -> None:
            try:
                index = await asyncio.to_thread(self._build, root)
            except Exception:  # pragma: no cover - logged, stale kept
                logger.warning(
                    "File search index rebuild failed for %s", key, exc_info=True
                )
                return
            async with self._lock:
                self._store_locked(key, index)

        task = asyncio.ensure_future(_rebuild())
        self._build_tasks[key] = task

        def _done(_task: asyncio.Task) -> None:
            self._build_tasks.pop(key, None)

        task.add_done_callback(_done)


# Process-wide singleton used by the HTTP layer and (later) agent tools.
_index_manager = FileSearchIndexManager()


def get_index_manager() -> FileSearchIndexManager:
    """Return the process-wide index manager (overridable in tests)."""
    return _index_manager


def set_index_manager(manager: FileSearchIndexManager) -> None:
    """Replace the process-wide index manager (test hook)."""
    global _index_manager
    _index_manager = manager


class FileSearchService:
    """Read-only, reusable filename/path search over a pipeline repository."""

    @staticmethod
    async def search(
        pipeline: Pipeline, query: str, limit: int = 20
    ) -> FileSearchResponse:
        """Search the pipeline repository for paths matching ``query``."""
        needle = query.strip().casefold()
        capped_limit = max(1, min(limit, MAX_RESULTS))
        if not needle:
            return FileSearchResponse(
                query=query, results=[], truncated=False, index_ready=True
            )

        root = FileBrowserService.resolve_root(pipeline)
        index = await get_index_manager().get_index(root)
        results, truncated = await asyncio.to_thread(
            _search_records, index.records, needle, capped_limit
        )
        return FileSearchResponse(
            query=query,
            results=[
                FileSearchResult(path=r.path, name=r.name, is_dir=r.is_dir)
                for r in results
            ],
            truncated=truncated or index.truncated,
            index_ready=True,
        )


__all__ = [
    "FileSearchService",
    "FileSearchIndexManager",
    "PathIndex",
    "PathRecord",
    "get_index_manager",
    "set_index_manager",
    "MAX_CACHED_PIPELINES",
    "MAX_INDEX_BYTES",
    "MAX_INDEX_ENTRIES",
    "MAX_RESULTS",
    "SOFT_TTL_SECONDS",
    "IDLE_TTL_SECONDS",
]
