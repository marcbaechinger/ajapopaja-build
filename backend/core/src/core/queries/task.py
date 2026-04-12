from typing import List, Optional
from core.models.models import Task, TaskStatus
from core.exceptions import EntityNotFoundError, VersionMismatchError

async def get_tasks_by_pipeline(pipeline_id: str) -> List[Task]:
    return await Task.find(Task.pipeline_id == pipeline_id).sort(+Task.order).to_list()

async def get_task_by_id(task_id: str) -> Task:
    task = await Task.get(task_id)
    if not task:
        raise EntityNotFoundError(f"Task with ID {task_id} not found")
    return task

async def create_task(pipeline_id: str, task: Task) -> Task:
    task.pipeline_id = pipeline_id
    task.version = 1
    await task.insert()
    return task

async def update_task_status(task_id: str, status: TaskStatus, version: int) -> Task:
    task = await get_task_by_id(task_id)
    
    if task.version != version:
        raise VersionMismatchError(
            f"Task version mismatch. Client has {version}, DB has {task.version}"
        )
    
    task.status = status
    task.version += 1
    await task.save()
    return task

async def update_task_details(
    task_id: str, 
    version: int, 
    title: Optional[str] = None, 
    description: Optional[str] = None
) -> Task:
    task = await get_task_by_id(task_id)
    
    if task.version != version:
        raise VersionMismatchError(
            f"Task version mismatch. Client has {version}, DB has {task.version}"
        )
    
    if title is not None:
        task.title = title
    if description is not None:
        task.description = description
        
    task.version += 1
    await task.save()
    return task
