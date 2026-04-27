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

from core.models.models import Task
from core.queries.task import create_task, get_design_doc_history, update_task_details


@pytest.mark.asyncio
async def test_design_doc_history_creation(init_mock_db):
    pipeline_id = "test-pipeline"
    task = Task(title="Initial Task", pipeline_id=pipeline_id)
    await create_task(pipeline_id, task)

    # Update 1: Set design doc
    await update_task_details(str(task.id), task.version, design_doc="# Design 1")

    # Reload task to get updated version
    task = await Task.get(task.id)
    assert task.design_doc == "# Design 1"
    assert task.version == 2

    # History should be empty because there was no PREVIOUS design doc
    history = await get_design_doc_history(str(task.id))
    assert len(history) == 0

    # Update 2: Change design doc
    await update_task_details(str(task.id), task.version, design_doc="# Design 2")

    # History should now have "# Design 1"
    history = await get_design_doc_history(str(task.id))
    assert len(history) == 1
    assert history[0].design_doc == "# Design 1"
    assert history[0].version == 2

    # Update 3: Change design doc again
    task = await Task.get(task.id)
    await update_task_details(str(task.id), task.version, design_doc="# Design 3")

    # History should now have "# Design 2" and "# Design 1"
    history = await get_design_doc_history(str(task.id))
    assert len(history) == 2
    assert history[0].design_doc == "# Design 2"
    assert history[0].version == 3
    assert history[1].design_doc == "# Design 1"
    assert history[1].version == 2


@pytest.mark.asyncio
async def test_design_doc_history_no_change(init_mock_db):
    pipeline_id = "test-pipeline"
    task = Task(title="Initial Task", design_doc="# Initial", pipeline_id=pipeline_id)
    await create_task(pipeline_id, task)

    # Update without changing design doc
    await update_task_details(str(task.id), task.version, title="New Title")

    history = await get_design_doc_history(str(task.id))
    assert len(history) == 0
