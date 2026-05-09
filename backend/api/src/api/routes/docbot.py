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
from pydantic import BaseModel

from api.auth import get_current_user
from core.queries import pipeline as pipeline_queries
from core.queries import task as task_queries
from core.utils import git_utils

from ..docbot.cache import clear_preview, get_preview
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

    if not task.commit_hash:
        raise HTTPException(
            status_code=400, detail="Task must have a commit hash to run DocBot"
        )

    # Queue the bot session
    try:
        await DocBotManager.process_completed_task(task)
        return {"status": "success", "message": "DocBot triggered successfully."}
    except Exception as e:
        logger.error(f"Failed to trigger DocBot: {e}")
        raise HTTPException(status_code=500, detail="Failed to trigger DocBot.")


class CommitRequest(BaseModel):
    commit_msg: str


@router.get("/preview/{task_id}")
async def get_docbot_preview(pipeline_id: str, task_id: str):
    logger.info(f"GET /preview/{task_id} for pipeline {pipeline_id}")
    preview = await get_preview(task_id)
    if not preview:
        raise HTTPException(status_code=404, detail="Preview not found for this task.")
    return preview


@router.post("/review/commit/{task_id}")
async def commit_docbot_change(pipeline_id: str, task_id: str, req: CommitRequest):
    logger.info(f"POST /review/commit/{task_id} for pipeline {pipeline_id}")
    preview = await get_preview(task_id)
    if not preview:
        raise HTTPException(status_code=404, detail="Preview not found for this task.")

    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    if not pipeline or not pipeline.workspace_abs_path:
        raise HTTPException(status_code=404, detail="Pipeline or workspace not found.")

    try:
        repo = git_utils.get_repo(pipeline.workspace_abs_path)
        repo.git.add(preview.file_path)
        # Use --no-verify to bypass pre-commit hooks that might fail in the server environment
        repo.git.commit("-m", req.commit_msg, "--no-verify")
        await clear_preview(task_id)
        return {
            "status": "success",
            "message": f"Committed change for {preview.filename}",
        }
    except Exception as e:
        logger.error(f"Failed to commit DocBot change: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/review/revert/{task_id}")
async def revert_docbot_change(pipeline_id: str, task_id: str):
    logger.info(f"POST /review/revert/{task_id} for pipeline {pipeline_id}")
    preview = await get_preview(task_id)
    if not preview:
        raise HTTPException(status_code=404, detail="Preview not found for this task.")

    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    if not pipeline or not pipeline.workspace_abs_path:
        raise HTTPException(status_code=404, detail="Pipeline or workspace not found.")

    try:
        repo = git_utils.get_repo(pipeline.workspace_abs_path)

        try:
            repo.git.reset("HEAD", preview.file_path)
        except Exception:
            pass  # Reset might fail if no initial commit or file not in HEAD

        try:
            repo.git.checkout("--", preview.file_path)
        except Exception:
            # If checkout fails, it was likely an untracked file, so delete it
            import os

            if os.path.exists(preview.file_path):
                os.remove(preview.file_path)

        await clear_preview(task_id)
        return {
            "status": "success",
            "message": f"Reverted changes to {preview.filename}",
        }
    except Exception as e:
        logger.error(f"Failed to revert DocBot change: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/review/cancel/{task_id}")
async def cancel_docbot_review(pipeline_id: str, task_id: str):
    # No action; keep cache for future review (as per design doc)
    return {"status": "success", "message": "Review cancelled, but changes kept."}
