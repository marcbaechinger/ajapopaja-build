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
from datetime import datetime, timedelta, UTC
from core.models.models import Task, TaskStatus, StateTransition
from core.queries.task import get_daily_stats

@pytest.mark.asyncio
async def test_get_daily_stats(init_mock_db):
    pipeline_id = "test_pipeline"
    # Use fixed dates to avoid "day boundary" issues during test execution
    now = datetime(2026, 4, 17, 10, 0, 0)
    yesterday = datetime(2026, 4, 16, 10, 0, 0)
    
    # Task 1: Created yesterday, implemented today
    task1 = Task(
        title="Task 1",
        pipeline_id=pipeline_id,
        status=TaskStatus.IMPLEMENTED,
        history=[
            StateTransition(to_status=TaskStatus.CREATED, timestamp=yesterday, by="user"),
            StateTransition(from_status=TaskStatus.CREATED, to_status=TaskStatus.SCHEDULED, timestamp=yesterday, by="user"),
            StateTransition(from_status=TaskStatus.SCHEDULED, to_status=TaskStatus.INPROGRESS, timestamp=now - timedelta(hours=2), by="mcp"),
            StateTransition(from_status=TaskStatus.INPROGRESS, to_status=TaskStatus.IMPLEMENTED, timestamp=now, by="mcp")
        ]
    )
    await task1.insert()
    
    # Task 2: Created today, still in progress
    task2 = Task(
        title="Task 2",
        pipeline_id=pipeline_id,
        status=TaskStatus.INPROGRESS,
        history=[
            StateTransition(to_status=TaskStatus.CREATED, timestamp=now - timedelta(hours=1), by="user"),
            StateTransition(from_status=TaskStatus.CREATED, to_status=TaskStatus.INPROGRESS, timestamp=now - timedelta(minutes=30), by="mcp")
        ]
    )
    await task2.insert()
    
    stats = await get_daily_stats(pipeline_id)
    
    assert len(stats) == 2
    
    yesterday_str = "2026-04-16"
    now_str = "2026-04-17"
    
    yesterday_stats = next(s for s in stats if s["date"] == yesterday_str)
    assert yesterday_stats["created"] == 1
    assert yesterday_stats["implemented"] == 0
    assert yesterday_stats["work_ms"] == 0
    
    now_stats = next(s for s in stats if s["date"] == now_str)
    assert now_stats["created"] == 1
    assert now_stats["implemented"] == 1
    assert now_stats["work_ms"] == 2 * 3600 * 1000 
