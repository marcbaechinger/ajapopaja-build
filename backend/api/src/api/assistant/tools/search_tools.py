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
import re
from pathlib import Path
from typing import Optional, List
from core.queries import pipeline as pipeline_queries
from core.utils.path_utils import safe_join
from api.assistant.decorators import register_tool

READ_ONLY = "read_only"


async def _run_command(workspace_path: str, args: List[str]) -> str:
    try:
        cmd_args = [arg for arg in args if arg]
        result = subprocess.run(
            cmd_args,
            cwd=workspace_path,
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode not in (0, 1): # grep returns 1 if no lines were selected
             return f"Error executing command {' '.join(cmd_args)}: {result.stderr}"
        return result.stdout if result.stdout else (result.stderr if result.stderr else "No results found.")
    except Exception as e:
        return f"Error: {str(e)}"

def _sanitize_path(workspace_path: str, relative_path: str) -> Optional[str]:
    try:
        return str(safe_join(Path(workspace_path), relative_path))
    except Exception:
        return None


@register_tool(tool_type=READ_ONLY)
async def grep(
    pipeline_id: str,
    pattern: str,
    file_glob: Optional[str] = None,
    ignore_case: bool = False,
    context_lines: Optional[int] = None,
) -> str:
    """
    Run a recursive grep; return file paths, line numbers, and snippets.

    Args:
        pipeline_id: The ID of the pipeline.
        pattern: The regex pattern to search for.
        file_glob: Only search in files matching this glob (e.g., "*.py").
        ignore_case: If True, perform case-insensitive search.
        context_lines: Number of lines of context to include before and after matches.
    """
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    if not pipeline or not pipeline.workspace_abs_path:
        return "Error: Workspace path not found."

    args = ["grep", "-rnI"]
    if ignore_case:
        args.append("-i")
    if context_lines is not None and context_lines > 0:
        args.append(f"-C{context_lines}")
    
    if file_glob:
        args.append(f"--include={file_glob}")
        
    # Ignore common dirs like .git, node_modules, .venv, __pycache__
    for ignore_dir in [".git", "node_modules", ".venv", "__pycache__", "dist"]:
        args.append(f"--exclude-dir={ignore_dir}")

    args.append("-E") # Extended regex
    args.append(pattern)
    args.append(".")

    result = await _run_command(str(pipeline.workspace_abs_path), args)
    return result[:10000] # Limit output size to prevent context overflow


@register_tool(tool_type=READ_ONLY)
async def find(
    pipeline_id: str,
    name_pattern: str,
    type: Optional[str] = None,
) -> str:
    """
    Search for files or directories matching a pattern.

    Args:
        pipeline_id: The ID of the pipeline.
        name_pattern: Pattern to match against filename (e.g., "*.txt", "config*").
        type: 'f' for file, 'd' for directory. Optional.
    """
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    if not pipeline or not pipeline.workspace_abs_path:
        return "Error: Workspace path not found."

    args = ["find", "."]
    
    # Prune ignored directories to speed up search
    args.extend(["-type", "d", "\\(", "-name", ".git", "-o", "-name", "node_modules", "-o", "-name", ".venv", "-o", "-name", "__pycache__", "\\)", "-prune", "-o"])
    
    if type:
        if type not in ["f", "d"]:
            return "Error: type must be 'f' or 'd'."
        args.extend(["-type", type])
        
    args.extend(["-name", name_pattern, "-print"])

    # run_command will struggle with the parenthesis if we just pass them, let's use a cleaner python implementation or simple find
    
    # Let's simplify find to avoid complex subprocess escaping issues with -prune
    args_simple = ["find", ".", "-name", name_pattern]
    if type:
         args_simple.extend(["-type", type])
         
    try:
         result = subprocess.run(
            args_simple,
            cwd=str(pipeline.workspace_abs_path),
            capture_output=True,
            text=True,
            check=False,
         )
         output = result.stdout
         # Filter out ignored directories manually
         lines = output.splitlines()
         ignored = [".git/", "node_modules/", ".venv/", "__pycache__/", "dist/"]
         filtered_lines = [l for l in lines if not any(ig in l for ig in ignored)]
         return "\n".join(filtered_lines)[:10000]
    except Exception as e:
         return f"Error: {str(e)}"


@register_tool(tool_type=READ_ONLY)
async def tree(
    pipeline_id: str,
    path: str = ".",
    depth: Optional[int] = None,
    follow_symlinks: bool = False,
) -> str:
    """
    Produce a tree view of the directory structure.

    Args:
        pipeline_id: The ID of the pipeline.
        path: Relative path to the directory to tree (optional, defaults to root).
        depth: Maximum display depth of the directory tree.
        follow_symlinks: If True, follow symbolic links.
    """
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    if not pipeline or not pipeline.workspace_abs_path:
        return "Error: Workspace path not found."

    full_path = _sanitize_path(str(pipeline.workspace_abs_path), path)
    if not full_path:
        return "Error: Invalid path. Path must be relative and within workspace."

    if not os.path.isdir(full_path):
        return f"Error: Directory not found: {path}"

    args = ["tree", "--noreport", "-I", ".git|node_modules|.venv|__pycache__|dist|.pytest_cache"]
    if depth is not None:
        args.extend(["-L", str(depth)])
    if follow_symlinks:
        args.append("-l")
        
    args.append(".")

    try:
         # Check if tree is available
         subprocess.run(["tree", "--version"], capture_output=True, check=True)
         result = await _run_command(full_path, args)
         return result[:10000]
    except (subprocess.CalledProcessError, FileNotFoundError):
         # Python fallback if 'tree' command is missing
         return _python_tree(full_path, depth)

def _python_tree(directory: str, max_depth: Optional[int] = None, current_depth: int = 0) -> str:
    if max_depth is not None and current_depth > max_depth:
        return ""
    
    output = []
    try:
        items = sorted(os.listdir(directory))
    except PermissionError:
        return ""
        
    ignored = [".git", "node_modules", ".venv", "__pycache__", "dist", ".pytest_cache"]
    items = [item for item in items if item not in ignored]
    
    for i, item in enumerate(items):
        is_last = (i == len(items) - 1)
        prefix = "└── " if is_last else "├── "
        indent = "    " if is_last else "│   "
        
        output.append(f"{prefix}{item}")
        
        path = os.path.join(directory, item)
        if os.path.isdir(path):
            sub_tree = _python_tree(path, max_depth, current_depth + 1)
            if sub_tree:
                sub_lines = sub_tree.splitlines()
                output.extend([f"{indent}{line}" for line in sub_lines])
                
    return "\n".join(output)


@register_tool(tool_type=READ_ONLY)
async def head(pipeline_id: str, file_path: str, lines: int = 10) -> str:
    """
    Return the first N lines of a file.

    Args:
        pipeline_id: The ID of the pipeline.
        file_path: Relative path to the file.
        lines: Number of lines to return.
    """
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    if not pipeline or not pipeline.workspace_abs_path:
        return "Error: Workspace path not found."

    full_path = _sanitize_path(str(pipeline.workspace_abs_path), file_path)
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
async def tail(pipeline_id: str, file_path: str, lines: int = 10) -> str:
    """
    Return the last N lines of a file.

    Args:
        pipeline_id: The ID of the pipeline.
        file_path: Relative path to the file.
        lines: Number of lines to return.
    """
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    if not pipeline or not pipeline.workspace_abs_path:
        return "Error: Workspace path not found."

    full_path = _sanitize_path(str(pipeline.workspace_abs_path), file_path)
    if not full_path:
        return "Error: Invalid path. Path must be relative and within workspace."
        
    if not os.path.isfile(full_path):
        return f"Error: File not found: {file_path}"

    args = ["tail", "-n", str(lines), full_path]
    return await _run_command(str(pipeline.workspace_abs_path), args)


@register_tool(tool_type=READ_ONLY)
async def search_file_content(pipeline_id: str, file_path: str, pattern: str) -> str:
    """
    Search a single file for a regex pattern.

    Args:
        pipeline_id: The ID of the pipeline.
        file_path: Relative path to the file to search.
        pattern: The regex pattern to search for.
    """
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    if not pipeline or not pipeline.workspace_abs_path:
        return "Error: Workspace path not found."

    full_path = _sanitize_path(str(pipeline.workspace_abs_path), file_path)
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
