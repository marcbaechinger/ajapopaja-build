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
    description: Optional[str] = None,
    order: Optional[int] = None
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
    if order is not None:
        task.order = order
        
    task.version += 1
    await task.save()
    return task

async def complete_task(
    task_id: str, 
    version: int, 
    commit_hash: str, 
    completion_info: str
) -> Task:
    task = await get_task_by_id(task_id)
    
    if task.version != version:
        raise VersionMismatchError(
            f"Task version mismatch. Client has {version}, DB has {task.version}"
        )
    
    task.commit_hash = commit_hash
    task.completion_info = completion_info
    task.status = TaskStatus.IMPLEMENTED
    task.version += 1
    
    # Run verification logic
    verification_results = _verify_task(task)
    task.verification = verification_results
    
    if not verification_results["success"]:
        # Create system task for failure
        system_task = Task(
            title=f"Verification failed: {task.title}",
            description=f"Automated verification failed for task {task_id}. Errors: {', '.join(verification_results['errors'])}",
            type="system",
            status=TaskStatus.CREATED,
            order=task.order - 1, # Higher priority
            parent_task_id=str(task.id),
            pipeline_id=task.pipeline_id
        )
        await system_task.insert()
    
    await task.save()
    return task

def _verify_task(task: Task) -> dict:
    """
    Initial implementation of verification logic.
    Success requires non-empty commit_hash and completion_info.
    """
    errors = []
    if not task.commit_hash or not task.commit_hash.strip():
        errors.append("Missing commit_hash")
    if not task.completion_info or not task.completion_info.strip():
        errors.append("Missing completion_info")
    
    return {
        "success": len(errors) == 0,
        "errors": errors
    }

async def get_next_task(pipeline_id: str) -> Optional[Task]:
    """Finds the first scheduled task (lowest order) and sets it to inprogress."""
    task = await Task.find(
        Task.pipeline_id == pipeline_id,
        Task.status == TaskStatus.SCHEDULED
    ).sort(+Task.order).first_or_none()
    
    if task:
        task.status = TaskStatus.INPROGRESS
        task.version += 1
        await task.save()
        
    return task

async def delete_task(task_id: str):
    task = await get_task_by_id(task_id)
    await task.delete()
