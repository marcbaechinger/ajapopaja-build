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

import importlib.util
from pathlib import Path

_SCRIPTS_DIR = Path(__file__).resolve().parents[3] / "scripts"
_SPEC = importlib.util.spec_from_file_location(
    "generate_db_overview", _SCRIPTS_DIR / "generate_db_overview.py"
)
gen = importlib.util.module_from_spec(_SPEC)
assert _SPEC.loader is not None
_SPEC.loader.exec_module(gen)


def _collection(**overrides):
    base = {
        "name": "tasks",
        "count": 10,
        "size_bytes": 1000,
        "storage_size_bytes": 800,
        "avg_obj_size": 80,
        "total_index_size": 200,
        "index_count": 2,
        "capped": False,
        "samples": [{"title": "example", "status": "created"}],
        "fields": [
            {
                "name": "title",
                "type": "string",
                "coverage": 100,
                "non_null": 10,
                "sensitive": False,
            },
            {
                "name": "status",
                "type": "string",
                "coverage": 100,
                "non_null": 10,
                "sensitive": False,
            },
        ],
        "indexes": [{"name": "_id_", "key": "_id (1)", "unique": True}],
        "breakdown": {"created": 6, "implemented": 4},
    }
    base.update(overrides)
    return base


def _overview(**overrides):
    base = {
        "uri": "mongodb://localhost:27017",
        "db_name": "testdb",
        "generated_at": "2026-01-01T00:00:00+00:00",
        "collections": [
            _collection(),
            _collection(
                name="pull_requests",
                count=3,
                breakdown={"open": 2, "accepted": 1},
                samples=[{"summary": "pr", "status": "open"}],
            ),
            _collection(
                name="pi_sessions",
                count=2,
                breakdown={"running": 1, "completed": 1},
                samples=[{"uid": "u", "status": "running"}],
            ),
        ],
        "totals": {
            "collections": 3,
            "documents": 15,
            "size_bytes": 1800,
            "storage_size_bytes": 1450,
            "index_size_bytes": 350,
        },
        "pipelines": [
            {
                "id": "p1",
                "name": "main",
                "status": "active",
                "workspace_path": "ws",
                "repo_uri": None,
                "deleted": False,
                "task_count": 10,
                "pr_count": 3,
                "session_count": 2,
            }
        ],
        "orphans": {"tasks": 1, "pull_requests": 0, "pi_sessions": 0},
    }
    base.update(overrides)
    return base


def test_parse_args_defaults():
    args = gen.parse_args([])
    assert args.uri == "mongodb://localhost:27017"
    assert args.db == "ajapopaja_build_prod"
    assert args.output == "db_overview.html"
    assert args.sample_size == 20


def test_human_size():
    assert gen.human_size(0) == "0 B"
    assert gen.human_size(1024) == "1.0 KB"
    assert gen.human_size(5 * 1024 * 1024) == "5.0 MB"
    assert gen.human_size(None) == "0 B"


def test_infer_type():
    assert gen.infer_type(None) == "null"
    assert gen.infer_type(True) == "boolean"
    assert gen.infer_type(1) == "integer"
    assert gen.infer_type(1.5) == "number"
    assert gen.infer_type("x") == "string"
    assert gen.infer_type([]) == "array"
    assert gen.infer_type({}) == "object"


def test_sanitize_redacts_sensitive_and_truncates():
    out = gen.sanitize(
        {
            "repo_token": "secret",
            "hashed_password": "hash",
            "nested": {"api_key": "k"},
            "title": "visible",
            "long": "x" * 500,
        }
    )
    assert out["repo_token"] == "***REDACTED***"
    assert out["hashed_password"] == "***REDACTED***"
    assert out["nested"]["api_key"] == "***REDACTED***"
    assert out["title"] == "visible"
    assert len(out["long"]) == 241
    assert out["long"].endswith("\u2026")


def test_infer_fields():
    docs = [
        {"title": "a", "status": "created"},
        {"title": "b", "status": None},
    ]
    fields = gen.infer_fields(docs)
    by_name = {f["name"]: f for f in fields}
    assert by_name["title"]["type"] == "string"
    assert by_name["title"]["coverage"] == 100
    assert by_name["status"]["type"] == "string"
    assert by_name["status"]["non_null"] == 1
    assert by_name["status"]["coverage"] == 50


def test_render_html_contains_core_sections():
    html = gen.render_html(_overview())
    assert "Database Overview" in html
    assert "Storage overview" in html
    assert "Pipelines" in html
    assert "Tasks" in html
    assert "Pull requests" in html
    assert "Pi sessions" in html
    assert "All collections" in html
    assert "main" in html  # a pipeline name
    # Sensitive sample values are never leaked into the report.
    assert "***REDACTED***" not in html


def test_render_html_escapes_injected_content():
    html = gen.render_html(_overview(db_name='<script>alert("x")</script>'))
    assert "<script>alert" not in html
    assert "&lt;script&gt;alert" in html


def test_render_html_handles_empty_database():
    overview = _overview(
        collections=[],
        totals={
            "collections": 0,
            "documents": 0,
            "size_bytes": 0,
            "storage_size_bytes": 0,
            "index_size_bytes": 0,
        },
        pipelines=[],
        orphans={"tasks": 0, "pull_requests": 0, "pi_sessions": 0},
    )
    html = gen.render_html(overview)
    assert "Database Overview" in html
    assert "No pipelines found." in html
