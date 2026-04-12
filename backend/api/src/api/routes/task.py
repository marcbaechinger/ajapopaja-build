from fastapi import APIRouter, Body
from typing import List, Optional
from core.models.models import Task, TaskStatus
from core.queries import task as task_queries
from api.websocket_manager import manager, WSMessage

# Root router for task-specific top-level endpoints
task_router = APIRouter(prefix="/tasks", tags=["tasks"])

@task_router.get("/{task_id}", response_model=Task)
async def get_task(task_id: str, include_deleted: bool = False):
    return await task_queries.get_task_by_id(task_id, include_deleted)

@task_router.patch("/{task_id}/status", response_model=Task)
async def update_task_status(
    task_id: str, 
    status: TaskStatus = Body(..., embed=True), 
    version: int = Body(..., embed=True)
):
    updated_task = await task_queries.update_task_status(task_id, status, version, actor="user")
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
    completion_info: str = Body(..., embed=True)
):
    updated_task = await task_queries.complete_task(task_id, version, commit_hash, completion_info, actor="user")
    await manager.broadcast(WSMessage(
        type="TASK_COMPLETED",
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
    design_doc: Optional[str] = Body(None, embed=True)
):
    updated_task = await task_queries.update_task_details(task_id, version, title, description, order, design_doc)
    await manager.broadcast(WSMessage(
        type="TASK_UPDATED",
        payload=updated_task.model_dump(mode='json')
    ))
    return updated_task

@task_router.delete("/{task_id}")
async def delete_task(task_id: str):
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
async def list_pipeline_tasks(pipeline_id: str, include_deleted: bool = False):
    return await task_queries.get_tasks_by_pipeline(pipeline_id, include_deleted)

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
async def create_task(pipeline_id: str, task: Task):
    new_task = await task_queries.create_task(pipeline_id, task, actor="user")
    await manager.broadcast(WSMessage(
        type="TASK_CREATED",
        payload=new_task.model_dump(mode='json')
    ))
    return new_task
