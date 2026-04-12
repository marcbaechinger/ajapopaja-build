from fastapi import APIRouter, Body
from typing import List, Optional
from core.models.models import Task, TaskStatus
from core.queries import task as task_queries

# Root router for task-specific top-level endpoints
task_router = APIRouter(prefix="/tasks", tags=["tasks"])

@task_router.get("/{task_id}", response_model=Task)
async def get_task(task_id: str):
    return await task_queries.get_task_by_id(task_id)

@task_router.patch("/{task_id}/status", response_model=Task)
async def update_task_status(
    task_id: str, 
    status: TaskStatus = Body(..., embed=True), 
    version: int = Body(..., embed=True)
):
    return await task_queries.update_task_status(task_id, status, version)

@task_router.patch("/{task_id}", response_model=Task)
async def update_task_details(
    task_id: str,
    version: int = Body(..., embed=True),
    title: Optional[str] = Body(None, embed=True),
    description: Optional[str] = Body(None, embed=True)
):
    return await task_queries.update_task_details(task_id, version, title, description)

# Pipeline-nested router for task management within a pipeline
pipeline_task_router = APIRouter(prefix="/pipelines/{pipeline_id}/tasks", tags=["tasks"])

@pipeline_task_router.get("/", response_model=List[Task])
async def list_pipeline_tasks(pipeline_id: str):
    return await task_queries.get_tasks_by_pipeline(pipeline_id)

@pipeline_task_router.post("/", response_model=Task)
async def create_task(pipeline_id: str, task: Task):
    return await task_queries.create_task(pipeline_id, task)
