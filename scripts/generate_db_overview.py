#!/usr/bin/env python3
# ruff: noqa: E501  # embedded HTML/CSS/JS template strings are intentionally long
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

"""Generate a static, self-contained HTML dashboard for a MongoDB database.

The dashboard gives an admin a bird's-eye view of every collection in the
database, the storage it consumes, and the shape of the data stored there. It
puts extra emphasis on the domain objects the application cares about most
(pipelines, tasks, pull requests and Pi sessions) while still covering every
collection generically.

The script talks directly to MongoDB using ``pymongo`` and produces a single
``.html`` file with no external assets: all CSS and JavaScript are inlined, so
the report can be opened offline, emailed, or archived.

Examples:
    # Defaults (localhost MongoDB + ajapopaja_build_prod + db_overview.html)
    python scripts/generate_db_overview.py

    # Point at a remote MongoDB and a custom output file
    python scripts/generate_db_overview.py --uri mongodb://host:27017 \\
        --db prod --output /tmp/overview.html
"""

import argparse
import html
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from bson.objectid import ObjectId
from pymongo import MongoClient

# ---------------------------------------------------------------------------
# Configuration / helpers
# ---------------------------------------------------------------------------

# Field names (or substrings) that must never leak into the generated report.
_SENSITIVE_SUBSTRINGS = (
    "password",
    "passwd",
    "token",
    "secret",
    "api_key",
    "apikey",
    "private_key",
    "credential",
)

# Collection names that are never listed (system / internal bookkeeping).
_IGNORED_COLLECTIONS = {"system.views"}

# Status -> CSS color mapping. Colors are reused consistently across the report
# for badges, donut charts and storage bars.
_STATUS_COLORS = {
    # pipeline statuses
    "active": "#22c55e",
    "paused": "#f59e0b",
    "completed": "#0ea5e9",
    # task statuses
    "created": "#0ea5e9",
    "scheduled": "#a855f7",
    "proposed": "#f59e0b",
    "inprogress": "#6366f1",
    "implemented": "#22c55e",
    "pull_request_available": "#06b6d4",
    "submitted": "#14b8a6",
    "discarded": "#94a3b8",
    "failed": "#ef4444",
    # pull request statuses
    "open": "#f59e0b",
    "accepted": "#22c55e",
    "rejected": "#ef4444",
    # pi session statuses
    "starting": "#0ea5e9",
    "running": "#22c55e",
}

# Fallback palette for anything that is not a recognized status value.
_PALETTE = (
    "#6366f1",
    "#22c55e",
    "#f59e0b",
    "#ef4444",
    "#0ea5e9",
    "#a855f7",
    "#14b8a6",
    "#f97316",
    "#84cc16",
    "#ec4899",
    "#64748b",
    "#06b6d4",
)


def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Generate a static HTML overview dashboard for a MongoDB database."
        )
    )
    parser.add_argument(
        "--uri",
        default="mongodb://localhost:27017",
        help="MongoDB connection string (default: mongodb://localhost:27017)",
    )
    parser.add_argument(
        "--db",
        default="ajapopaja_build_prod",
        help="Database name to inspect (default: ajapopaja_build_prod)",
    )
    parser.add_argument(
        "--output",
        "-o",
        default="db_overview.html",
        help="Output HTML file (default: db_overview.html)",
    )
    parser.add_argument(
        "--sample-size",
        type=int,
        default=20,
        help="How many documents per collection to sample (default: 20)",
    )
    return parser.parse_args(argv)


def human_size(num: Any) -> str:
    """Format a byte count as a human-readable string."""
    try:
        num = float(num or 0)
    except (TypeError, ValueError):
        num = 0.0
    for unit in ("B", "KB", "MB", "GB", "TB", "PB"):
        if abs(num) < 1024 or unit == "PB":
            return f"{int(num)} B" if unit == "B" else f"{num:.1f} {unit}"
        num /= 1024
    return f"{num:.1f} PB"


def _is_sensitive(name: str) -> bool:
    lowered = name.lower()
    return any(sub in lowered for sub in _SENSITIVE_SUBSTRINGS)


def infer_type(value: Any) -> str:
    """Return a short, human-friendly type name for a BSON value."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "boolean"
    if isinstance(value, int):
        return "integer"
    if isinstance(value, float):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, list):
        return "array"
    if isinstance(value, dict):
        return "object"
    if isinstance(value, ObjectId):
        return "objectid"
    if isinstance(value, datetime):
        return "date"
    return type(value).__name__


def sanitize(value: Any, depth: int = 0) -> Any:
    """Make an arbitrary BSON document safe for embedding in the report.

    Redacts sensitive keys, truncates long strings, collapses deep nesting and
    normalises non-JSON-native types (``ObjectId``, ``datetime``, ...) so the
    result is always JSON-serialisable.
    """
    if depth > 4:
        return "..."
    if isinstance(value, dict):
        out: Dict[str, Any] = {}
        for key, item in value.items():
            out[str(key)] = (
                "***REDACTED***"
                if _is_sensitive(str(key))
                else sanitize(item, depth + 1)
            )
        return out
    if isinstance(value, list):
        return [sanitize(item, depth + 1) for item in value[:20]]
    if isinstance(value, str):
        return value[:240] + "\u2026" if len(value) > 240 else value
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, (int, float, bool)):
        return value
    return str(value)


def infer_fields(docs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Infer the field schema of a collection from a sample of documents."""
    field_order: List[str] = []
    fields: Dict[str, Dict[str, Any]] = {}
    for doc in docs:
        if not isinstance(doc, dict):
            continue
        for key in doc:
            key = str(key)
            if key not in fields:
                fields[key] = {"name": key, "types": Counter(), "non_null": 0}
                field_order.append(key)
            fields[key]["types"][infer_type(doc[key])] += 1
            if doc[key] is not None:
                fields[key]["non_null"] += 1

    total = len(docs)
    result: List[Dict[str, Any]] = []
    for key in field_order:
        field = fields[key]
        counts = field["types"]
        primary = counts.most_common(1)[0][0] if counts else "null"
        result.append(
            {
                "name": key,
                "type": primary,
                "coverage": round(field["non_null"] / total * 100) if total else 0,
                "non_null": field["non_null"],
                "sensitive": _is_sensitive(key),
            }
        )
    return result


def group_count(db: Any, collection: str, field: str) -> Dict[str, int]:
    """Count documents grouped by a single field using server-side aggregation."""
    try:
        pipeline = [{"$group": {"_id": f"${field}", "count": {"$sum": 1}}}]
        result: Dict[str, int] = {}
        for row in db[collection].aggregate(pipeline):
            key = row.get("_id")
            if key is None:
                key = "(none)"
            result[str(key)] = int(row.get("count", 0))
        return result
    except Exception:
        return {}


def collection_stats(db: Any, name: str) -> Dict[str, Any]:
    """Fetch ``collStats`` for a collection, tolerating backends without it."""
    stats: Dict[str, Any] = {
        "size_bytes": 0,
        "storage_size_bytes": 0,
        "avg_obj_size": 0,
        "total_index_size": 0,
        "index_count": 0,
        "capped": False,
    }
    try:
        raw = db.command("collStats", name)
        stats.update(
            {
                "size_bytes": raw.get("size", 0),
                "storage_size_bytes": raw.get("storageSize", 0),
                "avg_obj_size": raw.get("avgObjSize", 0),
                "total_index_size": raw.get("totalIndexSize", 0),
                "index_count": raw.get("nindexes", 0),
                "capped": bool(raw.get("capped", False)),
            }
        )
    except Exception:
        pass
    return stats


def collection_indexes(db: Any, name: str) -> List[Dict[str, Any]]:
    try:
        info = db[name].index_information()
    except Exception:
        return []
    indexes: List[Dict[str, Any]] = []
    for idx_name, idx in info.items():
        key = idx.get("key", [])
        if isinstance(key, list):
            key_str = ", ".join(f"{k[0]} ({k[1]})" for k in key)
        else:
            key_str = str(key)
        indexes.append(
            {
                "name": idx_name,
                "key": key_str,
                "unique": bool(idx.get("unique", False)),
            }
        )
    return indexes


def build_pipeline_summary(db: Any) -> List[Dict[str, Any]]:
    """Summarise every pipeline and cross-reference related documents."""
    task_counts = group_count(db, "tasks", "pipeline_id")
    pr_counts = group_count(db, "pull_requests", "pipeline_id")
    session_counts = group_count(db, "pi_sessions", "pipeline_id")

    pipelines: List[Dict[str, Any]] = []
    try:
        cursor = db["pipelines"].find().sort("created_at", -1)
    except Exception:
        cursor = []
    for pipeline in cursor:
        pid = str(pipeline.get("_id"))
        pipelines.append(
            {
                "id": pid,
                "name": pipeline.get("name"),
                "status": pipeline.get("status"),
                "workspace_path": pipeline.get("workspace_path"),
                "repo_uri": pipeline.get("repo_uri"),
                "deleted": bool(pipeline.get("deleted", False)),
                "task_count": task_counts.get(pid, 0),
                "pr_count": pr_counts.get(pid, 0),
                "session_count": session_counts.get(pid, 0),
            }
        )
    return pipelines


def count_orphans(db: Any, collection: str, field: str) -> int:
    """Count documents whose ``field`` references a missing pipeline."""
    try:
        ids = {str(p["_id"]) for p in db["pipelines"].find({}, {"_id": 1})}
    except Exception:
        return 0
    total = 0
    try:
        for row in db[collection].aggregate(
            [{"$group": {"_id": f"${field}", "count": {"$sum": 1}}}]
        ):
            key = row.get("_id")
            if key is not None and str(key) not in ids:
                total += int(row.get("count", 0))
    except Exception:
        return 0
    return total


def collect_overview(uri: str, db_name: str, sample_size: int = 20) -> Dict[str, Any]:
    """Collect a complete overview of every collection in ``db_name``."""
    client = MongoClient(uri, tz_aware=True, serverSelectionTimeoutMS=10000)
    db = client[db_name]

    collections: List[Dict[str, Any]] = []
    names = sorted(
        name for name in db.list_collection_names() if name not in _IGNORED_COLLECTIONS
    )

    for name in names:
        coll = db[name]
        try:
            count = coll.count_documents({})
        except Exception:
            count = 0
        stats = collection_stats(db, name)
        try:
            raw_samples = list(coll.find().limit(sample_size))
        except Exception:
            raw_samples = []
        samples = [sanitize(doc) for doc in raw_samples]

        info = {
            "name": name,
            "count": count,
            "samples": samples,
            "fields": infer_fields(raw_samples),
            "indexes": collection_indexes(db, name),
        }
        info.update(stats)
        info["breakdown"] = {}
        if name in _BREAKDOWN_FIELDS:
            info["breakdown"] = group_count(db, name, _BREAKDOWN_FIELDS[name])
        collections.append(info)

    totals = {
        "collections": len(collections),
        "documents": sum(c["count"] for c in collections),
        "size_bytes": sum(c["size_bytes"] for c in collections),
        "storage_size_bytes": sum(c["storage_size_bytes"] for c in collections),
        "index_size_bytes": sum(c["total_index_size"] for c in collections),
    }

    overview = {
        "uri": uri,
        "db_name": db_name,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "collections": collections,
        "totals": totals,
        "pipelines": build_pipeline_summary(db),
        "orphans": {
            "tasks": count_orphans(db, "tasks", "pipeline_id"),
            "pull_requests": count_orphans(db, "pull_requests", "pipeline_id"),
            "pi_sessions": count_orphans(db, "pi_sessions", "pipeline_id"),
        },
    }
    client.close()
    return overview


# Collection -> field used to derive a status breakdown for the report.
_BREAKDOWN_FIELDS = {
    "tasks": "status",
    "pull_requests": "status",
    "pipelines": "status",
    "pi_sessions": "status",
}


# ---------------------------------------------------------------------------
# HTML rendering
# ---------------------------------------------------------------------------

_CSS = r"""
:root {
  --bg: #0f172a;
  --bg-soft: #1e293b;
  --bg-card: #16213b;
  --border: #27364d;
  --text: #e2e8f0;
  --text-dim: #94a3b8;
  --accent: #6366f1;
  --accent-2: #22c55e;
  --danger: #ef4444;
  --warn: #f59e0b;
}
:root[data-theme="light"] {
  --bg: #f1f5f9;
  --bg-soft: #e2e8f0;
  --bg-card: #ffffff;
  --border: #cbd5e1;
  --text: #0f172a;
  --text-dim: #64748b;
}
* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.5;
}
a { color: inherit; text-decoration: none; }
.hidden { display: none !important; }

.topbar {
  position: sticky; top: 0; z-index: 20;
  display: flex; align-items: center; gap: 16px;
  padding: 14px 24px;
  background: linear-gradient(120deg, #4f46e5, #7c3aed, #db2777);
  color: #fff;
  box-shadow: 0 4px 20px rgba(0,0,0,.25);
}
.topbar h1 { font-size: 18px; margin: 0; font-weight: 700; letter-spacing: .2px; }
.topbar .sub { font-size: 12px; opacity: .85; }
.topbar .spacer { flex: 1; }
.topbar .search {
  background: rgba(255,255,255,.16); border: 1px solid rgba(255,255,255,.35);
  color: #fff; border-radius: 10px; padding: 8px 14px; width: 260px; outline: none;
}
.topbar .search::placeholder { color: rgba(255,255,255,.7); }
.topbar button {
  background: rgba(255,255,255,.16); border: 1px solid rgba(255,255,255,.35);
  color: #fff; border-radius: 10px; padding: 8px 14px; cursor: pointer; font-weight: 600;
}
.topbar button:hover { background: rgba(255,255,255,.28); }

.layout { display: flex; gap: 24px; padding: 24px; align-items: flex-start; }
.sidebar {
  position: sticky; top: 84px; width: 250px; flex-shrink: 0;
  background: var(--bg-card); border: 1px solid var(--border); border-radius: 16px;
  padding: 14px; max-height: calc(100vh - 110px); overflow: auto;
}
.sidebar h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .8px; color: var(--text-dim); margin: 4px 6px 10px; }
.sidebar a { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 10px; color: var(--text); font-size: 14px; }
.sidebar a:hover { background: var(--bg-soft); }
.sidebar a.active { background: var(--bg-soft); font-weight: 600; }
.sidebar a .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--accent); }
.sidebar a .count { margin-left: auto; color: var(--text-dim); font-size: 12px; font-variant-numeric: tabular-nums; }

.main { flex: 1; min-width: 0; }
.section { margin-bottom: 28px; }
.section-head { display: flex; align-items: baseline; gap: 12px; margin-bottom: 12px; }
.section-head h2 { margin: 0; font-size: 20px; }
.section-head .meta { color: var(--text-dim); font-size: 13px; }

.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 14px; margin-bottom: 24px; }
.card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 16px; padding: 16px 18px; }
.card .label { color: var(--text-dim); font-size: 12px; text-transform: uppercase; letter-spacing: .6px; }
.card .value { font-size: 26px; font-weight: 700; margin-top: 6px; font-variant-numeric: tabular-nums; }
.card .note { font-size: 12px; color: var(--text-dim); margin-top: 4px; }

.panel { background: var(--bg-card); border: 1px solid var(--border); border-radius: 16px; overflow: hidden; }
.panel-body { padding: 18px; }

.storage-bar { display: flex; height: 34px; border-radius: 10px; overflow: hidden; background: var(--bg-soft); }
.storage-bar .seg { display: flex; align-items: center; justify-content: center; color: #fff; font-size: 11px; font-weight: 700; white-space: nowrap; overflow: hidden; }
.storage-legend { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 12px; }
.storage-legend .item { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--text-dim); }
.storage-legend .swatch { width: 12px; height: 12px; border-radius: 3px; }

table { width: 100%; border-collapse: collapse; font-size: 13px; }
th, td { text-align: left; padding: 9px 10px; border-bottom: 1px solid var(--border); }
th { color: var(--text-dim); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .4px; }
tr:last-child td { border-bottom: none; }
tbody tr:hover { background: var(--bg-soft); }
.num { text-align: right; font-variant-numeric: tabular-nums; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.wrap { word-break: break-word; }
.empty { color: var(--text-dim); font-style: italic; padding: 20px; text-align: center; }

.badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; color: #fff; }
.badge.muted { background: var(--bg-soft); color: var(--text-dim); }

.donut-wrap { display: flex; gap: 24px; align-items: center; flex-wrap: wrap; }
.donut { width: 140px; height: 140px; border-radius: 50%; position: relative; flex-shrink: 0; }
.donut::after { content: ""; position: absolute; inset: 26px; border-radius: 50%; background: var(--bg-card); }
.donut .center { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; z-index: 1; flex-direction: column; }
.donut .center b { font-size: 22px; }
.donut .center span { font-size: 11px; color: var(--text-dim); }
.legend { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 20px; font-size: 13px; }
.legend .row { display: flex; align-items: center; gap: 8px; }
.legend .swatch { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
.legend .val { margin-left: auto; font-variant-numeric: tabular-nums; color: var(--text-dim); }

details.collapse { border-top: 1px solid var(--border); }
details.collapse summary { cursor: pointer; padding: 12px 18px; font-weight: 600; list-style: none; display: flex; align-items: center; gap: 8px; }
details.collapse summary::before { content: "▸"; color: var(--text-dim); transition: transform .15s; }
details.collapse[open] summary::before { transform: rotate(90deg); }
details.collapse .body { padding: 0 18px 16px; }
pre.json { background: var(--bg); border: 1px solid var(--border); border-radius: 10px; padding: 14px; overflow: auto; font-size: 12px; margin: 0; max-height: 320px; }

.pill { display: inline-flex; align-items: center; gap: 6px; }
.pill .dot { width: 8px; height: 8px; border-radius: 50%; }
.gradient-note { color: var(--text-dim); font-size: 12px; }
footer { padding: 24px; text-align: center; color: var(--text-dim); font-size: 12px; }
@media (max-width: 900px) {
  .layout { flex-direction: column; }
  .sidebar { position: static; width: 100%; max-height: none; }
}
"""

_JS = r"""
(function () {
  var root = document.documentElement;
  var saved = null;
  try { saved = localStorage.getItem('db-overview-theme'); } catch (e) {}
  if (saved) root.setAttribute('data-theme', saved);

  var toggle = document.getElementById('theme-toggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('db-overview-theme', next); } catch (e) {}
    });
  }

  var search = document.getElementById('search');
  if (search) {
    search.addEventListener('input', function () {
      var q = search.value.trim().toLowerCase();
      document.querySelectorAll('[data-search]').forEach(function (el) {
        var hay = (el.getAttribute('data-search') || '').toLowerCase();
        el.classList.toggle('hidden', q !== '' && hay.indexOf(q) === -1);
      });
    });
  }

  var links = document.querySelectorAll('.sidebar a');
  var sections = Array.prototype.map.call(links, function (l) {
    return document.querySelector(l.getAttribute('href'));
  }).filter(Boolean);
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          links.forEach(function (l) { l.classList.remove('active'); });
          var link = document.querySelector('.sidebar a[href="#' + entry.target.id + '"]');
          if (link) link.classList.add('active');
        }
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    sections.forEach(function (s) { io.observe(s); });
  }
})();
"""


def _status_color(status: Any, index: int = 0) -> str:
    key = str(status).lower() if status is not None else ""
    if key in _STATUS_COLORS:
        return _STATUS_COLORS[key]
    return _PALETTE[index % len(_PALETTE)]


def _badge(status: Any) -> str:
    text = html.escape(str(status if status is not None else "(none)"))
    color = _status_color(status)
    return f'<span class="badge" style="background:{color}">{text}</span>'


def _donut(counts: Dict[str, int]) -> str:
    total = sum(counts.values())
    if total == 0:
        return (
            '<div class="donut" style="background:var(--bg-soft)">'
            '<div class="center"><b>0</b><span>items</span></div></div>'
        )
    stops = []
    acc = 0.0
    items = sorted(counts.items(), key=lambda kv: kv[1], reverse=True)
    for i, (key, value) in enumerate(items):
        frac = value / total * 100.0
        color = _status_color(key, i)
        stops.append(f"{color} {acc:.2f}% {acc + frac:.2f}%")
        acc += frac
    gradient = "conic-gradient(" + ", ".join(stops) + ")"
    return (
        f'<div class="donut" style="background:{gradient}">'
        f'<div class="center"><b>{total}</b><span>items</span></div></div>'
    )


def _legend(counts: Dict[str, int]) -> str:
    total = sum(counts.values())
    items = sorted(counts.items(), key=lambda kv: kv[1], reverse=True)
    rows = []
    for i, (key, value) in enumerate(items):
        color = _status_color(key, i)
        pct = round(value / total * 100) if total else 0
        label = html.escape(str(key))
        rows.append(
            f'<div class="row"><span class="swatch" style="background:{color}"></span>'
            f'{label}<span class="val">{value} ({pct}%)</span></div>'
        )
    return '<div class="legend">' + "".join(rows) + "</div>"


def _summary_cards(overview: Dict[str, Any]) -> str:
    totals = overview["totals"]
    orphans = overview["orphans"]
    orphan_text = "".join(
        f'<span class="pill"><span class="dot" style="background:var(--warn)"></span>'
        f"{html.escape(name)}: {value}</span>"
        for name, value in orphans.items()
        if value
    )
    cards = [
        (
            "Collections",
            str(totals["collections"]),
            f"in {html.escape(overview['db_name'])}",
        ),
        ("Documents", str(totals["documents"]), "total across all collections"),
        (
            "Storage",
            human_size(totals["storage_size_bytes"] + totals["index_size_bytes"]),
            human_size(totals["size_bytes"]) + " raw data",
        ),
        ("Indexes", human_size(totals["index_size_bytes"]), "total index footprint"),
    ]
    html_parts = ['<div class="cards">']
    for label, value, note in cards:
        html_parts.append(
            f'<div class="card"><div class="label">{label}</div>'
            f'<div class="value">{html.escape(value)}</div>'
            f'<div class="note">{html.escape(note)}</div></div>'
        )
    html_parts.append("</div>")
    if orphan_text:
        html_parts.append(
            f'<div class="section"><div class="panel"><div class="panel-body">'
            f'<div class="label" style="margin-bottom:8px">Orphaned references '
            f"(missing pipeline)</div>{orphan_text}</div></div></div>"
        )
    return "".join(html_parts)


def _storage_bar(collections: List[Dict[str, Any]]) -> str:
    total = sum(c["storage_size_bytes"] for c in collections)
    if total <= 0:
        return '<div class="panel"><div class="panel-body"><div class="empty">No storage data available</div></div></div>'
    segs = []
    legend = []
    for i, coll in enumerate(collections):
        size = coll["storage_size_bytes"]
        if size <= 0:
            continue
        pct = size / total * 100
        color = _PALETTE[i % len(_PALETTE)]
        label = html.escape(coll["name"])
        segs.append(
            f'<div class="seg" style="width:{pct:.2f}%;background:{color}" '
            f'title="{label}: {human_size(size)}">{label if pct > 6 else ""}</div>'
        )
        legend.append(
            f'<div class="item"><span class="swatch" style="background:{color}"></span>'
            f"{label} · {human_size(size)} · {coll['count']} docs</div>"
        )
    return (
        '<div class="panel"><div class="panel-body">'
        f'<div class="storage-bar">{"".join(segs)}</div>'
        f'<div class="storage-legend">{"".join(legend)}</div>'
        "</div></div>"
    )


def _pipeline_table(overview: Dict[str, Any]) -> str:
    pipelines = overview["pipelines"]
    if not pipelines:
        return '<div class="empty">No pipelines found.</div>'
    rows = []
    for p in pipelines:
        name = html.escape(p["name"] or "(unnamed)")
        search = (
            (p["name"] or "")
            + " "
            + (p["status"] or "")
            + " "
            + (p["repo_uri"] or "")
            + " "
            + (p["workspace_path"] or "")
        )
        repo = html.escape(p["repo_uri"] or "") or '<span class="empty">local</span>'
        ws = html.escape(p["workspace_path"] or "")
        status = _badge(p["status"])
        deleted = '<span class="badge muted">deleted</span> ' if p["deleted"] else ""
        rows.append(
            f'<tr data-search="{html.escape(search.lower())}">'
            f"<td>{deleted}{name}</td>"
            f"<td>{status}</td>"
            f'<td class="wrap mono">{ws or "—"}</td>'
            f'<td class="wrap mono">{repo}</td>'
            f'<td class="num">{p["task_count"]}</td>'
            f'<td class="num">{p["pr_count"]}</td>'
            f'<td class="num">{p["session_count"]}</td>'
            "</tr>"
        )
    return (
        '<div class="panel"><table><thead><tr>'
        "<th>Pipeline</th><th>Status</th><th>Workspace</th><th>Repository</th>"
        '<th class="num">Tasks</th><th class="num">PRs</th><th class="num">Sessions</th>'
        "</tr></thead><tbody>" + "".join(rows) + "</tbody></table></div>"
    )


def _status_breakdown(overview: Dict[str, Any], name: str, title: str) -> str:
    coll = next((c for c in overview["collections"] if c["name"] == name), None)
    if coll is None:
        return ""
    breakdown = coll.get("breakdown") or {}
    return (
        f'<div class="section" id="focus-{name}">'
        f'<div class="section-head"><h2>{title}</h2>'
        f'<span class="meta">{coll["count"]} documents · {human_size(coll["storage_size_bytes"])}</span></div>'
        f'<div class="panel"><div class="panel-body">'
        f'<div class="donut-wrap">{_donut(breakdown)}{_legend(breakdown)}</div>'
        "</div></div></div>"
    )


def _field_table(coll: Dict[str, Any]) -> str:
    fields = coll["fields"]
    if not fields:
        return '<div class="empty">No sampled documents to infer fields.</div>'
    rows = []
    for f in fields:
        name = html.escape(f["name"])
        if f["sensitive"]:
            name += ' <span class="badge muted">redacted</span>'
        rows.append(
            f'<tr><td class="mono">{name}</td>'
            f"<td>{html.escape(f['type'])}</td>"
            f'<td class="num">{f["coverage"]}%</td>'
            f'<td class="num">{f["non_null"]}</td></tr>'
        )
    return (
        "<table><thead><tr><th>Field</th><th>Type</th>"
        '<th class="num">Coverage</th><th class="num">Non-null</th></tr></thead><tbody>'
        + "".join(rows)
        + "</tbody></table>"
    )


def _index_table(coll: Dict[str, Any]) -> str:
    indexes = coll["indexes"]
    if not indexes:
        return '<div class="empty">No indexes.</div>'
    rows = []
    for idx in indexes:
        unique = (
            '<span class="badge" style="background:var(--accent-2)">unique</span>'
            if idx["unique"]
            else ""
        )
        rows.append(
            f'<tr><td class="mono">{html.escape(idx["name"])}</td>'
            f'<td class="mono wrap">{html.escape(idx["key"])}</td>'
            f"<td>{unique}</td></tr>"
        )
    return (
        "<table><thead><tr><th>Index</th><th>Key</th><th></th></tr></thead><tbody>"
        + "".join(rows)
        + "</tbody></table>"
    )


def _samples(coll: Dict[str, Any]) -> str:
    samples = coll["samples"]
    if not samples:
        return '<div class="empty">No documents.</div>'
    parts = []
    for i, sample in enumerate(samples):
        code = html.escape(json.dumps(sample, indent=2, ensure_ascii=False))
        parts.append(
            f'<details class="collapse"><summary>Document {i + 1}</summary>'
            f'<div class="body"><pre class="json">{code}</pre></div></details>'
        )
    return "".join(parts)


def _collection_section(coll: Dict[str, Any]) -> str:
    name = coll["name"]
    search_text = name + " " + " ".join(f["name"] for f in coll["fields"])
    return (
        f'<div class="section" id="coll-{html.escape(name)}" '
        f'data-search="{html.escape(search_text.lower())}">'
        f'<div class="section-head"><h2>{html.escape(name)}</h2>'
        f'<span class="meta">{coll["count"]} docs · {human_size(coll["storage_size_bytes"])} storage · '
        f"{human_size(coll['avg_obj_size'])} avg/doc · {human_size(coll['total_index_size'])} indexes</span></div>"
        f'<div class="panel"><div class="panel-body">'
        f'<details class="collapse" open><summary>Fields</summary><div class="body">{_field_table(coll)}</div></details>'
        f'<details class="collapse"><summary>Indexes ({len(coll["indexes"])})</summary>'
        f'<div class="body">{_index_table(coll)}</div></details>'
        f'<details class="collapse"><summary>Sample documents ({len(coll["samples"])})</summary>'
        f'<div class="body">{_samples(coll)}</div></details>'
        "</div></div></div>"
    )


def _sidebar(overview: Dict[str, Any]) -> str:
    links = [
        ("#storage", "Storage overview", "var(--accent-2)"),
        ("#pipelines", "Pipelines", "var(--accent)"),
        ("#focus-tasks", "Tasks", "#0ea5e9"),
        ("#focus-pull_requests", "Pull requests", "#f59e0b"),
        ("#focus-pi_sessions", "Pi sessions", "#22c55e"),
    ]
    for coll in overview["collections"]:
        color = _PALETTE[overview["collections"].index(coll) % len(_PALETTE)]
        links.append((f"#coll-{coll['name']}", coll["name"], color))
    parts = ['<div class="sidebar"><h2>Contents</h2>']
    for href, label, color in links:
        if href.startswith("#coll-"):
            coll_name = href[len("#coll-") :]
            coll = next(
                (c for c in overview["collections"] if c["name"] == coll_name), None
            )
            count = coll["count"] if coll else 0
        elif href == "#pipelines":
            count = len(overview["pipelines"])
        elif href == "#focus-tasks":
            coll = next(
                (c for c in overview["collections"] if c["name"] == "tasks"), None
            )
            count = coll["count"] if coll else 0
        elif href == "#focus-pull_requests":
            coll = next(
                (c for c in overview["collections"] if c["name"] == "pull_requests"),
                None,
            )
            count = coll["count"] if coll else 0
        elif href == "#focus-pi_sessions":
            coll = next(
                (c for c in overview["collections"] if c["name"] == "pi_sessions"), None
            )
            count = coll["count"] if coll else 0
        else:
            count = ""
        count_html = f'<span class="count">{count}</span>' if count != "" else ""
        parts.append(
            f'<a href="{href}"><span class="dot" style="background:{color}"></span>'
            f"{html.escape(label)}{count_html}</a>"
        )
    parts.append("</div>")
    return "".join(parts)


def render_html(overview: Dict[str, Any]) -> str:
    """Render the overview data as a complete, self-contained HTML document."""
    generated = html.escape(overview["generated_at"])
    db_name = html.escape(overview["db_name"])
    uri = html.escape(overview["uri"])

    body_parts = [
        '<div class="topbar">',
        "<h1>📊 Database Overview</h1>",
        f'<div class="sub">{db_name}<br>{generated}</div>',
        '<div class="spacer"></div>',
        '<input id="search" class="search" type="search" placeholder="Search collections, fields, pipelines…">',
        '<button id="theme-toggle" type="button">Toggle theme</button>',
        "</div>",
        '<div class="layout">',
        _sidebar(overview),
        '<div class="main">',
        _summary_cards(overview),
        f'<div class="section" id="storage"><div class="section-head"><h2>Storage overview</h2>'
        f'<span class="meta">{human_size(overview["totals"]["storage_size_bytes"])} on disk '
        f"({human_size(overview['totals']['index_size_bytes'])} in indexes)</span></div>"
        f"{_storage_bar(overview['collections'])}</div>",
        f'<div class="section" id="pipelines"><div class="section-head"><h2>Pipelines</h2>'
        f'<span class="meta">{len(overview["pipelines"])} pipeline(s)</span></div>'
        f"{_pipeline_table(overview)}</div>",
        _status_breakdown(overview, "tasks", "Tasks"),
        _status_breakdown(overview, "pull_requests", "Pull requests"),
        _status_breakdown(overview, "pi_sessions", "Pi sessions"),
        '<div class="section-head" id="collections"><h2>All collections</h2>'
        '<span class="meta">every collection in the database</span></div>',
    ]

    for coll in overview["collections"]:
        body_parts.append(_collection_section(coll))

    body_parts.append(
        "</div></div>"
        f"<footer>Generated {generated} · database “{db_name}” · {uri}</footer>"
    )

    body = "".join(body_parts)
    return (
        "<!DOCTYPE html>\n"
        '<html lang="en" data-theme="dark">\n<head>\n'
        '<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        "<title>Database Overview · " + db_name + "</title>\n"
        "<style>"
        + _CSS
        + "</style>\n</head>\n<body>\n"
        + body
        + "\n<script>"
        + _JS
        + "</script>\n</body>\n</html>\n"
    )


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    print(f"Collecting overview of '{args.db}' at {args.uri} ...")
    try:
        overview = collect_overview(args.uri, args.db, sample_size=args.sample_size)
    except Exception as exc:  # noqa: BLE001 - report a friendly CLI error
        print(f"ERROR: could not read database: {exc}", file=sys.stderr)
        return 1

    html_content = render_html(overview)
    with open(args.output, "w", encoding="utf-8") as fh:
        fh.write(html_content)

    total = overview["totals"]
    print(
        f"Wrote {args.output} ({human_size(len(html_content.encode('utf-8')))}) "
        f"— {total['collections']} collections, {total['documents']} documents, "
        f"{human_size(total['storage_size_bytes'])} storage."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
