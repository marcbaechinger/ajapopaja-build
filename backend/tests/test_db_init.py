import pytest

from core import db


@pytest.mark.asyncio
async def test_init_db_lazy(capsys):
    # Reset internal state for clean test
    db._is_initialized = False
    db._client = None

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
    # Reset internal state
    db._is_initialized = False
    db._client = None

    await db.init_db()
    client1 = db._client
    assert client1 is not None

    # Reset initialized flag but NOT client to simulate reuse check
    db._is_initialized = False
    await db.init_db()
    client2 = db._client

    assert client1 is client2
