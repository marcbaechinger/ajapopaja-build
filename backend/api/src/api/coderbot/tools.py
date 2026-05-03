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
from pathlib import Path
from typing import Any, Dict, Optional

from api.assistant.tools.search_tools import (
    _python_tree,
)
from api.assistant.tools.search_tools import (
    _run_command as search_run_command,
)
from api.websocket_manager import WSMessage, manager as ws_manager
from core import config
from core.models.models import Pipeline, PullRequest, PullRequestStatus
from core.utils.path_utils import safe_join

from .git_helper import SandboxGitHelper
from .registry import coderbot_registry


def _get_sandbox_path(task_id: str) -> Path:
    sandbox_root = (config.SANDBOX_ROOT / task_id).resolve()
    # Ensure sandbox root exists
    sandbox_root.mkdir(parents=True, exist_ok=True)
    return sandbox_root


def _validate_path(task_id: str, relative_path: str) -> Path:
    """
    Validates that the path is within the sandbox for the given task.
    Rejects directory traversal (..) and absolute paths.
    """
    sandbox_root = _get_sandbox_path(task_id)
    try:
        return safe_join(sandbox_root, relative_path)
    except ValueError as e:
        raise ValueError(f"Security error: {str(e)}")


async def write_file(pipeline_id: str, task_id: str, path: str, content: str):
    """
    Writes the full content to a file in the sandbox. Overwrites if exists.

    Args:
        path: The relative path to the file.
        content: The full content to write.
    """
    try:
        target_path = _validate_path(task_id, path)
        target_path.parent.mkdir(parents=True, exist_ok=True)
        target_path.write_text(content)
        return f"Successfully wrote to {path}"
    except Exception as e:
        return f"Error writing file: {str(e)}"


async def write_file_partially(
    pipeline_id: str, task_id: str, path: str, old_string: str, new_string: str
):
    """
    Replaces exactly one occurrence of old_string with new_string in a file.

    Args:
        path: The relative path to the file.
        old_string: The exact literal text to replace.
        new_string: The replacement text.
    """
    try:
        target_path = _validate_path(task_id, path)
        content = target_path.read_text()
        if content.count(old_string) == 0:
            return f"Error: '{old_string}' not found in {path}"
        if content.count(old_string) > 1:
            return f"Error: Multiple occurrences of '{old_string}' found in {path}"

        new_content = content.replace(old_string, new_string)
        target_path.write_text(new_content)
        return f"Successfully updated {path}"
    except Exception as e:
        return f"Error updating file: {str(e)}"


async def run_command(task_id: str, command: str):
    """Internal helper to run commands in the sandbox."""
    sandbox_root = _get_sandbox_path(task_id)
    try:
        process = subprocess.run(
            command,
            shell=True,
            cwd=str(sandbox_root),
            capture_output=True,
            text=True,
            timeout=300,  # 5 minutes
        )
        return {
            "stdout": process.stdout,
            "stderr": process.stderr,
            "exit_code": process.returncode,
        }
    except subprocess.TimeoutExpired:
        return {"error": "Command timed out after 5 minutes"}
    except Exception as e:
        return {"error": str(e)}


async def lint(pipeline_id: str, task_id: str):
    """
    Runs project-specific linting in the sandbox.
    """
    # For now, we'll try common lint commands or assume standard ones
    # In a more robust implementation, we'd detect this based on the project.
    res = await run_command(task_id, "uv run ruff check . || npm run lint || true")
    return res


async def test(pipeline_id: str, task_id: str):
    """
    Runs project-specific tests in the sandbox.
    """
    res = await run_command(task_id, "uv run pytest || CI=true npm test || true")
    return res


async def task_completed(pipeline_id: str, task_id: str, summary: str):
    """
    Called when the coding task is completed. This creates a Pull Request.

    Args:
        summary: A summary of the changes made and the work done.
    """
    try:
        pipeline = await Pipeline.get(pipeline_id)
        if not pipeline:
            return "Error: Pipeline not found"

        helper = SandboxGitHelper(task_id, pipeline.workspace_abs_path)

        # Ensure changes are committed in the sandbox branch
        repo = helper.get_repo()
        repo.git.add(A=True)
        try:
            repo.git.commit("-m", f"CoderBot: {summary}")
        except Exception:
            # Maybe nothing to commit
            pass

        patch = helper.get_patch()

        pr = PullRequest(
            pipeline_id=pipeline_id,
            task_id=task_id,
            summary=summary,
            branch_name=helper.branch_name,
            patch=patch,
            status=PullRequestStatus.OPEN,
        )
        await pr.insert()

        # Broadcast event
        await ws_manager.broadcast(
            WSMessage(
                type="PULL_REQUEST_CREATED",
                payload={
                    "id": str(pr.id),
                    "pipeline_id": pipeline_id,
                    "task_id": task_id,
                    "summary": summary,
                },
            )
        )

        # Cleanup sandbox after PR creation
        helper.cleanup()

        return (
            f"Pull Request created successfully for task {task_id}. Summary: {summary}"
        )
    except Exception as e:
        return f"Error completing task: {str(e)}"


async def tree(
    pipeline_id: str,
    task_id: str,
    path: str = ".",
    depth: Optional[int] = None,
    follow_symlinks: bool = False,
) -> str:
    """
    Produce a tree view of the directory structure in the sandbox.

    Args:
        path: Relative path to the directory to tree (optional, defaults to root).
        depth: Maximum display depth of the directory tree.
        follow_symlinks: If True, follow symbolic links.
    """
    try:
        full_path = _validate_path(task_id, path)
    except ValueError as e:
        return str(e)

    if not os.path.isdir(full_path):
        return f"Error: Directory not found: {path}"

    ignore_pattern = "|".join(config.IGNORED_DIRECTORIES)
    args = ["tree", "--noreport", "-I", ignore_pattern]
    if depth is not None:
        args.extend(["-L", str(depth)])
    if follow_symlinks:
        args.append("-l")

    args.append(".")

    try:
        subprocess.run(["tree", "--version"], capture_output=True, check=True)
        result = await search_run_command(str(full_path), args)
        return result[:10000]
    except (subprocess.CalledProcessError, FileNotFoundError):
        return _python_tree(str(full_path), depth)


async def read_source_file(pipeline_id: str, task_id: str, path: str) -> str:
    """
    Reads the content of a source file from the sandbox.

    Args:
        path: Relative path to the file from the project root.
    """
    try:
        target_path = _validate_path(task_id, path)
        with open(target_path, "r") as f:
            return f.read()
    except Exception as e:
        return f"Error reading file: {str(e)}"


async def grep(
    pipeline_id: str,
    task_id: str,
    pattern: str,
    file_extension: Optional[str] = None,
    ignore_case: bool = False,
    context_lines: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Run a recursive grep in the sandbox.

    Args:
        pattern: The regex pattern to search for.
        file_extension: Only search in files matching this extension (e.g., "*.ts").
        ignore_case: If True, perform case-insensitive search.
        context_lines: Number of lines of context to include before and after matches.
    """
    sandbox_root = _get_sandbox_path(task_id)
    args = ["grep", "-rnI"]
    if ignore_case:
        args.append("-i")
    if context_lines is not None and int(context_lines) > 0:
        args.append(f"-C{context_lines}")

    if file_extension:
        args.append(f"--include={file_extension}")

    for ignore_dir in config.IGNORED_DIRECTORIES:
        args.append(f"--exclude-dir={ignore_dir}")

    args.append("-E")
    args.append(pattern)
    args.append(".")

    result = await search_run_command(str(sandbox_root), args)

    if result.startswith("Error:"):
        return {"error": result}

    if result == "No results found.":
        return {"matches": [], "total_matches": 0, "truncated": False}

    all_matches = []
    for line in result.splitlines():
        parts = line.split(":", 2)
        if len(parts) >= 3:
            try:
                path = parts[0]
                line_num = int(parts[1])
                text = parts[2]
                clean_path = path[2:] if path.startswith("./") else path
                all_matches.append(
                    {
                        "path": clean_path,
                        "line": line_num,
                        "match": text.strip()[:100],
                    }
                )
            except (ValueError, IndexError):
                continue
        if len(all_matches) >= 1000:
            break

    total_matches = len(all_matches)
    matches = all_matches[:10]
    truncated = total_matches > 10

    return {
        "matches": matches,
        "total_matches": total_matches,
        "truncated": truncated,
    }


async def git_status(pipeline_id: str, task_id: str) -> str:
    """
    Shows the working-tree status in the sandbox.
    """
    try:
        pipeline = await Pipeline.get(pipeline_id)
        helper = SandboxGitHelper(task_id, pipeline.workspace_abs_path)
        repo = helper.get_repo()
        return repo.git.status()
    except Exception as e:
        return f"Error: {str(e)}"


async def git_diff(pipeline_id: str, task_id: str) -> str:
    """
    Shows the diff in the sandbox.
    """
    try:
        pipeline = await Pipeline.get(pipeline_id)
        helper = SandboxGitHelper(task_id, pipeline.workspace_abs_path)
        repo = helper.get_repo()
        return repo.git.diff()
    except Exception as e:
        return f"Error: {str(e)}"


coderbot_registry.register_tool(tree)
coderbot_registry.register_tool(read_source_file)
coderbot_registry.register_tool(grep)
coderbot_registry.register_tool(git_status)
coderbot_registry.register_tool(git_diff)
coderbot_registry.register_tool(write_file)
coderbot_registry.register_tool(write_file_partially)
coderbot_registry.register_tool(lint)
coderbot_registry.register_tool(test)
coderbot_registry.register_tool(task_completed)
