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

import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from api.docbot.session import DocBotSession
from api.docbot.tools import (
    document_update_completed,
    update_markdown_section,
    update_ref_doc,
)


@pytest.mark.asyncio
async def test_update_markdown_section_success():
    with tempfile.TemporaryDirectory() as tmp_dir:
        workspace = Path(tmp_dir)
        pipeline_id = "p1"
        filename = "test_doc.md"
        design_dir = workspace / "design"
        design_dir.mkdir()
        file_path = design_dir / filename

        initial_content = """# System Design

## 1. Overview
Old overview text.

## 2. Components
### 2.1 Backend
Backend details.

## 3. Deployment
Deployment info.
"""
        file_path.write_text(initial_content)

        mock_pipeline = AsyncMock()
        mock_pipeline.workspace_abs_path = workspace

        with patch(
            "api.docbot.tools.pipeline_queries.get_pipeline_by_id",
            return_value=mock_pipeline,
        ):
            # Test case 1: Replace section with exact heading match
            new_section = "## 2. Components\nNew components text.\n"
            result = await update_markdown_section(
                pipeline_id, filename, "## 2. Components", new_section, "Refactor"
            )
            assert "Successfully updated section" in result

            updated_content = file_path.read_text()
            assert "New components text." in updated_content
            assert "Old overview text." in updated_content
            assert "Deployment info." in updated_content
            assert (
                "### 2.1 Backend" not in updated_content
            )  # Subheadings should be gone

            # Test case 2: Fuzziness (missing heading in section)
            new_overview = "New overview text."
            result = await update_markdown_section(
                pipeline_id, filename, "## 1. Overview", new_overview, "Update"
            )
            assert "Successfully updated section" in result
            updated_content = file_path.read_text()
            assert "## 1. Overview\nNew overview text." in updated_content


@pytest.mark.asyncio
async def test_docbot_multi_update_workflow():
    with tempfile.TemporaryDirectory() as tmp_dir:
        workspace = Path(tmp_dir)
        pipeline_id = "p1"
        task_id = "t1"
        design_dir = workspace / "design"
        design_dir.mkdir()

        session = DocBotSession(pipeline_id, task_id)
        assert session.has_updates is False

        mock_pipeline = AsyncMock()
        mock_pipeline.workspace_abs_path = workspace

        with patch(
            "api.docbot.tools.pipeline_queries.get_pipeline_by_id",
            return_value=mock_pipeline,
        ):
            # 1. First update
            await update_ref_doc(
                pipeline_id, "doc1.md", "# Doc 1", "Reason 1", session=session
            )
            assert session.has_updates is True

            # 2. Second update (section)
            (design_dir / "doc1.md").write_text("# Doc 1\n## Section A\nOld")
            await update_markdown_section(
                pipeline_id,
                "doc1.md",
                "## Section A",
                "New",
                "Reason 2",
                session=session,
            )
            assert session.has_updates is True

            # 3. Complete
            result = await document_update_completed("Summary", session=session)
            assert "completed and finalized" in result


@pytest.mark.asyncio
async def test_document_update_completed_error():
    session = DocBotSession("p1", "t1")
    session.has_updates = False

    result = await document_update_completed("Summary", session=session)
    assert "Error: No updates were made" in result
