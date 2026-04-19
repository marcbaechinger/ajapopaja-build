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
from pathlib import Path
from core.models.models import Pipeline
from api.assistant.tools.search_tools import grep

@pytest.fixture
async def real_workspace_pipeline(init_mock_db):
    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir).resolve()
        
        # Create the files specified in the task data
        clients_dir = tmp_path / "frontend" / "src" / "core" / "clients"
        clients_dir.mkdir(parents=True)
        
        pipeline_client = clients_dir / "PipelineClient.ts"
        pipeline_client.write_text("import { BaseClient } from './BaseClient.ts';\n\nexport class PipelineClient extends BaseClient {\n    constructor() {\n        super();\n    }\n}\n")
        
        task_client = clients_dir / "TaskClient.ts"
        task_client.write_text("import { BaseClient } from './BaseClient.ts';\n\nexport class TaskClient extends BaseClient {\n    constructor() {\n        super();\n    }\n}\n")
        
        system_client = clients_dir / "SystemClient.ts"
        system_client.write_text("import { BaseClient } from './BaseClient.ts';\n\nexport class SystemClient extends BaseClient {\n    constructor() {\n        super();\n    }\n}\n")
        
        # Create a large file for the large file test
        large_file = tmp_path / "large_file.ts"
        content = []
        for i in range(1000):
            if i % 100 == 0:
                content.append(f"// Match BaseClient at line {i+1}")
            else:
                content.append(f"// Dummy line {i+1}")
        large_file.write_text("\n".join(content))

        # Create an even larger file for the very large file test
        very_large_file = tmp_path / "very_large_file.ts"
        content = []
        for i in range(10000):
            if (i + 1) % 1000 == 0:
                content.append(f"// Target match at line {i+1}")
            else:
                content.append(f"// Line {i+1}")
        very_large_file.write_text("\n".join(content))

        pipeline = Pipeline(
            name="Test Grep Pipeline",
            workspace_path=str(tmp_path),
            workspace_abs_path=tmp_path
        )
        await pipeline.insert()
        
        yield pipeline

@pytest.mark.asyncio
async def test_grep_integration_positive(real_workspace_pipeline):
    # Search for something that appears only in a few places to avoid truncation
    result = await grep(str(real_workspace_pipeline.id), "PipelineClient", file_extension="*.ts")
    matches = result["matches"]
    
    # Matches found is 1 in PipelineClient.ts (the class definition)
    assert result["total_matches"] == 1
    assert result["truncated"] == False
    assert len(matches) == 1

    assert matches[0]["path"] == "frontend/src/core/clients/PipelineClient.ts"
    assert matches[0]["line"] == 3
    assert "export class PipelineClient extends BaseClient" in matches[0]["match"]

@pytest.mark.asyncio
async def test_grep_integration_negative(real_workspace_pipeline):
    # Negative test – Search for a string that does not exist.
    result = await grep(str(real_workspace_pipeline.id), "NonExistentString12345", file_extension="*.ts")
    assert result == {"matches": [], "total_matches": 0, "truncated": False}

@pytest.mark.asyncio
async def test_grep_integration_case_insensitive(real_workspace_pipeline):
    # Case sensitivity test
    result = await grep(str(real_workspace_pipeline.id), "pipelineclient", file_extension="*.ts", ignore_case=True)
    matches = result["matches"]
    
    assert result["total_matches"] == 1
    assert result["truncated"] == False
    assert len(matches) == 1

    assert matches[0]["path"] == "frontend/src/core/clients/PipelineClient.ts"
    assert matches[0]["line"] == 3
    assert "export class PipelineClient extends BaseClient" in matches[0]["match"]

@pytest.mark.asyncio
async def test_grep_integration_truncation(real_workspace_pipeline):
    # Specifically test truncation with BaseClient (16 matches)
    result = await grep(str(real_workspace_pipeline.id), "BaseClient", file_extension="*.ts")
    
    assert result["total_matches"] == 16
    assert result["truncated"] == True
    assert len(result["matches"]) == 10

@pytest.mark.asyncio
async def test_grep_integration_large_file(real_workspace_pipeline):
    # Verify that all 10 occurrences in the large file are returned.
    result = await grep(str(real_workspace_pipeline.id), "Match BaseClient", file_extension="*.ts")
    
    # Total matches is 10 (only large_file.ts contains "Match BaseClient")
    assert result["total_matches"] == 10
    assert result["truncated"] == False
    assert len(result["matches"]) == 10
    for i in range(10):
        line_num = i * 100 + 1
        assert result["matches"][i]["path"] == "large_file.ts"
        assert result["matches"][i]["line"] == line_num
        assert f"// Match BaseClient at line {line_num}" in result["matches"][i]["match"]

@pytest.mark.asyncio
async def test_grep_integration_very_large_file(real_workspace_pipeline):
    # Verify accurate line numbering in a 10,000 line file.
    # We expect matches at 1000, 2000, ..., 10000.
    result = await grep(str(real_workspace_pipeline.id), "Target match", file_extension="*.ts")
    
    assert result["total_matches"] == 10
    assert result["truncated"] == False
    assert len(result["matches"]) == 10
    for i in range(10):
        line_num = (i + 1) * 1000
        assert result["matches"][i]["path"] == "very_large_file.ts"
        assert result["matches"][i]["line"] == line_num
        assert f"// Target match at line {line_num}" in result["matches"][i]["match"]
