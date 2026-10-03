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
import time

from api.coderbot import pi_session_store
from core import config


def _patch_root(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "PI_SESSIONS_ROOT", tmp_path)
    monkeypatch.setattr(config, "PI_SESSION_EVENT_LOG_ENABLED", True)


def test_layout_helpers(tmp_path, monkeypatch):
    _patch_root(monkeypatch, tmp_path)
    assert pi_session_store.session_dir("u1") == tmp_path / "u1"
    assert pi_session_store.pi_sessions_dir("u1") == tmp_path / "u1" / "pi-sessions"
    assert pi_session_store.events_path("u1") == tmp_path / "u1" / "events.jsonl"
    assert pi_session_store.meta_path("u1") == tmp_path / "u1" / "meta.json"
    assert pi_session_store.workspace_dir("u1") == tmp_path / "u1" / "workspace"


def test_ensure_session_dir(tmp_path, monkeypatch):
    _patch_root(monkeypatch, tmp_path)
    pi_session_store.ensure_session_dir("u1")
    assert (tmp_path / "u1" / "pi-sessions").is_dir()


def test_append_and_read_events(tmp_path, monkeypatch):
    _patch_root(monkeypatch, tmp_path)
    pi_session_store.append_event("u1", {"type": "agent_start"})
    pi_session_store.append_event("u1", {"type": "agent_settled"})

    events = pi_session_store.read_session_events("u1")
    assert events == [{"type": "agent_start"}, {"type": "agent_settled"}]

    # The on-disk shape mirrors the legacy batch log.
    raw = (tmp_path / "u1" / "events.jsonl").read_text().strip().splitlines()
    record = json.loads(raw[0])
    assert record["type"] == "pi_rpc_event"
    assert record["event"] == {"type": "agent_start"}
    assert "timestamp" in record


def test_read_events_missing_returns_empty(tmp_path, monkeypatch):
    _patch_root(monkeypatch, tmp_path)
    assert pi_session_store.read_session_events("nope") == []


def test_event_log_disabled(tmp_path, monkeypatch):
    _patch_root(monkeypatch, tmp_path)
    monkeypatch.setattr(config, "PI_SESSION_EVENT_LOG_ENABLED", False)
    pi_session_store.append_event("u1", {"type": "agent_start"})
    assert not (tmp_path / "u1" / "events.jsonl").exists()


def test_session_event_log_records(tmp_path, monkeypatch):
    _patch_root(monkeypatch, tmp_path)
    log = pi_session_store.SessionEventLog("u1")
    log.append({"type": "agent_start"})
    assert log.read() == [{"type": "agent_start"}]


def test_meta_roundtrip_and_recovery(tmp_path, monkeypatch):
    _patch_root(monkeypatch, tmp_path)
    session_file = tmp_path / "session.jsonl"
    session_file.write_text("{}")
    record = {
        "uid": "u1",
        "kind": "interactive",
        "pi_session_file": str(session_file),
    }
    pi_session_store.write_meta(record)

    meta = pi_session_store.read_meta("u1")
    assert meta["uid"] == "u1"
    assert meta["kind"] == "interactive"
    assert pi_session_store.recover_session_file("u1") == str(session_file)


def test_delete_session_dir(tmp_path, monkeypatch):
    _patch_root(monkeypatch, tmp_path)
    pi_session_store.ensure_session_dir("u1")
    pi_session_store.append_event("u1", {"type": "agent_start"})
    pi_session_store.delete_session_dir("u1")
    assert not (tmp_path / "u1").exists()


def test_sweep_expired_workspaces_sync(tmp_path, monkeypatch):
    _patch_root(monkeypatch, tmp_path)
    workspace = pi_session_store.workspace_dir("old")
    workspace.mkdir(parents=True)
    # Backdate the workspace so it falls outside a 1-day TTL.
    old = time.time() - 3 * 86400
    import os

    os.utime(workspace, (old, old))

    removed = pi_session_store.sweep_expired_workspaces_sync(ttl_days=1)
    assert removed == ["old"]
    assert not workspace.exists()
