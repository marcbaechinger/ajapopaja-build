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

from datetime import datetime

import pytest

from core.models.models import (
    PiSession,
    PiSessionKind,
    PiSessionStatus,
    PullRequest,
    Task,
)


def test_pi_session_defaults(init_mock_db):
    record = PiSession(uid="u1", kind=PiSessionKind.INTERACTIVE)
    assert record.status == PiSessionStatus.STARTING
    assert record.owner is None
    assert record.label is None
    assert record.pull_request_ids == []
    assert record.skill_names == []
    assert record.bot_type == "interactive"
    assert record.resume_count == 0
    assert isinstance(record.created_at, datetime)
    assert isinstance(record.updated_at, datetime)
    assert record.discarded_at is None


def test_pi_session_status_transitions(init_mock_db):
    record = PiSession(uid="u1", kind=PiSessionKind.CODERBOT)
    record.status = PiSessionStatus.RUNNING
    assert record.status == PiSessionStatus.RUNNING
    record.status = PiSessionStatus.PAUSED
    record.status = PiSessionStatus.COMPLETED
    assert record.status.value == "completed"


def test_pi_session_serialization(init_mock_db):
    record = PiSession(uid="u1", kind=PiSessionKind.CODERBOT, task_id="t1")
    data = record.model_dump(mode="json")
    assert data["uid"] == "u1"
    assert data["kind"] == "coderbot"
    assert data["status"] == "starting"
    assert data["task_id"] == "t1"


def test_task_pi_session_uid_optional(init_mock_db):
    task = Task(title="T", pipeline_id="p1")
    assert task.pi_session_uid is None
    task.pi_session_uid = "u1"
    assert task.pi_session_uid == "u1"


def test_pull_request_pi_session_uid_optional(init_mock_db):
    pr = PullRequest(
        pipeline_id="p1",
        task_id="t1",
        summary="s",
        branch_name="b",
        patch="",
    )
    assert pr.pi_session_uid is None
    pr.pi_session_uid = "u1"
    assert pr.pi_session_uid == "u1"


@pytest.mark.asyncio
async def test_pi_session_persists(init_mock_db):
    record = PiSession(uid="u1", kind=PiSessionKind.INTERACTIVE, pipeline_id="p1")
    await record.insert()

    saved = await PiSession.find_one(PiSession.uid == "u1")
    assert saved is not None
    assert saved.kind == PiSessionKind.INTERACTIVE
    assert saved.pipeline_id == "p1"


@pytest.mark.asyncio
async def test_pi_session_serialization_is_timezone_aware(init_mock_db):
    """Datetimes read back from Mongo must carry an offset.

    Otherwise ``model_dump(mode="json")`` emits an offset-less string such as
    ``"2026-10-04T12:27:00"`` which JavaScript parses as *local* time, shifting
    every relative/absolute timestamp by the browser's UTC offset.
    """
    record = PiSession(uid="u1", kind=PiSessionKind.INTERACTIVE, pipeline_id="p1")
    await record.insert()

    saved = await PiSession.find_one(PiSession.uid == "u1")
    assert saved is not None
    data = saved.model_dump(mode="json")

    for field in ("created_at", "updated_at"):
        value = data[field]
        assert value.endswith("+00:00") or value.endswith("Z"), (
            f"{field}={value!r} is not timezone-aware; JS would parse it as local time"
        )
