import pytest
import asyncio
from datetime import datetime, UTC, timedelta
from core.models.models import Task, TaskStatus, Pipeline
from core.queries import task as task_queries

@pytest.mark.asyncio
async def test_task_execution_order_fifo_scheduled(init_mock_db):
    pipeline = Pipeline(name="Order Test Pipeline")
    await pipeline.insert()
    pid = str(pipeline.id)
    
    # Task 1 created first
    t1 = Task(title="Task 1", pipeline_id=pid, status=TaskStatus.CREATED, order=0)
    await t1.insert()
    
    # Wait a bit to ensure different created_at
    await asyncio.sleep(0.01)
    
    # Task 2 created second
    t2 = Task(title="Task 2", pipeline_id=pid, status=TaskStatus.CREATED, order=0)
    await t2.insert()
    
    # Schedule Task 2 FIRST
    await task_queries.update_task_status(str(t2.id), TaskStatus.SCHEDULED, t2.version)
    
    # Wait a bit
    await asyncio.sleep(0.01)
    
    # Schedule Task 1 SECOND
    await task_queries.update_task_status(str(t1.id), TaskStatus.SCHEDULED, t1.version)
    
    # get_next_task should return Task 2 first, even though it was created later,
    # because it was scheduled first.
    next_task = await task_queries.get_next_task(pid)
    assert next_task.title == "Task 2"
    
    # Next should be Task 1
    next_task = await task_queries.get_next_task(pid)
    assert next_task.title == "Task 1"

@pytest.mark.asyncio
async def test_task_execution_order_with_design_approval(init_mock_db):
    pipeline = Pipeline(name="Design Order Pipeline")
    await pipeline.insert()
    pid = str(pipeline.id)
    
    # T1 created first, needs design
    t1 = Task(title="Task 1", pipeline_id=pid, status=TaskStatus.CREATED, order=0, want_design_doc=True)
    await t1.insert()
    
    # T2 created second, simple task
    t2 = Task(title="Task 2", pipeline_id=pid, status=TaskStatus.CREATED, order=0)
    await t2.insert()
    
    # Schedule T2 (becomes scheduled immediately)
    await task_queries.update_task_status(str(t2.id), TaskStatus.SCHEDULED, t2.version)
    
    # T1 goes through design
    # 1. Schedule for design (moves to inprogress for MCP)
    # We use order=-1 to ensure T1 is picked up before T2 for design phase
    await task_queries.update_task_details(str(t1.id), t1.version, order=-1)
    t1 = await task_queries.get_task_by_id(str(t1.id))
    
    await task_queries.update_task_status(str(t1.id), TaskStatus.SCHEDULED, t1.version)
    t1 = await task_queries.get_next_task(pid) # now inprogress
    assert t1.title == "Task 1"
    
    # 2. Submit design (moves to proposed)
    t1 = await task_queries.update_task_details(str(t1.id), t1.version, design_doc="Some design")
    assert t1.status == TaskStatus.PROPOSED
    
    # 3. Accept design (moves back to scheduled)
    # Restore order to 0 so we can test the scheduled_at logic
    t1 = await task_queries.update_task_details(str(t1.id), t1.version, order=0)
    await task_queries.accept_design(str(t1.id), t1.version)
    
    # Now T2 was scheduled BEFORE T1 was approved.
    # T2 should run first.
    next_task = await task_queries.get_next_task(pid)
    assert next_task.title == "Task 2"
    
    next_task = await task_queries.get_next_task(pid)
    assert next_task.title == "Task 1"
