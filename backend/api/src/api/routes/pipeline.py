from fastapi import APIRouter, Body
from typing import List
from core.models.models import Pipeline
from core.queries import pipeline as pipeline_queries
from api.websocket_manager import manager, WSMessage

router = APIRouter(prefix="/pipelines", tags=["pipelines"])

@router.get("/", response_model=List[Pipeline])
async def get_pipelines():
    return await pipeline_queries.get_all_pipelines()

@router.post("/", response_model=Pipeline)
async def create_pipeline(pipeline: Pipeline):
    new_pipeline = await pipeline_queries.create_pipeline(pipeline)
    await manager.broadcast(WSMessage(
        type="PIPELINE_CREATED",
        payload=new_pipeline.model_dump(mode='json')
    ))
    return new_pipeline

@router.get("/{pipeline_id}", response_model=Pipeline)
async def get_pipeline(pipeline_id: str):
    return await pipeline_queries.get_pipeline_by_id(pipeline_id)

@router.patch("/{pipeline_id}", response_model=Pipeline)
async def update_pipeline(
    pipeline_id: str, 
    name: str = Body(..., embed=True), 
    version: int = Body(..., embed=True)
):
    updated_pipeline = await pipeline_queries.update_pipeline(pipeline_id, name, version)
    await manager.broadcast(WSMessage(
        type="PIPELINE_UPDATED",
        payload=updated_pipeline.model_dump(mode='json')
    ))
    return updated_pipeline
