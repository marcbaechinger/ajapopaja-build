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

import git
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from core.queries import pipeline as pipeline_queries

from ..docbot.cache import clear_preview, get_preview

router = APIRouter(prefix="/pipelines/{pipeline_id}/docbot", tags=["docbot"])
logger = logging.getLogger(__name__)


class CommitRequest(BaseModel):
    commit_msg: str


@router.get("/preview/{task_id}")
async def get_docbot_preview(pipeline_id: str, task_id: str):
    preview = get_preview(task_id)
    if not preview:
        raise HTTPException(status_code=404, detail="Preview not found for this task.")
    return preview


@router.post("/review/commit/{task_id}")
async def commit_docbot_change(pipeline_id: str, task_id: str, req: CommitRequest):
    preview = get_preview(task_id)
    if not preview:
        raise HTTPException(status_code=404, detail="Preview not found for this task.")

    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    if not pipeline or not pipeline.workspace_abs_path:
        raise HTTPException(status_code=404, detail="Pipeline or workspace not found.")

    try:
        repo = git.Repo(pipeline.workspace_abs_path)
        repo.git.add(preview.file_path)
        repo.git.commit("-m", req.commit_msg)
        clear_preview(task_id)
        return {
            "status": "success",
            "message": f"Committed change for {preview.filename}",
        }
    except Exception as e:
        logger.error(f"Failed to commit DocBot change: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/review/revert/{task_id}")
async def revert_docbot_change(pipeline_id: str, task_id: str):
    preview = get_preview(task_id)
    if not preview:
        raise HTTPException(status_code=404, detail="Preview not found for this task.")

    pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
    if not pipeline or not pipeline.workspace_abs_path:
        raise HTTPException(status_code=404, detail="Pipeline or workspace not found.")

    try:
        repo = git.Repo(pipeline.workspace_abs_path)

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

        clear_preview(task_id)
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
