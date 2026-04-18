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
import shutil
from api.assistant.tools.file_tools import read_source_file, list_project_structure
from core.models.models import Pipeline


@pytest.mark.asyncio
async def test_read_source_file_sanitization(init_mock_db):
    # Setup a temporary workspace
    with tempfile.TemporaryDirectory() as tmp_dir:
        # Create a file in the workspace
        test_file_name = "test.txt"
        test_file_path = os.path.join(tmp_dir, test_file_name)
        with open(test_file_path, "w") as f:
            f.write("workspace content")

        # Create a file OUTSIDE the workspace
        outside_dir = tempfile.mkdtemp()
        outside_file_name = "secret.txt"
        outside_file_path = os.path.join(outside_dir, outside_file_name)
        with open(outside_file_path, "w") as f:
            f.write("secret content")

        try:
            # Create a pipeline with this workspace
            pipeline = Pipeline(name="Test Pipeline", workspace_path=tmp_dir)
            await pipeline.insert()
            pipeline_id = str(pipeline.id)

            # Test valid read
            result = await read_source_file(pipeline_id, test_file_name)
            assert result == "workspace content"

            # Test path traversal (..)
            # We try to go up from workspace root to reach outside_file_path
            # Since both are in /tmp, we can likely reach it with enough ..
            # But our sanitization should block any ".."
            result = await read_source_file(pipeline_id, "../secret.txt")
            assert "escapes root" in result

            #  Test absolute path
            result = await read_source_file(pipeline_id, outside_file_path)
            assert "escapes root" in result

            #  Test missing workspace_path
            pipeline_no_path = Pipeline(name="No Path Pipeline")
            await pipeline_no_path.insert()
            result = await read_source_file(str(pipeline_no_path.id), "test.txt")
            assert "Workspace root is missing" in result

        finally:
            if os.path.exists(outside_dir):
                shutil.rmtree(outside_dir)


@pytest.mark.asyncio
async def test_list_project_structure_sanitization(init_mock_db):
    # Setup a temporary workspace
    with tempfile.TemporaryDirectory() as tmp_dir:
        # Create some files
        os.makedirs(os.path.join(tmp_dir, "src"))
        with open(os.path.join(tmp_dir, "src", "main.py"), "w") as f:
            f.write("pass")

        # Create a pipeline
        pipeline = Pipeline(name="Test Pipeline", workspace_path=tmp_dir)
        await pipeline.insert()
        pipeline_id = str(pipeline.id)

        # Test valid list (default: list_files=False)
        result = await list_project_structure(pipeline_id, "src")
        # Should contain summary for src
        assert any("src/ (1 files)" in item for item in result)

        # Test valid list with files (list_files=True)
        result = await list_project_structure(pipeline_id, "src", list_files=True)
        assert any("src/main.py" in item for item in result)

        # Test path traversal
        result = await list_project_structure(pipeline_id, "..")
        assert any("escapes root" in item for item in result)

        # Test root list (default)
        result = await list_project_structure(pipeline_id)
        # Should contain summary for root and src
        assert any("./ (0 files)" in item for item in result)
        assert any("src/ (1 files)" in item for item in result)
