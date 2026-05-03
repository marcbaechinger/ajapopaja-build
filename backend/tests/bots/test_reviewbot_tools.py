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

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api.reviewbot.tools import save_review


@pytest.mark.asyncio
async def test_save_review_success():
    pipeline_id = "test_pipeline"
    task_id = "test_task"
    review_md = "# Technical Review\n\nExcellent work."

    mock_task = AsyncMock()
    mock_task.id = task_id
    mock_task.save = AsyncMock()
    mock_task.model_dump = MagicMock(
        return_value={"id": task_id, "pipeline_id": pipeline_id, "review_md": review_md}
    )

    with (
        patch(
            "api.reviewbot.tools.task_queries.get_task_by_id", return_value=mock_task
        ),
        patch(
            "api.reviewbot.tools.manager.broadcast", new_callable=AsyncMock
        ) as mock_broadcast,
    ):
        result = await save_review(pipeline_id, task_id, review_md)

        assert "Successfully saved review" in result
        assert mock_task.review_md == review_md
        assert mock_task.save.called
        assert mock_broadcast.called

        # Verify websocket message
        call_args = mock_broadcast.call_args[0][0]
        assert call_args.type == "REVIEWBOT_REVIEW_READY"
        assert call_args.payload["id"] == task_id


@pytest.mark.asyncio
async def test_save_review_task_not_found():
    with patch("api.reviewbot.tools.task_queries.get_task_by_id", return_value=None):
        result = await save_review("p1", "t1", "# Review")
        assert "Error: Task t1 not found" in result


@pytest.mark.asyncio
async def test_save_review_invalid_payload():
    # Test non-string
    result = await save_review("p1", "t1", 123)  # type: ignore
    assert "Error: review_md must be a string" in result

    # Test empty string
    result = await save_review("p1", "t1", "")
    assert "Error: review_md cannot be empty" in result

    # Test whitespace string
    result = await save_review("p1", "t1", "   ")
    assert "Error: review_md cannot be empty" in result
