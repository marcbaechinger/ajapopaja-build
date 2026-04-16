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
    now = datetime.now(UTC)
    yesterday = now - timedelta(days=1)
    
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
    
    yesterday_str = yesterday.date().isoformat()
    now_str = now.date().isoformat()
    
    yesterday_stats = next(s for s in stats if s["date"] == yesterday_str)
    assert yesterday_stats["created"] == 1
    assert yesterday_stats["implemented"] == 0
    assert yesterday_stats["work_ms"] == 0
    
    now_stats = next(s for s in stats if s["date"] == now_str)
    assert now_stats["created"] == 1
    assert now_stats["implemented"] == 1
    # Task 1 worked for 2 hours (7200000 ms)
    # Task 2 worked for 30 mins but hasn't finished yet in history (so not counted in this V1 logic)
    # Wait, my V1 logic: "last_inprogress_start" is reset when it transitions to something else.
    # Task 2 is still INPROGRESS at the end of history, so last_inprogress_start is not None, but loop ends.
    assert now_stats["work_ms"] == 2 * 3600 * 1000 
