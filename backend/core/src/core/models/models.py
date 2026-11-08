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
from uuid import uuid4

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
    v: Optional[List[List[str]]],
    field_name: str,
    kind: str,
    error_type: type = ValueError,
) -> Optional[List[List[str]]]:
    """Validate a per-pipeline command list (a list of argv lists).

    ``None`` means “not configured”. An empty list ``[]`` explicitly disables
    pipeline-specific commands. Otherwise each entry must be a non-empty list of
    non-empty strings. The normalized list is returned.

    ``field_name`` and ``kind`` are used only for the wording of error messages,
    while ``error_type`` is the exception class raised on malformed input (it
    defaults to :class:`ValueError`, which the Pydantic validators rely on).
    """
    if v is None:
        return v
    if not isinstance(v, list):
        raise error_type(f"{field_name} must be a JSON list of command argv lists")
    validated: List[List[str]] = []
    for entry in v:
        if not isinstance(entry, list) or not entry:
            raise error_type(
                f"Each {kind} command must be a non-empty list of argv strings"
            )
        if not all(isinstance(a, str) and a for a in entry):
            raise error_type(
                f"Each {kind} command argv element must be a non-empty string"
            )
        validated.append(list(entry))
    return validated


def _normalize_model_override(value: Optional[str]) -> Optional[str]:
    """Return a trimmed model name or ``None`` for a blank value.

    Shared by the :class:`Pipeline` field validator and the update query so a
    "cleared" override is always persisted uniformly as ``None``.
    """
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    return value


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
    # Original batch Pi session that implemented this task. Optional, so
    # existing documents remain valid without a migration.
    pi_session_uid: Optional[str] = None
    # Pi-agent model id (from ``docker/pi-agent/models.json``) that a
    # CoderBotSession started for this task should use instead of the
    # configured pipeline/global model. Optional, so existing documents remain
    # valid without a migration.
    suggested_model: Optional[str] = None

    @field_validator("suggested_model")
    @classmethod
    def validate_suggested_model(cls, v):
        """Normalize blank/whitespace suggested models to ``None``."""
        return _normalize_model_override(v)

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


class BuildArtifactSpec(BaseModel):
    """Declaration of a pipeline's single build output file.

    ``path`` is a repository-relative POSIX path. It is validated with the same
    rules as file-browser paths: absolute paths and traversal escapes are
    rejected, and the ``.git`` metadata directory is never addressable.
    """

    path: str
    label: Optional[str] = None
    description: Optional[str] = None
    media_type: Optional[str] = None

    @field_validator("path")
    @classmethod
    def validate_path(cls, v: str) -> str:
        clean = sanitize_relative_path(v)
        if any(part == ".git" for part in clean.split("/")):
            raise ValueError("build_artifact.path must not reference .git")
        return clean


class BuildArtifactInfo(BaseModel):
    """Live metadata/fingerprint for a pipeline's configured build artifact.

    The information is computed on demand from the workspace; it is never
    persisted. ``sha256`` is the authoritative equality key, while ``size`` and
    ``modified_at`` are cheap hints for deciding whether a hash is needed.
    """

    path: Optional[str] = None
    exists: bool = False
    size: Optional[int] = None
    modified_at: Optional[datetime] = None
    version: Optional[str] = None
    sha256: Optional[str] = None
    media_type: Optional[str] = None
    build_commands_configured: bool = False
    # Optional fields populated by the REST/MCP layers.
    download_url: Optional[str] = None
    download_token: Optional[str] = None
    expires_in: Optional[int] = None
    # Display metadata copied from the declaration (when one is configured).
    label: Optional[str] = None
    description: Optional[str] = None

    def __await__(self):
        """Allow callers to await a synchronously computed result.

        The artifact service is intentionally synchronous (it only stats,
        hashes and reads git metadata), but consumers may reasonably use it
        from an async context. Returning ``self`` makes both
        ``get_artifact_info(pipeline)`` and
        ``await get_artifact_info(pipeline)`` work.
        """
        if False:  # pragma: no cover - makes this method a generator
            yield None
        return self


class RepoBootstrapStatus(str, Enum):
    """Outcome of the startup clone-if-missing check for a remote repo."""

    CLONED = "cloned"  # repo was missing and has been cloned
    AVAILABLE = "available"  # repo already present; no action taken


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
    # Pipeline-specific serve commands (list of argv lists, e.g.
    # [["sh", "-c", "uv run uvicorn api.main:app --reload"]]). These are
    # launched as a long-running background dev server by the
    # ``DevProcessManager`` / dev router. ``None``/empty means "not configured".
    serve_commands: Optional[List[List[str]]] = None
    # Pipeline-specific build commands (list of argv lists, e.g.
    # [["sh", "-c", "cd frontend && npm run build"]]). These build the repo.
    # ``None``/empty means "not configured".
    build_commands: Optional[List[List[str]]] = None
    # Optional declaration of the single file produced by ``build_commands``.
    # The file itself is never persisted; metadata is computed on demand.
    build_artifact: Optional[BuildArtifactSpec] = None
    # Per-use-case model overrides. ``None``/empty means "no override" and the
    # global configuration from ``core.config`` is used instead. All fields are
    # optional so existing documents remain valid without a migration.
    # ``ollama_model`` is a general fallback applied to every Ollama use case;
    # the others are use-case specific. ``coderbot_model`` selects a pi-agent
    # model id from ``docker/pi-agent/models.json`` (not an Ollama tag).
    ollama_model: Optional[str] = None
    one_prompt_model: Optional[str] = None
    assistant_model: Optional[str] = None
    archbot_model: Optional[str] = None
    reviewbot_model: Optional[str] = None
    docbot_model: Optional[str] = None
    specagent_model: Optional[str] = None
    coderbot_model: Optional[str] = None
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

    @field_validator("serve_commands")
    @classmethod
    def validate_serve_commands(cls, v):
        """Validate per-pipeline serve commands (a list of argv lists).

        - ``None`` means “not configured”.
        - An empty list ``[]`` disables the pipeline-specific dev server.
        - Otherwise each entry must be a non-empty list of non-empty strings.
        """
        return _validate_command_lists(v, "serve_commands", "serve")

    @field_validator("build_commands")
    @classmethod
    def validate_build_commands(cls, v):
        """Validate per-pipeline build commands (a list of argv lists).

        - ``None`` means “not configured”.
        - An empty list ``[]`` disables pipeline-specific build commands.
        - Otherwise each entry must be a non-empty list of non-empty strings.
        """
        return _validate_command_lists(v, "build_commands", "build")

    @field_validator(
        "ollama_model",
        "one_prompt_model",
        "assistant_model",
        "archbot_model",
        "reviewbot_model",
        "docbot_model",
        "specagent_model",
        "coderbot_model",
    )
    @classmethod
    def validate_model_overrides(cls, v):
        """Normalize blank/whitespace model overrides to ``None``.

        A blank select is stored uniformly as ``None`` so it never shadows the
        global configuration.
        """
        return _normalize_model_override(v)

    @field_validator("build_artifact", mode="before")
    @classmethod
    def validate_build_artifact(cls, v):
        """Sanitize the configured artifact path and reject ``.git``.

        Accept both a :class:`BuildArtifactSpec` and the plain dict shape used
        by API requests, so persisted documents and incoming payloads share
        exactly the same path-safety rules as the file browser.
        """
        if v is None:
            return v

        if isinstance(v, BuildArtifactSpec):
            clean = sanitize_relative_path(v.path)
            if any(part == ".git" for part in clean.split("/")):
                raise ValueError("build_artifact.path must not reference .git")
            v.path = clean
            return v

        if isinstance(v, dict):
            raw_path = v.get("path")
            if raw_path is None:
                return v
            clean = sanitize_relative_path(raw_path)
            if any(part == ".git" for part in clean.split("/")):
                raise ValueError("build_artifact.path must not reference .git")
            return {**v, "path": clean}

        # Let Pydantic produce its normal type error for anything else.
        return v

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


class GitStatusInfo(BaseModel):
    """Read-only snapshot of a pipeline repository's working-tree status.

    ``in_sync`` is ``True`` when there are no local commits ahead of and no
    remote commits behind ``origin``; ``False`` when the branch diverged;
    ``None`` when sync is not applicable or cannot be determined (no origin,
    detached HEAD, or the branch was never pushed).
    """

    staged: int = 0
    unstaged: int = 0
    untracked: int = 0
    has_origin: bool = False
    branch: Optional[str] = None
    in_sync: Optional[bool] = None
    ahead: int = 0
    behind: int = 0
    error: Optional[str] = None


class GitLogEntry(BaseModel):
    """Compact commit information for the history dialog."""

    hash: str
    short_hash: str
    author: Optional[str] = None
    email: Optional[str] = None
    date: Optional[str] = None
    subject: Optional[str] = None


class FileEntry(BaseModel):
    """A single entry (file or directory) in a directory listing.

    ``path`` is always a repository-relative POSIX path; absolute paths are
    never exposed to the client. ``git_status`` is one of
    ``clean|modified|added|deleted|untracked|ignored|conflicted`` or ``None``
    when git status is unavailable.
    """

    name: str
    path: str
    is_dir: bool
    size: Optional[int] = None
    created_at: Optional[datetime] = None
    modified_at: Optional[datetime] = None
    git_status: Optional[str] = None
    has_children: Optional[bool] = None


class DirectoryListing(BaseModel):
    """Contents of a single directory in the pipeline repository."""

    path: str
    parent: Optional[str] = None
    entries: List[FileEntry] = Field(default_factory=list)


class FileContent(BaseModel):
    """Read-only content and metadata of a single file."""

    path: str
    name: str
    size: int
    created_at: Optional[datetime] = None
    modified_at: Optional[datetime] = None
    git_status: Optional[str] = None
    is_binary: bool = False
    truncated: bool = False
    encoding: Optional[str] = None
    content: Optional[str] = None


class FileSearchResult(BaseModel):
    """A single hit of a repository path search.

    ``path`` is always a repository-relative POSIX path; absolute paths are
    never exposed to the client.
    """

    path: str
    name: str
    is_dir: bool = False


class FileSearchResponse(BaseModel):
    """Result of searching a pipeline repository for filenames/paths.

    ``index_ready`` is ``False`` only while the very first index build is in
    flight; the endpoint normally waits for the index, so it is effectively
    always ``True`` in responses. ``truncated`` is set when the index or the
    result set hit a configured cap.
    """

    query: str
    results: List[FileSearchResult] = Field(default_factory=list)
    truncated: bool = False
    index_ready: bool = True


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


class NotificationType(str, Enum):
    """Kind of user-facing notification."""

    MESSAGE = "message"  # informational/warning/error banner
    CONFIRMATION = "confirmation"  # exactly one confirm action
    ACTIONS = "actions"  # one of N actions (or dismiss)


class NotificationSeverity(str, Enum):
    """Visual/UX severity of a notification."""

    NORMAL = "normal"
    WARNING = "warning"
    ERROR = "error"


class NotificationAction(BaseModel):
    """An action the user can trigger from a notification.

    ``name`` is the key of a handler registered on the backend
    :class:`~core.services.notification_manager.NotificationManager`;
    ``label`` is the button text shown to the user; ``data`` carries an
    arbitrary JSON-serializable payload for the handler; ``style`` is a UI hint
    (``default`` | ``primary`` | ``danger``).
    """

    name: str  # registry key executed on the backend
    label: str  # button text shown to the user
    data: Dict[str, Any] = Field(default_factory=dict)
    style: str = "default"  # default | primary | danger (UI hint)


class Notification(BaseModel):
    """A user-facing notification delivered over the WebSocket.

    Deliberately does **not** carry delivery targets: those are an api-layer
    concern and never leak to clients. The model serializes cleanly to JSON and
    maps 1:1 to the frontend domain model.
    """

    id: str = Field(default_factory=lambda: str(uuid4()))
    type: NotificationType
    severity: NotificationSeverity = NotificationSeverity.NORMAL
    title: str
    message: str = ""
    actions: List[NotificationAction] = Field(default_factory=list)
    dismissible: bool = True
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class PullRequestStatus(str, Enum):
    OPEN = "open"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    SUBMITTED = "submitted"  # Gitea PR created, awaiting external review


class PullRequestKind(str, Enum):
    IMPLEMENTATION = "implementation"
    DOCUMENTATION = "documentation"


class PullRequest(Document):
    pipeline_id: str
    task_id: str
    summary: str
    subject: str = ""
    author: Optional[str] = None
    branch_name: str
    kind: PullRequestKind = PullRequestKind.IMPLEMENTATION
    commit_hash: Optional[str] = None
    # The git diff output. Cleared when the pull request reaches a terminal
    # state and its completion cleanup runs (see
    # design/git/dd_batch_coderbot_git_process.md).
    patch: Optional[str] = None
    status: PullRequestStatus = PullRequestStatus.OPEN
    remote_pr_url: Optional[str] = None  # set only in gitea_pr mode
    # Target/base branch the pull request was submitted against (set in
    # gitea_pr mode). Used to match an incoming Gitea webhook/poll event to the
    # correct local PR when reconciling remote merge/reject state.
    base_branch: Optional[str] = None
    # How accepting this PR will apply the change, resolved at read time by the
    # pull-request routes based on the pipeline's repo_uri and the global
    # REMOTE_PR_MODE:
    #   "merge"  -> applied directly in the local workspace/repo
    #   "push"   -> committed to the cloned repo and pushed to the remote
    #   "submit" -> committed to the cloned repo and sent as a pull request
    apply_mode: Optional[str] = None
    # Pi session that produced this pull request. Optional, so existing
    # documents remain valid without a migration.
    pi_session_uid: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))

    class Settings:
        name = "pull_requests"


class PiSessionKind(str, Enum):
    INTERACTIVE = "interactive"
    CODERBOT = "coderbot"  # batch task run


class PiSessionStatus(str, Enum):
    STARTING = "starting"
    RUNNING = "running"
    PAUSED = "paused"  # deliberately stopped, resumable
    COMPLETED = "completed"  # batch finished, resumable
    FAILED = "failed"  # resumable
    DISCARDED = "discarded"  # resources released


class PiSession(Document):
    """Durable backend record for a Pi agent session.

    The ``uid`` is the stable handle that survives backend restarts and is the
    primary key of the ``pi_sessions`` collection and the on-disk directory.
    """

    uid: str  # UUID4, primary handle
    kind: PiSessionKind
    status: PiSessionStatus = PiSessionStatus.STARTING
    owner: Optional[str] = None  # username, for scoping
    label: Optional[str] = None  # human readable (Pi session name)

    # Relationships
    pipeline_id: Optional[str] = None
    task_id: Optional[str] = None
    pull_request_ids: List[str] = Field(default_factory=list)

    # Where Pi stores its conversation
    pi_session_id: Optional[str] = None  # from get_state
    pi_session_file: Optional[str] = None  # absolute path, from get_state
    session_dir: Optional[str] = None  # our --session-dir for this uid

    # Runtime / resume inputs
    cwd: Optional[str] = None
    workspace_path: Optional[str] = None  # retained batch sandbox
    model: Optional[str] = None
    skill_names: List[str] = Field(default_factory=list)
    bot_type: str = "interactive"  # websocket discriminator

    # Reconstruction / audit
    base_commit: Optional[str] = None
    branch_name: Optional[str] = None
    # Hash of the commit this session created in its sandbox (audit/UI).
    head_commit: Optional[str] = None
    # UID of the retained predecessor workspace this session's sandbox was
    # branched from (ordered branch chaining), or None when branched from the
    # default branch.
    chained_from_session_uid: Optional[str] = None

    # Bookkeeping
    resume_count: int = 0
    last_error: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    last_active_at: Optional[datetime] = None
    discarded_at: Optional[datetime] = None

    class Settings:
        name = "pi_sessions"
