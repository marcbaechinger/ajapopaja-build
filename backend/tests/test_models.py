import pytest
from core.models.models import Pipeline, Task

@pytest.mark.asyncio
async def test_pipeline_version_default(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline")
    assert pipeline.version == 1

@pytest.mark.asyncio
async def test_task_version_default(init_mock_db):
    task = Task(title="Test Task", pipeline_id="123")
    assert task.version == 1

@pytest.mark.asyncio
async def test_pipeline_save_version(init_mock_db):
    pipeline = Pipeline(name="Versioned Pipeline")
    await pipeline.insert()
    assert pipeline.version == 1
    
    pipeline.name = "Updated Name"
    await pipeline.save()
    assert pipeline.version == 1  # Standard save doesn't auto-increment yet
