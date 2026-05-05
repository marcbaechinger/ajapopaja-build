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

from typing import Dict, Tuple

import git

from core.exceptions import EntityNotFoundError
from core.models.models import Pipeline
from core.queries import pipeline as pipeline_queries
from core.queries import task as task_queries
from core.utils.path_utils import get_workspace_path


def get_repo(workspace_abs_path: str) -> git.Repo:
    """Returns a git.Repo instance for the given absolute path."""
    return git.Repo(workspace_abs_path)


async def get_repo_for_pipeline(
    pipeline_id: str, task_id: str | None = None, use_sandbox: bool = False
) -> git.Repo:
    """
    Fetches the pipeline and returns a git.Repo instance for its workspace.
    Raises EntityNotFoundError if pipeline or workspace path is missing.
    """
    _, repo = await get_pipeline_and_repo(pipeline_id, task_id, use_sandbox)
    return repo


async def get_pipeline_and_repo(
    pipeline_id: str, task_id: str | None = None, use_sandbox: bool = False
) -> Tuple[Pipeline, git.Repo]:
    """
    Fetches the pipeline and returns both the pipeline and a git.Repo instance.
    Raises EntityNotFoundError if pipeline or workspace path is missing.
    """
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    if not pipeline or not pipeline.workspace_abs_path:
        raise EntityNotFoundError(
            f"Workspace path not found for pipeline {pipeline_id}"
        )

    workspace_path = await get_workspace_path(
        pipeline_id, task_id, use_sandbox, pipeline=pipeline
    )
    return pipeline, get_repo(str(workspace_path))


async def get_repo_for_pipeline_by_task(task_id: str) -> git.Repo:
    """
    Fetches the task and its pipeline, then returns a git.Repo instance.
    Raises EntityNotFoundError if task, pipeline, or workspace path is missing.
    """
    task = await task_queries.get_task_by_id(task_id)
    return await get_repo_for_pipeline(task.pipeline_id)


def validate_commit_hash(repo: git.Repo, commit_hash: str) -> bool:
    """Verifies that the given commit hash exists in the repository."""
    try:
        repo.git.show(commit_hash, "--no-patch")
        return True
    except git.exc.GitCommandError:
        return False


def get_git_status_summary(repo: git.Repo) -> Dict[str, int]:
    """Returns a summary of staged, unstaged, and untracked changes."""
    status_output = repo.git.status("--porcelain")
    staged = 0
    unstaged = 0
    untracked = 0

    for line in status_output.splitlines():
        if len(line) < 3:
            continue
        x, y = line[0], line[1]
        if x == "?" and y == "?":
            untracked += 1
        else:
            if x != " ":
                staged += 1
            if y != " " and y != "?":
                unstaged += 1

    return {"staged": staged, "unstaged": unstaged, "untracked": untracked}
