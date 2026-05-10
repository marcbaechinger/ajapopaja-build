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
from unittest.mock import AsyncMock, MagicMock, patch

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
        mock_pipeline.doc_root = "design"
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
            with (
                patch("api.docbot.tools.set_preview") as mock_set_preview,
                patch("core.utils.git_utils.get_repo") as mock_get_repo,
                patch("api.docbot.tools.manager.broadcast") as mock_broadcast,
            ):
                # Setup mock repo to return a dummy diff
                mock_repo_instance = MagicMock()
                mock_get_repo.return_value = mock_repo_instance
                mock_repo_instance.git.diff.return_value = "dummy diff"

                result = await update_ref_doc(
                    pipeline_id, filename, content, reason, task_id="test_task_id"
                )
                assert "Successfully updated" in result
                assert os.path.isfile(os.path.join(tmp_dir, "design", filename))
                assert mock_set_preview.called
                assert mock_broadcast.called

            # 3. Test list_ref_docs (with file)
            result = await list_ref_docs(pipeline_id)
            assert filename in result

            # 4. Test read_ref_doc (success)
            result = await read_ref_doc(pipeline_id, filename)
            assert result == content

            # 5. Test update_ref_doc (update)
            new_content = "# Updated Doc\nNew content."
            with (
                patch("api.docbot.tools.set_preview") as mock_set_preview,
                patch("core.utils.git_utils.get_repo") as mock_get_repo,
                patch("api.docbot.tools.manager.broadcast") as mock_broadcast,
            ):
                mock_repo_instance = MagicMock()
                mock_get_repo.return_value = mock_repo_instance
                mock_repo_instance.git.diff.return_value = "dummy diff"

                result = await update_ref_doc(
                    pipeline_id,
                    filename,
                    new_content,
                    "Updated info",
                    task_id="test_task_id",
                )
                assert "Successfully updated" in result
                assert mock_set_preview.called
                assert mock_broadcast.called

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
        mock_pipeline.doc_root = "design"
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

            # update_ref_doc should now fail with error instead of stripping path
            result = await update_ref_doc(
                pipeline_id, "../escaped.md", "escaped content", "hacking"
            )
            assert "Error: Invalid filename" in result
            assert not os.path.isfile(os.path.join(tmp_dir, "design", "escaped.md"))

            # read_ref_doc should also fail with error
            result = await read_ref_doc(pipeline_id, "../secret.md")
            assert "Error: Invalid filename" in result


@pytest.mark.asyncio
async def test_docbot_tools_recursive():
    with tempfile.TemporaryDirectory() as tmp_dir:
        mock_pipeline = AsyncMock()
        mock_pipeline.workspace_abs_path = Path(tmp_dir)
        mock_pipeline.doc_root = "design"
        pipeline_id = "test_pipeline"

        with patch(
            "api.docbot.tools.pipeline_queries.get_pipeline_by_id",
            return_value=mock_pipeline,
        ):
            # 1. Test update_ref_doc in subdirectory
            filename = "implemented/new_feature.md"
            content = "# New Feature\nDetails."
            reason = "Documentation for sub-feature"

            with (
                patch("api.docbot.tools.set_preview"),
                patch("core.utils.git_utils.get_repo"),
                patch("api.docbot.tools.manager.broadcast"),
            ):
                result = await update_ref_doc(pipeline_id, filename, content, reason)
                assert "Successfully updated" in result
                assert os.path.isfile(
                    os.path.join(tmp_dir, "design", "implemented", "new_feature.md")
                )

            # 2. Test list_ref_docs (recursive)
            # Create another file in root
            with open(os.path.join(tmp_dir, "design", "root.md"), "w") as f:
                f.write("root")

            result = await list_ref_docs(pipeline_id)
            assert "implemented/new_feature.md" in result
            assert "root.md" in result

            # 3. Test read_ref_doc in subdirectory
            result = await read_ref_doc(pipeline_id, "implemented/new_feature.md")
            assert result == content

            # 4. Test read_ref_doc with design/ prefix
            result = await read_ref_doc(
                pipeline_id, "design/implemented/new_feature.md"
            )
            assert result == content


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
