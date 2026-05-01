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
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from api.docbot.tools import (
    list_ref_docs,
    no_doc_update_needed,
    read_ref_doc,
    update_ref_doc,
)


@pytest.mark.asyncio
async def test_docbot_tools_flow():
    with tempfile.TemporaryDirectory() as tmp_dir:
        # Setup mock pipeline
        mock_pipeline = AsyncMock()
        mock_pipeline.workspace_abs_path = Path(tmp_dir)
        pipeline_id = "test_pipeline"

        with patch(
            "api.docbot.tools.pipeline_queries.get_pipeline_by_id",
            return_value=mock_pipeline,
        ):
            # 1. Test list_ref_docs (missing dir)
            result = await list_ref_docs(pipeline_id)
            assert "does not exist yet" in result[0]

            # 2. Test update_ref_doc (create)
            filename = "test_doc.md"
            content = "# Test Doc\nContent here."
            reason = "Initial documentation"
            result = await update_ref_doc(pipeline_id, filename, content, reason)
            assert "Successfully updated" in result
            assert os.path.isfile(os.path.join(tmp_dir, "design", filename))

            # 3. Test list_ref_docs (with file)
            result = await list_ref_docs(pipeline_id)
            assert filename in result

            # 4. Test read_ref_doc (success)
            result = await read_ref_doc(pipeline_id, filename)
            assert result == content

            # 5. Test update_ref_doc (update)
            new_content = "# Updated Doc\nNew content."
            result = await update_ref_doc(
                pipeline_id, filename, new_content, "Updated info"
            )
            assert "Successfully updated" in result

            # 6. Test read_ref_doc (verify update)
            result = await read_ref_doc(pipeline_id, filename)
            assert result == new_content

            # 7. Test no_doc_update_needed
            result = await no_doc_update_needed(reason="Already covered")
            assert "No documentation update performed" in result


@pytest.mark.asyncio
async def test_docbot_tools_errors():
    with tempfile.TemporaryDirectory() as tmp_dir:
        mock_pipeline = AsyncMock()
        mock_pipeline.workspace_abs_path = Path(tmp_dir)
        pipeline_id = "test_pipeline"

        with patch(
            "api.docbot.tools.pipeline_queries.get_pipeline_by_id",
            return_value=mock_pipeline,
        ):
            # Test read nonexistent file
            result = await read_ref_doc(pipeline_id, "ghost.md")
            assert "Error: Document 'ghost.md' not found" in result

            # Test path traversal protection in read
            # Create a file outside design/ but in workspace
            with open(os.path.join(tmp_dir, "secret.md"), "w") as f:
                f.write("top secret")

            # update_ref_doc uses os.path.basename, so it should only write to design/
            await update_ref_doc(
                pipeline_id, "../escaped.md", "escaped content", "hacking"
            )
            assert os.path.isfile(os.path.join(tmp_dir, "design", "escaped.md"))
            assert not os.path.isfile(os.path.join(tmp_dir, "escaped.md"))

            # read_ref_doc uses os.path.basename, so it should only read from design/
            result = await read_ref_doc(pipeline_id, "../secret.md")
            assert "Error: Document 'secret.md' not found" in result


@pytest.mark.asyncio
async def test_docbot_tools_missing_pipeline():
    # Test with non-existent pipeline_id (Mocking the exception)
    fake_id = "non_existent"

    with patch(
        "api.docbot.tools.pipeline_queries.get_pipeline_by_id",
        side_effect=Exception("Pipeline not found"),
    ):
        result = await list_ref_docs(fake_id)
        assert "Error: Pipeline not found" in result[0]

        result = await read_ref_doc(fake_id, "any.md")
        assert "Error: Pipeline not found" in result

        result = await update_ref_doc(fake_id, "any.md", "content", "reason")
        assert "Error: Pipeline not found" in result
