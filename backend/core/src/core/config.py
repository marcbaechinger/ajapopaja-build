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

# Default to a sensible path for the host user; allow override via env var
WORKSPACES_ROOT = Path(
    os.getenv("WORKSPACES_ROOT", "/home/marc-baechinger/monolit/code")
).resolve()

if not WORKSPACES_ROOT.is_dir():
    raise RuntimeError(
        f"WORKSPACES_ROOT '{WORKSPACES_ROOT}' does not exist or is not a directory. "
        "Please create it or configure the WORKSPACES_ROOT environment variable correctly."
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

