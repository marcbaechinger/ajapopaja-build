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

from fastapi import APIRouter, Body, Depends, Query
from typing import List, Optional
from pydantic import BaseModel
from core.models.models import Task, TaskStatus, User
from core.queries import task as task_queries
from api.websocket_manager import manager, WSMessage
from api.auth import get_current_user
from api.gemini_executor import GeminiExecutor

# Root router for task-specific top-level endpoints
task_router = APIRouter(prefix="/tasks", tags=["tasks"])

class CompletedTasksResponse(BaseModel):
    tasks: List[Task]
    total_count: int

class SearchTasksResponse(BaseModel):
    tasks: List[Task]
    total_count: int

@task_router.get("/search", response_model=SearchTasksResponse)
async def search_tasks(
    keywords: Optional[str] = None,
    statuses: Optional[List[TaskStatus]] = Query(None),
    pipeline_id: Optional[str] = None,
    page: int = 0,
    limit: int = 20,
    current_user: User = Depends(get_current_user)
):
    tasks, total_count = await task_queries.search_tasks(
        keywords=keywords,
        statuses=statuses,
        pipeline_id=pipeline_id,
        page=page,
        limit=limit
    )
    return SearchTasksResponse(tasks=tasks, total_count=total_count)

@task_router.get("/{task_id}", response_model=Task)
async def get_task(
    task_id: str, 
    include_deleted: bool = False,
    current_user: User = Depends(get_current_user)
):
    return await task_queries.get_task_by_id(task_id, include_deleted)

@task_router.patch("/{task_id}/status", response_model=Task)
async def update_task_status(
    task_id: str, 
    status: TaskStatus = Body(..., embed=True), 
    version: int = Body(..., embed=True),
    current_user: User = Depends(get_current_user)
):
    updated_task = await task_queries.update_task_status(task_id, status, version, actor="user")
    
    if updated_task.status == TaskStatus.SCHEDULED:
        await GeminiExecutor.ensure_running(updated_task.pipeline_id)

    await manager.broadcast(WSMessage(
        type="TASK_STATUS_UPDATED",
        payload=updated_task.model_dump(mode='json')
    ))
    return updated_task

@task_router.post("/{task_id}/complete", response_model=Task)
async def complete_task(
    task_id: str,
    version: int = Body(..., embed=True),
    commit_hash: str = Body(..., embed=True),
    completion_info: str = Body(..., embed=True),
    current_user: User = Depends(get_current_user)
):
    updated_task = await task_queries.complete_task(task_id, version, commit_hash, completion_info, actor="user")
    await manager.broadcast(WSMessage(
        type="TASK_COMPLETED",
        payload=updated_task.model_dump(mode='json')
    ))
    return updated_task

@task_router.post("/{task_id}/accept-design", response_model=Task)
async def accept_design(
    task_id: str,
    version: int = Body(..., embed=True),
    current_user: User = Depends(get_current_user)
):
    updated_task = await task_queries.accept_design(task_id, version, actor="user")
    
    if updated_task.status == TaskStatus.SCHEDULED:
        await GeminiExecutor.ensure_running(updated_task.pipeline_id)

    await manager.broadcast(WSMessage(
        type="TASK_STATUS_UPDATED",
        payload=updated_task.model_dump(mode='json')
    ))
    return updated_task

@task_router.post("/{task_id}/reject-design", response_model=Task)
async def reject_design(
    task_id: str,
    version: int = Body(..., embed=True),
    current_user: User = Depends(get_current_user)
):
    updated_task = await task_queries.reject_design(task_id, version, actor="user")
    await manager.broadcast(WSMessage(
        type="TASK_STATUS_UPDATED",
        payload=updated_task.model_dump(mode='json')
    ))
    return updated_task

@task_router.patch("/{task_id}", response_model=Task)
async def update_task_details(
    task_id: str,
    version: int = Body(..., embed=True),
    title: Optional[str] = Body(None, embed=True),
    description: Optional[str] = Body(None, embed=True),
    order: Optional[int] = Body(None, embed=True),
    design_doc: Optional[str] = Body(None, embed=True),
    spec: Optional[str] = Body(None, embed=True),
    want_design_doc: Optional[bool] = Body(None, embed=True),
    current_user: User = Depends(get_current_user)
):
    updated_task = await task_queries.update_task_details(
        task_id, version, title, description, order, design_doc, spec=spec, want_design_doc=want_design_doc, actor="user"
    )
    await manager.broadcast(WSMessage(
        type="TASK_UPDATED",
        payload=updated_task.model_dump(mode='json')
    ))
    return updated_task

@task_router.delete("/{task_id}")
async def delete_task(
    task_id: str,
    current_user: User = Depends(get_current_user)
):
    task = await task_queries.get_task_by_id(task_id)
    pipeline_id = task.pipeline_id
    await task_queries.delete_task(task_id)
    await manager.broadcast(WSMessage(
        type="TASK_DELETED",
        payload={"task_id": task_id, "pipeline_id": pipeline_id}
    ))
    return {"status": "ok"}

@task_router.post("/{task_id}/notify", status_code=202)
async def notify_task_changed(task_id: str):
    # Fetch the updated task from the database
    task = await task_queries.get_task_by_id(task_id)
    # Broadcast a TASK_UPDATED message to all connected WebSocket clients
    await manager.broadcast(WSMessage(
        type="TASK_UPDATED",
        payload=task.model_dump(mode='json')
    ))
    return {"status": "notified"}

# Pipeline-nested router for task management within a pipeline
pipeline_task_router = APIRouter(prefix="/pipelines/{pipeline_id}/tasks", tags=["tasks"])

@pipeline_task_router.get("/", response_model=List[Task])
async def list_pipeline_tasks(
    pipeline_id: str, 
    include_deleted: bool = False,
    current_user: User = Depends(get_current_user)
):
    return await task_queries.get_tasks_by_pipeline(pipeline_id, include_deleted)

@pipeline_task_router.get("/completed", response_model=CompletedTasksResponse)
async def list_completed_pipeline_tasks(
    pipeline_id: str,
    page: int = 0,
    limit: int = 5,
    current_user: User = Depends(get_current_user)
):
    tasks, total_count = await task_queries.get_completed_tasks_by_pipeline(pipeline_id, page, limit)
    return CompletedTasksResponse(tasks=tasks, total_count=total_count)

@pipeline_task_router.post("/next", response_model=Optional[Task])
async def get_next_task(pipeline_id: str):
    task = await task_queries.get_next_task(pipeline_id, actor="mcp")
    if task:
        await manager.broadcast(WSMessage(
            type="TASK_STATUS_UPDATED",
            payload=task.model_dump(mode='json')
        ))
    return task

@pipeline_task_router.post("/", response_model=Task)
async def create_task(
    pipeline_id: str, 
    task: Task,
    current_user: User = Depends(get_current_user)
):
    new_task = await task_queries.create_task(pipeline_id, task, actor="user")
    
    if new_task.status == TaskStatus.SCHEDULED:
        await GeminiExecutor.ensure_running(new_task.pipeline_id)

    await manager.broadcast(WSMessage(
        type="TASK_CREATED",
        payload=new_task.model_dump(mode='json')
    ))
    return new_task
