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

import pytest
import os
import tempfile
import subprocess
from api.assistant.tools.git_tools import (
    git_log,
    git_show_commit,
    git_commit_hunks,
    git_blame,
    git_status,
    git_branch_list,
    git_diff,
)
from core.models.models import Pipeline


def run_git(cwd, args):
    subprocess.run(["git"] + args, cwd=cwd, check=True, capture_output=True)


@pytest.fixture
def git_repo():
    with tempfile.TemporaryDirectory() as tmp_dir:
        run_git(tmp_dir, ["init", "-b", "main"])
        run_git(tmp_dir, ["config", "user.email", "test@example.com"])
        run_git(tmp_dir, ["config", "user.name", "Test User"])

        # Create a file and commit it
        file1 = os.path.join(tmp_dir, "file1.txt")
        with open(file1, "w") as f:
            f.write("Line 1\nLine 2\n")

        run_git(tmp_dir, ["add", "file1.txt"])
        run_git(tmp_dir, ["commit", "-m", "Initial commit"])

        # Create another commit
        with open(file1, "a") as f:
            f.write("Line 3\n")
        run_git(tmp_dir, ["add", "file1.txt"])
        run_git(tmp_dir, ["commit", "-m", "Second commit"])

        yield tmp_dir


@pytest.mark.asyncio
async def test_git_tools(init_mock_db, git_repo):
    pipeline = Pipeline(name="Git Pipeline", workspace_path=git_repo)
    await pipeline.insert()
    pipeline_id = str(pipeline.id)

    # Test git_log
    log = await git_log(pipeline_id)
    assert "Initial commit" in log
    assert "Second commit" in log

    # Test git_status
    status = await git_status(pipeline_id)
    assert "nothing to commit, working tree clean" in status.lower()

    # Test git_branch_list
    branches = await git_branch_list(pipeline_id)
    assert "main" in branches

    # Test git_show_commit (get SHA from log)
    sha = log.split(" | ")[0]
    show = await git_show_commit(pipeline_id, sha)
    assert "Second commit" in show
    assert "file1.txt" in show

    # Test git_blame
    blame = await git_blame(pipeline_id, "file1.txt")
    assert "Test User" in blame
    assert "Line 1" in blame

    # Test git_diff
    with open(os.path.join(git_repo, "file1.txt"), "a") as f:
        f.write("Modified line\n")
    diff = await git_diff(pipeline_id)
    assert "+Modified line" in diff


@pytest.mark.asyncio
async def test_git_commit_hunks(init_mock_db, git_repo):
    pipeline = Pipeline(name="Git Hunks Pipeline", workspace_path=git_repo)
    await pipeline.insert()
    pipeline_id = str(pipeline.id)

    # 1. Prepare files
    file1 = os.path.join(git_repo, "file1.txt")  # Exists
    file3 = os.path.join(git_repo, "file3.txt")
    with open(file3, "w") as f:
        f.write("To be deleted\n")
    run_git(git_repo, ["add", "file3.txt"])
    run_git(git_repo, ["commit", "-m", "Prepare for hunks"])

    # 2. Actual commit with changes, deletion, addition
    # Change file1.txt
    with open(file1, "w") as f:
        f.write("Line 1\nLine 2 modified\nLine 3\n")

    # Delete file3.txt
    run_git(git_repo, ["rm", "file3.txt"])

    # Addition: file4.txt
    file4 = os.path.join(git_repo, "file4.txt")
    with open(file4, "w") as f:
        f.write("Real addition\n")
    run_git(git_repo, ["add", "file1.txt", "file4.txt"])
    run_git(git_repo, ["commit", "-m", "Hunk commit"])

    # Get SHA
    log = await git_log(pipeline_id)
    sha = log.split("\n")[0].split(" | ")[0]

    # Test git_commit_hunks
    import json

    hunks_json = await git_commit_hunks(pipeline_id, sha)
    hunks = json.loads(hunks_json)

    # Verify hunks
    hunk_files = [h["file"] for h in hunks]
    assert "file1.txt" in hunk_files
    assert "file3.txt" in hunk_files
    assert "file4.txt" in hunk_files

    for h in hunks:
        if h["file"] == "file1.txt":
            assert h["type"] == "change"
            assert h["first_line"] == 2
            assert h["last_line"] == 2
        if h["file"] == "file3.txt":
            assert h["type"] == "deletion"
        if h["file"] == "file4.txt":
            assert h["type"] == "addition"
            assert h["first_line"] == 1
            assert h["last_line"] == 1

@pytest.mark.asyncio
async def test_git_path_sanitization(init_mock_db, git_repo):
    pipeline = Pipeline(name="Git Pipeline", workspace_path=git_repo)
    await pipeline.insert()
    pipeline_id = str(pipeline.id)

    # Test path traversal in git_blame
    blame = await git_blame(pipeline_id, "../../../../etc/passwd")
    assert "Error: Invalid file path." in blame

    # Test absolute path in git_blame
    blame = await git_blame(pipeline_id, "/etc/passwd")
    assert "Error: Invalid file path." in blame

    # Test path traversal in git_diff
    diff = await git_diff(pipeline_id, file_path="../../../../etc/passwd")
    assert "Error: Invalid file path." in diff

    # Test absolute path in git_diff
    diff = await git_diff(pipeline_id, file_path="/etc/passwd")
    assert "Error: Invalid file path." in diff
