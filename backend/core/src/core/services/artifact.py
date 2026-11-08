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

"""Live metadata/fingerprint computation for a pipeline build artifact.

The artifact is a pipeline *declaration* (``Pipeline.build_artifact``), not a
persisted document. This service resolves the declared file inside the
pipeline workspace, stats and hashes it, and derives the source version from the
workspace git repository. All path handling is delegated to
:class:`~core.services.file_browser.FileBrowserService`, so artifact paths get
exactly the same traversal/``.git`` protection as the file browser.

The module is intentionally free of FastAPI and database dependencies beyond
the model types, making it reusable from REST routes, MCP tools and assistant
tools.
"""

import hashlib
import logging
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Dict, Optional

from core.exceptions import EntityNotFoundError
from core.models.models import BuildArtifactInfo, BuildArtifactSpec, Pipeline
from core.services.file_browser import FileBrowserService, guess_media_type
from core.utils import git_utils

logger = logging.getLogger(__name__)

# Streaming read size used while computing SHA-256. One MiB keeps memory use
# small while amortising syscall overhead for large artifacts (APKs/ZIPs).
HASH_CHUNK_SIZE = 1024 * 1024


def compute_sha256(path: Path) -> str:
    """Return the lowercase hex SHA-256 digest of ``path`` by streaming it."""
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(HASH_CHUNK_SIZE), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _workspace_version(pipeline: Pipeline) -> Optional[str]:
    """Return the workspace ``HEAD`` commit, or ``None`` when not a git repo."""
    try:
        workspace = pipeline.workspace_abs_path
        if not workspace:
            return None
        repo = git_utils.get_repo(str(workspace))
        return repo.head.commit.hexsha or None
    except Exception:
        # Missing workspace, non-git directory, unborn branch, detached/broken
        # repository, etc. all simply mean there is no version to report.
        logger.debug("Could not determine artifact workspace version", exc_info=True)
        return None


def _build_commands_configured(pipeline: Pipeline) -> bool:
    """Whether the pipeline has at least one configured build command."""
    commands = getattr(pipeline, "build_commands", None)
    if commands is None:
        return False
    try:
        return len(commands) > 0
    except TypeError:
        return bool(commands)


def _optional_text(value: Any) -> Optional[str]:
    """Return trimmed text, treating blanks/non-strings as unset."""
    if not isinstance(value, str):
        return None
    stripped = value.strip()
    return stripped or None


def _coerce_spec(pipeline: Pipeline) -> Optional[BuildArtifactSpec]:
    """Return a validated artifact spec, or ``None`` when not configured.

    Real pipelines always carry either ``None`` or a ``BuildArtifactSpec``.
    The dict/duck-typed branches make the service convenient for tests and
    callers that construct lightweight pipeline stand-ins.
    """
    spec = getattr(pipeline, "build_artifact", None)
    if spec is None:
        return None
    if isinstance(spec, BuildArtifactSpec):
        return spec
    if isinstance(spec, dict):
        return BuildArtifactSpec(**spec)

    raw_path = getattr(spec, "path", None)
    if not isinstance(raw_path, str):
        return None
    return BuildArtifactSpec(
        path=raw_path,
        label=_optional_text(getattr(spec, "label", None)),
        description=_optional_text(getattr(spec, "description", None)),
        media_type=_optional_text(getattr(spec, "media_type", None)),
    )


def _base_info(
    spec: Optional[BuildArtifactSpec],
    *,
    build_commands_configured: bool,
    version: Optional[str] = None,
) -> Dict[str, Any]:
    if spec is None:
        return {
            "path": None,
            "exists": False,
            "size": None,
            "modified_at": None,
            "version": None,
            "sha256": None,
            "media_type": None,
            "build_commands_configured": build_commands_configured,
            "label": None,
            "description": None,
        }

    return {
        "path": spec.path,
        "exists": False,
        "size": None,
        "modified_at": None,
        "version": version,
        "sha256": None,
        "media_type": spec.media_type or guess_media_type(spec.path),
        "build_commands_configured": build_commands_configured,
        "label": spec.label,
        "description": spec.description,
    }


def get_artifact_info(
    pipeline: Pipeline, include_hash: bool = True
) -> BuildArtifactInfo:
    """Compute the live :class:`BuildArtifactInfo` for ``pipeline``.

    The function is synchronous because stat/hash/git inspection are blocking
    operations. The returned model is awaitable, so async callers can simply
    ``await`` it without a thread hop.

    Set ``include_hash=False`` for cheap polling with ``size``/``modified_at``
    only; callers can request the authoritative SHA-256 when those change.
    """
    build_commands_configured = _build_commands_configured(pipeline)
    spec = _coerce_spec(pipeline)
    if spec is None:
        return BuildArtifactInfo(
            **_base_info(
                None,
                build_commands_configured=build_commands_configured,
            )
        )

    # ``version`` is workspace provenance and is useful even when the build
    # output is currently missing (e.g. the UI can show "build first").
    version = _workspace_version(pipeline)
    info = _base_info(
        spec,
        build_commands_configured=build_commands_configured,
        version=version,
    )

    try:
        resolved, clean = FileBrowserService.resolve_file(pipeline, spec.path)
    except (FileNotFoundError, IsADirectoryError, EntityNotFoundError):
        # Not configured/build not run yet, or the workspace itself is missing;
        # keep the configured path so the UI/agent can prompt for a build.
        return BuildArtifactInfo(**info)

    try:
        stat = os.stat(resolved)
        sha256 = compute_sha256(resolved) if include_hash else None
    except OSError:
        logger.warning("Could not read build artifact %s", clean, exc_info=True)
        return BuildArtifactInfo(**info)

    info.update(
        {
            "path": clean,
            "exists": True,
            "size": stat.st_size,
            "modified_at": datetime.fromtimestamp(stat.st_mtime, tz=UTC),
            "sha256": sha256,
        }
    )
    return BuildArtifactInfo(**info)


class ArtifactService:
    """Reusable, read-only service for pipeline build artifact metadata."""

    get = staticmethod(get_artifact_info)
    get_info = staticmethod(get_artifact_info)
    get_artifact = staticmethod(get_artifact_info)
    get_artifact_info = staticmethod(get_artifact_info)
    get_build_artifact = staticmethod(get_artifact_info)
    get_build_artifact_info = staticmethod(get_artifact_info)
    info = staticmethod(get_artifact_info)
    build_info = staticmethod(get_artifact_info)
    describe = staticmethod(get_artifact_info)


# Descriptive class alias for callers that prefer the full concept name.
BuildArtifactService = ArtifactService


# Convenient module-level aliases. ``get_build_artifact`` intentionally mirrors
# the future MCP tool name; it returns metadata only, never file bytes.
get_info = get_artifact_info
get_build_artifact = get_artifact_info
get_build_artifact_info = get_artifact_info
build_artifact_info = get_artifact_info
compute_artifact_info = get_artifact_info
get_artifact = get_artifact_info
get_artifact_metadata = get_artifact_info
artifact_info = get_artifact_info

# Backwards/utility aliases for callers that only need the content hash.
sha256_file = compute_sha256
_compute_sha256 = compute_sha256
_sha256 = compute_sha256
_hash_file = compute_sha256

# Version-helper aliases kept for callers that test provenance directly.
_get_version = _workspace_version
_head_version = _workspace_version


__all__ = [
    "ArtifactService",
    "BuildArtifactService",
    "HASH_CHUNK_SIZE",
    "artifact_info",
    "build_artifact_info",
    "compute_artifact_info",
    "compute_sha256",
    "get_artifact",
    "get_artifact_info",
    "get_artifact_metadata",
    "get_build_artifact",
    "get_build_artifact_info",
    "get_info",
    "sha256_file",
]
