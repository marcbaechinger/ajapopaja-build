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

from fastapi import APIRouter, Body, Depends
from typing import List, Optional
from core.models.models import Pipeline, User, PipelineStatus
from core.queries import pipeline as pipeline_queries
from core.queries import task as task_queries
from api.websocket_manager import manager, WSMessage
from api.auth import get_current_user
from api.gemini_executor import GeminiExecutor

router = APIRouter(prefix="/pipelines", tags=["pipelines"])

@router.get("/", response_model=List[Pipeline])
async def get_pipelines(
    include_deleted: bool = False,
    current_user: User = Depends(get_current_user)
):
    return await pipeline_queries.get_all_pipelines(include_deleted)

@router.post("/", response_model=Pipeline)
async def create_pipeline(
    pipeline: Pipeline,
    current_user: User = Depends(get_current_user)
):
    new_pipeline = await pipeline_queries.create_pipeline(pipeline)
    await manager.broadcast(WSMessage(
        type="PIPELINE_CREATED",
        payload=new_pipeline.model_dump(mode='json')
    ))
    return new_pipeline

@router.get("/{pipeline_id}", response_model=Pipeline)
async def get_pipeline(
    pipeline_id: str, 
    include_deleted: bool = False,
    current_user: User = Depends(get_current_user)
):
    return await pipeline_queries.get_pipeline_by_id(pipeline_id, include_deleted)

@router.patch("/{pipeline_id}", response_model=Pipeline)
async def update_pipeline(
    pipeline_id: str, 
    version: int = Body(..., embed=True),
    name: Optional[str] = Body(None, embed=True), 
    status: Optional[PipelineStatus] = Body(None, embed=True),
    workspace_path: Optional[str] = Body(None, embed=True),
    manage_gemini: Optional[bool] = Body(None, embed=True),
    current_user: User = Depends(get_current_user)
):
    updated_pipeline = await pipeline_queries.update_pipeline(
        pipeline_id, version, name=name, status=status, workspace_path=workspace_path, manage_gemini=manage_gemini
    )
    
    if updated_pipeline.status in [PipelineStatus.PAUSED, PipelineStatus.COMPLETED]:
        GeminiExecutor.stop_running(pipeline_id)

    if manage_gemini is False:
        GeminiExecutor.stop_running(pipeline_id)

    await manager.broadcast(WSMessage(
        type="PIPELINE_UPDATED",
        payload=updated_pipeline.model_dump(mode='json')
    ))
    return updated_pipeline

@router.delete("/{pipeline_id}")
async def delete_pipeline(
    pipeline_id: str,
    current_user: User = Depends(get_current_user)
):
    await pipeline_queries.delete_pipeline(pipeline_id)
    GeminiExecutor.stop_running(pipeline_id)
    await manager.broadcast(WSMessage(
        type="PIPELINE_DELETED",
        payload={"pipeline_id": pipeline_id}
    ))
    return {"status": "ok"}

@router.get("/{pipeline_id}/stats/daily")
async def get_daily_pipeline_stats(
    pipeline_id: str,
    current_user: User = Depends(get_current_user)
):
    return await task_queries.get_daily_stats(pipeline_id)
