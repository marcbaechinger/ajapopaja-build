import pytest
from core.models.models import Task, TaskStatus, Pipeline
from core.queries import task as task_queries
from core.exceptions import VersionMismatchError

@pytest.mark.asyncio
async def test_transition_to_proposed(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline")
    await pipeline.insert()
    
    # Task that wants a design doc
    task = Task(
        title="Test Task", 
        pipeline_id=str(pipeline.id), 
        status=TaskStatus.INPROGRESS, 
        want_design_doc=True
    )
    await task.insert()
    
    # Update design doc should trigger PROPOSED status
    updated_task = await task_queries.update_task_details(
        task_id=str(task.id),
        version=task.version,
        design_doc="# Proposed design\n\nSome details."
    )
    
    assert updated_task.status == TaskStatus.PROPOSED
    assert updated_task.design_doc == "# Proposed design\n\nSome details."
    assert updated_task.version == 2
    assert updated_task.history[-1].to_status == TaskStatus.PROPOSED

@pytest.mark.asyncio
async def test_accept_design(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline")
    await pipeline.insert()
    
    task = Task(
        title="Test Task", 
        pipeline_id=str(pipeline.id), 
        status=TaskStatus.PROPOSED,
        design_doc="Some design"
    )
    await task.insert()
    
    # Accept design
    updated_task = await task_queries.accept_design(
        task_id=str(task.id),
        version=task.version
    )
    
    assert updated_task.status == TaskStatus.SCHEDULED
    assert updated_task.version == 2
    assert updated_task.history[-1].to_status == TaskStatus.SCHEDULED

@pytest.mark.asyncio
async def test_reject_design(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline")
    await pipeline.insert()
    
    task = Task(
        title="Test Task", 
        pipeline_id=str(pipeline.id), 
        status=TaskStatus.PROPOSED,
        design_doc="Some design"
    )
    await task.insert()
    
    # Reject design
    updated_task = await task_queries.reject_design(
        task_id=str(task.id),
        version=task.version
    )
    
    assert updated_task.status == TaskStatus.DISCARDED
    assert updated_task.version == 2
    assert updated_task.history[-1].to_status == TaskStatus.DISCARDED

@pytest.mark.asyncio
async def test_accept_design_invalid_status(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline")
    await pipeline.insert()
    
    task = Task(
        title="Test Task", 
        pipeline_id=str(pipeline.id), 
        status=TaskStatus.CREATED
    )
    await task.insert()
    
    with pytest.raises(ValueError, match="Task status must be PROPOSED"):
        await task_queries.accept_design(
            task_id=str(task.id),
            version=task.version
        )

@pytest.mark.asyncio
async def test_update_title_from_design_doc(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline")
    await pipeline.insert()
    
    task = Task(
        title="Original Title", 
        pipeline_id=str(pipeline.id), 
        status=TaskStatus.INPROGRESS, 
        want_design_doc=True
    )
    await task.insert()
    
    # Update with design doc containing an H1 header
    design_doc = """
    # New Improved Title
    
    Some details here.
    """
    
    updated_task = await task_queries.update_task_details(
        task_id=str(task.id),
        version=task.version,
        design_doc=design_doc
    )
    
    assert updated_task.title == "New Improved Title"
    assert updated_task.status == TaskStatus.PROPOSED

@pytest.mark.asyncio
async def test_update_title_from_design_doc_missing_header(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline")
    await pipeline.insert()
    
    task = Task(
        title="Original Title", 
        pipeline_id=str(pipeline.id), 
        status=TaskStatus.INPROGRESS, 
        want_design_doc=True
    )
    await task.insert()
    
    # Update with design doc missing an H1 header
    design_doc = "No top-level header here."
    
    with pytest.raises(ValueError, match="Design document must contain a top-level Markdown header"):
        await task_queries.update_task_details(
            task_id=str(task.id),
            version=task.version,
            design_doc=design_doc
        )
