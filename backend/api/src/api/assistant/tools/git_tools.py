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
from typing import Optional, List
import git
from core.queries import pipeline as pipeline_queries
from core.utils.path_utils import safe_join
from api.assistant.decorators import register_tool

# Tool Categories
READ_ONLY = "read_only"


def _sanitize_path(workspace: str, rel_path: str) -> Optional[str]:
    try:
        return str(safe_join(Path(workspace), rel_path))
    except Exception:
        return None


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
    if not pipeline or not pipeline.workspace_abs_path:
        return "Error: Workspace path not found."

    try:
        repo = git.Repo(pipeline.workspace_abs_path)
        kwargs = {}
        if author:
            kwargs["author"] = author
        if since:
            kwargs["since"] = since
        if until:
            kwargs["until"] = until
            
        commits = list(repo.iter_commits(max_count=limit, **kwargs))
        if not commits:
            return "No commits found."
            
        return "\n".join([f"{c.hexsha} | {c.author.name} | {c.committed_datetime.strftime('%Y-%m-%d')} | {c.summary}" for c in commits])
    except git.exc.GitCommandError as e:
        return f"Error executing git command: {e}"
    except Exception as e:
        return f"Error: {str(e)}"


@register_tool(tool_type=READ_ONLY)
async def git_show_commit(pipeline_id: str, commit_sha: str) -> str:
    """
    Returns the diff, metadata, and file list for a single commit.

    Args:
        pipeline_id: The ID of the pipeline to which the project belongs.
        commit_sha: The SHA of the commit to show.
    """
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    if not pipeline or not pipeline.workspace_abs_path:
        return "Error: Workspace path not found."

    try:
        repo = git.Repo(pipeline.workspace_abs_path)
        return repo.git.show("--stat", commit_sha)
    except git.exc.GitCommandError as e:
        return f"Error executing git command: {e}"
    except Exception as e:
        return f"Error: {str(e)}"


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
    if not pipeline or not pipeline.workspace_abs_path:
        return "Error: Workspace path not found."

    full_path = _sanitize_path(str(pipeline.workspace_abs_path), file_path)
    if not full_path:
        return "Error: Invalid file path. Must be relative and within workspace."

    try:
        repo = git.Repo(pipeline.workspace_abs_path)
        args = []
        if line_number:
            args.extend(["-L", f"{line_number},{line_number}"])
        args.append(full_path)
        return repo.git.blame(*args)
    except git.exc.GitCommandError as e:
        return f"Error executing git command: {e}"
    except Exception as e:
        return f"Error: {str(e)}"


@register_tool(tool_type=READ_ONLY)
async def git_status(pipeline_id: str) -> str:
    """
    Shows the working-tree status (modified, added, deleted, staged).

    Args:
        pipeline_id: The ID of the pipeline to which the project belongs.
    """
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    if not pipeline or not pipeline.workspace_abs_path:
        return "Error: Workspace path not found."

    try:
        repo = git.Repo(pipeline.workspace_abs_path)
        return repo.git.status()
    except git.exc.GitCommandError as e:
        return f"Error executing git command: {e}"
    except Exception as e:
        return f"Error: {str(e)}"


@register_tool(tool_type=READ_ONLY)
async def git_branch_list(pipeline_id: str) -> str:
    """
    Lists all local and remote branches.

    Args:
        pipeline_id: The ID of the pipeline to which the project belongs.
    """
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    if not pipeline or not pipeline.workspace_abs_path:
        return "Error: Workspace path not found."

    try:
        repo = git.Repo(pipeline.workspace_abs_path)
        return repo.git.branch("-a")
    except git.exc.GitCommandError as e:
        return f"Error executing git command: {e}"
    except Exception as e:
        return f"Error: {str(e)}"


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
    if not pipeline or not pipeline.workspace_abs_path:
        return "Error: Workspace path not found."

    try:
        repo = git.Repo(pipeline.workspace_abs_path)
        args = []
        if commit_a:
            if commit_b:
                args.append(f"{commit_a}..{commit_b}")
            else:
                args.append(commit_a)

        if file_path:
            full_path = _sanitize_path(str(pipeline.workspace_abs_path), file_path)
            if not full_path:
                return "Error: Invalid file path. Must be relative and within workspace."
            args.extend(["--", full_path])

        return repo.git.diff(*args)
    except git.exc.GitCommandError as e:
        return f"Error executing git command: {e}"
    except Exception as e:
        return f"Error: {str(e)}"
