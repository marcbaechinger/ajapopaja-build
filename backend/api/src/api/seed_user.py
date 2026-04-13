import asyncio
import os
from core.db import init_db
from core.models.models import User
from api.auth import get_password_hash

async def seed_user():
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
