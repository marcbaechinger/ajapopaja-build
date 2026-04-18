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

from enum import Enum
from typing import List, Optional, Dict, Any
from datetime import datetime, UTC
from pydantic import Field, BaseModel
from beanie import Document

class TaskStatus(str, Enum):
    CREATED = "created"
    SCHEDULED = "scheduled"
    PROPOSED = "proposed"
    INPROGRESS = "inprogress"
    IMPLEMENTED = "implemented"
    DISCARDED = "discarded"
    FAILED = "failed"

class StateTransition(BaseModel):
    from_status: Optional[TaskStatus] = None
    to_status: TaskStatus
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))
    by: str  # "user", "mcp", "system"

class Task(Document):
    title: str
    description: Optional[str] = None
    status: TaskStatus = TaskStatus.CREATED
    type: str = "manual"  # manual, system
    spec: Optional[str] = None
    want_design_doc: bool = False
    order: int = 0
    version: int = 1
    commit_hash: Optional[str] = None
    completion_info: Optional[str] = None
    verification: Optional[Dict[str, Any]] = None
    design_doc: Optional[str] = None
    parent_task_id: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    scheduled_at: Optional[datetime] = None
    pipeline_id: str
    deleted: bool = False
    history: List[StateTransition] = Field(default_factory=list)

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
    workspace_path: Optional[str] = None
    manage_gemini: bool = False
    manage_vibe: bool = False
    version: int = 1
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    deleted: bool = False

    class Settings:
        name = "pipelines"

class User(Document):
    username: str
    hashed_password: str
    email: Optional[str] = None
    full_name: Optional[str] = None
    disabled: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    class Settings:
        name = "users"

class ChatMessage(BaseModel):
    role: str  # "user", "assistant", "system", "tool"
    content: str
    tool_calls: Optional[List[Dict[str, Any]]] = None
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))

class UserChat(Document):
    user_id: str
    history: List[ChatMessage] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    class Settings:
        name = "assistant_chats"
