import pytest
from httpx import AsyncClient
from pymongo import AsyncMongoClient
from beanie import init_beanie
from api.main import app
from core.models.models import Pipeline, Task

@pytest.fixture
async def init_mock_db():
    client = AsyncMongoClient("mongodb://localhost:27017")
    db = client["ajapopaja_test_db"]
    await init_beanie(
        database=db,
        document_models=[Pipeline, Task]
    )
    yield
    await client.drop_database("ajapopaja_test_db")
    await client.close()

@pytest.fixture
async def async_client():
    async with AsyncClient(app=app, base_url="http://test") as client:
        yield client
