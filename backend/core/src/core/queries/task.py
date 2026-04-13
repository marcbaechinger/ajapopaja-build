from typing import List, Optional, Any
from beanie import PydanticObjectId
from core.models.models import Task, TaskStatus, StateTransition
from core.exceptions import EntityNotFoundError, VersionMismatchError

async def get_tasks_by_pipeline(pipeline_id: str, include_deleted: bool = False) -> List[Task]:
    if include_deleted:
        return await Task.find(Task.pipeline_id == pipeline_id).sort(+Task.order, +Task.created_at).to_list()
    return await Task.find(Task.pipeline_id == pipeline_id, Task.deleted == False).sort(+Task.order, +Task.created_at).to_list()

async def get_completed_tasks_by_pipeline(
    pipeline_id: str, 
    page: int = 0, 
    limit: int = 5
) -> (List[Task], int):
    # Filter for completed tasks (IMPLEMENTED or DISCARDED) that are not deleted
    query = Task.find(
        Task.pipeline_id == pipeline_id,
        Task.deleted == False,
        {"status": {"$in": [TaskStatus.IMPLEMENTED, TaskStatus.DISCARDED]}}
    )
    
    # Total count of all completed tasks
    total_completed = await query.count()
    
    # The UI shows the *latest* completed task separately. 
    # We want to return "older" completed tasks, so we skip the first one.
    # We sort by updated_at descending to get the newest first.
    tasks = await query.sort(-Task.updated_at).skip(1 + (page * limit)).limit(limit).to_list()
    
    # We return total_completed - 1 because one task is shown separately
    return tasks, max(0, total_completed - 1)

async def get_task_by_id(task_id: str, include_deleted: bool = False) -> Task:
    try:
        task = await Task.get(task_id)
    except Exception:
        task = None
        
    if not task or (not include_deleted and task.deleted):
        raise EntityNotFoundError(f"Task with ID {task_id} not found")
    return task

async def create_task(pipeline_id: str, task: Task, actor: str = "user") -> Task:
    task.pipeline_id = pipeline_id
    task.version = 1
    task.history = [StateTransition(to_status=task.status, by=actor)]
    await task.insert()
    return task

async def update_task_status(task_id: str, status: TaskStatus, version: int, actor: str = "user") -> Task:
    task = await get_task_by_id(task_id)
    
    if task.version != version:
        raise VersionMismatchError(
            f"Task version mismatch. Client has {version}, DB has {task.version}"
        )
    
    task.history.append(StateTransition(from_status=task.status, to_status=status, by=actor))
    task.status = status
    task.version += 1
    await task.save()
    return task

async def update_task_details(
    task_id: str, 
    version: int, 
    title: Optional[str] = None, 
    description: Optional[str] = None,
    order: Optional[int] = None,
    design_doc: Optional[str] = None,
    spec: Optional[str] = None,
    want_design_doc: Optional[bool] = None,
    actor: str = "mcp"
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
    if spec is not None:
        task.spec = spec
    if want_design_doc is not None:
        task.want_design_doc = want_design_doc
        
    if design_doc is not None:
        task.design_doc = design_doc
        if task.want_design_doc and task.status == TaskStatus.INPROGRESS:
            task.history.append(StateTransition(from_status=task.status, to_status=TaskStatus.PROPOSED, by=actor))
            task.status = TaskStatus.PROPOSED
        
    task.version += 1
    await task.save()
    return task

async def accept_design(task_id: str, version: int, actor: str = "user") -> Task:
    task = await get_task_by_id(task_id)
    
    if task.version != version:
        raise VersionMismatchError(
            f"Task version mismatch. Client has {version}, DB has {task.version}"
        )
    
    if task.status != TaskStatus.PROPOSED:
        raise ValueError(f"Task status must be PROPOSED to accept design, currently {task.status}")
    
    task.history.append(StateTransition(from_status=task.status, to_status=TaskStatus.SCHEDULED, by=actor))
    task.status = TaskStatus.SCHEDULED
    task.version += 1
    await task.save()
    return task

async def reject_design(task_id: str, version: int, actor: str = "user") -> Task:
    task = await get_task_by_id(task_id)
    
    if task.version != version:
        raise VersionMismatchError(
            f"Task version mismatch. Client has {version}, DB has {task.version}"
        )
    
    if task.status != TaskStatus.PROPOSED:
        raise ValueError(f"Task status must be PROPOSED to reject design, currently {task.status}")
    
    task.history.append(StateTransition(from_status=task.status, to_status=TaskStatus.DISCARDED, by=actor))
    task.status = TaskStatus.DISCARDED
    task.version += 1
    await task.save()
    return task

async def complete_task(
    task_id: str, 
    version: int, 
    commit_hash: str, 
    completion_info: str,
    actor: str = "mcp"
) -> Task:
    task = await get_task_by_id(task_id)
    
    if task.version != version:
        raise VersionMismatchError(
            f"Task version mismatch. Client has {version}, DB has {task.version}"
        )
    
    task.commit_hash = commit_hash
    task.completion_info = completion_info
    task.history.append(StateTransition(from_status=task.status, to_status=TaskStatus.IMPLEMENTED, by=actor))
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
            pipeline_id=task.pipeline_id,
            history=[StateTransition(to_status=TaskStatus.CREATED, by="system")]
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

async def get_next_task(pipeline_id: str, actor: str = "mcp") -> Optional[Task]:
    """Finds the first scheduled task (lowest order, then oldest creation time), sets it to inprogress, and increments version."""
    task = await Task.find(
        Task.pipeline_id == pipeline_id,
        Task.status == TaskStatus.SCHEDULED,
        Task.deleted == False
    ).sort(+Task.order, +Task.created_at).first_or_none()
    
    if task:
        task.history.append(StateTransition(from_status=task.status, to_status=TaskStatus.INPROGRESS, by=actor))
        task.status = TaskStatus.INPROGRESS
        task.version += 1
        await task.save()
        return task
        
    return None

async def delete_task(task_id: str):
    task = await get_task_by_id(task_id)
    task.deleted = True
    task.version += 1
    await task.save()
