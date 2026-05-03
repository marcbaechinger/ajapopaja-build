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
import shutil
from pathlib import Path

import git

from core import config


class SandboxGitHelper:
    def __init__(self, task_id: str, source_repo_path: Path):
        self.task_id = task_id
        self.source_repo_path = source_repo_path
        self.sandbox_path = config.SANDBOX_ROOT / task_id
        self.branch_name = f"coderbot/{task_id}"

    def setup_sandbox(self):
        """Clones the source repo and creates a branch."""
        if self.sandbox_path.exists():
            self.cleanup()

        self.sandbox_path.mkdir(parents=True, exist_ok=True)

        # Clone locally
        repo = git.Repo.clone_from(str(self.source_repo_path), str(self.sandbox_path))

        # Create and checkout branch
        repo.git.checkout("-b", self.branch_name)
        return repo

    def get_repo(self) -> git.Repo:
        return git.Repo(str(self.sandbox_path))

    def get_default_branch(self) -> str:
        """Determines the default branch of the repository."""
        # 1. Configuration fallback
        configured_default = os.getenv("DEFAULT_GIT_BRANCH")
        if configured_default:
            return configured_default

        # 2. Query the source repository's active branch
        try:
            source_repo = git.Repo(str(self.source_repo_path))
            return source_repo.active_branch.name
        except Exception:
            pass

        repo = self.get_repo()

        # 3. Look for standard remote HEAD
        try:
            origin_head = repo.remotes.origin.refs.HEAD
            return origin_head.reference.name.split("/")[-1]
        except Exception:
            pass

        # 4. Fallback to common branch names
        for branch in ["main", "master", "develop", "trunk"]:
            if f"origin/{branch}" in [ref.name for ref in repo.remotes.origin.refs]:
                return branch

        return "main"

    def get_patch(self) -> str:
        """Returns the diff between the default branch and current branch."""
        repo = self.get_repo()
        default_branch = self.get_default_branch()
        return repo.git.diff(default_branch)

    def cleanup(self):
        """Removes the sandbox directory."""
        if self.sandbox_path.exists():
            shutil.rmtree(self.sandbox_path)
