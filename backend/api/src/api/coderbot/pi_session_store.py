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

"""On-disk persistence for Pi agent sessions.

Layout (one directory per backend session UID)::

    PI_SESSIONS_ROOT/
    └── <session_uid>/
        ├── pi-sessions/          # passed to pi as --session-dir
        │   └── --<cwd-slug>--/
        │       └── <timestamp>_<uuid>.jsonl
        ├── events.jsonl          # backend raw-RPC event log (UI replay)
        ├── meta.json             # crash-recovery mirror of the DB record
        └── workspace/            # batch sessions only (retained tree)

The native Pi session files and ``events.jsonl`` are append-only. ``meta.json``
is a best-effort sidecar (never the source of truth) so the backend can recover
the Pi ``sessionFile`` even when MongoDB is temporarily unavailable.
"""

import asyncio
import json
import logging
import shutil
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from core import config
from core.models.models import PiSession, PiSessionStatus

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Layout helpers
# ---------------------------------------------------------------------------
def sessions_root() -> Path:
    """Return the configured root of all per-session directories."""
    return Path(config.PI_SESSIONS_ROOT)


def session_dir(session_uid: str) -> Path:
    """Return the directory that owns the given backend session."""
    return sessions_root() / str(session_uid)


def pi_sessions_dir(session_uid: str) -> Path:
    """Return the ``--session-dir`` directory for the given session."""
    return session_dir(session_uid) / "pi-sessions"


def events_path(session_uid: str) -> Path:
    """Return the ``events.jsonl`` path for the given session."""
    return session_dir(session_uid) / "events.jsonl"


def meta_path(session_uid: str) -> Path:
    """Return the ``meta.json`` path for the given session."""
    return session_dir(session_uid) / "meta.json"


def workspace_dir(session_uid: str) -> Path:
    """Return the retained batch workspace path for the given session."""
    return session_dir(session_uid) / "workspace"


def ensure_session_dir(session_uid: str) -> Path:
    """Create (idempotently) the session directory tree and return its root."""
    root = session_dir(session_uid)
    root.mkdir(parents=True, exist_ok=True)
    pi_sessions_dir(session_uid).mkdir(parents=True, exist_ok=True)
    return root


# ---------------------------------------------------------------------------
# Event log
# ---------------------------------------------------------------------------
def append_event(session_uid: str, event: Dict[str, Any]) -> None:
    """Append one raw RPC event to ``events.jsonl`` (best-effort, synchronous).

    The shape mirrors the batch log so the frontend can reuse the same replay
    reducer: ``{"timestamp": ..., "type": "pi_rpc_event", "event": {...}}``.
    """
    if not config.PI_SESSION_EVENT_LOG_ENABLED:
        return
    try:
        path = events_path(session_uid)
        path.parent.mkdir(parents=True, exist_ok=True)
        record = {
            "timestamp": datetime.now(UTC).isoformat(),
            "type": "pi_rpc_event",
            "event": event,
        }
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(record) + "\n")
    except Exception as e:  # pragma: no cover - defensive
        logger.error("Failed to append event for session %s: %s", session_uid, e)


def read_session_events(session_uid: str) -> List[Dict[str, Any]]:
    """Read the ordered raw RPC events persisted for a backend session.

    Returns an empty list when the session (or its event log) does not exist.
    """
    path = events_path(session_uid)
    events: List[Dict[str, Any]] = []
    if not path.exists():
        return events
    try:
        with open(path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    data = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if data.get("type") == "pi_rpc_event" and isinstance(
                    data.get("event"), dict
                ):
                    events.append(data["event"])
    except Exception as e:  # pragma: no cover - defensive
        logger.error("Failed to read events for session %s: %s", session_uid, e)
    return events


class SessionEventLog:
    """Append-only ``events.jsonl`` writer shared by both session classes.

    A lock serialises concurrent appends from the background read loop without
    blocking the event loop for long (writes are tiny).
    """

    def __init__(self, session_uid: str, enabled: Optional[bool] = None):
        self.session_uid = str(session_uid)
        self.enabled = (
            config.PI_SESSION_EVENT_LOG_ENABLED if enabled is None else enabled
        )
        self._lock = asyncio.Lock()

    @property
    def path(self) -> Path:
        return events_path(self.session_uid)

    def append(self, event: Dict[str, Any]) -> None:
        """Synchronously append one event (best-effort)."""
        if not self.enabled:
            return
        append_event(self.session_uid, event)

    async def record(self, event: Dict[str, Any]) -> asyncio.Lock:
        """Append one event while holding the log lock."""
        if not self.enabled:
            return
        async with self._lock:
            self.append(event)

    # Alias used by callers that prefer an explicit async name.
    async def append_async(self, event: Dict[str, Any]) -> None:
        if not self.enabled:
            return
        async with self._lock:
            self.append(event)

    def read(self) -> List[Dict[str, Any]]:
        return read_session_events(self.session_uid)


# ---------------------------------------------------------------------------
# meta.json crash-recovery sidecar
# ---------------------------------------------------------------------------
def write_meta(record: Any) -> None:
    """Best-effort write of the session record to ``meta.json``.

    The record may be a :class:`PiSession` document, a :class:`PiSessionHandle`
    or a plain dict. Failures are swallowed: the sidecar is only a recovery aid.
    """
    try:
        if hasattr(record, "record") and hasattr(record.record, "model_dump"):
            record = record.record
        if hasattr(record, "model_dump"):
            data = record.model_dump(mode="json")
        elif isinstance(record, dict):
            data = record
        else:  # pragma: no cover - defensive
            return
        uid = data.get("uid")
        if not uid:
            return
        path = meta_path(uid)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    except Exception as e:  # pragma: no cover - defensive
        logger.debug("Failed to write session meta: %s", e)


def read_meta(session_uid: str) -> Optional[Dict[str, Any]]:
    """Read the ``meta.json`` sidecar, or ``None`` when missing/corrupt."""
    path = meta_path(session_uid)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:  # pragma: no cover - defensive
        logger.debug("Failed to read session meta %s: %s", session_uid, e)
        return None


def recover_session_file(session_uid: str) -> Optional[str]:
    """Return the Pi session file recorded in ``meta.json`` (disk recovery)."""
    meta = read_meta(session_uid)
    if not meta:
        return None
    session_file = meta.get("pi_session_file")
    if session_file and Path(session_file).exists():
        return session_file
    return session_file or None


# ---------------------------------------------------------------------------
# Cleanup / garbage collection
# ---------------------------------------------------------------------------
def delete_session_dir(session_uid: str, *, delete_pi_session: bool = True) -> None:
    """Delete the on-disk directory for a session.

    When ``delete_pi_session`` is ``False`` only the retained ``workspace/`` is
    removed; the Pi conversation and event log are kept.
    """
    root = session_dir(session_uid)
    if not root.exists():
        return
    try:
        if delete_pi_session:
            shutil.rmtree(root)
        else:
            workspace = workspace_dir(session_uid)
            if workspace.exists():
                shutil.rmtree(workspace)
    except Exception as e:  # pragma: no cover - defensive
        logger.error("Failed to delete session dir %s: %s", session_uid, e)


async def sweep_expired_workspaces(
    ttl_days: Optional[float] = None,
) -> List[str]:
    """Remove retained workspaces older than the configured TTL.

    Only workspaces belonging to sessions that are neither ``RUNNING`` nor
    ``PAUSED`` are candidates. Returns the list of session UIDs whose workspace
    was removed.
    """
    if ttl_days is None:
        ttl_days = config.PI_SESSION_WORKSPACE_TTL_DAYS
    if not ttl_days or ttl_days <= 0:
        return []

    removed: List[str] = []

    # Database-driven sweep.
    try:
        records = await PiSession.find_all().to_list()
    except Exception:  # pragma: no cover - DB unavailable
        records = []

    for record in records:
        if record.status in (PiSessionStatus.RUNNING, PiSessionStatus.PAUSED):
            continue
        workspace = workspace_dir(record.uid)
        if not workspace.exists():
            continue
        try:
            reference = record.last_active_at or record.updated_at or record.created_at
            if reference is not None:
                age = (datetime.now(UTC) - reference).total_seconds()
            else:  # pragma: no cover - defensive
                age = time.time() - workspace.stat().st_mtime
        except Exception:  # pragma: no cover - defensive
            age = time.time() - workspace.stat().st_mtime
        if age > float(ttl_days) * 86400:
            delete_session_dir(record.uid, delete_pi_session=False)
            removed.append(record.uid)

    return removed


def sweep_expired_workspaces_sync(ttl_days: Optional[float] = None) -> List[str]:
    """Filesystem-only TTL sweep based on the directory mtime.

    Used as a lightweight fallback when the database is unavailable. Returns the
    list of session UIDs whose workspace was removed.
    """
    if ttl_days is None:
        ttl_days = config.PI_SESSION_WORKSPACE_TTL_DAYS
    if not ttl_days or ttl_days <= 0:
        return []

    root = sessions_root()
    if not root.exists():
        return []

    cutoff = time.time() - (float(ttl_days) * 86400)
    removed: List[str] = []
    for child in root.iterdir():
        if not child.is_dir():
            continue
        workspace = child / "workspace"
        if not workspace.exists():
            continue
        if workspace.stat().st_mtime < cutoff:
            shutil.rmtree(workspace, ignore_errors=True)
            removed.append(child.name)
    return removed
