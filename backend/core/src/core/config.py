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

# Per-component model configuration. Each value defaults to the global
# Ollama configuration so existing deployments are unaffected unless they
# opt into a separate model/host/api-key per component.
ASSISTANT_MODEL = os.getenv("ASSISTANT_MODEL", OLLAMA_MODEL)
ARCHBOT_MODEL = os.getenv("ARCHBOT_MODEL", OLLAMA_MODEL)
REVIEWBOT_MODEL = os.getenv("REVIEWBOT_MODEL", OLLAMA_MODEL)
DOCBOT_MODEL = os.getenv("DOCBOT_MODEL", OLLAMA_MODEL)

ASSISTANT_HOST = os.getenv("ASSISTANT_HOST", OLLAMA_HOST)
ARCHBOT_HOST = os.getenv("ARCHBOT_HOST", OLLAMA_HOST)
REVIEWBOT_HOST = os.getenv("REVIEWBOT_HOST", OLLAMA_HOST)
DOCBOT_HOST = os.getenv("DOCBOT_HOST", OLLAMA_HOST)

ASSISTANT_API_KEY = os.getenv("ASSISTANT_API_KEY", OLLAMA_API_KEY)
ARCHBOT_API_KEY = os.getenv("ARCHBOT_API_KEY", OLLAMA_API_KEY)
REVIEWBOT_API_KEY = os.getenv("REVIEWBOT_API_KEY", OLLAMA_API_KEY)
DOCBOT_API_KEY = os.getenv("DOCBOT_API_KEY", OLLAMA_API_KEY)

# CoderBot keeps its existing dedicated knob; introduce a symmetric alias so
# all components share the same naming convention. CODERBOT_DEFAULT_MODEL remains
# supported for backward compatibility.
CODERBOT_MODEL = (
    os.getenv(
        "CODERBOT_MODEL",
        os.getenv("CODERBOT_DEFAULT_MODEL", ""),
    )
    or None
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

# Run the documented project test suite in the sandbox after Pi finishes.
CODERBOT_RUN_TESTS = os.getenv("CODERBOT_RUN_TESTS", "true").lower() == "true"

# Optional global override of the test verification commands (JSON list of
# argv lists, e.g. `[["sh", "-c", "cd backend && uv run pytest"]]`). When unset,
# the README commands are used. A Pipeline may define its own per-pipeline
# `test_commands` which take precedence over this global configuration when set.
CODERBOT_TEST_COMMANDS_JSON = os.getenv("CODERBOT_TEST_COMMANDS_JSON", "")

# Timeout (seconds) for each post-run verification test command. Guards against
# commands that spawn a long-running/daemonizing child (e.g. `npm run test`
# without CI=true, which drops into vitest's watch mode and never exits). When
# a command exceeds this limit it is terminated (the whole process group is
# killed) and reported as a failure instead of hanging the server forever.
CODERBOT_VERIFICATION_TIMEOUT = float(os.getenv("CODERBOT_VERIFICATION_TIMEOUT", "300"))

# Git identity used for commits when none is configured in the environment
# (e.g. inside the Docker image). Overridable via environment variables.
GIT_USER_NAME = os.getenv("GIT_USER_NAME", "Ajapopaja Build")
GIT_USER_EMAIL = os.getenv("GIT_USER_EMAIL", "ajapopaja-build@localhost")

# Timeout (seconds) for `git ls-remote` reachability verification performed
# when creating a remote pipeline. Guards against a hung ls-remote against an
# unreachable host blocking the pipeline-creation request indefinitely.
# Overridable via env var.
GIT_LS_REMOTE_TIMEOUT = float(os.getenv("GIT_LS_REMOTE_TIMEOUT", "10"))

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

# Port on which a user-started pipeline dev server is expected to listen inside
# the container. It is published to the host via docker-compose.yml and injected
# into the dev-process environment by DevProcessManager. Must be an integer.
try:
    DEV_SERVER_PORT = int(os.getenv("DEV_SERVER_PORT", "1224"))
except ValueError as e:
    raise RuntimeError("DEV_SERVER_PORT must be an integer") from e
