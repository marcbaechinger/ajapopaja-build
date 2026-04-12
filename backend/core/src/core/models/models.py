from enum import Enum
from typing import List, Optional
from datetime import datetime
from pydantic import Field
from beanie import Document, Link

class TaskStatus(str, Enum):
    CREATED = "created"
    SCHEDULED = "scheduled"
    INPROGRESS = "inprogress"
    IMPLEMENTED = "implemented"
    DISCARDED = "discarded"
    FAILED = "failed"

class Task(Document):
    title: str
    description: Optional[str] = None
    status: TaskStatus = TaskStatus.CREATED
    order: int = 0
    version: int = 1
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    pipeline_id: str

    class Settings:
        name = "tasks"

class Pipeline(Document):
    name: str
    description: Optional[str] = None
    version: int = 1
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "pipelines"
