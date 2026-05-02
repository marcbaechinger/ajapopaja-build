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

import json
import logging
from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException

from api.assistant.tools.git_tools import git_commit_hunks
from api.assistant.tools.nvim_tools import nvim_diffview_open, nvim_set_quickfix
from api.auth import get_current_user
from core.models.models import TaskStatus
from core.queries import task as task_queries

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/editor", tags=["editor"], dependencies=[Depends(get_current_user)]
)


@router.post("/quickfix/{task_id}")
async def open_quickfix(task_id: str) -> Dict[str, str]:
    """
    Triggers a Neovim quickfix for the specified implemented task.

    Args:
        task_id: The ID of the task to populate the quickfix with.

    Returns:
        A dictionary indicating the status of the operation.

    Raises:
        HTTPException: If the task is not found, not implemented, or if the
                       operation fails.
    """
    task = await task_queries.get_task_by_id(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if task.status != TaskStatus.IMPLEMENTED or not task.commit_hash:
        raise HTTPException(
            status_code=400, detail="Task is not implemented or has no commit hash"
        )

    # 1. Get hunks for the commit
    hunks_json = await git_commit_hunks(task.pipeline_id, task.commit_hash)
    if hunks_json.startswith("Error"):
        raise HTTPException(status_code=500, detail=hunks_json)

    try:
        hunks = json.loads(hunks_json)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse hunks: {str(e)}")

    # 2. Map hunks to quickfix matches
    matches = [
        {
            "filename": h["file"],
            "lnum": h["first_line"],
            "text": f"[{h['type']}] {task.title}",
        }
        for h in hunks
    ]

    # 3. Set quickfix in Neovim
    result = await nvim_set_quickfix(
        task.pipeline_id, matches, title=f"Task: {task.title}"
    )

    if not result.get("success"):
        raise HTTPException(
            status_code=500, detail=result.get("error", "Failed to set quickfix")
        )

    return {"status": "ok"}


@router.post("/call/{command}")
async def call_editor_command(
    command: str,
    options: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Generic endpoint for executing various editor commands.

    Supported commands:
    - 'quickfix': Triggers the quickfix for a task.
      Options: {'task_id': '...'}
    - 'diff_view_open': Opens a diff view for a specific commit.
      Options: {'pipeline_id': '...', 'commit_hash': '...'}

    Args:
        command: The name of the command to execute.
        options: A dictionary of arguments specific to the command.

    Returns:
        A dictionary containing the command execution status.

    Raises:
        HTTPException: If the command is unknown or required options are missing.
    """
    if command == "quickfix":
        task_id = options.get("task_id")
        if not task_id:
            raise HTTPException(
                status_code=400, detail="task_id is required for quickfix command"
            )
        return await open_quickfix(task_id)

    if command == "diff_view_open":
        pipeline_id = options.get("pipeline_id")
        commit_hash = options.get("commit_hash")
        if not pipeline_id or not commit_hash:
            raise HTTPException(
                status_code=400,
                detail="pipeline_id and commit_hash are required for diff_view_open command",
            )
        result = await nvim_diffview_open(pipeline_id, commit_hash)
        if not result.get("success"):
            raise HTTPException(
                status_code=500, detail=result.get("error", "Failed to open diff view")
            )
        return {"status": "ok"}

    raise HTTPException(status_code=400, detail=f"Unknown editor command: {command}")
