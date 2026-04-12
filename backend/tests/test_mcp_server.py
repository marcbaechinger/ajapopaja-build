import pytest
from core.models.models import Task, TaskStatus, Pipeline
from ajapopaja_mcp.server import (
    get_next_task,
    update_task_design_doc,
    complete_task,
    get_task_status,
)


@pytest.fixture(autouse=True)
def setup_mcp_env(monkeypatch, init_mock_db):
    monkeypatch.setenv("DATABASE_NAME", init_mock_db)


@pytest.mark.asyncio
async def test_mcp_get_next_task_success():
    pipeline = Pipeline(name="MCP Pipeline")
    await pipeline.insert()
    pid = str(pipeline.id)

    task = Task(title="Task 1", pipeline_id=pid, status=TaskStatus.SCHEDULED, order=10)
    await task.insert()

    # Call MCP tool
    result = await get_next_task(pid)

    assert result["id"] == str(task.id)
    assert result["title"] == "Task 1"
    assert result["version"] == 2  # Version increments on status change

    # Verify DB state
    updated_task = await Task.get(task.id)
    assert updated_task is not None
    assert updated_task.status == TaskStatus.INPROGRESS


@pytest.mark.asyncio
async def test_mcp_get_next_task_empty():
    result = await get_next_task("nonexistent_pipeline")
    assert "error" in result
    assert "No scheduled tasks found" in result["error"]


@pytest.mark.asyncio
async def test_mcp_update_design_doc_success():
    task = Task(title="Task 1", pipeline_id="123", version=1)
    await task.insert()

    result = await update_task_design_doc(str(task.id), "New Design Plan", 1)
    assert "updated successfully" in result

    updated_task = await Task.get(task.id)
    assert updated_task is not None
    assert updated_task.design_doc == "New Design Plan"
    assert updated_task.version == 2


@pytest.mark.asyncio
async def test_mcp_update_design_doc_occ_failure():
    task = Task(title="Task 1", pipeline_id="123", version=1)
    await task.insert()

    # Try to update with wrong version
    result = await update_task_design_doc(str(task.id), "New Design Plan", 2)
    assert "Error" in result
    assert "version mismatch" in result.lower()


@pytest.mark.asyncio
async def test_mcp_complete_task_success():
    task = Task(
        title="Task 1", pipeline_id="123", version=1, status=TaskStatus.INPROGRESS
    )
    await task.insert()

    result = await complete_task(
        task_id=str(task.id),
        commit_hash="abc1234",
        completion_info="Implemented feature X",
        version=1,
    )

    assert "completed successfully" in result

    updated_task = await Task.get(task.id)
    assert updated_task is not None
    assert updated_task.status == TaskStatus.IMPLEMENTED
    assert updated_task.commit_hash == "abc1234"
    assert updated_task.verification is not None
    assert updated_task.version == 2
    assert updated_task.verification["success"] is True


@pytest.mark.asyncio
async def test_mcp_complete_task_verification_warning():
    task = Task(
        title="Task 1", pipeline_id="123", version=1, status=TaskStatus.INPROGRESS
    )
    await task.insert()

    # Complete with a valid hash but no verification success recorded in db
    result = await complete_task(
        task_id=str(task.id), commit_hash="1234567", completion_info="", version=1
    )

    assert "WARNING: Verification failed" in result

    updated_task = await Task.get(task.id)
    assert updated_task is not None
    assert updated_task.verification is not None
    assert updated_task.verification["success"] is False


@pytest.mark.asyncio
async def test_mcp_complete_task_invalid_hash():
    result = await complete_task(
        task_id="123", commit_hash="invalid_hash_!", completion_info="", version=1
    )
    assert "Error: Invalid commit hash" in result
    
    result_empty = await complete_task(
        task_id="123", commit_hash="", completion_info="", version=1
    )
    assert "Error: Invalid commit hash" in result_empty


@pytest.mark.asyncio
async def test_mcp_get_task_status():
    task = Task(title="Task 1", pipeline_id="123", status=TaskStatus.FAILED)
    await task.insert()

    result = await get_task_status(str(task.id))
    assert result["id"] == str(task.id)
    assert result["status"] == TaskStatus.FAILED
