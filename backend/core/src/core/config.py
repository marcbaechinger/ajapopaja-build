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
from pathlib import Path
from typing import Optional

# Default to a sensible path for the host user; allow override via env var
WORKSPACES_ROOT = Path(
    os.getenv("WORKSPACES_ROOT", "/home/marc-baechinger/monolit/code")
).resolve()

# Root directory for bot sandboxes
SANDBOX_ROOT = Path(os.getenv("SANDBOX_ROOT", "/data/ajapopaja/sandboxes")).resolve()

# Root directory where remote git repositories are cloned for pipelines that
# declare a repo_uri. Lives next to the local WORKSPACES_ROOT.
REMOTE_WORKSPACES_ROOT = Path(
    os.getenv("REMOTE_WORKSPACES_ROOT", "/data/ajapopaja/remote_workspaces")
).resolve()

if not WORKSPACES_ROOT.is_dir():
    raise RuntimeError(
        f"WORKSPACES_ROOT '{WORKSPACES_ROOT}' does not exist or is not a directory. "
        "Please create it or configure the WORKSPACES_ROOT environment variable "
        "correctly."
    )

# Common directories to ignore across all file and search tools
IGNORED_DIRECTORIES = [
    ".git",
    "node_modules",
    ".venv",
    "__pycache__",
    "dist",
    ".pytest_cache",
    ".logs",
]

# Ollama configuration for the AI Assistant
OLLAMA_API_KEY = os.getenv("OLLAMA_API_KEY")
OLLAMA_HOST = os.getenv(
    "OLLAMA_HOST", "https://ollama.com" if OLLAMA_API_KEY else "http://localhost:11434"
)
OLLAMA_MODEL = os.getenv(
    "OLLAMA_MODEL", "gpt-oss:120b" if OLLAMA_API_KEY else "gpt-oss:20b"
)

# MCP Security Configuration
MCP_AUTHENTICATION_ENABLED = (
    os.getenv("MCP_AUTHENTICATION_ENABLED", "false").lower() == "true"
)

# Bot Logging
BASEBOT_LOG_ENABLED = os.getenv("BASEBOT_LOG_ENABLED", "true").lower() == "true"

# Default model used by CoderBotManager when spawning Pi sessions.
# If unset, no --model flag is passed to Pi (None).
CODERBOT_DEFAULT_MODEL: Optional[str] = os.getenv("CODERBOT_DEFAULT_MODEL")

# Git identity used for commits when none is configured in the environment
# (e.g. inside the Docker image). Overridable via environment variables.
GIT_USER_NAME = os.getenv("GIT_USER_NAME", "Ajapopaja Build")
GIT_USER_EMAIL = os.getenv("GIT_USER_EMAIL", "ajapopaja-build@localhost")

# Global git credentials used to push to remote repositories when a pipeline
# does not define its own per-pipeline credentials. Overridable via env vars.
GIT_PUSH_USERNAME = os.getenv("GIT_PUSH_USERNAME", "")
GIT_PUSH_TOKEN = os.getenv("GIT_PUSH_TOKEN", "")

# Remote pull-request submission mode.
#   "direct"    -> current behavior: apply patch, commit, push HEAD to origin.
#   "gitea_pr"  -> push a feature branch and create a Gitea pull request for review.
# The mode is global; local pipelines (no repo_uri) always use the direct path.
REMOTE_PR_MODE = os.getenv("REMOTE_PR_MODE", "direct").lower()

if REMOTE_PR_MODE not in ("direct", "gitea_pr"):
    raise RuntimeError("REMOTE_PR_MODE must be 'direct' or 'gitea_pr'")
