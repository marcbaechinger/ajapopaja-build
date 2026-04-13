import pytest
from core.models.models import Task, TaskStatus, Pipeline
from core.queries import task as task_queries
from datetime import datetime, timedelta

@pytest.mark.asyncio
async def test_get_completed_tasks_paging(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline")
    await pipeline.insert()
    pid = str(pipeline.id)
    
    # Create 12 completed tasks with distinct updated_at times
    for i in range(12):
        # We set distinct updated_at times to ensure predictable sort order
        task = Task(
            title=f"Task {i}", 
            pipeline_id=pid, 
            status=TaskStatus.IMPLEMENTED,
            updated_at=(datetime.utcnow() + timedelta(minutes=i)).isoformat()
        )
        await task.insert()
        
    # Total completed should be 12. 
    # The UI shows the *latest* one separately, so the query should return 11 as total_count.
    
    # Page 0, Limit 5
    tasks, total = await task_queries.get_completed_tasks_by_pipeline(pid, page=0, limit=5)
    assert total == 11
    assert len(tasks) == 5
    # Latest is Task 11 (updated_at + 11m), so tasks[0] should be Task 10
    assert tasks[0].title == "Task 10"
    assert tasks[4].title == "Task 6"
    
    # Page 1, Limit 5
    tasks, total = await task_queries.get_completed_tasks_by_pipeline(pid, page=1, limit=5)
    assert total == 11
    assert len(tasks) == 5
    assert tasks[0].title == "Task 5"
    assert tasks[4].title == "Task 1"
    
    # Page 2, Limit 5 (only 1 remains: Task 0)
    tasks, total = await task_queries.get_completed_tasks_by_pipeline(pid, page=2, limit=5)
    assert total == 11
    assert len(tasks) == 1
    assert tasks[0].title == "Task 0"
