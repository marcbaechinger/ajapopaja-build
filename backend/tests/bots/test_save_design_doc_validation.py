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

from api.archbot.tools import save_design_doc
from core.models.models import Pipeline, Task


@pytest.mark.asyncio
async def test_save_design_doc_validation_missing_heading(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline")
    await pipeline.save()

    task = Task(title="Test Task", pipeline_id=str(pipeline.id), spec="Test Spec")
    await task.save()

    result = await save_design_doc(str(pipeline.id), str(task.id), "No heading here.")
    assert "Error: design_doc_md must contain at least one top-level heading" in result


@pytest.mark.asyncio
async def test_save_design_doc_sanitization(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline")
    await pipeline.save()

    task = Task(title="Test Task", pipeline_id=str(pipeline.id), spec="Test Spec")
    await task.save()

    design_doc = "# Valid Heading\n\n<script>alert('xss')</script>Content."

    result = await save_design_doc(str(pipeline.id), str(task.id), design_doc)
    assert "Successfully saved design document" in result

    # Verify task updated in DB with SANITIZED content
    updated_task = await Task.get(task.id)
    assert "alert('xss')Content." in updated_task.design_doc
    assert "<script>" not in updated_task.design_doc
