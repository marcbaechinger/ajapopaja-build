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
import re
from datetime import UTC, datetime
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse

from beanie import Document
from pydantic import (
    BaseModel,
    Field,
    computed_field,
    field_serializer,
    field_validator,
)

from core import config
from core.utils.path_utils import (
    repo_name_from_uri,
    safe_join,
    sanitize_relative_path,
)


def _validate_command_lists(
    v: Optional[List[List[str]]], field_name: str, kind: str
) -> Optional[List[List[str]]]:
    """Validate a per-pipeline command list (a list of argv lists).

    ``None`` means “not configured”. An empty list ``[]`` explicitly disables
    pipeline-specific commands. Otherwise each entry must be a non-empty list of
    non-empty strings. The normalized list is returned.
    """
    if v is None:
        return v
    if not isinstance(v, list):
        raise ValueError(f"{field_name} must be a JSON list of command argv lists")
    validated: List[List[str]] = []
    for entry in v:
        if not isinstance(entry, list) or not entry:
            raise ValueError(
                f"Each {kind} command must be a non-empty list of argv strings"
            )
        if not all(isinstance(a, str) and a for a in entry):
            raise ValueError(
                f"Each {kind} command argv element must be a non-empty string"
            )
        validated.append(list(entry))
    return validated


class TaskStatus(str, Enum):
    CREATED = "created"
    SCHEDULED = "scheduled"
    PROPOSED = "proposed"
    INPROGRESS = "inprogress"
    IMPLEMENTED = "implemented"
    PULL_REQUEST_AVAILABLE = "pull_request_available"
    SUBMITTED = "submitted"
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
    # Priority/position used to sort backlog (CREATED/PROPOSED) and scheduled
    # tasks. Lower values sort first; the default (100) places new tasks below
    # any that were given an explicit (often negative or small) priority.
    order: int = 100
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
    repo_uri: Optional[str] = None
    repo_username: Optional[str] = None
    repo_token: Optional[str] = None
    doc_root: str = "design"
    # Pipeline-specific test verification commands (list of argv lists, e.g.
    # [["sh", "-c", "cd backend && uv run pytest"]]). When empty, the global
    # CODERBOT_TEST_COMMANDS_JSON / default commands are used as fallback.
    test_commands: Optional[List[List[str]]] = None
    # Pipeline-specific lint commands (list of argv lists, e.g.
    # [["sh", "-c", "cd frontend && npm run lint"]]). These are run by the
    # ``run_lint`` assistant tool / lint endpoint. ``None``/empty means
    # "not configured".
    lint_commands: Optional[List[List[str]]] = None
    version: int = 1
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    deleted: bool = False

    @computed_field
    @property
    def has_repo_token(self) -> bool:
        """Whether a repo token is stored. The token itself is never serialized."""
        return bool(self.repo_token)

    @field_serializer("repo_token")
    def serialize_repo_token(self, v: Optional[str]) -> Optional[str]:
        """Never expose the repo token in serialized output (API responses)."""
        return None

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

    @field_validator("test_commands")
    @classmethod
    def validate_test_commands(cls, v):
        """Validate per-pipeline test commands (a list of argv lists).

        - ``None`` means “not configured” and falls back to the global config.
        - An empty list ``[]`` explicitly disables pipeline-specific commands
          (the global config is used).
        - Otherwise each entry must be a non-empty list of non-empty strings.
        """
        return _validate_command_lists(v, "test_commands", "test")

    @field_validator("lint_commands")
    @classmethod
    def validate_lint_commands(cls, v):
        """Validate per-pipeline lint commands (a list of argv lists).

        - ``None`` means “not configured”.
        - An empty list ``[]`` disables pipeline-specific lint commands.
        - Otherwise each entry must be a non-empty list of non-empty strings.
        """
        return _validate_command_lists(v, "lint_commands", "lint")

    @field_validator("repo_uri")
    @classmethod
    def validate_repo_uri(cls, v):
        if v is None or v == "":
            return v
        v = v.strip()
        # SCP-style SSH URL: git@host:path
        if re.match(r"^[^@]+@[^:]+:.+$", v):
            return v
        parsed = urlparse(v)
        if parsed.scheme in ("https", "http", "ssh", "git") and parsed.netloc:
            return v
        raise ValueError(
            f"repo_uri must be a well-formed git URL (https://, http://, ssh://, "
            f"git://, or git@host:path), got '{v}'"
        )

    @property
    def workspace_abs_path(self) -> Optional[Path]:
        if self.repo_uri:
            # Remote pipeline: resolve to the cloned repo under REMOTE_WORKSPACES_ROOT.
            repo_name = repo_name_from_uri(self.repo_uri) or self.name
            return safe_join(config.REMOTE_WORKSPACES_ROOT, repo_name)
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
    SUBMITTED = "submitted"  # Gitea PR created, awaiting external review


class PullRequest(Document):
    pipeline_id: str
    task_id: str
    summary: str
    subject: str = ""
    branch_name: str
    patch: str  # The git diff output
    status: PullRequestStatus = PullRequestStatus.OPEN
    remote_pr_url: Optional[str] = None  # set only in gitea_pr mode
    # How accepting this PR will apply the change, resolved at read time by the
    # pull-request routes based on the pipeline's repo_uri and the global
    # REMOTE_PR_MODE:
    #   "merge"  -> applied directly in the local workspace/repo
    #   "push"   -> committed to the cloned repo and pushed to the remote
    #   "submit" -> committed to the cloned repo and sent as a pull request
    apply_mode: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    class Settings:
        name = "pull_requests"
