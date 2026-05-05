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

import subprocess
from pathlib import Path

from api.assistant.tools.git_tools import git_diff, git_status
from api.assistant.tools.search_tools import grep, read_file as read_source_file, tree
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


def _validate_path(task_id: str, relative_path: str, allow_root: bool = False) -> Path:
    """
    Validates that the path is within the sandbox for the given task.
    Rejects directory traversal (..), absolute paths, and empty paths (unless allow_root is True).
    """
    if not relative_path or relative_path.strip() in ("", ".", "./"):
        if not allow_root:
            raise ValueError("Relative path cannot be empty or root.")
        relative_path = "."

    sandbox_root = _get_sandbox_path(task_id)
    try:
        return safe_join(sandbox_root, relative_path)
    except ValueError as e:
        raise ValueError(f"Security error: {str(e)}")


async def write_file(pipeline_id: str, task_id: str, path: str, content: str):
    """
    Writes the full content to a file in the sandbox. Overwrites if exists.
    The path must be relative to the sandbox root and cannot escape it.
    Empty paths or root access are not allowed for this tool.

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
    The path must be relative to the sandbox root and cannot escape it.
    Empty paths or root access are not allowed for this tool.

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
    """
    helper = None
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

        return (
            f"Pull Request created successfully for task {task_id}. Summary: {summary}"
        )
    except Exception as e:
        return f"Error completing task: {str(e)}"
    finally:
        if helper:
            # Cleanup sandbox after PR creation (or failure)
            helper.cleanup()


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
