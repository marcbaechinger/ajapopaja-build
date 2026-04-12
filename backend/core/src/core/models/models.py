from enum import Enum
from typing import List, Optional, Dict, Any
from datetime import datetime
from pydantic import Field
from beanie import Document

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
    type: str = "manual"  # manual, system
    order: int = 0
    version: int = 1
    commit_hash: Optional[str] = None
    completion_info: Optional[str] = None
    verification: Optional[Dict[str, Any]] = None
    parent_task_id: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    pipeline_id: str

    class Settings:
        name = "tasks"

class PipelineStatus(str, Enum):
    ACTIVE = "active"
    PAUSED = "paused"
    COMPLETED = "completed"

class Pipeline(Document):
    name: str
    description: Optional[str] = None
    status: PipelineStatus = PipelineStatus.ACTIVE
    version: int = 1
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    class Settings:
        name = "pipelines"
