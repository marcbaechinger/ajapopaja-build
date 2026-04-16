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

from typing import List, Optional
from beanie import PydanticObjectId
from core.models.models import Pipeline, Task, PipelineStatus
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

async def update_pipeline(
    pipeline_id: str, 
    version: int,
    name: Optional[str] = None, 
    status: Optional[PipelineStatus] = None,
    workspace_path: Optional[str] = None,
    manage_gemini: Optional[bool] = None
) -> Pipeline:
    pipeline = await get_pipeline_by_id(pipeline_id)
    
    if pipeline.version != version:
        raise VersionMismatchError(
            f"Pipeline version mismatch. Client has {version}, DB has {pipeline.version}"
        )
    
    if name is not None:
        pipeline.name = name
    if status is not None:
        pipeline.status = status
    if workspace_path is not None:
        pipeline.workspace_path = workspace_path
    if manage_gemini is not None:
        pipeline.manage_gemini = manage_gemini

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
