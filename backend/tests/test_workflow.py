import pytest
from core.models.models import Task, TaskStatus, Pipeline
from core.queries import task as task_queries
from core.exceptions import VersionMismatchError

@pytest.mark.asyncio
async def test_complete_task_success(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline")
    await pipeline.insert()
    
    task = Task(title="Test Task", pipeline_id=str(pipeline.id), status=TaskStatus.INPROGRESS, order=10)
    await task.insert()
    
    # Complete task
    updated_task = await task_queries.complete_task(
        task_id=str(task.id),
        version=task.version,
        commit_hash="abc1234",
        completion_info="Done!"
    )
    
    assert updated_task.status == TaskStatus.IMPLEMENTED
    assert updated_task.commit_hash == "abc1234"
    assert updated_task.completion_info == "Done!"
    assert updated_task.version == 2

@pytest.mark.asyncio
async def test_complete_task_version_mismatch(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline")
    await pipeline.insert()
    
    task = Task(title="Test Task", pipeline_id=str(pipeline.id), status=TaskStatus.INPROGRESS)
    await task.insert()
    
    with pytest.raises(VersionMismatchError):
        await task_queries.complete_task(
            task_id=str(task.id),
            version=task.version + 1,  # Wrong version
            commit_hash="abc1234",
            completion_info="Done!"
        )

@pytest.mark.asyncio
async def test_complete_task_failed_verification(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline")
    await pipeline.insert()
    
    task = Task(title="Test Task", pipeline_id=str(pipeline.id), status=TaskStatus.INPROGRESS, order=10)
    await task.insert()
    
    # Complete task with empty info (should fail verification)
    updated_task = await task_queries.complete_task(
        task_id=str(task.id),
        version=task.version,
        commit_hash="",
        completion_info=""
    )
    
    # Original task should still be IMPLEMENTED
    assert updated_task.status == TaskStatus.IMPLEMENTED
    assert updated_task.verification["success"] is False
    
    # Check if a new system task was created
    tasks = await task_queries.get_tasks_by_pipeline(str(pipeline.id))
    assert len(tasks) == 2
    
    system_task = next(t for t in tasks if t.type == "system")
    assert system_task.parent_task_id == str(task.id)
    assert system_task.order < task.order
    assert "Verification failed" in system_task.title

@pytest.mark.asyncio
async def test_complete_task_missing_required_design_doc(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline")
    await pipeline.insert()
    
    # Task that requires a design doc
    task = Task(title="Test Task", pipeline_id=str(pipeline.id), status=TaskStatus.INPROGRESS, want_design_doc=True)
    await task.insert()
    
    # Complete task without design_doc
    updated_task = await task_queries.complete_task(
        task_id=str(task.id),
        version=task.version,
        commit_hash="abc1234",
        completion_info="Done!"
    )
    
    assert updated_task.verification["success"] is False
    assert any("Missing design_doc" in err for err in updated_task.verification["errors"])
    
    # Check for system task
    tasks = await task_queries.get_tasks_by_pipeline(str(pipeline.id))
    assert any(t.type == "system" for t in tasks)

@pytest.mark.asyncio
async def test_update_task_design_doc(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline")
    await pipeline.insert()
    
    task = Task(title="Test Task", pipeline_id=str(pipeline.id), order=10)
    await task.insert()
    
    # Update design doc
    updated_task = await task_queries.update_task_details(
        task_id=str(task.id),
        version=task.version,
        design_doc="New design doc"
    )
    
    assert updated_task.design_doc == "New design doc"
    assert updated_task.version == 2

@pytest.mark.asyncio
async def test_reorder_tasks(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline")
    await pipeline.insert()
    
    t1 = Task(title="Task 1", pipeline_id=str(pipeline.id), order=10)
    t2 = Task(title="Task 2", pipeline_id=str(pipeline.id), order=20)
    await t1.insert()
    await t2.insert()
    
    # Reorder
    await task_queries.update_task_details(str(t1.id), t1.version, order=30)
    
    tasks = await task_queries.get_tasks_by_pipeline(str(pipeline.id))
    assert len(tasks) == 2
    assert tasks[0].title == "Task 2"
    assert tasks[1].title == "Task 1"

@pytest.mark.asyncio
async def test_manual_failure_override(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline")
    await pipeline.insert()
    
    task = Task(title="Task 1", pipeline_id=str(pipeline.id), status=TaskStatus.INPROGRESS)
    await task.insert()
    
    # Manual fail
    updated_task = await task_queries.update_task_status(str(task.id), TaskStatus.FAILED, task.version)
    assert updated_task.status == TaskStatus.FAILED

@pytest.mark.asyncio
async def test_delete_task(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline")
    await pipeline.insert()
    task = Task(title="To Delete", pipeline_id=str(pipeline.id))
    await task.insert()
    
    await task_queries.delete_task(str(task.id))
    
    tasks = await task_queries.get_tasks_by_pipeline(str(pipeline.id))
    assert len(tasks) == 0

@pytest.mark.asyncio
async def test_delete_pipeline_cascades(init_mock_db):
    pipeline = Pipeline(name="To Delete")
    await pipeline.insert()
    task = Task(title="Task in Pipeline", pipeline_id=str(pipeline.id))
    await task.insert()
    
    from core.queries import pipeline as pipeline_queries
    await pipeline_queries.delete_pipeline(str(pipeline.id))
    
    # Check pipeline gone
    with pytest.raises(Exception):
        await pipeline_queries.get_pipeline_by_id(str(pipeline.id))
        
    # Check tasks gone
    tasks = await task_queries.get_tasks_by_pipeline(str(pipeline.id))
    assert len(tasks) == 0
