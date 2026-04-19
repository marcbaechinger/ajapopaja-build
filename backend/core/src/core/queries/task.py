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

from typing import List, Optional, Any, Dict
from datetime import datetime, UTC
from beanie import PydanticObjectId
from core.models.models import Task, TaskStatus, StateTransition
from core.exceptions import EntityNotFoundError, VersionMismatchError

async def get_tasks_by_pipeline(pipeline_id: str, include_deleted: bool = False) -> List[Task]:
    if include_deleted:
        return await Task.find(Task.pipeline_id == pipeline_id).sort(+Task.order, +Task.scheduled_at, +Task.created_at).to_list()
    return await Task.find(Task.pipeline_id == pipeline_id, Task.deleted == False).sort(+Task.order, +Task.scheduled_at, +Task.created_at).to_list()

async def get_tasks_for_tool(
    pipeline_id: str,
    offset: int = 0,
    page_size: int = 5,
    sort_order: str = "last_created_first"
) -> dict:
    query = Task.find(Task.pipeline_id == pipeline_id, Task.deleted == False)
    total_tasks = await query.count()

    if sort_order == "last_created_first":
        query = query.sort(-Task.created_at)
    elif sort_order == "last_implemented_first":
        query = query.sort(-Task.updated_at)
    else:
        query = query.sort(+Task.order, +Task.scheduled_at, +Task.created_at)

    tasks = await query.skip(offset).limit(page_size).to_list()

    MAX_LEN = 500
    task_dicts = []
    for t in tasks:
        td = t.model_dump(mode="json")
        if td.get("spec") and len(td["spec"]) > MAX_LEN:
            td["spec"] = td["spec"][:MAX_LEN] + "\n...[truncated]"
        if td.get("design_doc") and len(td["design_doc"]) > MAX_LEN:
            td["design_doc"] = td["design_doc"][:MAX_LEN] + "\n...[truncated]"
        task_dicts.append(td)

    return {
        "total_tasks": total_tasks,
        "offset": offset,
        "page_size": page_size,
        "sort_order": sort_order,
        "tasks": task_dicts
    }

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
    if task.status == TaskStatus.SCHEDULED:
        task.scheduled_at = datetime.now(UTC)
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
    if status == TaskStatus.SCHEDULED:
        task.scheduled_at = datetime.now(UTC)
    task.version += 1
    task.updated_at = datetime.now(UTC)
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
        if task.status not in [TaskStatus.CREATED, TaskStatus.PROPOSED]:
            raise ValueError(f"Task title can only be updated in CREATED or PROPOSED state, currently {task.status}")
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
            # Parse top-level header from design doc to use as task title
            new_title = _parse_title_from_design_doc(design_doc)
            if not new_title:
                raise ValueError("Design document must contain a top-level Markdown header (e.g., '# Title') to be used as the task title.")
            
            task.title = new_title
            
            task.history.append(StateTransition(from_status=task.status, to_status=TaskStatus.PROPOSED, by=actor))
            task.status = TaskStatus.PROPOSED
        
    task.version += 1
    task.updated_at = datetime.now(UTC)
    await task.save()
    return task

def _parse_title_from_design_doc(design_doc: str) -> Optional[str]:
    """Parses the first top-level Markdown header (# Title) from the design doc."""
    for line in design_doc.splitlines():
        line = line.strip()
        if line.startswith("# "):
            return line[2:].strip()
    return None

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
    task.scheduled_at = datetime.now(UTC)
    task.version += 1
    task.updated_at = datetime.now(UTC)
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
    task.updated_at = datetime.now(UTC)
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
    task.updated_at = datetime.now(UTC)
    
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
    If want_design_doc is True, design_doc must also be non-empty.
    """
    errors = []
    if not task.commit_hash or not task.commit_hash.strip():
        errors.append("Missing commit_hash")
    if not task.completion_info or not task.completion_info.strip():
        errors.append("Missing completion_info")
    
    if task.want_design_doc and (not task.design_doc or not task.design_doc.strip()):
        errors.append("Missing design_doc. Since want_design_doc is True, you MUST provide a design proposal using update_task_design_doc and have it approved before completing the task.")
    
    return {
        "success": len(errors) == 0,
        "errors": errors
    }

async def get_next_task(pipeline_id: str, actor: str = "mcp") -> Optional[Task]:
    """Finds the first scheduled task (lowest order, then oldest scheduled time), sets it to inprogress, and increments version."""
    task = await Task.find(
        Task.pipeline_id == pipeline_id,
        Task.status == TaskStatus.SCHEDULED,
        Task.deleted == False
    ).sort(+Task.order, +Task.scheduled_at, +Task.created_at).first_or_none()
    
    if task:
        task.history.append(StateTransition(from_status=task.status, to_status=TaskStatus.INPROGRESS, by=actor))
        task.status = TaskStatus.INPROGRESS
        task.version += 1
        task.updated_at = datetime.now(UTC)
        await task.save()
        return task
        
    return None

async def delete_task(task_id: str):
    task = await get_task_by_id(task_id)
    task.deleted = True
    task.version += 1
    task.updated_at = datetime.now(UTC)
    await task.save()

async def get_daily_stats(pipeline_id: str) -> List[Dict[str, Any]]:
    tasks = await get_tasks_by_pipeline(pipeline_id, include_deleted=True)
    daily_stats = {}

    for task in tasks:
        # History processing
        last_inprogress_start = None
        
        # Track if this task was already counted as "created"
        # We only count it once for its whole history
        counted_created = False
        
        # Sort history to process in chronological order
        sorted_history = sorted(task.history, key=lambda x: x.timestamp)
        
        for event in sorted_history:
            day = event.timestamp.date().isoformat()
            if day not in daily_stats:
                daily_stats[day] = {"date": day, "created": 0, "implemented": 0, "work_ms": 0}
            
            # Tasks Created: Count once when it first enters CREATED or SCHEDULED status
            if not counted_created and event.to_status in [TaskStatus.CREATED, TaskStatus.SCHEDULED]:
                daily_stats[day]["created"] += 1
                counted_created = True
            
            # Tasks Implemented
            if event.to_status == TaskStatus.IMPLEMENTED:
                daily_stats[day]["implemented"] += 1
            
            # Work Time: from INPROGRESS to any other status
            if event.to_status == TaskStatus.INPROGRESS:
                last_inprogress_start = event.timestamp
            elif last_inprogress_start is not None:
                duration = event.timestamp - last_inprogress_start
                duration_ms = int(duration.total_seconds() * 1000)
                daily_stats[day]["work_ms"] += duration_ms
                last_inprogress_start = None

    # Convert to sorted list by date
    result = sorted(daily_stats.values(), key=lambda x: x["date"])
    return result

async def search_tasks(
    keywords: Optional[str] = None,
    statuses: Optional[List[TaskStatus]] = None,
    pipeline_id: Optional[str] = None,
    page: int = 0,
    limit: int = 20
) -> (List[Task], int):
    filters = {"deleted": False}
    
    if pipeline_id:
        filters["pipeline_id"] = pipeline_id
        
    if statuses:
        filters["status"] = {"$in": statuses}
        
    if keywords:
        # Case-insensitive search in title, spec, and design_doc
        regex_filter = {"$regex": keywords, "$options": "i"}
        filters["$or"] = [
            {"title": regex_filter},
            {"spec": regex_filter},
            {"design_doc": regex_filter}
        ]
        
    query = Task.find(filters)
    total_count = await query.count()
    tasks = await query.sort(-Task.updated_at).skip(page * limit).limit(limit).to_list()
    
    return tasks, total_count
