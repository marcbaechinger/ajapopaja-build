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

"""Read-only file-system browsing for a pipeline repository.

The service is deliberately decoupled from FastAPI so the same logic can be
reused by agent tools. All paths are repo-relative POSIX strings; absolute
paths never leave this module. Every operation is read-only: it never writes,
creates, deletes, clones, fetches or checks out anything.
"""

import logging
import re
from datetime import UTC, datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from core.exceptions import AjapopajaError, EntityNotFoundError
from core.models.models import (
    DirectoryListing,
    FileContent,
    FileEntry,
    Pipeline,
)
from core.utils import git_utils
from core.utils.path_utils import safe_join, sanitize_relative_path

logger = logging.getLogger(__name__)

# Largest amount of a text file that is returned to the client. Larger files are
# truncated to this prefix and flagged with ``truncated=True``.
MAX_TEXT_BYTES = 1024 * 1024  # 1 MiB

# Number of leading bytes inspected for a NUL byte to classify a file binary.
BINARY_SNIFF_BYTES = 8192

# Metadata directories that are never browsed.
EXCLUDED_NAMES = {".git"}


class PathEscapeError(AjapopajaError):
    """Raised when a path (e.g. a symlink) escapes the repository root."""


class UnreadablePathError(AjapopajaError):
    """Raised when a path cannot be read (permission or I/O error)."""


def _join_rel(parent: str, name: str) -> str:
    return f"{parent}/{name}" if parent else name


def _parent_of(rel_path: str) -> Optional[str]:
    if not rel_path:
        return None
    return rel_path.rsplit("/", 1)[0] if "/" in rel_path else ""


def _natural_key(name: str) -> List[object]:
    """Case-insensitive alphanumeric sort key with numeric tie-breaks.

    ``file2`` sorts before ``file10`` while preserving a stable, deterministic
    order for names that differ only in case.
    """
    parts = re.split(r"(\d+)", name)
    return [int(part) if part.isdigit() else part.casefold() for part in parts]


def _entry_sort_key(entry: FileEntry) -> Tuple[int, List[object]]:
    return (0 if entry.is_dir else 1, _natural_key(entry.name))


def _timestamp(value: float) -> datetime:
    return datetime.fromtimestamp(value, tz=UTC)


class FileBrowserService:
    """Stateless helpers to browse a pipeline repository read-only."""

    @staticmethod
    def _resolve_root(pipeline: Pipeline) -> Path:
        root = pipeline.workspace_abs_path
        if not root:
            raise EntityNotFoundError(
                f"Workspace path not found for pipeline {pipeline.id or ''}"
            )
        root = Path(root).resolve()
        if not root.is_dir():
            raise EntityNotFoundError("Pipeline workspace not found")
        return root

    @staticmethod
    def _resolve_path(
        pipeline: Pipeline, rel_path: Optional[str], *, allow_root: bool
    ) -> Tuple[Path, str]:
        """Resolve ``rel_path`` inside the pipeline root, safely.

        Returns the absolute resolved path and the normalized repo-relative
        path. Raises ``ValueError`` for syntactically invalid paths,
        ``FileNotFoundError`` for excluded (``.git``) paths and
        :class:`PathEscapeError` for paths escaping the root (e.g. symlinks).
        """
        root = FileBrowserService._resolve_root(pipeline)

        raw = (rel_path or "").strip()
        if raw in ("", ".", "/"):
            if not allow_root:
                raise ValueError("path is required")
            return root, ""

        clean = sanitize_relative_path(raw)
        if any(part in EXCLUDED_NAMES for part in clean.split("/")):
            raise FileNotFoundError("Path not found")

        try:
            resolved = safe_join(root, clean)
        except ValueError as e:
            # ``sanitize_relative_path`` already rejected ``..``/absolute paths,
            # so the only way to escape here is a symlink pointing outside the
            # root. Report it as a forbidden path without leaking absolutes.
            raise PathEscapeError("Path escapes the pipeline repository") from e
        return resolved, clean

    @staticmethod
    def _try_repo(pipeline: Pipeline):
        """Return a read-only git repo handle, or ``None`` when unavailable."""
        try:
            root = pipeline.workspace_abs_path
            if not root:
                return None
            return git_utils.get_repo(str(root))
        except Exception:
            logger.debug("No git repository for pipeline", exc_info=True)
            return None

    @staticmethod
    def _statuses_for(
        pipeline: Pipeline, rel_paths: List[str]
    ) -> Optional[Dict[str, str]]:
        """Return a path -> status map, or ``None`` when git is unavailable."""
        repo = FileBrowserService._try_repo(pipeline)
        if repo is None:
            return None
        if not rel_paths:
            return {}
        try:
            return git_utils.get_paths_git_status(repo, rel_paths)
        except Exception:
            logger.debug("Could not compute git status", exc_info=True)
            return None

    @staticmethod
    def _status_for(pipeline: Pipeline, rel_path: str) -> Optional[str]:
        repo = FileBrowserService._try_repo(pipeline)
        if repo is None:
            return None
        try:
            return git_utils.get_file_git_status(repo, rel_path)
        except Exception:
            logger.debug("Could not compute git status", exc_info=True)
            return None

    @staticmethod
    def _has_children(path: Path) -> bool:
        try:
            for child in path.iterdir():
                if child.name not in EXCLUDED_NAMES:
                    return True
        except OSError:
            return False
        return False

    @staticmethod
    def _build_entry(path: Path, rel_path: str, git_status: Optional[str]) -> FileEntry:
        try:
            stat = path.stat()
            is_dir = path.is_dir()
        except OSError as e:
            raise UnreadablePathError("Failed to read path metadata") from e

        return FileEntry(
            name=path.name,
            path=rel_path,
            is_dir=is_dir,
            size=None if is_dir else stat.st_size,
            created_at=_timestamp(stat.st_ctime),
            modified_at=_timestamp(stat.st_mtime),
            git_status=git_status,
            has_children=FileBrowserService._has_children(path) if is_dir else None,
        )

    @staticmethod
    async def list_directory(
        pipeline: Pipeline, rel_path: Optional[str] = ""
    ) -> DirectoryListing:
        """List a directory, sorted dirs-first then case-insensitive natural."""
        resolved, clean = FileBrowserService._resolve_path(
            pipeline, rel_path, allow_root=True
        )
        if not resolved.is_dir():
            raise FileNotFoundError("Path not found")

        try:
            children = [
                child
                for child in resolved.iterdir()
                if child.name not in EXCLUDED_NAMES
            ]
        except OSError as e:
            raise UnreadablePathError("Failed to list directory") from e

        rel_names = [_join_rel(clean, child.name) for child in children]
        statuses = FileBrowserService._statuses_for(pipeline, rel_names)

        entries: List[FileEntry] = []
        for child, rel_name in zip(children, rel_names):
            entries.append(
                FileBrowserService._build_entry(
                    child,
                    rel_name,
                    None if statuses is None else statuses.get(rel_name, "clean"),
                )
            )
        entries.sort(key=_entry_sort_key)

        return DirectoryListing(
            path=clean,
            parent=_parent_of(clean),
            entries=entries,
        )

    @staticmethod
    async def read_file(pipeline: Pipeline, rel_path: str) -> FileContent:
        """Read a text file, classifying binary/oversized content safely."""
        resolved, clean = FileBrowserService._resolve_path(
            pipeline, rel_path, allow_root=False
        )
        if resolved.is_dir():
            raise IsADirectoryError("Path is a directory")
        if not resolved.is_file():
            raise FileNotFoundError("Path not found")

        try:
            stat = resolved.stat()
        except OSError as e:
            raise UnreadablePathError("Failed to read file metadata") from e

        try:
            with open(resolved, "rb") as handle:
                raw = handle.read(MAX_TEXT_BYTES + 1)
        except OSError as e:
            raise UnreadablePathError("Failed to read file") from e

        truncated = len(raw) > MAX_TEXT_BYTES
        content_bytes = raw[:MAX_TEXT_BYTES]
        is_binary = b"\x00" in content_bytes[:BINARY_SNIFF_BYTES]

        git_status = FileBrowserService._status_for(pipeline, clean)

        if is_binary:
            return FileContent(
                path=clean,
                name=resolved.name,
                size=stat.st_size,
                created_at=_timestamp(stat.st_ctime),
                modified_at=_timestamp(stat.st_mtime),
                git_status=git_status,
                is_binary=True,
                truncated=truncated,
                encoding=None,
                content=None,
            )

        try:
            text = content_bytes.decode("utf-8")
        except UnicodeDecodeError:
            text = content_bytes.decode("utf-8", errors="replace")

        return FileContent(
            path=clean,
            name=resolved.name,
            size=stat.st_size,
            created_at=_timestamp(stat.st_ctime),
            modified_at=_timestamp(stat.st_mtime),
            git_status=git_status,
            is_binary=False,
            truncated=truncated,
            encoding="utf-8",
            content=text,
        )

    @staticmethod
    async def get_meta(pipeline: Pipeline, rel_path: str) -> FileEntry:
        """Return metadata + git status for a single entry (refresh)."""
        resolved, clean = FileBrowserService._resolve_path(
            pipeline, rel_path, allow_root=False
        )
        if not resolved.exists():
            raise FileNotFoundError("Path not found")
        statuses = FileBrowserService._statuses_for(pipeline, [clean])
        return FileBrowserService._build_entry(
            resolved,
            clean,
            None if statuses is None else statuses.get(clean, "clean"),
        )


__all__ = [
    "FileBrowserService",
    "PathEscapeError",
    "UnreadablePathError",
    "MAX_TEXT_BYTES",
    "BINARY_SNIFF_BYTES",
]
