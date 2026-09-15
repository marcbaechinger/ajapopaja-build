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

from api.coderbot import session as session_module
from api.coderbot.session import read_session_history


def test_read_session_history_replays_rpc_events(tmp_path):
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
        events, start_time = read_session_history("t1")

    assert len(events) == 2
    assert events[0]["type"] == "agent_start"
    assert events[1]["type"] == "message_update"
    # No session_start line present, so no start time is reported.
    assert start_time is None


def test_read_session_history_empty_when_no_log(tmp_path):
    with patch.object(session_module.config, "SANDBOX_ROOT", tmp_path):
        assert read_session_history("t1") == ([], None)


def test_read_session_history_reports_latest_session_start_time(tmp_path):
    task_dir = tmp_path / "logs" / "t1"
    task_dir.mkdir(parents=True)
    # Two runs for the same task; the newest file wins for the start time.
    older = task_dir / "coderbot_20260101_000000.jsonl"
    older.write_text(
        json.dumps(
            {
                "type": "session_start",
                "timestamp": "2026-01-01T00:00:00+00:00",
                "task_id": "t1",
            }
        )
        + "\n"
    )
    newer = task_dir / "coderbot_20260102_000000.jsonl"
    newer.write_text(
        json.dumps(
            {
                "type": "session_start",
                "timestamp": "2026-01-02T00:00:00+00:00",
                "task_id": "t1",
            }
        )
        + "\n"
    )

    with patch.object(session_module.config, "SANDBOX_ROOT", tmp_path):
        events, start_time = read_session_history("t1")

    assert events == []
    assert start_time == "2026-01-02T00:00:00+00:00"
