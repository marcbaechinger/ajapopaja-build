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

from fastapi import APIRouter, Depends, HTTPException

from api.auth import get_current_user
from core.models.models import Task

from .manager import coderbot_manager

router = APIRouter(
    prefix="/coderbot",
    tags=["coderbot"],
    dependencies=[Depends(get_current_user)],
)


@router.post("/trigger/{task_id}")
async def trigger_coderbot(task_id: str):
    task = await Task.get(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    await coderbot_manager.process_task(task)
    return {"status": "success", "message": "CoderBot enqueued"}


@router.post("/stop/{task_id}")
async def stop_coderbot(task_id: str):
    stopped = coderbot_manager.stop_session(task_id)
    if not stopped:
        raise HTTPException(
            status_code=404, detail="Active session not found for this task"
        )
    return {"status": "success", "message": "CoderBot termination signaled"}
