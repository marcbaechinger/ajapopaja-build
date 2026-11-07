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

from fastapi import APIRouter, Depends, HTTPException

from api.auth import get_current_user
from core.models.models import TaskStatus
from core.queries import pipeline as pipeline_queries
from core.queries import task as task_queries
from core.utils import git_utils

from ..docbot.manager import DocBotManager

router = APIRouter(
    prefix="/pipelines/{pipeline_id}/docbot",
    tags=["docbot"],
    dependencies=[Depends(get_current_user)],
)
logger = logging.getLogger(__name__)


@router.post("/trigger/{task_id}")
async def trigger_docbot(pipeline_id: str, task_id: str):
    """
    Manually triggers a DocBot review session for a completed task.
    """
    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")

    task = await task_queries.get_task_by_id(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if task.pipeline_id != pipeline_id:
        raise HTTPException(
            status_code=400, detail="Task does not belong to this pipeline"
        )

    if task.status not in (TaskStatus.IMPLEMENTED, TaskStatus.SUBMITTED):
        raise HTTPException(
            status_code=400,
            detail="DocBot requires a task in IMPLEMENTED or SUBMITTED state",
        )

    if not task.commit_hash:
        raise HTTPException(
            status_code=400,
            detail="Task has no implementation commit",
        )

    if not pipeline.workspace_abs_path:
        raise HTTPException(status_code=404, detail="Pipeline workspace not found")

    try:
        repo = git_utils.get_repo(str(pipeline.workspace_abs_path))
        repo.commit(task.commit_hash)
    except Exception:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Implementation commit {task.commit_hash} is not present in the "
                "pipeline workspace. Sync the repository and retry."
            ),
        )

    # Queue the bot session
    try:
        await DocBotManager.process_completed_task(task)
        return {"status": "success", "message": "DocBot triggered successfully."}
    except Exception as e:
        logger.error(f"Failed to trigger DocBot: {e}")
        raise HTTPException(status_code=500, detail="Failed to trigger DocBot.")
