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
from datetime import datetime, timedelta, UTC

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
            updated_at=(datetime.now(UTC) + timedelta(minutes=i)).isoformat()
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
