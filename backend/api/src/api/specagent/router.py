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
from core.queries import task as task_queries
from core.exceptions import EntityNotFoundError

from .cache import clear_proposal, get_proposal
from .manager import SpecAgentManager

router = APIRouter(
    prefix="/pipelines/{pipeline_id}/specagent",
    tags=["specagent"],
    dependencies=[Depends(get_current_user)],
)
logger = logging.getLogger(__name__)


@router.post("/trigger/{task_id}")
async def trigger_specagent(pipeline_id: str, task_id: str):
    """
    Triggers the SpecAgent for a specific task.

    The task must belong to the pipeline and have a base specification to
    elaborate. The agent's elaborated spec is stored as a pending proposal and
    is not applied until the user accepts it.
    """
    logger.info(
        f"trigger_specagent: Received request for task {task_id} "
        f"in pipeline {pipeline_id}"
    )

    try:
        task = await task_queries.get_task_by_id(task_id)
    except EntityNotFoundError:
        raise HTTPException(status_code=404, detail="Task not found")

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if str(task.pipeline_id) != str(pipeline_id):
        raise HTTPException(
            status_code=400, detail="Task does not belong to this pipeline"
        )

    if not task.spec:
        raise HTTPException(
            status_code=400,
            detail="Task must have a specification to elaborate",
        )

    await SpecAgentManager.process_task(task)

    return {"status": "success", "message": "SpecAgent enqueued"}


@router.get("/proposal/{task_id}")
async def get_spec_proposal(pipeline_id: str, task_id: str):
    """Returns the outstanding elaborated-spec proposal for a task, if any."""
    proposal = await get_proposal(task_id)
    if not proposal:
        raise HTTPException(status_code=404, detail="Proposal not found for this task.")
    return proposal


@router.delete("/proposal/{task_id}")
async def delete_spec_proposal(pipeline_id: str, task_id: str):
    """Clears a rejected elaborated-spec proposal for a task."""
    await clear_proposal(task_id)
    return {"status": "success", "message": "Proposal cleared."}
