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
from core.models.models import Task, TaskStatus, Pipeline
from core.queries import task as task_queries

@pytest.mark.asyncio
async def test_search_tasks_by_keyword(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline")
    await pipeline.insert()
    pid = str(pipeline.id)
    
    await Task(title="Auth Feature", spec="Implement OAuth2", pipeline_id=pid).insert()
    await Task(title="Database Setup", spec="PostgreSQL config", design_doc="Use standard schema", pipeline_id=pid).insert()
    await Task(title="UI Layout", spec="Sidebar and main content", pipeline_id=pid).insert()
    
    # Search by title
    tasks, total = await task_queries.search_tasks(keywords="Auth")
    assert total == 1
    assert tasks[0].title == "Auth Feature"
    
    # Search by spec
    tasks, total = await task_queries.search_tasks(keywords="OAuth2")
    assert total == 1
    assert tasks[0].title == "Auth Feature"
    
    # Search by design doc
    tasks, total = await task_queries.search_tasks(keywords="standard schema")
    assert total == 1
    assert tasks[0].title == "Database Setup"
    
    # Case insensitive
    tasks, total = await task_queries.search_tasks(keywords="postgresql")
    assert total == 1
    assert tasks[0].title == "Database Setup"

@pytest.mark.asyncio
async def test_search_tasks_by_status(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline")
    await pipeline.insert()
    pid = str(pipeline.id)
    
    await Task(title="Task 1", status=TaskStatus.CREATED, pipeline_id=pid).insert()
    await Task(title="Task 2", status=TaskStatus.INPROGRESS, pipeline_id=pid).insert()
    await Task(title="Task 3", status=TaskStatus.IMPLEMENTED, pipeline_id=pid).insert()
    
    # Search by status
    tasks, total = await task_queries.search_tasks(statuses=[TaskStatus.INPROGRESS])
    assert total == 1
    assert tasks[0].title == "Task 2"
    
    # Search by multiple statuses
    tasks, total = await task_queries.search_tasks(statuses=[TaskStatus.CREATED, TaskStatus.IMPLEMENTED])
    assert total == 2

@pytest.mark.asyncio
async def test_search_tasks_pagination(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline")
    await pipeline.insert()
    pid = str(pipeline.id)
    
    for i in range(15):
        await Task(title=f"Task {i:02d}", pipeline_id=pid).insert()
        
    # Page 0, Limit 10
    tasks, total = await task_queries.search_tasks(limit=10, page=0)
    assert total == 15
    assert len(tasks) == 10
    
    # Page 1, Limit 10
    tasks, total = await task_queries.search_tasks(limit=10, page=1)
    assert total == 15
    assert len(tasks) == 5
