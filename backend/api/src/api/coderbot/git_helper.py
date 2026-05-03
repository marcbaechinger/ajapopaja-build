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

    def get_patch(self) -> str:
        """Returns the diff between main (or default branch) and current branch."""
        repo = self.get_repo()
        # Assume 'main' is the base. In a real scenario, we might want to detect this.
        # git diff main...coderbot/task_id
        return repo.git.diff("main")

    def cleanup(self):
        """Removes the sandbox directory."""
        if self.sandbox_path.exists():
            shutil.rmtree(self.sandbox_path)
