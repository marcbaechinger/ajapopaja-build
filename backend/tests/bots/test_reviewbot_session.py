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

from api.reviewbot.registry import reviewbot_registry
from api.reviewbot.session import ReviewBotSession


async def make_async_iter(items):
    for item in items:
        yield item


@pytest.mark.asyncio
async def test_reviewbot_session_run_terminal_call():
    session = ReviewBotSession(pipeline_id="test_pipeline", task_id="test_task")

    # Mock tool result
    async def mock_tool_func(**kwargs):
        return "Review saved"

    mock_tool = MagicMock()
    mock_tool.name = "save_review"
    mock_tool.description = "A mock tool description"
    mock_tool.parameters = {
        "type": "object",
        "properties": {"review_md": {"type": "string"}},
    }
    mock_tool.func = mock_tool_func

    with (
        patch.object(reviewbot_registry, "get_tool", return_value=mock_tool),
        patch.object(reviewbot_registry, "list_tools", return_value=[mock_tool]),
    ):
        # Mock Ollama response with a tool call
        mock_msg = MagicMock()
        mock_tool_call = MagicMock()
        mock_tool_call.function.name = "save_review"
        mock_tool_call.function.arguments = {"review_md": "# Review content"}
        mock_msg.tool_calls = [mock_tool_call]
        mock_msg.content = ""

        mock_chunk = MagicMock()
        mock_chunk.message = mock_msg

        with patch(
            "api.bot.base_session.ollama.AsyncClient.chat", new_callable=AsyncMock
        ) as mock_chat:
            # chat returns an async generator when stream=True
            mock_chat.return_value = make_async_iter([mock_chunk])

            with patch.object(
                session,
                "get_initial_prompt",
                new_callable=AsyncMock,
                return_value="Initial prompt",
            ):
                await session.run()

            assert mock_chat.called
            # Check terminal call was detected (loop finished)
            assert any(
                msg.get("role") == "tool" and '"Review saved"' in msg.get("content", "")
                for msg in session.history
                if isinstance(msg, dict)
            )
