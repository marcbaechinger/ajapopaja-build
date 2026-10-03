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

"""Tests for :func:`api.coderbot.session_title.read_first_user_prompt`.

The prompt text is recovered from the persisted ``events.jsonl`` replay log
first, then from the native Pi session file and finally (batch sessions only)
from the linked task title.
"""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace

from api.coderbot.session_title import (
    extract_first_user_prompt_from_native_file,
    read_first_user_prompt,
)
from core import config
from core.models.models import PiSession, PiSessionKind, PiSessionStatus, Task


def _patch_root(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(config, "PI_SESSIONS_ROOT", tmp_path)
    monkeypatch.setattr(config, "PI_SESSION_EVENT_LOG_ENABLED", True)


def _write_events(root: Path, uid: str, events: list[dict]) -> None:
    path = root / uid / "events.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as handle:
        for event in events:
            handle.write(json.dumps({"type": "pi_rpc_event", "event": event}) + "\n")


def _write_native(path: Path, entries: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        for entry in entries:
            handle.write(json.dumps(entry) + "\n")


# ---------------------------------------------------------------------------
# events.jsonl (primary)
# ---------------------------------------------------------------------------


async def test_read_from_events_log(init_mock_db, tmp_path, monkeypatch):
    _patch_root(monkeypatch, tmp_path)
    record = PiSession(
        uid="u-events",
        kind=PiSessionKind.INTERACTIVE,
        status=PiSessionStatus.PAUSED,
        pipeline_id="p1",
    )
    await record.insert()
    _write_events(
        tmp_path,
        "u-events",
        [
            {"type": "message_end", "message": {"role": "assistant", "content": "hi"}},
            {
                "type": "agent_end",
                "messages": [
                    {"role": "user", "content": "Implement the events reader"}
                ],
            },
        ],
    )

    assert await read_first_user_prompt("u-events") == "Implement the events reader"


async def test_events_log_works_without_a_record(init_mock_db, tmp_path, monkeypatch):
    _patch_root(monkeypatch, tmp_path)
    _write_events(
        tmp_path,
        "u-norecord",
        [{"type": "agent_end", "messages": [{"role": "user", "content": "Hello"}]}],
    )

    assert await read_first_user_prompt("u-norecord") == "Hello"


# ---------------------------------------------------------------------------
# Native Pi session file (fallback)
# ---------------------------------------------------------------------------


def test_extract_from_native_file(tmp_path):
    native = tmp_path / "--cwd--" / "session.jsonl"
    _write_native(
        native,
        [
            {
                "id": "a",
                "type": "message",
                "message": {"role": "assistant", "content": "hi"},
            },
            {
                "id": "b",
                "type": "message",
                "message": {
                    "role": "user",
                    "content": [{"type": "text", "text": "Native prompt"}],
                },
            },
        ],
    )
    assert extract_first_user_prompt_from_native_file(native) == "Native prompt"


def test_extract_from_missing_native_file_returns_none(tmp_path):
    assert extract_first_user_prompt_from_native_file(tmp_path / "nope.jsonl") is None
    assert extract_first_user_prompt_from_native_file(None) is None


async def test_read_falls_back_to_native_file(init_mock_db, tmp_path, monkeypatch):
    _patch_root(monkeypatch, tmp_path)
    native = tmp_path / "native.jsonl"
    _write_native(
        native,
        [{"message": {"role": "user", "content": "From the native file"}}],
    )
    record = PiSession(
        uid="u-native",
        kind=PiSessionKind.INTERACTIVE,
        status=PiSessionStatus.PAUSED,
        pipeline_id="p1",
        pi_session_file=str(native),
    )
    await record.insert()

    assert await read_first_user_prompt("u-native") == "From the native file"


# ---------------------------------------------------------------------------
# Batch task-title fallback
# ---------------------------------------------------------------------------


async def test_batch_session_falls_back_to_task_title(
    init_mock_db, tmp_path, monkeypatch
):
    _patch_root(monkeypatch, tmp_path)
    task = Task(title="Batch task title", pipeline_id="p1")
    await task.insert()
    record = PiSession(
        uid="u-batch",
        kind=PiSessionKind.CODERBOT,
        status=PiSessionStatus.COMPLETED,
        pipeline_id="p1",
        task_id=str(task.id),
    )
    await record.insert()

    assert await read_first_user_prompt("u-batch") == "Batch task title"


async def test_all_sources_missing_returns_none(init_mock_db, tmp_path, monkeypatch):
    _patch_root(monkeypatch, tmp_path)
    record = PiSession(
        uid="u-none",
        kind=PiSessionKind.INTERACTIVE,
        status=PiSessionStatus.PAUSED,
        pipeline_id="p1",
    )
    await record.insert()

    assert await read_first_user_prompt("u-none") is None


async def test_explicit_record_avoids_a_db_lookup(monkeypatch, tmp_path):
    _patch_root(monkeypatch, tmp_path)
    native = tmp_path / "native.jsonl"
    _write_native(native, [{"message": {"role": "user", "content": "Explicit"}}])
    record = SimpleNamespace(pi_session_file=str(native), kind=None, task_id=None)

    assert await read_first_user_prompt("whatever", record=record) == "Explicit"
