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

import pytest

from ajapopaja_mcp.tools import (
    complete_task,
    get_next_task,
    get_task_details,
    get_task_status,
    search_tasks,
    update_task_design_doc,
)
from api.auth import create_access_token
from core.models.models import Pipeline, Task, TaskStatus, User


@pytest.mark.asyncio
async def test_mcp_security(async_client, init_mock_db):
    """Verifies that MCP endpoints are secured."""
    # 1. Test without token - Should be 401
    response = await async_client.post("/mcp/")
    assert response.status_code == 401
    assert "Unauthorized" in response.json()["detail"]

    # Create a test user
    user = User(username="testuser", hashed_password="hashed_password")
    await user.insert()

    # Generate a valid token
    token = create_access_token(data={"sub": user.username})

    # 2. Test with valid token in header - Should NOT be 401
    # Note: It might return 400 or other if the MCP payload is missing, but not 401
    response = await async_client.post(
        "/mcp/", headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code != 401

    # 3. Test with valid token in query param - Should NOT be 401
    response = await async_client.post(f"/mcp/?token={token}")
    assert response.status_code != 401

    # 4. Test with invalid token - Should be 401
    response = await async_client.post(
        "/mcp/", headers={"Authorization": "Bearer invalid"}
    )
    assert response.status_code == 401

    # 5. Test OPTIONS request - Should be 200 (or at least not 401)
    response = await async_client.options("/mcp/")
    assert response.status_code != 401


VALID_PID = "123456789012345678901234"


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
async def test_mcp_get_next_task_design_doc_ready():
    pipeline = Pipeline(name="MCP Pipeline")
    await pipeline.insert()
    pid = str(pipeline.id)

    # Task that wants design doc and has it
    task = Task(
        title="Design Ready Task",
        pipeline_id=pid,
        status=TaskStatus.SCHEDULED,
        want_design_doc=True,
        design_doc="# My Design",
        order=10,
    )
    await task.insert()

    result = await get_next_task(pid)
    assert result["id"] == str(task.id)
    assert result["want_design_doc"] is True
    assert result["design_doc_ready"] is True
    assert result["design_doc"] == "# My Design"

    # Task that wants design doc but it's empty
    task2 = Task(
        title="Design Not Ready Task",
        pipeline_id=pid,
        status=TaskStatus.SCHEDULED,
        want_design_doc=True,
        design_doc="",
        order=20,
    )
    await task2.insert()

    result2 = await get_next_task(pid)
    assert result2["id"] == str(task2.id)
    assert result2["want_design_doc"] is True
    assert result2["design_doc_ready"] is False


@pytest.mark.asyncio
async def test_mcp_get_next_task_empty():
    result = await get_next_task(VALID_PID)
    assert "error" in result
    assert "No scheduled tasks found" in result["error"]


@pytest.mark.asyncio
async def test_mcp_update_design_doc_success():
    task = Task(title="Task 1", pipeline_id=VALID_PID, version=1)
    await task.insert()

    result = await update_task_design_doc(str(task.id), "New Design Plan", 1)
    assert "updated successfully" in result

    updated_task = await Task.get(task.id)
    assert updated_task is not None
    assert updated_task.design_doc == "New Design Plan"
    assert updated_task.version == 2


@pytest.mark.asyncio
async def test_mcp_update_design_doc_occ_failure():
    task = Task(title="Task 1", pipeline_id=VALID_PID, version=1)
    await task.insert()

    # Try to update with wrong version
    result = await update_task_design_doc(str(task.id), "New Design Plan", 2)
    assert "Error" in result
    assert "version mismatch" in result.lower()


@pytest.mark.asyncio
async def test_mcp_complete_task_success():
    task = Task(
        title="Task 1", pipeline_id=VALID_PID, version=1, status=TaskStatus.INPROGRESS
    )
    await task.insert()

    result = await complete_task(
        task_id=str(task.id),
        commit_hash="abc12345678",
        completion_info="Implemented feature X",
        version=1,
    )

    assert "completed successfully" in result

    updated_task = await Task.get(task.id)
    assert updated_task is not None
    assert updated_task.status == TaskStatus.IMPLEMENTED
    assert updated_task.commit_hash == "abc12345678"
    assert updated_task.verification is not None
    assert updated_task.version == 2
    assert updated_task.verification["success"] is True


@pytest.mark.asyncio
async def test_mcp_complete_task_verification_warning():
    task = Task(
        title="Task 1",
        pipeline_id=VALID_PID,
        version=1,
        status=TaskStatus.INPROGRESS,
        want_design_doc=True,
    )
    # want_design_doc=True but no design_doc should trigger warning
    await task.insert()

    # Complete with a valid hash but no verification success recorded in db
    result = await complete_task(
        task_id=str(task.id),
        commit_hash="1234567890",
        completion_info="Some info",
        version=1,
    )

    assert "WARNING: Verification failed" in result

    updated_task = await Task.get(task.id)
    assert updated_task is not None
    assert updated_task.verification is not None
    assert updated_task.verification["success"] is False


@pytest.mark.asyncio
async def test_mcp_complete_task_invalid_hash():
    # Use valid task_id to get to the hash check
    task_id = "0123456789abcdef01234567"
    result = await complete_task(
        task_id=task_id, commit_hash="invalid_hash_!", completion_info="info", version=1
    )
    assert "Error: Invalid commit hash" in result

    result_empty = await complete_task(
        task_id=task_id, commit_hash="", completion_info="info", version=1
    )
    assert "Error: Invalid commit hash" in result_empty


@pytest.mark.asyncio
async def test_mcp_get_task_status():
    task = Task(title="Task 1", pipeline_id=VALID_PID, status=TaskStatus.FAILED)
    await task.insert()

    result = await get_task_status(str(task.id))
    assert result["id"] == str(task.id)
    assert result["status"] == TaskStatus.FAILED


@pytest.mark.asyncio
async def test_mcp_get_task_details():
    task = Task(
        title="Detail Task",
        pipeline_id=VALID_PID,
        status=TaskStatus.INPROGRESS,
        spec="Detailed spec",
        design_doc="# Design",
        commit_hash="f00ba4abcde",
    )
    await task.insert()

    result = await get_task_details(str(task.id))
    assert result["id"] == str(task.id)
    assert result["pipeline_id"] == VALID_PID
    assert result["title"] == "Detail Task"
    assert result["status"] == TaskStatus.INPROGRESS
    assert result["spec"] == "Detailed spec"
    assert result["design_doc"] == "# Design"
    assert result["commit_hash"] == "f00ba4abcde"
    assert "history" in result
    assert "created_at" in result
    assert "updated_at" in result


@pytest.mark.asyncio
async def test_mcp_search_tasks():
    # Insert a few tasks
    t1 = Task(
        title="Searchable Alpha",
        pipeline_id=VALID_PID,
        status=TaskStatus.CREATED,
        spec="First spec",
    )
    t2 = Task(
        title="Searchable Beta",
        pipeline_id=VALID_PID,
        status=TaskStatus.INPROGRESS,
        spec="Second spec",
    )
    await t1.insert()
    await t2.insert()

    # Search by keyword
    result = await search_tasks(keywords="Alpha")
    assert result["total_count"] == 1
    assert result["tasks"][0]["title"] == "Searchable Alpha"

    # Search by status
    result = await search_tasks(statuses=["inprogress"])
    assert result["total_count"] == 1
    assert result["tasks"][0]["title"] == "Searchable Beta"

    # Search by keyword and status
    result = await search_tasks(keywords="Searchable", statuses=["created"])
    assert result["total_count"] == 1
    assert result["tasks"][0]["title"] == "Searchable Alpha"

    # Search with no results
    result = await search_tasks(keywords="Gamma")
    assert result["total_count"] == 0
    assert len(result["tasks"]) == 0


@pytest.mark.asyncio
async def test_mcp_search_tasks_excludes_deleted():
    # Insert a deleted task
    t_deleted = Task(
        title="Deleted Task",
        pipeline_id=VALID_PID,
        status=TaskStatus.CREATED,
        deleted=True,
    )
    await t_deleted.insert()

    # Search for it
    result = await search_tasks(keywords="Deleted")
    assert result["total_count"] == 0
    assert len(result["tasks"]) == 0


@pytest.mark.asyncio
async def test_mcp_mounting_and_precedence(async_client, init_mock_db):
    """Verifies that MCP is mounted correctly and does not interfere with /api routes."""
    # Test /api/health (Standard FastAPI route)
    response = await async_client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"

    # Test /mcp (MCP Mount)
    # FastMCP streamable-http requires a lifespan to initialize its task group.
    # In this test environment, we might get a RuntimeError if the lifespan is not fully triggered,
    # but receiving that error actually CONFIRMS that the request was routed to the mcp_app.
    try:
        response = await async_client.post("/mcp/")
        # If it doesn't raise, we check it's not a 404/405 from the parent app
        assert response.status_code != 405
        assert response.status_code != 404
    except RuntimeError as e:
        assert "Task group is not initialized" in str(e) or "lifespan" in str(e)
