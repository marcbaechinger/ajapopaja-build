from fastapi import APIRouter, Body, Depends
from typing import List
from core.models.models import Pipeline, User
from core.queries import pipeline as pipeline_queries
from api.websocket_manager import manager, WSMessage
from api.auth import get_current_user

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
    name: str = Body(..., embed=True), 
    version: int = Body(..., embed=True),
    current_user: User = Depends(get_current_user)
):
    updated_pipeline = await pipeline_queries.update_pipeline(pipeline_id, name, version)
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
    await manager.broadcast(WSMessage(
        type="PIPELINE_DELETED",
        payload={"pipeline_id": pipeline_id}
    ))
    return {"status": "ok"}
