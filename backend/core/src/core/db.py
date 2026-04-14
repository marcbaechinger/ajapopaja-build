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
from pymongo import AsyncMongoClient
from beanie import init_beanie
from core.models.models import Pipeline, Task, User

async def init_db():
    mongodb_uri = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
    database_name = os.getenv("DATABASE_NAME", "ajapopaja_build")
    
    client = AsyncMongoClient(mongodb_uri)
    await init_beanie(
        database=client[database_name],
        document_models=[Pipeline, Task, User]
    )
    print(f"Database initialized: {database_name}")
