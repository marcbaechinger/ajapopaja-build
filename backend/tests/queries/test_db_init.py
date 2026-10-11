import pytest
from mongomock.database import Database as MongoMockDatabase
from mongomock_motor import AsyncMongoMockClient

from core import db


@pytest.fixture(autouse=True)
def _isolate_db_init(monkeypatch):
    """Exercise the real ``core.db.init_db`` logic against an in-memory client.

    ``init_db`` normally constructs a real ``AsyncMongoClient``, which would
    require a reachable MongoDB. Swap that constructor for the in-memory mock
    (and teach mongomock to ignore the ``list_collection_names`` kwargs Beanie
    passes) so the suite runs without any MongoDB.
    """
    monkeypatch.setattr(db, "AsyncMongoClient", AsyncMongoMockClient)

    orig_list = MongoMockDatabase.list_collection_names

    def _patched_list_collection_names(self, *args, **kwargs):
        kwargs.pop("authorizedCollections", None)
        kwargs.pop("nameOnly", None)
        return orig_list(self, *args, **kwargs)

    monkeypatch.setattr(
        MongoMockDatabase, "list_collection_names", _patched_list_collection_names
    )

    db._is_initialized = False
    db._client = None
    yield
    db._is_initialized = False
    db._client = None


@pytest.mark.asyncio
async def test_init_db_lazy(capsys):
    # First call - should initialize
    await db.init_db()
    captured = capsys.readouterr()
    assert "Database initialized" in captured.out
    assert db._is_initialized is True

    # Second call - should NOT initialize again (lazy)
    await db.init_db()
    captured = capsys.readouterr()
    assert "Database initialized" not in captured.out

    # Force call - should initialize again
    await db.init_db(force=True)
    captured = capsys.readouterr()
    assert "Database initialized" in captured.out


@pytest.mark.asyncio
async def test_init_db_client_reuse():
    await db.init_db()
    client1 = db._client
    assert client1 is not None

    # Reset initialized flag but NOT client to simulate reuse check
    db._is_initialized = False
    await db.init_db()
    client2 = db._client

    assert client1 is client2
