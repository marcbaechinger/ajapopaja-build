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

import logging
import os
import re
import subprocess
from pathlib import Path
from typing import List, Optional

from core.config import IGNORED_DIRECTORIES
from core.utils.path_utils import safe_join

logger = logging.getLogger(__name__)


async def run_command_in_dir(workspace_path: str, args: List[str]) -> str:
    try:
        cmd_args = [arg for arg in args if arg]
        result = subprocess.run(
            cmd_args,
            cwd=workspace_path,
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode not in (0, 1):  # grep returns 1 if no lines were selected
            return f"Error executing command {' '.join(cmd_args)}: {result.stderr}"
        return (
            result.stdout
            if result.stdout
            else (result.stderr if result.stderr else "No results found.")
        )
    except Exception as e:
        return f"Error: {str(e)}"


def get_match_context(
    text: str, pattern: str, ignore_case: bool, context: int = 50
) -> str:
    flags = re.IGNORECASE if ignore_case else 0
    try:
        match = re.search(pattern, text, flags)
        if not match:
            # Fallback if re.search doesn't find it
            return (
                text[: context * 2] + ("..." if len(text) > context * 2 else "")
            ).strip()

        start = max(0, match.start() - context)
        end = min(len(text), match.end() + context)

        prefix = "..." if start > 0 else ""
        suffix = "..." if end < len(text) else ""

        return (prefix + text[start:end] + suffix).strip()
    except Exception:
        return (
            text[: context * 2] + ("..." if len(text) > context * 2 else "")
        ).strip()


def python_tree_impl(
    directory: str, max_depth: Optional[int] = None, current_depth: int = 0
) -> str:
    if max_depth is not None and current_depth > max_depth:
        return ""

    output = []
    try:
        items = sorted(os.listdir(directory))
    except PermissionError:
        return ""

    ignored = IGNORED_DIRECTORIES
    items = [item for item in items if item not in ignored]

    for i, item in enumerate(items):
        is_last = i == len(items) - 1
        prefix = "└── " if is_last else "├── "
        indent = "    " if is_last else "│   "

        output.append(f"{prefix}{item}")

        path = os.path.join(directory, item)
        if os.path.isdir(path):
            sub_tree = python_tree_impl(path, max_depth, current_depth + 1)
            if sub_tree:
                sub_lines = sub_tree.splitlines()
                output.extend([f"{indent}{line}" for line in sub_lines])

    return "\n".join(output)


def sanitize_and_resolve_path(
    workspace_path: str, relative_path: str
) -> Optional[Path]:
    try:
        return safe_join(Path(workspace_path), relative_path)
    except Exception:
        return None
