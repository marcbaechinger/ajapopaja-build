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

import os
import uuid
from pathlib import Path

import pytest
from beanie import init_beanie
from httpx import ASGITransport, AsyncClient
from pymongo import AsyncMongoClient

from api.main import app
from core import config
from core.models.models import (
    DesignDocHistory,
    Pipeline,
    PiSession,
    PullRequest,
    Task,
    User,
    UserChat,
)


@pytest.fixture(autouse=True)
def mock_workspaces_root(monkeypatch):
    monkeypatch.setattr(config, "WORKSPACES_ROOT", Path("/tmp"))


@pytest.fixture(autouse=True)
def isolate_pi_sessions_root(monkeypatch, tmp_path):
    """Keep every test's Pi session files inside pytest's tmp dir.

    Several code paths (e.g. ``CoderBotManager.process_task`` and
    ``start_interactive_session``) write a ``meta.json`` sidecar through
    :mod:`api.coderbot.pi_session_store` as a best-effort recovery aid. Without
    this fixture those writes land in the real ``config.PI_SESSIONS_ROOT``
    (``/data/ajapopaja/pi_sessions``) and leave orphaned session directories
    behind after a test run.

    Tests that need a specific layout can still override
    ``config.PI_SESSIONS_ROOT`` themselves; their ``monkeypatch`` wins for the
    duration of the test.
    """
    sessions_root = tmp_path / "pi_sessions"
    # Patch both the attribute and the environment variable: some tests call
    # ``importlib.reload(config)``, which re-reads the env var and would
    # otherwise discard the attribute patch.
    monkeypatch.setattr(config, "PI_SESSIONS_ROOT", sessions_root)
    monkeypatch.setenv("PI_SESSIONS_ROOT", str(sessions_root))


@pytest.fixture
async def init_mock_db():
    mongodb_uri = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
    test_db_name = f"test_db_{uuid.uuid4().hex}"
    client = AsyncMongoClient(mongodb_uri)
    db = client[test_db_name]
    await init_beanie(
        database=db,
        document_models=[
            Pipeline,
            Task,
            DesignDocHistory,
            User,
            UserChat,
            PullRequest,
            PiSession,
        ],
    )
    yield test_db_name
    await client.drop_database(test_db_name)
    await client.close()


@pytest.fixture
async def async_client():
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://test"
    ) as client:
        yield client
