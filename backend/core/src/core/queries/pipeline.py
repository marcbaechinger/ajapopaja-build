from typing import List
from core.models.models import Pipeline
from core.exceptions import EntityNotFoundError, VersionMismatchError

async def get_all_pipelines() -> List[Pipeline]:
    return await Pipeline.find_all().to_list()

async def get_pipeline_by_id(pipeline_id: str) -> Pipeline:
    pipeline = await Pipeline.get(pipeline_id)
    if not pipeline:
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
