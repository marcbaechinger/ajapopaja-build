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
from unittest.mock import patch, MagicMock, AsyncMock
from api.assistant.tools.search_tools import (
    grep,
    find,
    tree,
    head,
    tail,
    search_file_content,
    _python_tree
)
from core.models.models import Pipeline

from pathlib import Path
...
@pytest.fixture
def mock_pipeline():
    pipeline = MagicMock(spec=Pipeline)
    pipeline.id = "test-pipeline-id"
    pipeline.workspace_path = "mock/workspace"
    pipeline.workspace_abs_path = Path("/tmp/mock/workspace")
    return pipeline

@pytest.fixture
def temp_workspace():
    with tempfile.TemporaryDirectory() as tmp_dir:
        # Create a structure for testing
        os.makedirs(os.path.join(tmp_dir, "src", "sub"))
        os.makedirs(os.path.join(tmp_dir, ".git"))
        
        with open(os.path.join(tmp_dir, "src", "main.py"), "w") as f:
            f.write("import os\n\ndef hello():\n    print('hello world')\n")
            
        with open(os.path.join(tmp_dir, "src", "sub", "util.py"), "w") as f:
            f.write("def helper():\n    pass\n")
            
        with open(os.path.join(tmp_dir, "README.md"), "w") as f:
            f.write("# Project README\n")

        with open(os.path.join(tmp_dir, ".git", "config"), "w") as f:
            f.write("git config")

        yield tmp_dir

@pytest.mark.asyncio
async def test_grep_success(mock_pipeline):
    with patch("core.queries.pipeline.get_pipeline_by_id", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = mock_pipeline
        
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(
                returncode=0, 
                stdout="src/main.py:3:    print('hello world')\n", 
                stderr=""
            )
            
            result = await grep("pipeline_id", "hello", file_glob="*.py", ignore_case=True, context_lines=2)
            
            assert "src/main.py:3:    print('hello world')" in result
            mock_run.assert_called_once()
            args = mock_run.call_args[0][0]
            assert "grep" in args
            assert "-rnI" in args
            assert "-i" in args
            assert "-C2" in args
            assert "--include=*.py" in args
            assert "--exclude-dir=.git" in args
            assert "hello" in args

@pytest.mark.asyncio
async def test_grep_no_results(mock_pipeline):
    with patch("core.queries.pipeline.get_pipeline_by_id", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = mock_pipeline
        with patch("subprocess.run") as mock_run:
            # grep returns 1 when no matches are found
            mock_run.return_value = MagicMock(returncode=1, stdout="", stderr="")
            
            result = await grep("pipeline_id", "nonexistent")
            assert "No results found." in result

@pytest.mark.asyncio
async def test_find_success(mock_pipeline):
    with patch("core.queries.pipeline.get_pipeline_by_id", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = mock_pipeline
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(
                returncode=0, 
                stdout="./src/main.py\n./tests/test_main.py\n./.git/config\n", 
                stderr=""
            )
            
            result = await find("pipeline_id", "*.py")
            
            # .git/config should be filtered out by the tool manually
            assert "src/main.py" in result
            assert "test_main.py" in result
            assert ".git/config" not in result
            
            mock_run.assert_called_once()
            args = mock_run.call_args[0][0]
            assert "find" in args
            assert "*.py" in args

@pytest.mark.asyncio
async def test_tree_with_command(mock_pipeline):
    with patch("core.queries.pipeline.get_pipeline_by_id", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = mock_pipeline
        with patch("subprocess.run") as mock_run:
            # First call for version check, second for tree command
            mock_run.side_effect = [
                MagicMock(returncode=0),
                MagicMock(returncode=0, stdout=".\n├── src\n│   └── main.py\n└── README.md\n", stderr="")
            ]
            
            # Mock os.path.isdir to return True for the workspace path
            with patch("os.path.isdir", return_value=True):
                result = await tree("pipeline_id", depth=2)
                
                assert "src" in result
                assert "main.py" in result
                assert mock_run.call_count == 2
                args = mock_run.call_args[0][0]
                assert "tree" in args
                assert "-L" in args
                assert "2" in args

@pytest.mark.asyncio
async def test_tree_python_fallback(mock_pipeline, temp_workspace):
    # Using real files for python fallback test
    mock_pipeline.workspace_path = os.path.basename(temp_workspace)
    mock_pipeline.workspace_abs_path = Path(temp_workspace)
    with patch("core.queries.pipeline.get_pipeline_by_id", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = mock_pipeline
        with patch("subprocess.run") as mock_run:
            # tree command missing
            mock_run.side_effect = FileNotFoundError()
            
            result = await tree("pipeline_id")
            
            assert "src" in result
            assert "main.py" in result
            assert "util.py" in result
            assert "README.md" in result
            assert ".git" not in result # Should be ignored by _python_tree

@pytest.mark.asyncio
async def test_head_success(mock_pipeline, temp_workspace):
    mock_pipeline.workspace_path = os.path.basename(temp_workspace)
    mock_pipeline.workspace_abs_path = Path(temp_workspace)
    with patch("core.queries.pipeline.get_pipeline_by_id", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = mock_pipeline
        
        # Create a file with many lines
        file_path = os.path.join(temp_workspace, "large.txt")
        with open(file_path, "w") as f:
            for i in range(1, 21):
                f.write(f"Line {i}\n")
                
        result = await head("pipeline_id", "large.txt", lines=5)
        lines = result.splitlines()
        assert len(lines) == 5
        assert lines[0] == "Line 1"
        assert lines[4] == "Line 5"

@pytest.mark.asyncio
async def test_tail_success(mock_pipeline):
    with patch("core.queries.pipeline.get_pipeline_by_id", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = mock_pipeline
        with patch("subprocess.run") as mock_run:
            mock_run.return_value = MagicMock(
                returncode=0, 
                stdout="Line 16\nLine 17\nLine 18\nLine 19\nLine 20\n", 
                stderr=""
            )
            
            # Mock os.path.isfile to return True
            with patch("os.path.isfile", return_value=True):
                result = await tail("pipeline_id", "large.txt", lines=5)
                
                assert "Line 20" in result
                mock_run.assert_called_once()
                args = mock_run.call_args[0][0]
                assert "tail" in args
                assert "-n" in args
                assert "5" in args

@pytest.mark.asyncio
async def test_search_file_content_success(mock_pipeline, temp_workspace):
    mock_pipeline.workspace_path = os.path.basename(temp_workspace)
    mock_pipeline.workspace_abs_path = Path(temp_workspace)
    with patch("core.queries.pipeline.get_pipeline_by_id", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = mock_pipeline
        
        result = await search_file_content("pipeline_id", "src/main.py", "hello")
        assert "4:     print('hello world')" in result

@pytest.mark.asyncio
async def test_search_file_content_no_match(mock_pipeline, temp_workspace):
    mock_pipeline.workspace_path = os.path.basename(temp_workspace)
    mock_pipeline.workspace_abs_path = Path(temp_workspace)
    with patch("core.queries.pipeline.get_pipeline_by_id", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = mock_pipeline
        
        result = await search_file_content("pipeline_id", "src/main.py", "nonexistent")
        assert "No results found." in result

@pytest.mark.asyncio
async def test_search_file_content_invalid_regex(mock_pipeline, temp_workspace):
    mock_pipeline.workspace_path = os.path.basename(temp_workspace)
    mock_pipeline.workspace_abs_path = Path(temp_workspace)
    with patch("core.queries.pipeline.get_pipeline_by_id", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = mock_pipeline
        
        result = await search_file_content("pipeline_id", "src/main.py", "[unclosed bracket")
        assert "Error: Invalid regular expression" in result

@pytest.mark.asyncio
async def test_path_sanitization_failure(mock_pipeline):
    with patch("core.queries.pipeline.get_pipeline_by_id", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = mock_pipeline
        
        # Test with .. in path
        result = await head("pipeline_id", "../outside.txt")
        assert "Error: Invalid path" in result
        
        # Test with absolute path
        result = await head("pipeline_id", "/etc/passwd")
        assert "Error: Invalid path" in result

@pytest.mark.asyncio
async def test_pipeline_not_found():
    with patch("core.queries.pipeline.get_pipeline_by_id", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = None
        
        result = await grep("invalid_id", "pattern")
        assert "Error: Workspace path not found." in result

@pytest.mark.asyncio
async def test_workspace_path_missing():
    pipeline = MagicMock(spec=Pipeline)
    pipeline.workspace_path = None
    pipeline.workspace_abs_path = None
    with patch("core.queries.pipeline.get_pipeline_by_id", new_callable=AsyncMock) as mock_get:
        mock_get.return_value = pipeline
        
        result = await grep("pipeline_id", "pattern")
        assert "Error: Workspace path not found." in result

def test_python_tree_direct(temp_workspace):
    # Test _python_tree function directly for depth and items
    res = _python_tree(temp_workspace, max_depth=0)
    assert "src" in res
    assert "README.md" in res
    assert "main.py" not in res # depth 0

    res = _python_tree(temp_workspace, max_depth=1)
    assert "main.py" in res
    assert "util.py" not in res # depth 1

    res = _python_tree(temp_workspace) # infinite depth
    assert "util.py" in res
