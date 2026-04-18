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
import pytest
from pathlib import Path
from core.utils.path_utils import sanitize_relative_path, safe_join
from core.models.models import Pipeline
from core import config

def test_sanitize_relative_path():
    assert sanitize_relative_path("my/project") == "my/project"
    assert sanitize_relative_path("my/./project") == "my/project"
    assert sanitize_relative_path("my/../project") == "project"
    assert sanitize_relative_path("my/project/") == "my/project"
    
    with pytest.raises(ValueError, match="absolute path not allowed"):
        sanitize_relative_path("/my/project")
    
    with pytest.raises(ValueError, match="workspace_path cannot escape root"):
        sanitize_relative_path("../../etc/passwd")

def test_safe_join(tmp_path):
    root = tmp_path / "workspaces"
    root.mkdir()
    
    ws = root / "project1"
    ws.mkdir()
    
    # Safe join
    assert safe_join(root, "project1") == ws
    assert safe_join(root, "project1/file.txt") == ws / "file.txt"
    
    # Traversal attempt
    with pytest.raises(ValueError, match="escapes root"):
        safe_join(root, "../outside")

@pytest.mark.asyncio
async def test_pipeline_workspace_validation(init_mock_db, monkeypatch, tmp_path):
    root = tmp_path / "workspaces"
    root.mkdir()
    
    # Mock WORKSPACES_ROOT
    monkeypatch.setattr(config, "WORKSPACES_ROOT", root)
    
    # Relative path
    p1 = Pipeline(name="P1", workspace_path="my-rel-path")
    assert p1.workspace_path == "my-rel-path"
    assert p1.workspace_abs_path == root / "my-rel-path"
    
    # Absolute path migration (within root)
    abs_path = str(root / "legacy-project")
    p2 = Pipeline(name="P2", workspace_path=abs_path)
    assert p2.workspace_path == "legacy-project"
    assert p2.workspace_abs_path == root / "legacy-project"
    
    # Absolute path rejection (outside root)
    p3 = Pipeline(name="P3", workspace_path="/tmp/outside")
    assert p3.workspace_path is None
    assert p3.workspace_abs_path is None
    
    # Traversal rejection
    with pytest.raises(ValueError, match="cannot escape root"):
        Pipeline(name="P4", workspace_path="my/../../outside")

@pytest.mark.asyncio
async def test_pipeline_workspace_empty(init_mock_db):
    p = Pipeline(name="P", workspace_path=None)
    assert p.workspace_path is None
    assert p.workspace_abs_path is None
    
    p2 = Pipeline(name="P2", workspace_path="")
    assert p2.workspace_path == "" # or None? validator returns v if empty
    assert p2.workspace_abs_path is None
