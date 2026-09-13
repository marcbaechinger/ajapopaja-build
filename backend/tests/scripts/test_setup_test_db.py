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

import pytest
from mongomock.database import Database as MongoMockDatabase
from mongomock_motor import AsyncMongoMockClient

from core import db
from core.models.models import Pipeline, Task, TaskStatus

_SCRIPTS_DIR = Path(__file__).resolve().parents[3] / "scripts"
_SPEC = importlib.util.spec_from_file_location(
    "setup_test_db", _SCRIPTS_DIR / "setup_test_db.py"
)
setup = importlib.util.module_from_spec(_SPEC)
assert _SPEC.loader is not None
_SPEC.loader.exec_module(setup)


@pytest.fixture
async def mock_db(monkeypatch):
    """Point the shared core.db bootstrap at an in-memory MongoDB, isolated per test."""
    monkeypatch.setenv("MONGODB_URI", "mongodb://localhost:27017")
    monkeypatch.setenv("DATABASE_NAME", f"test_seed_{id(setup)}")

    # mongomock doesn't accept the authorizedCollections/nameOnly kwargs that
    # Beanie passes to Database.list_collection_names(), so strip them out.
    orig_list = MongoMockDatabase.list_collection_names

    def _patched_list_collection_names(self, *args, **kwargs):
        kwargs.pop("authorizedCollections", None)
        kwargs.pop("nameOnly", None)
        return orig_list(self, *args, **kwargs)

    monkeypatch.setattr(
        MongoMockDatabase, "list_collection_names", _patched_list_collection_names
    )

    mock_client = AsyncMongoMockClient()

    # Seed the shared core.db state with the mock client so init_db binds Beanie
    # to the in-memory database rather than creating its own real client.
    db._is_initialized = False
    db._client = mock_client
    await db.init_db()

    yield

    db._is_initialized = False
    db._client = None
    await mock_client.drop_database(f"test_seed_{id(setup)}")
    mock_client.close()


def _example_tasks():
    return [
        {
            "title": "Task A",
            "description": "First task",
            "spec": "# Spec for task A",
            "want_design_doc": False,
            "type": "manual",
            "order": 2,
        },
        {
            "title": "Task B",
            "spec": "Some b spec",
            "want_design_doc": True,
            "type": "system",
            "order": 5,
        },
        {
            "title": "Task C",
            "want_design_doc": False,
            "type": "manual",
            "order": 9,
        },
    ]


async def _seed(mock_db, tasks=None):
    pipeline = await setup.get_or_create_pipeline(setup.PIPELINE_NAME)
    inserted, skipped = await setup.seed_tasks(pipeline, tasks or _example_tasks())
    return pipeline, inserted, skipped


@pytest.mark.asyncio
async def test_finds_and_reuses_existing_pipeline(mock_db):
    pipeline1, inserted1, skipped1 = await _seed(mock_db)
    assert inserted1 == 3
    assert skipped1 == 0

    # Seeding a second time reuses the same pipeline and skips all tasks.
    pipeline2, inserted2, skipped2 = await _seed(mock_db)
    assert str(pipeline1.id) == str(pipeline2.id)
    assert inserted2 == 0
    assert skipped2 == 3

    pipelines = await Pipeline.find(Pipeline.name == setup.PIPELINE_NAME).to_list()
    assert len(pipelines) == 1


@pytest.mark.asyncio
async def test_creates_tasks_in_created_state(mock_db):
    pipeline, inserted, _ = await _seed(mock_db)
    assert inserted == 3

    tasks = await Task.find(Task.pipeline_id == str(pipeline.id)).to_list()
    assert len(tasks) == 3
    for t in tasks:
        assert t.status == TaskStatus.CREATED
        assert t.version == 1
        assert t.pipeline_id == str(pipeline.id)
        assert len(t.history) == 1
        assert t.history[0].to_status == TaskStatus.CREATED
        assert t.history[0].by == "system"


@pytest.mark.asyncio
async def test_respects_order_from_json(mock_db):
    pipeline, _, _ = await _seed(mock_db)
    tasks = await Task.find(Task.pipeline_id == str(pipeline.id)).to_list()
    by_title = {t.title: t for t in tasks}
    assert by_title["Task A"].order == 2
    assert by_title["Task B"].order == 5
    assert by_title["Task C"].order == 9


def test_defaults_and_args():
    args = setup.parse_args([])
    assert args.uri == "mongodb://localhost:27017"
    assert args.db == "ajapopaja_build_prod"
    assert args.data == str(_SCRIPTS_DIR / "test_repo_tasks_data.json")
