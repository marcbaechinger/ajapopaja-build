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
