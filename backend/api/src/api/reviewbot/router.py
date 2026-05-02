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
from core.queries import pipeline as pipeline_queries
from core.queries import task as task_queries

from .manager import ReviewBotManager

router = APIRouter(
    prefix="/pipelines/{pipeline_id}/reviewbot",
    tags=["reviewbot"],
    dependencies=[Depends(get_current_user)],
)
logger = logging.getLogger(__name__)


@router.post("/trigger/{task_id}")
async def trigger_reviewbot(pipeline_id: str, task_id: str):
    """
    Manually triggers a ReviewBot session for a completed task.
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

    if not task.commit_hash:
        raise HTTPException(
            status_code=400, detail="Task must have a commit hash to run ReviewBot"
        )

    # Queue the bot session
    try:
        await ReviewBotManager.process_completed_task(task)
        return {"status": "success", "message": "ReviewBot triggered successfully."}
    except Exception as e:
        logger.error(f"Failed to trigger ReviewBot: {e}")
        raise HTTPException(status_code=500, detail="Failed to trigger ReviewBot.")


@router.delete("/review/{task_id}")
async def delete_review(pipeline_id: str, task_id: str):
    """
    Deletes the review from a task.
    """
    task = await task_queries.get_task_by_id(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if task.pipeline_id != pipeline_id:
        raise HTTPException(
            status_code=400, detail="Task does not belong to this pipeline"
        )

    try:
        task.review_md = None
        await task.save()
        return {"status": "success", "message": "Review deleted successfully."}
    except Exception as e:
        logger.error(f"Failed to delete review: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete review.")
