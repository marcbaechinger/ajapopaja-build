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
    def __init__(self, bot_type: str, task_id: str, source_repo_path: Path):
        self.bot_type = bot_type
        self.task_id = task_id
        self.source_repo_path = source_repo_path
        # Non-colliding paths: sandbox/coderbot/task_id vs sandbox/docbot/task_id
        self.sandbox_path = config.SANDBOX_ROOT / bot_type / task_id
        self.branch_name = f"{bot_type}/{task_id}"

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

    # SHA-1 of Git's empty tree object. Diffing against it yields the full
    # content of the working tree/index as if every file were new, which is
    # exactly what we need when the repository has no commits yet.
    _EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"

    def get_patch(self) -> str:
        """Returns the diff between the default branch and current branch.

        On a freshly cloned repository that has no commits yet, the default
        branch does not exist as a ref (it is "unborn"). Diffing against it
        would fail with git's "ambiguous argument ... unknown revision". To
        handle that, we check whether the base ref exists before diffing and
        fall back to diffing against the empty tree so all new files are
        captured in the patch.
        """
        repo = self.get_repo()
        default_branch = self.get_default_branch()
        # Check whether the base ref actually exists before diffing against it.
        base_exists = False
        try:
            repo.commit(default_branch)
            base_exists = True
        except Exception:
            base_exists = False

        if base_exists:
            # --binary is required so binary files (e.g. images) are included
            # in the patch and can be applied later via `git apply --3way`.
            return repo.git.diff(default_branch, binary=True)

        # No commits yet: diff against the empty tree to include all files.
        return repo.git.diff(self._EMPTY_TREE, binary=True)

    def cleanup(self):
        """Removes the sandbox directory."""
        if self.sandbox_path.exists():
            shutil.rmtree(self.sandbox_path)
