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
from datetime import UTC, datetime
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional

from beanie import Document
from pydantic import BaseModel, Field, field_validator

from core import config
from core.utils.path_utils import safe_join, sanitize_relative_path


class TaskStatus(str, Enum):
    CREATED = "created"
    SCHEDULED = "scheduled"
    PROPOSED = "proposed"
    INPROGRESS = "inprogress"
    IMPLEMENTED = "implemented"
    PULL_REQUEST_AVAILABLE = "pull_request_available"
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
    review_md: Optional[str] = None

    class Settings:
        name = "tasks"


class DesignDocHistory(Document):
    task_id: str
    version: int
    design_doc: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))

    class Settings:
        name = "design_doc_history"


class PipelineStatus(str, Enum):
    ACTIVE = "active"
    PAUSED = "paused"
    COMPLETED = "completed"


class Pipeline(Document):
    name: str
    description: Optional[str] = None
    status: PipelineStatus = PipelineStatus.ACTIVE
    workspace_path: Optional[str] = None
    version: int = 1
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    deleted: bool = False

    @field_validator("workspace_path")
    @classmethod
    def validate_workspace_path(cls, v):
        if v is not None and v != "":
            if os.path.isabs(v):
                # Migration logic: if it's an absolute path, try to make it relative to
                # config.WORKSPACES_ROOT
                try:
                    rel_path = os.path.relpath(v, config.WORKSPACES_ROOT)
                    # Check if it's actually within config.WORKSPACES_ROOT
                    if rel_path.startswith(".."):
                        import logging

                        logging.warning(
                            f"Absolute path {v} is outside config.WORKSPACES_ROOT "
                            f"{config.WORKSPACES_ROOT}. Nullifying workspace_path."
                        )
                        return None
                    v = rel_path
                except ValueError as e:
                    import logging

                    logging.warning(
                        f"Could not migrate absolute path {v} to config.WORKSPACES_ROOT"
                        f" {config.WORKSPACES_ROOT}: {e}. Nullifying workspace_path."
                    )
                    return None

            return sanitize_relative_path(v)
        return v

    @property
    def workspace_abs_path(self) -> Optional[Path]:
        if not self.workspace_path:
            return None
        return safe_join(config.WORKSPACES_ROOT, self.workspace_path)

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
    thought: Optional[str] = None
    tool_calls: Optional[List[Dict[str, Any]]] = None
    timestamp: datetime = Field(default_factory=lambda: datetime.now(UTC))


class UserChat(Document):
    user_id: str
    history: List[ChatMessage] = Field(default_factory=list)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    class Settings:
        name = "assistant_chats"


class PullRequestStatus(str, Enum):
    OPEN = "open"
    ACCEPTED = "accepted"
    REJECTED = "rejected"


class PullRequest(Document):
    pipeline_id: str
    task_id: str
    summary: str
    branch_name: str
    patch: str  # The git diff output
    status: PullRequestStatus = PullRequestStatus.OPEN
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    class Settings:
        name = "pull_requests"
