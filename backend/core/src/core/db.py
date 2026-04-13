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
