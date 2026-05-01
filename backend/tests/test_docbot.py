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

from api.docbot.registry import docbot_registry
from api.docbot.session import DocBotSession


@pytest.mark.asyncio
async def test_docbot_session_run_terminal_call():
    session = DocBotSession(pipeline_id="test_pipeline")

    # Mock tool result
    async def mock_tool_func(**kwargs):
        return "Tool success"

    mock_tool = MagicMock()
    mock_tool.name = "no_doc_update_needed"
    mock_tool.description = "A mock tool description"
    mock_tool.parameters = {"type": "object", "properties": {}}
    mock_tool.func = mock_tool_func

    with (
        patch.object(docbot_registry, "get_tool", return_value=mock_tool),
        patch.object(docbot_registry, "list_tools", return_value=[mock_tool]),
    ):
        # Mock Ollama response with a tool call
        mock_response = MagicMock()
        mock_msg = MagicMock()

        mock_tool_call = MagicMock()
        mock_tool_call.function.name = "no_doc_update_needed"
        mock_tool_call.function.arguments = {"reason": "nothing to do"}

        mock_msg.tool_calls = [mock_tool_call]
        mock_msg.content = ""
        mock_response.message = mock_msg

        with patch(
            "api.docbot.session.ollama.AsyncClient.chat", new_callable=AsyncMock
        ) as mock_chat:
            mock_chat.return_value = mock_response

            await session.run("Initial prompt")

            assert mock_chat.called
            # Check terminal call was detected (loop finished)
            assert any(
                msg.get("role") == "tool" and '"Tool success"' in msg.get("content", "")
                for msg in session.history
                if isinstance(msg, dict)
            )


@pytest.mark.asyncio
async def test_docbot_session_max_iterations():
    session = DocBotSession(pipeline_id="test_pipeline")

    # Mock Ollama response with no tool call
    mock_response = MagicMock()
    mock_msg = MagicMock()
    mock_msg.tool_calls = []
    mock_msg.content = "Just talking..."
    mock_response.message = mock_msg

    with patch(
        "api.docbot.session.ollama.AsyncClient.chat", new_callable=AsyncMock
    ) as mock_chat:
        mock_chat.return_value = mock_response

        await session.run("Initial prompt", max_iterations=2)

        # Should be called 2 times (the max_iterations)
        assert mock_chat.call_count == 2
        # History should contain "Continue" prompts
        assert any(
            "Continue to analyze" in msg["content"]
            for msg in session.history
            if msg["role"] == "user"
        )
