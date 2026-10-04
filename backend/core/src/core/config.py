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

# Dedicated model for the one-shot AI prompt framework. Falls back to the
# global OLLAMA_MODEL so existing deployments are unaffected unless they opt
# into a separate model. Host and API key stay shared (OLLAMA_HOST /
# OLLAMA_API_KEY); only the model is split out.
ONE_PROMPT_OLLAMA_MODEL = os.getenv("ONE_PROMPT_OLLAMA_MODEL", OLLAMA_MODEL)

# Per-component model configuration. Each value defaults to the global
# Ollama configuration so existing deployments are unaffected unless they
# opt into a separate model/host/api-key per component.
ASSISTANT_MODEL = os.getenv("ASSISTANT_MODEL", OLLAMA_MODEL)
ARCHBOT_MODEL = os.getenv("ARCHBOT_MODEL", OLLAMA_MODEL)
REVIEWBOT_MODEL = os.getenv("REVIEWBOT_MODEL", OLLAMA_MODEL)
DOCBOT_MODEL = os.getenv("DOCBOT_MODEL", OLLAMA_MODEL)
SPECAGENT_MODEL = os.getenv("SPECAGENT_MODEL", OLLAMA_MODEL)

ASSISTANT_HOST = os.getenv("ASSISTANT_HOST", OLLAMA_HOST)
ARCHBOT_HOST = os.getenv("ARCHBOT_HOST", OLLAMA_HOST)
REVIEWBOT_HOST = os.getenv("REVIEWBOT_HOST", OLLAMA_HOST)
DOCBOT_HOST = os.getenv("DOCBOT_HOST", OLLAMA_HOST)
SPECAGENT_HOST = os.getenv("SPECAGENT_HOST", OLLAMA_HOST)

ASSISTANT_API_KEY = os.getenv("ASSISTANT_API_KEY", OLLAMA_API_KEY)
ARCHBOT_API_KEY = os.getenv("ARCHBOT_API_KEY", OLLAMA_API_KEY)
REVIEWBOT_API_KEY = os.getenv("REVIEWBOT_API_KEY", OLLAMA_API_KEY)
DOCBOT_API_KEY = os.getenv("DOCBOT_API_KEY", OLLAMA_API_KEY)
SPECAGENT_API_KEY = os.getenv("SPECAGENT_API_KEY", OLLAMA_API_KEY)

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

# Bearer token injected into interactive Pi sessions so the bundled
# ``ajapopaja`` skill can authenticate against the MCP server when
# ``MCP_AUTHENTICATION_ENABLED`` is on. Left empty by default (auth disabled).
MCP_AUTH_TOKEN = os.getenv("MCP_AUTH_TOKEN", "")

# Bot Logging
BASEBOT_LOG_ENABLED = os.getenv("BASEBOT_LOG_ENABLED", "true").lower() == "true"

# ---------------------------------------------------------------------------
# Pi session persistence
# ---------------------------------------------------------------------------
# Master switch. When disabled Pi is spawned with ``--no-session`` and the whole
# persistence layer degrades to the previous ephemeral behaviour.
PI_SESSION_PERSISTENCE_ENABLED = (
    os.getenv("PI_SESSION_PERSISTENCE_ENABLED", "true").lower() == "true"
)

# Root of the per-session directories. Defaults to a dedicated, host-mounted
# path (``/data/ajapopaja/pi_sessions``) so interactive and batch sessions
# survive container restarts. Overridable via the environment; the path is
# created on demand by the session store, so it need not pre-exist on dev
# machines.
PI_SESSIONS_ROOT = Path(
    os.getenv("PI_SESSIONS_ROOT", "/data/ajapopaja/pi_sessions")
).resolve()

# Write the raw-RPC ``events.jsonl`` used to replay the activity log in the UI.
PI_SESSION_EVENT_LOG_ENABLED = (
    os.getenv("PI_SESSION_EVENT_LOG_ENABLED", "true").lower() == "true"
)

# Keep the batch sandbox working tree around so a completed batch run can be
# resumed and iterated on in place.
PI_SESSION_RETAIN_BATCH_WORKSPACE = (
    os.getenv("PI_SESSION_RETAIN_BATCH_WORKSPACE", "true").lower() == "true"
)

# Age (days) after which a workspace belonging to a not-running session is
# garbage collected. Set to <= 0 to disable the sweeper.
try:
    PI_SESSION_WORKSPACE_TTL_DAYS = float(
        os.getenv("PI_SESSION_WORKSPACE_TTL_DAYS", "14")
    )
except ValueError as e:  # pragma: no cover - defensive
    raise RuntimeError("PI_SESSION_WORKSPACE_TTL_DAYS must be a number") from e

# Resume the newest interactive session automatically at startup.
PI_SESSION_AUTO_RESUME = (
    os.getenv("PI_SESSION_AUTO_RESUME", "false").lower() == "true"
)

# Number of Pi processes that may run concurrently (1 batch + 1 interactive by
# default to match the historical behaviour). Values < 1 are clamped to 1.
try:
    PI_SESSION_MAX_RUNNING = max(1, int(os.getenv("PI_SESSION_MAX_RUNNING", "2")))
except ValueError as e:  # pragma: no cover - defensive
    raise RuntimeError("PI_SESSION_MAX_RUNNING must be an integer") from e

# Cap on retained paused sessions per owner.
try:
    PI_SESSION_MAX_PAUSED = int(os.getenv("PI_SESSION_MAX_PAUSED", "50"))
except ValueError as e:  # pragma: no cover - defensive
    raise RuntimeError("PI_SESSION_MAX_PAUSED must be an integer") from e

# Maximum length (in characters) of an AI-generated session title. The title is
# short enough to be used as a UI label but long enough to be descriptive. It is
# injected into the ``session_generate_title`` one-shot prompt and re-applied by
# the response normaliser so the model and the backend agree on the limit.
try:
    SESSION_TITLE_MAX_LENGTH = max(
        1, int(os.getenv("SESSION_TITLE_MAX_LENGTH", "80"))
    )
except ValueError as e:  # pragma: no cover - defensive
    raise RuntimeError("SESSION_TITLE_MAX_LENGTH must be an integer") from e

# Default model used by CoderBotManager when spawning Pi sessions.
# If unset, no --model flag is passed to Pi (None).
CODERBOT_DEFAULT_MODEL: Optional[str] = os.getenv("CODERBOT_DEFAULT_MODEL")

# Path to the pi-agent ``models.json`` that lists the CoderBot model options.
# In the Docker image it is baked in at ``/root/.pi/agent/models.json``; for
# local development the catalog helper falls back to the repo-relative
# ``docker/pi-agent/models.json`` when this path does not exist.
PI_AGENT_MODELS_PATH = Path(
    os.getenv("PI_AGENT_MODELS_PATH", "/root/.pi/agent/models.json")
)

# Read-only directory (baked into the Docker image) that holds the bundled Pi
# skills. Models stay global (a single /root/.pi/agent/models.json); skills are
# staged per session type from this library so interactive and CoderBot sessions
# can expose different skill sets.
PI_SKILLS_LIBRARY_DIR = Path(
    os.getenv("PI_SKILLS_LIBRARY_DIR", "/opt/ajapopaja/pi/skills")
).resolve()


def _parse_skill_list(raw: str) -> list[str]:
    """Split a comma/whitespace-separated skill-name list into clean names."""
    return [s for s in re.split(r"[,\s]+", raw.strip()) if s]


# Skills exposed to each session type. CoderBot defaults to none (unchanged
# behaviour); interactive sessions expose the bundled ajapopaja skill. Both are
# overridable via the environment (forwarded from /etc/ajapopaja-build.env).
CODERBOT_SKILLS = _parse_skill_list(os.getenv("CODERBOT_SKILLS", ""))
INTERACTIVE_SKILLS = _parse_skill_list(os.getenv("INTERACTIVE_SKILLS", "ajapopaja"))

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
