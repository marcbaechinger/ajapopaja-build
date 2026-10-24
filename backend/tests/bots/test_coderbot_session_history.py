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

import json
from unittest.mock import patch

import pytest

from api.coderbot import session as session_module
from api.coderbot.session import read_session_history


@pytest.mark.asyncio
async def test_read_session_history_replays_rpc_events(tmp_path):
    task_dir = tmp_path / "logs" / "t1"
    task_dir.mkdir(parents=True)
    log = task_dir / "coderbot_20260101_000000.jsonl"
    lines = [
        {"type": "pi_rpc_event", "event": {"type": "agent_start"}},
        {
            "type": "pi_rpc_event",
            "event": {
                "type": "message_update",
                "assistantMessageEvent": {"type": "text_delta", "delta": "hi"},
            },
        },
        {"type": "error", "message": "boom"},
    ]
    log.write_text("\n".join(json.dumps(line) for line in lines) + "\n")

    with patch.object(session_module.config, "SANDBOX_ROOT", tmp_path):
        events = await read_session_history("t1")

    assert len(events) == 2
    assert events[0]["type"] == "agent_start"
    assert events[1]["type"] == "message_update"


@pytest.mark.asyncio
async def test_read_session_history_replays_user_message_events_in_order(
    tmp_path, monkeypatch
):
    monkeypatch.setattr(session_module.config, "PI_SESSIONS_ROOT", tmp_path)
    monkeypatch.setattr(session_module.config, "PI_SESSION_EVENT_LOG_ENABLED", True)
    timestamp = 1733234401000
    events = [
        {
            "type": "message_start",
            "message": {
                "role": "user",
                "content": "Review this repository",
                "timestamp": timestamp,
            },
        },
        {
            "type": "message_end",
            "message": {
                "role": "user",
                "content": "Review this repository",
                "timestamp": timestamp,
            },
        },
        {
            "type": "message_update",
            "assistantMessageEvent": {
                "type": "text_delta",
                "contentIndex": 0,
                "delta": "Looking…",
            },
        },
    ]
    path = tmp_path / "u-user" / "events.jsonl"
    path.parent.mkdir(parents=True)
    path.write_text(
        "\n".join(
            json.dumps({"type": "pi_rpc_event", "event": event}) for event in events
        )
        + "\n"
    )

    replayed = await read_session_history("t1", session_uid="u-user")

    assert replayed == events


@pytest.mark.asyncio
async def test_read_session_history_empty_when_no_log(tmp_path):
    with patch.object(session_module.config, "SANDBOX_ROOT", tmp_path):
        assert await read_session_history("t1") == []
