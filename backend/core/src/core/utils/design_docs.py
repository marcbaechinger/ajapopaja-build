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

"""Filesystem helpers backing the Design Doc Library dialog.

The functions in this module are deliberately free of HTTP/DB concerns so they
can be unit tested against a temporary ``doc_root``. They only resolve the
pipeline's ``doc_root`` under its workspace and read Markdown files from it,
keeping every access constrained to that directory via
:func:`core.utils.path_utils.safe_join`.
"""

import logging
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import List, Optional, Tuple

from core.exceptions import EntityNotFoundError, ValidationError
from core.models.models import DesignDocContent, DesignDocInfo, Pipeline
from core.utils.path_utils import safe_join

logger = logging.getLogger(__name__)

_MARKDOWN_SUFFIX = ".md"
# Upper bound on how much of a document is read for listing/title extraction.
# Design docs are small; this only guards against accidentally reading a huge
# file. The content endpoint reads the same cap.
_MAX_DOC_BYTES = 512 * 1024
_SNIPPET_RADIUS = 80


def _resolve_doc_root(pipeline: Pipeline) -> Optional[Path]:
    """Return the (contained) absolute ``doc_root`` directory for a pipeline.

    Returns ``None`` when the pipeline has no workspace or a ``doc_root`` that
    would escape the workspace.
    """
    if not pipeline.workspace_abs_path:
        return None
    try:
        return safe_join(pipeline.workspace_abs_path, pipeline.doc_root)
    except ValueError:
        logger.warning(
            "Invalid doc_root %r for pipeline %s", pipeline.doc_root, pipeline.id
        )
        return None


def _fallback_title(path: str) -> str:
    """Derive a human-friendly title from a relative file path."""
    stem = Path(path).stem
    pretty = stem.replace("_", " ").replace("-", " ").strip()
    return pretty or path


def _extract_title(content: str, fallback: str) -> str:
    """Return the first level-1 Markdown heading, else ``fallback``."""
    for line in content.splitlines():
        stripped = line.strip()
        if stripped.startswith("# "):
            heading = stripped[2:].strip()
            if heading:
                return heading
            break
    return fallback


def _make_snippet(content: str, query: str) -> Optional[str]:
    """Return a short single-line preview around the first content match."""
    index = content.lower().find(query.lower())
    if index == -1:
        return None
    start = max(0, index - _SNIPPET_RADIUS)
    end = min(len(content), index + len(query) + _SNIPPET_RADIUS)
    snippet = " ".join(content[start:end].split())
    if start > 0:
        snippet = "…" + snippet
    if end < len(content):
        snippet = snippet + "…"
    return snippet


def _read_text(path: Path) -> str:
    """Read at most ``_MAX_DOC_BYTES`` of a text file, replacing bad bytes."""
    with open(path, "rb") as handle:
        raw = handle.read(_MAX_DOC_BYTES)
    return raw.decode("utf-8", errors="replace")


def _modified_at(path: Path) -> datetime:
    return datetime.fromtimestamp(path.stat().st_mtime, tz=UTC)


def list_design_docs(
    pipeline: Pipeline, query: Optional[str] = None
) -> Tuple[List[DesignDocInfo], int]:
    """List the Markdown design documents under a pipeline's ``doc_root``.

    The directory is scanned recursively. When ``query`` is provided, a
    document is kept only when the query appears in its relative path or its
    content; content matches carry a ``snippet`` preview. Results are sorted by
    path (case-insensitive).
    """
    root = _resolve_doc_root(pipeline)
    if root is None or not root.is_dir():
        return [], 0

    query_norm = (query or "").strip()
    documents: List[DesignDocInfo] = []

    for dirpath, _dirnames, filenames in os.walk(root):
        for filename in filenames:
            if not filename.lower().endswith(_MARKDOWN_SUFFIX):
                continue
            full_path = Path(dirpath) / filename
            try:
                relative = full_path.relative_to(root).as_posix()
                content = _read_text(full_path)
                stat = full_path.stat()
            except OSError as exc:
                logger.warning("Skipping unreadable design doc %s: %s", full_path, exc)
                continue

            snippet: Optional[str] = None
            if query_norm:
                path_match = query_norm.lower() in relative.lower()
                snippet = _make_snippet(content, query_norm)
                if not path_match and snippet is None:
                    continue

            documents.append(
                DesignDocInfo(
                    path=relative,
                    title=_extract_title(content, _fallback_title(relative)),
                    size=stat.st_size,
                    modified_at=datetime.fromtimestamp(stat.st_mtime, tz=UTC),
                    snippet=snippet,
                )
            )

    documents.sort(key=lambda doc: doc.path.lower())
    return documents, len(documents)


def read_design_doc(pipeline: Pipeline, path: str) -> DesignDocContent:
    """Read a single Markdown design document identified by relative ``path``.

    Raises :class:`ValidationError` for malformed/invalid paths and
    :class:`EntityNotFoundError` when the document (or ``doc_root``) is missing.
    """
    root = _resolve_doc_root(pipeline)
    if root is None or not root.is_dir():
        raise EntityNotFoundError(
            f"No design documents found for pipeline {pipeline.id}: "
            f"'{pipeline.doc_root}' does not exist."
        )

    if not path or Path(path).is_absolute():
        raise ValidationError("Design document path must be a non-empty relative path.")
    if not path.lower().endswith(_MARKDOWN_SUFFIX):
        raise ValidationError("Only Markdown (.md) design documents can be read.")

    try:
        file_path = safe_join(root, path)
    except ValueError as exc:
        raise ValidationError(f"Invalid design document path '{path}'.") from exc

    if not file_path.is_file():
        raise EntityNotFoundError(f"Design document '{path}' not found.")

    try:
        content = _read_text(file_path)
        modified_at = _modified_at(file_path)
        size = file_path.stat().st_size
    except OSError as exc:
        raise EntityNotFoundError(
            f"Design document '{path}' could not be read: {exc}"
        ) from exc

    return DesignDocContent(
        path=path,
        title=_extract_title(content, _fallback_title(path)),
        content=content,
        size=size,
        modified_at=modified_at,
    )
