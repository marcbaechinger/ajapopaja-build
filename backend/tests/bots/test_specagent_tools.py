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

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api.specagent import cache as cache_mod
from api.specagent.cache import get_proposal
from api.specagent.tools import save_elaborated_spec
from core.models.models import Pipeline, Task


@pytest.mark.asyncio
async def test_save_elaborated_spec_rejects_empty():
    result = await save_elaborated_spec("p1", "t1", "   ")
    assert result.startswith("Error")
    assert "empty" in result.lower()


@pytest.mark.asyncio
async def test_save_elaborated_spec_rejects_missing_heading():
    result = await save_elaborated_spec("p1", "t1", "No heading here.")
    assert result.startswith("Error")
    assert "top-level heading" in result


@pytest.mark.asyncio
async def test_save_elaborated_spec_rejects_non_string():
    result = await save_elaborated_spec("p1", "t1", 123)  # type: ignore[arg-type]
    assert result.startswith("Error")
    assert "string" in result


@pytest.mark.asyncio
async def test_save_elaborated_spec_stores_proposal_and_broadcasts(
    init_mock_db, tmp_path, monkeypatch
):
    monkeypatch.setattr(cache_mod, "CACHE_FILE", str(tmp_path / "proposals.json"))

    pipeline = Pipeline(name="Test Pipeline")
    await pipeline.save()
    task = Task(
        title="Test Task",
        pipeline_id=str(pipeline.id),
        spec="- original base spec",
    )
    await task.save()

    session = MagicMock()
    session.session_result = None

    spec_md = "# Elaborated Spec\n\n<script>alert('x')</script>Body <p>tag</p>."

    with patch(
        "api.specagent.tools.manager.broadcast", new_callable=AsyncMock
    ) as mock_broadcast:
        result = await save_elaborated_spec(
            str(pipeline.id),
            str(task.id),
            spec_md,
            rationale="Closed two gaps",
            session=session,
        )

    assert "Successfully saved" in result

    proposal = await get_proposal(str(task.id))
    assert proposal is not None
    assert proposal.task_id == str(task.id)
    assert proposal.pipeline_id == str(pipeline.id)
    assert proposal.rationale == "Closed two gaps"
    # HTML is sanitized before storage.
    assert "<script>" not in proposal.spec_md
    assert "<p>" not in proposal.spec_md
    assert "alert('x')Body tag." in proposal.spec_md

    assert session.session_result == {
        "status": "spec_proposal_ready",
        "task_id": str(task.id),
    }

    mock_broadcast.assert_called_once()
    msg = mock_broadcast.call_args[0][0]
    assert msg.type == "SPECAGENT_SPEC_READY"
    assert msg.payload["task_id"] == str(task.id)

    # The task specification must NOT be mutated by the terminal tool.
    refreshed = await Task.get(task.id)
    assert refreshed.spec == "- original base spec"
