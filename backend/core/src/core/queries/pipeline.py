from typing import List
from beanie import PydanticObjectId
from core.models.models import Pipeline, Task
from core.exceptions import EntityNotFoundError, VersionMismatchError

async def get_all_pipelines(include_deleted: bool = False) -> List[Pipeline]:
    if include_deleted:
        return await Pipeline.find_all().to_list()
    return await Pipeline.find(Pipeline.deleted == False).to_list()

async def get_pipeline_by_id(pipeline_id: str, include_deleted: bool = False) -> Pipeline:
    try:
        pipeline = await Pipeline.get(pipeline_id)
    except Exception:
        pipeline = None
        
    if not pipeline or (not include_deleted and pipeline.deleted):
        raise EntityNotFoundError(f"Pipeline with ID {pipeline_id} not found")
    return pipeline

async def create_pipeline(pipeline: Pipeline) -> Pipeline:
    # Ensure version is set to 1 for new pipelines
    pipeline.version = 1
    await pipeline.insert()
    return pipeline

async def update_pipeline(pipeline_id: str, name: str, version: int) -> Pipeline:
    pipeline = await get_pipeline_by_id(pipeline_id)
    
    if pipeline.version != version:
        raise VersionMismatchError(
            f"Pipeline version mismatch. Client has {version}, DB has {pipeline.version}"
        )
    
    pipeline.name = name
    pipeline.version += 1
    await pipeline.save()
    return pipeline

async def delete_pipeline(pipeline_id: str):
    pipeline = await get_pipeline_by_id(pipeline_id)
    # Mark all tasks in this pipeline as deleted
    await Task.find(Task.pipeline_id == pipeline_id).update({"$set": {"deleted": True}})
    # Mark pipeline as deleted
    pipeline.deleted = True
    pipeline.version += 1
    await pipeline.save()
