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
from typing import Any, Dict, Optional

from api.assistant.decorators import register_tool
from core.config import IGNORED_DIRECTORIES

from .shared_utils import (
    get_match_context,
    get_workspace_path,
    python_tree_impl,
    run_command_in_dir,
    sanitize_and_resolve_path,
)

logger = logging.getLogger(__name__)

READ_ONLY = "read_only"


@register_tool(tool_type=READ_ONLY)
async def grep(
    pipeline_id: str,
    pattern: str,
    task_id: Optional[str] = None,
    use_sandbox: bool = False,
    file_extension: Optional[str] = None,
    ignore_case: bool = False,
    context_lines: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Run a recursive grep; return a list of matches with file paths and line numbers.

    Args:
        pipeline_id: The ID of the pipeline.
        pattern: The regex pattern to search for.
        task_id: The ID of the task (optional, used for sandbox).
        use_sandbox: If True, operate in the task's sandbox.
        file_extension: Only search in files matching this extension (e.g., "ts", ".ts", "*.ts").
        ignore_case: If True, perform case-insensitive search.
        context_lines: Number of lines of context to include before and after matches.
    """
    if file_extension:
        # Normalize the extension by stripping '*.' or '.' prefixes
        if file_extension.startswith("*."):
            file_extension = file_extension[2:]
        elif file_extension.startswith("."):
            file_extension = file_extension[1:]

    try:
        workspace_path = await get_workspace_path(pipeline_id, task_id, use_sandbox)
    except ValueError as e:
        return {"error": str(e)}

    args = ["grep", "-rnI"]
    if ignore_case:
        args.append("-i")
    if context_lines is not None and int(context_lines) > 0:
        args.append(f"-C{context_lines}")

    if file_extension:
        args.append(f"--include=*.{file_extension}")

    # Ignore common dirs like .git, node_modules, .venv, __pycache__
    for ignore_dir in IGNORED_DIRECTORIES:
        args.append(f"--exclude-dir={ignore_dir}")

    args.append("-E")  # Extended regex
    args.append(pattern)
    args.append(".")

    logger.info(f"grep with {args}")

    result = await run_command_in_dir(str(workspace_path), args)

    if result.startswith("Error:"):
        logger.warning(f"grep with error: {result}")
        return {"error": result}

    if result == "No results found.":
        logger.debug(f"grep with no results: {result}")
        return {"matches": [], "total_matches": 0, "truncated": False}

    all_matches = []
    # Grep output for -rnI is "file:line:text\n"
    for line in result.splitlines():
        if not line:
            continue

        # Standard grep output: path:line:text
        parts = line.split(":", 2)
        if len(parts) >= 3:
            try:
                path = parts[0]
                line_num = int(parts[1])
                text = parts[2]

                # Remove './' from start of path if present
                clean_path = path[2:] if path.startswith("./") else path
                all_matches.append(
                    {
                        "path": clean_path,
                        "line": line_num,
                        "match": get_match_context(text, pattern, ignore_case),
                    }
                )
            except (ValueError, IndexError):
                continue

        if len(all_matches) >= 1000:
            break

    total_matches = len(all_matches)
    matches = all_matches[:10]
    truncated = total_matches > 10

    logger.info(f"Grep tool found {total_matches} matches for pattern: '{pattern}'")
    return {
        "matches": matches,
        "total_matches": total_matches,
        "truncated": truncated,
    }


@register_tool(tool_type=READ_ONLY)
async def find(
    pipeline_id: str,
    name_pattern: str,
    task_id: Optional[str] = None,
    use_sandbox: bool = False,
    type: Optional[str] = None,
) -> str:
    """
    Search for files or directories matching a pattern.

    Args:
        pipeline_id: The ID of the pipeline.
        name_pattern: Pattern to match against filename (e.g., "*.txt", "config*").
        task_id: The ID of the task (optional, used for sandbox).
        use_sandbox: If True, operate in the task's sandbox.
        type: 'f' for file, 'd' for directory. Optional.
    """
    try:
        workspace_path = await get_workspace_path(pipeline_id, task_id, use_sandbox)
    except ValueError as e:
        return str(e)

    # Let's simplify find to avoid complex subprocess escaping issues with -prune
    args_simple = ["find", ".", "-name", name_pattern]
    if type:
        if type not in ["f", "d"]:
            return "Error: type must be 'f' or 'd'."
        args_simple.extend(["-type", type])

    try:
        result = subprocess.run(
            args_simple,
            cwd=str(workspace_path),
            capture_output=True,
            text=True,
            check=False,
        )
        output = result.stdout
        # Filter out ignored directories manually
        lines = output.splitlines()
        ignored = [f"{d}/" for d in IGNORED_DIRECTORIES]
        filtered_lines = [
            line for line in lines if not any(ig in line for ig in ignored)
        ]
        return "\n".join(filtered_lines)[:10000]
    except Exception as e:
        return f"Error: {str(e)}"


@register_tool(tool_type=READ_ONLY)
async def tree(
    pipeline_id: str,
    path: str = ".",
    task_id: Optional[str] = None,
    use_sandbox: bool = False,
    depth: Optional[int] = None,
    follow_symlinks: bool = False,
) -> str:
    """
    Produce a tree view of the directory structure.

    Args:
        pipeline_id: The ID of the pipeline.
        path: Relative path to the directory to tree (optional, defaults to root).
        task_id: The ID of the task (optional, used for sandbox).
        use_sandbox: If True, operate in the task's sandbox.
        depth: Maximum display depth of the directory tree.
        follow_symlinks: If True, follow symbolic links.
    """
    full_path = await sanitize_and_resolve_path(pipeline_id, path, task_id, use_sandbox)
    if not full_path:
        return "Error: Invalid path. Path must be relative and within workspace."

    if not os.path.isdir(full_path):
        return f"Error: Directory not found: {path}"

    ignore_pattern = "|".join(IGNORED_DIRECTORIES)
    args = ["tree", "--noreport", "-I", ignore_pattern]
    if depth is not None:
        args.extend(["-L", str(depth)])
    if follow_symlinks:
        args.append("-l")

    args.append(".")

    try:
        # Check if tree is available
        subprocess.run(["tree", "--version"], capture_output=True, check=True)
        result = await run_command_in_dir(str(full_path), args)
        return result[:10000]
    except (subprocess.CalledProcessError, FileNotFoundError):
        # Python fallback if 'tree' command is missing
        return python_tree_impl(str(full_path), depth)


@register_tool(tool_type=READ_ONLY)
async def read_file(
    pipeline_id: str,
    file_path: str,
    task_id: Optional[str] = None,
    use_sandbox: bool = False,
) -> str:
    """
    Reads the content of a file.

    Args:
        pipeline_id: The ID of the pipeline.
        file_path: Relative path to the file.
        task_id: The ID of the task (optional, used for sandbox).
        use_sandbox: If True, operate in the task's sandbox.
    """
    full_path = await sanitize_and_resolve_path(
        pipeline_id, file_path, task_id, use_sandbox
    )
    if not full_path:
        return "Error: Invalid path. Path must be relative and within workspace."

    if not os.path.isfile(full_path):
        return f"Error: File not found: {file_path}"

    try:
        return full_path.read_text(encoding="utf-8")
    except Exception as e:
        return f"Error reading file: {str(e)}"


@register_tool(tool_type=READ_ONLY)
async def head(
    pipeline_id: str,
    file_path: str,
    task_id: Optional[str] = None,
    use_sandbox: bool = False,
    lines: int = 10,
) -> str:
    """
    Return the first N lines of a file.

    Args:
        pipeline_id: The ID of the pipeline.
        file_path: Relative path to the file.
        task_id: The ID of the task (optional, used for sandbox).
        use_sandbox: If True, operate in the task's sandbox.
        lines: Number of lines to return.
    """
    full_path = await sanitize_and_resolve_path(
        pipeline_id, file_path, task_id, use_sandbox
    )
    if not full_path:
        return "Error: Invalid path. Path must be relative and within workspace."

    if not os.path.isfile(full_path):
        return f"Error: File not found: {file_path}"

    try:
        with open(full_path, "r", encoding="utf-8") as f:
            head_lines = []
            for _ in range(lines):
                line = f.readline()
                if not line:
                    break
                head_lines.append(line)
            return "".join(head_lines)
    except Exception as e:
        return f"Error reading file: {str(e)}"


@register_tool(tool_type=READ_ONLY)
async def tail(
    pipeline_id: str,
    file_path: str,
    task_id: Optional[str] = None,
    use_sandbox: bool = False,
    lines: int = 10,
) -> str:
    """
    Return the last N lines of a file.

    Args:
        pipeline_id: The ID of the pipeline.
        file_path: Relative path to the file.
        task_id: The ID of the task (optional, used for sandbox).
        use_sandbox: If True, operate in the task's sandbox.
        lines: Number of lines to return.
    """
    try:
        workspace_path = await get_workspace_path(pipeline_id, task_id, use_sandbox)
    except ValueError as e:
        return str(e)

    full_path = await sanitize_and_resolve_path(
        pipeline_id, file_path, task_id, use_sandbox
    )
    if not full_path:
        return "Error: Invalid path. Path must be relative and within workspace."

    if not os.path.isfile(full_path):
        return f"Error: File not found: {file_path}"

    args = ["tail", "-n", str(lines), str(full_path)]
    return await run_command_in_dir(str(workspace_path), args)


@register_tool(tool_type=READ_ONLY)
async def search_file_content(
    pipeline_id: str,
    file_path: str,
    pattern: str,
    task_id: Optional[str] = None,
    use_sandbox: bool = False,
) -> str:
    """
    Search a single file for a regex pattern.

    Args:
        pipeline_id: The ID of the pipeline.
        file_path: Relative path to the file to search.
        pattern: The regex pattern to search for.
        task_id: The ID of the task (optional, used for sandbox).
        use_sandbox: If True, operate in the task's sandbox.
    """
    full_path = await sanitize_and_resolve_path(
        pipeline_id, file_path, task_id, use_sandbox
    )
    if not full_path:
        return "Error: Invalid path. Path must be relative and within workspace."

    if not os.path.isfile(full_path):
        return f"Error: File not found: {file_path}"

    try:
        regex = re.compile(pattern)
        matches = []
        with open(full_path, "r", encoding="utf-8") as f:
            for i, line in enumerate(f, 1):
                if regex.search(line):
                    matches.append(f"{i}: {line.rstrip()}")
                    if len(matches) >= 1000:
                        matches.append("... output truncated ...")
                        break
        if not matches:
            return "No results found."
        return "\n".join(matches)
    except re.error as e:
        return f"Error: Invalid regular expression: {str(e)}"
    except Exception as e:
        return f"Error reading file: {str(e)}"
