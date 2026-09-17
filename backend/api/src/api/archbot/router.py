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

from typing import Optional

from fastapi import APIRouter, HTTPException, Depends, Body

from api.auth import get_current_user
from core.queries import task as task_queries
from core.models.models import TaskStatus

from .manager import ArchBotManager

router = APIRouter(prefix="/pipelines/{pipeline_id}/archbot", tags=["archbot"])
logger = logging.getLogger(__name__)


@router.post("/trigger/{task_id}")
async def trigger_archbot(
    pipeline_id: str,
    task_id: str,
    comments: Optional[str] = Body(None, embed=True),
    current_user: str = Depends(get_current_user),
):
    """
    Triggers the ArchitectureBot for a specific task.

    - If the task has no design document yet, it generates a new one.
    - If the task already has a design document, `comments` (the feedback the
      user wants the bot to address) are used to iterate on the existing doc.
    """
    logger.info(
        f"trigger_archbot: Received request for task {task_id} in pipeline {pipeline_id}"
    )

    task = await task_queries.get_task_by_id(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if task.pipeline_id != pipeline_id:
        raise HTTPException(
            status_code=400, detail="Task does not belong to this pipeline"
        )

    if task.design_doc:
        # The task already has a design document: iterate on it using the
        # provided comments. Comments are required for iteration.
        comments = (comments or "").strip()
        if not comments:
            raise HTTPException(
                status_code=400,
                detail="Comments are required to iterate on an existing design document",
            )

        await ArchBotManager.process_task(task, user_prompt=comments)

        return {"status": "success", "message": "ArchitectureBot enqueued"}

    # Validation: CREATED state and no design doc
    if task.status != TaskStatus.CREATED:
        raise HTTPException(
            status_code=400,
            detail=f"Task must be in CREATED state, currently {task.status}",
        )

    if not task.spec:
        raise HTTPException(
            status_code=400,
            detail="Task must have a spec before generating a design document",
        )

    await ArchBotManager.process_task(task)

    return {"status": "success", "message": "ArchitectureBot enqueued"}
