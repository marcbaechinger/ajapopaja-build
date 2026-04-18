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
from typing import Optional, List
from core.queries import pipeline as pipeline_queries
from api.assistant.decorators import register_tool

# Tool Categories
READ_ONLY = "read_only"


async def _run_git_command(workspace_path: str, args: List[str]) -> str:
    try:
        # Filter out empty strings if any
        cmd_args = [arg for arg in args if arg]
        result = subprocess.run(
            ["git"] + cmd_args,
            cwd=workspace_path,
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            return f"Error executing git command: {result.stderr}"
        return result.stdout
    except Exception as e:
        return f"Error: {str(e)}"


@register_tool(tool_type=READ_ONLY)
async def git_log(
    pipeline_id: str,
    author: Optional[str] = None,
    since: Optional[str] = None,
    until: Optional[str] = None,
    limit: int = 20,
) -> str:
    """
    Returns a list of recent commits (full SHA, author, date, message).

    Args:
        pipeline_id: The ID of the pipeline to which the project belongs.
        author: Filter by author name or email.
        since: Show commits more recent than a specific date.
        until: Show commits older than a specific date.
        limit: Maximum number of commits to return (default: 20).
    """
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    if not pipeline or not pipeline.workspace_path:
        return "Error: Workspace path not found."

    args = [
        "log",
        "-n",
        str(limit),
        "--pretty=format:%H | %an | %ad | %s",
        "--date=short",
    ]
    if author:
        args.append(f"--author={author}")
    if since:
        args.append(f"--since={since}")
    if until:
        args.append(f"--until={until}")

    return await _run_git_command(pipeline.workspace_path, args)


@register_tool(tool_type=READ_ONLY)
async def git_show_commit(pipeline_id: str, commit_sha: str) -> str:
    """
    Returns the diff, metadata, and file list for a single commit.

    Args:
        pipeline_id: The ID of the pipeline to which the project belongs.
        commit_sha: The SHA of the commit to show.
    """
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    if not pipeline or not pipeline.workspace_path:
        return "Error: Workspace path not found."

    return await _run_git_command(
        pipeline.workspace_path, ["show", "--stat", commit_sha]
    )


@register_tool(tool_type=READ_ONLY)
async def git_blame(
    pipeline_id: str, file_path: str, line_number: Optional[int] = None
) -> str:
    """
    Returns blame info (author, date, commit) for a line or file.

    Args:
        pipeline_id: The ID of the pipeline to which the project belongs.
        file_path: Relative path to the file.
        line_number: Specific line number to blame (optional).
    """
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    if not pipeline or not pipeline.workspace_path:
        return "Error: Workspace path not found."

    args = ["blame"]
    if line_number:
        args.extend(["-L", f"{line_number},{line_number}"])
    args.append(file_path)

    return await _run_git_command(pipeline.workspace_path, args)


@register_tool(tool_type=READ_ONLY)
async def git_status(pipeline_id: str) -> str:
    """
    Shows the working-tree status (modified, added, deleted, staged).

    Args:
        pipeline_id: The ID of the pipeline to which the project belongs.
    """
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    if not pipeline or not pipeline.workspace_path:
        return "Error: Workspace path not found."

    return await _run_git_command(pipeline.workspace_path, ["status"])


@register_tool(tool_type=READ_ONLY)
async def git_branch_list(pipeline_id: str) -> str:
    """
    Lists all local and remote branches.

    Args:
        pipeline_id: The ID of the pipeline to which the project belongs.
    """
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    if not pipeline or not pipeline.workspace_path:
        return "Error: Workspace path not found."

    return await _run_git_command(pipeline.workspace_path, ["branch", "-a"])


@register_tool(tool_type=READ_ONLY)
async def git_diff(
    pipeline_id: str,
    commit_a: Optional[str] = None,
    commit_b: Optional[str] = None,
    file_path: Optional[str] = None,
) -> str:
    """
    Returns the diff between two refs or between a ref and the working tree.

    Args:
        pipeline_id: The ID of the pipeline to which the project belongs.
        commit_a: Base ref (optional).
        commit_b: Target ref (optional).
        file_path: Specific file to diff (optional).
    """
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    if not pipeline or not pipeline.workspace_path:
        return "Error: Workspace path not found."

    args = ["diff"]
    if commit_a:
        if commit_b:
            args.append(f"{commit_a}..{commit_b}")
        else:
            args.append(commit_a)

    if file_path:
        args.extend(["--", file_path])

    return await _run_git_command(pipeline.workspace_path, args)
