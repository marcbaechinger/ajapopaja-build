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
from api.assistant.tools.search_tools import (
    grep,
    find,
    tree,
    head,
    tail,
    search_file_content,
)
from core.models.models import Pipeline


@pytest.fixture
def search_workspace():
    with tempfile.TemporaryDirectory() as tmp_dir:
        # Create some files and directories
        os.makedirs(os.path.join(tmp_dir, "src"))
        os.makedirs(os.path.join(tmp_dir, "tests"))

        with open(os.path.join(tmp_dir, "src", "main.py"), "w") as f:
            f.write("def hello():\n    print('hello world')\n\nhello()\n")
            
        with open(os.path.join(tmp_dir, "src", "config.json"), "w") as f:
            f.write('{\n  "key": "secret_value"\n}\n')

        with open(os.path.join(tmp_dir, "tests", "test_main.py"), "w") as f:
            f.write("def test_hello():\n    assert True\n")
            
        # Large file for head/tail
        with open(os.path.join(tmp_dir, "large.txt"), "w") as f:
            for i in range(1, 101):
                f.write(f"Line {i}\n")

        yield tmp_dir


@pytest.mark.asyncio
async def test_search_tools(init_mock_db, search_workspace):
    pipeline = Pipeline(name="Search Pipeline", workspace_path=search_workspace)
    await pipeline.insert()
    pipeline_id = str(pipeline.id)

    # Test grep
    res = await grep(pipeline_id, "hello")
    assert "src/main.py" in res
    assert "tests/test_main.py" in res

    # Test find
    res = await find(pipeline_id, "*.py")
    assert "main.py" in res
    assert "test_main.py" in res
    assert "config.json" not in res
    
    # Test find dir
    res = await find(pipeline_id, "src", type="d")
    assert "src" in res
    assert "main.py" not in res

    # Test tree
    res = await tree(pipeline_id)
    assert "src" in res
    assert "main.py" in res
    assert "tests" in res
    
    # Test tree with path
    res = await tree(pipeline_id, path="src")
    assert "main.py" in res
    assert "tests" not in res

    # Test head
    res = await head(pipeline_id, "large.txt", lines=5)
    lines = res.splitlines()
    assert len(lines) == 5
    assert lines[0] == "Line 1"
    assert lines[-1] == "Line 5"

    # Test tail
    res = await tail(pipeline_id, "large.txt", lines=5)
    lines = res.strip().splitlines()
    assert len(lines) == 5
    assert lines[0] == "Line 96"
    assert lines[-1] == "Line 100"

    # Test search_file_content
    res = await search_file_content(pipeline_id, "src/config.json", "secret")
    assert "secret_value" in res
    assert "2: " in res # Line number check
