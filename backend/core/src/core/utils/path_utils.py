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
from pathlib import Path
from typing import Any


def sanitize_relative_path(raw: str) -> str:
    """Return a clean relative path.
    * Reject absolute paths
    * Remove leading slashes
    * Collapse '.' and '..' segments
    * Reject any traversal that would escape the root
    """
    if os.path.isabs(raw):
        raise ValueError("absolute path not allowed")

    # Normalise path
    path = Path(raw).as_posix()
    path = path.lstrip("/")  # remove leading slashes

    parts = []
    for part in Path(path).parts:
        if part == "..":
            if not parts:
                raise ValueError("workspace_path cannot escape root")
            parts.pop()
        elif part == "." or part == "":
            continue
        else:
            parts.append(part)

    cleaned = "/".join(parts)
    if not cleaned:
        raise ValueError("workspace_path cannot be empty or resolve to empty")

    return cleaned


def safe_join(base: Path, *parts: str) -> Path:
    """Join parts to base and verify containment."""
    # We resolve the base to make sure we have an absolute path to compare against
    base_resolved = base.resolve()

    # Join and resolve the full path
    joined = base_resolved.joinpath(*parts).resolve()

    try:
        joined.relative_to(base_resolved)
    except ValueError:
        raise ValueError(f"Path '{joined}' escapes root '{base_resolved}'")

    return joined


async def get_workspace_path(
    pipeline_id: str,
    task_id: str | None = None,
    use_sandbox: bool = False,
    pipeline: Any = None,
) -> Path:
    """
    Returns the absolute path to the workspace for the given pipeline and optional task.
    If use_sandbox is True and task_id is provided, returns the sandbox path.
    Otherwise, returns the pipeline's workspace path.
    """
    if use_sandbox and task_id:
        from core import config

        sandbox_path = (config.SANDBOX_ROOT / task_id).resolve()
        if sandbox_path.exists():
            return sandbox_path

    if not pipeline:
        from core.queries import pipeline as pipeline_queries

        pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)

    if not pipeline or not pipeline.workspace_abs_path:
        raise ValueError("Workspace path not found.")
    return Path(pipeline.workspace_abs_path)
