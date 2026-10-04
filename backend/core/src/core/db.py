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

from beanie import init_beanie
from pymongo import AsyncMongoClient

from core.models.models import (
    DesignDocHistory,
    Pipeline,
    PiSession,
    PullRequest,
    Task,
    User,
    UserChat,
)

_client = None
_is_initialized = False


async def init_db(force: bool = False):
    global _client, _is_initialized

    if not force and _is_initialized:
        return

    mongodb_uri = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
    database_name = os.getenv("DATABASE_NAME", "ajapopaja_build")

    if force or _client is None:
        # ``tz_aware=True`` makes PyMongo return aware ``datetime`` objects on
        # read. Without it, Beanie/Pydantic serialize datetimes without an
        # offset, which JavaScript parses as *local* time and shifts every
        # relative/absolute timestamp by the browser's UTC offset.
        _client = AsyncMongoClient(mongodb_uri, tz_aware=True)

    await init_beanie(
        database=_client[database_name],
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
    _is_initialized = True
    print(f"Database initialized: {database_name}")
