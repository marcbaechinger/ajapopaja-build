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

"""Tests for the backend SpecAgent accept/reject/open actions."""

from unittest.mock import AsyncMock, patch

import pytest

from api.specagent import cache as cache_mod
from api.specagent.actions import (
    specagent_accept,
    specagent_open,
    specagent_reject,
)
from api.specagent.cache import SpecProposal, get_proposal, set_proposal
from core.models.models import Pipeline, Task
from core.services.notification_manager import NotificationActionContext


def _ctx() -> NotificationActionContext:
    return NotificationActionContext(
        username="alice", notification_id="specagent:t1", client_id="c1"
    )


async def _seed(tmp_path, monkeypatch) -> tuple[Pipeline, Task, str]:
    monkeypatch.setattr(cache_mod, "CACHE_FILE", str(tmp_path / "proposals.json"))
    pipeline = Pipeline(name="Pipe")
    await pipeline.save()
    task = Task(title="Task", pipeline_id=str(pipeline.id), spec="old spec")
    await task.save()
    task_id = str(task.id)
    return pipeline, task, task_id


@pytest.mark.asyncio
async def test_specagent_accept_applies_spec_and_clears(
    init_mock_db, tmp_path, monkeypatch
):
    pipeline, task, task_id = await _seed(tmp_path, monkeypatch)
    await set_proposal(
        task_id,
        SpecProposal(
            task_id=task_id,
            pipeline_id=str(pipeline.id),
            spec_md="# Elaborated",
        ),
    )

    with patch(
        "api.specagent.actions.manager.broadcast", new_callable=AsyncMock
    ) as mock_broadcast:
        result = await specagent_accept(
            {"pipeline_id": str(pipeline.id), "task_id": task_id}, _ctx()
        )

    assert result == {"ok": True, "spec_updated": True}
    refreshed = await Task.get(task.id)
    assert refreshed.spec == "# Elaborated"
    assert await get_proposal(task_id) is None

    mock_broadcast.assert_awaited_once()
    message = mock_broadcast.call_args[0][0]
    assert message.type == "TASK_UPDATED"
    assert message.payload["spec"] == "# Elaborated"


@pytest.mark.asyncio
async def test_specagent_accept_missing_proposal_is_soft_failure(
    init_mock_db, tmp_path, monkeypatch
):
    _, _, task_id = await _seed(tmp_path, monkeypatch)

    result = await specagent_accept({"task_id": task_id}, _ctx())

    assert result == {"ok": False, "error": "Proposal no longer available"}


@pytest.mark.asyncio
async def test_specagent_accept_requires_task_id(init_mock_db):
    result = await specagent_accept({}, _ctx())
    assert result["ok"] is False


@pytest.mark.asyncio
async def test_specagent_reject_clears_proposal(init_mock_db, tmp_path, monkeypatch):
    pipeline, _, task_id = await _seed(tmp_path, monkeypatch)
    await set_proposal(
        task_id,
        SpecProposal(task_id=task_id, pipeline_id=str(pipeline.id), spec_md="# X"),
    )

    result = await specagent_reject({"task_id": task_id}, _ctx())

    assert result == {"ok": True}
    assert await get_proposal(task_id) is None


@pytest.mark.asyncio
async def test_specagent_open_returns_ids(init_mock_db):
    result = await specagent_open(
        {"pipeline_id": "p1", "task_id": "t1"}, _ctx()
    )
    assert result == {"ok": True, "pipeline_id": "p1", "task_id": "t1"}
