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

import pytest
import uuid
from httpx import AsyncClient
from pymongo import AsyncMongoClient
from beanie import init_beanie
from api.main import app
from core.models.models import Pipeline, Task

@pytest.fixture
async def init_mock_db():
    test_db_name = f"test_db_{uuid.uuid4().hex}"
    client = AsyncMongoClient("mongodb://localhost:27017")
    db = client[test_db_name]
    await init_beanie(
        database=db,
        document_models=[Pipeline, Task]
    )
    yield test_db_name
    await client.drop_database(test_db_name)
    await client.close()

@pytest.fixture
async def async_client():
    async with AsyncClient(app=app, base_url="http://test") as client:
        yield client
