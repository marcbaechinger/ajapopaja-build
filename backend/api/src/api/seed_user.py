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

import asyncio
import os
from core.db import init_db
from core.models.models import User
from api.auth import get_password_hash

"""
Development utility to seed an initial administrator user.
This script should ONLY be used in development or for first-time setup.
"""

async def seed_user():
    """Seeds the database with a default admin user."""
    print("Initializing database...")
    await init_db()
    
    username = "admin"
    password = "admin"
    
    existing_user = await User.find_one(User.username == username)
    if existing_user:
        print(f"User '{username}' already exists.")
        return
    
    hashed_password = get_password_hash(password)
    user = User(
        username=username,
        hashed_password=hashed_password,
        full_name="Administrator",
        email="admin@example.com"
    )
    
    await user.insert()
    print(f"User '{username}' created successfully.")

if __name__ == "__main__":
    asyncio.run(seed_user())
