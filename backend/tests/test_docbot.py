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


async def make_async_iter(items):
    for item in items:
        yield item


@pytest.mark.asyncio
async def test_docbot_session_run_terminal_call():
    session = DocBotSession(pipeline_id="test_pipeline", task_id="test_task")

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
        mock_msg = MagicMock()
        mock_tool_call = MagicMock()
        mock_tool_call.function.name = "no_doc_update_needed"
        mock_tool_call.function.arguments = {"reason": "nothing to do"}
        mock_msg.tool_calls = [mock_tool_call]
        mock_msg.content = ""

        mock_chunk = MagicMock()
        mock_chunk.message = mock_msg

        with patch(
            "api.assistant.base_session.ollama.AsyncClient.chat", new_callable=AsyncMock
        ) as mock_chat:
            # chat returns an async generator when stream=True
            mock_chat.return_value = make_async_iter([mock_chunk])

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
    session = DocBotSession(pipeline_id="test_pipeline", task_id="test_task")

    # Mock Ollama response with no tool call
    mock_msg = MagicMock()
    mock_msg.tool_calls = []
    mock_msg.content = "Just talking..."

    mock_chunk = MagicMock()
    mock_chunk.message = mock_msg

    with patch(
        "api.assistant.base_session.ollama.AsyncClient.chat", new_callable=AsyncMock
    ) as mock_chat:
        mock_chat.return_value = make_async_iter([mock_chunk])

        await session.run("Initial prompt", max_iterations=2)

        # Should be called 2 times (the max_iterations)
        assert mock_chat.call_count == 2
        # History should contain "Continue" prompts
        assert any(
            "Continue to analyze" in msg["content"]
            for msg in session.history
            if msg["role"] == "user"
        )


@pytest.mark.asyncio
async def test_docbot_session_multiple_tool_calls():
    session = DocBotSession(pipeline_id="test_pipeline", task_id="test_task")

    async def mock_tool_1(**kwargs):
        return "Tool 1 success"

    async def mock_tool_2(**kwargs):
        return "Tool 2 success"

    t1 = MagicMock()
    t1.name = "tool1"
    t1.parameters = {"type": "object", "properties": {}}
    t1.func = mock_tool_1
    t1.is_available.return_value = True

    t2 = MagicMock()
    t2.name = "no_doc_update_needed"
    t2.parameters = {"type": "object", "properties": {}}
    t2.func = mock_tool_2
    t2.is_available.return_value = True

    with (
        patch.object(
            docbot_registry,
            "get_tool",
            side_effect=lambda n: t1 if n == "tool1" else t2,
        ),
        patch.object(docbot_registry, "list_tools", return_value=[t1, t2]),
    ):
        mock_msg = MagicMock()

        tc1 = MagicMock()
        tc1.function.name = "tool1"
        tc1.function.arguments = {}

        tc2 = MagicMock()
        tc2.function.name = "no_doc_update_needed"
        tc2.function.arguments = {"reason": "done"}

        mock_msg.tool_calls = [tc1, tc2]
        mock_msg.content = ""

        mock_chunk = MagicMock()
        mock_chunk.message = mock_msg

        with patch(
            "api.assistant.base_session.ollama.AsyncClient.chat", new_callable=AsyncMock
        ) as mock_chat:
            mock_chat.return_value = make_async_iter([mock_chunk])

            await session.run("Initial prompt")

            # Verify both tools were called and results added to history
            tool_results = [
                msg["content"] for msg in session.history if msg.get("role") == "tool"
            ]
            assert '"Tool 1 success"' in tool_results
            assert '"Tool 2 success"' in tool_results
            assert mock_chat.call_count == 1


@pytest.mark.asyncio
async def test_docbot_session_terminal_retry_on_error():
    session = DocBotSession(pipeline_id="test_pipeline", task_id="test_task")

    async def mock_fail_func(**kwargs):
        return "Error: Something went wrong"

    async def mock_success_func(**kwargs):
        return "Success"

    t = MagicMock()
    t.name = "no_doc_update_needed"
    t.parameters = {"type": "object", "properties": {}}
    t.func = mock_fail_func
    t.is_available.return_value = True

    with (
        patch.object(docbot_registry, "get_tool", return_value=t),
        patch.object(docbot_registry, "list_tools", return_value=[t]),
    ):
        # 1st response: fail
        mock_msg1 = MagicMock()
        tc1 = MagicMock()
        tc1.function.name = "no_doc_update_needed"
        tc1.function.arguments = {"reason": "try 1"}
        mock_msg1.tool_calls = [tc1]
        mock_msg1.content = ""
        mock_chunk1 = MagicMock()
        mock_chunk1.message = mock_msg1

        # 2nd response: success (we'll swap the mock function)
        mock_msg2 = MagicMock()
        tc2 = MagicMock()
        tc2.function.name = "no_doc_update_needed"
        tc2.function.arguments = {"reason": "try 2"}
        mock_msg2.tool_calls = [tc2]
        mock_msg2.content = ""
        mock_chunk2 = MagicMock()
        mock_chunk2.message = mock_msg2

        with patch(
            "api.assistant.base_session.ollama.AsyncClient.chat", new_callable=AsyncMock
        ) as mock_chat:
            mock_chat.side_effect = [
                make_async_iter([mock_chunk1]),
                make_async_iter([mock_chunk2]),
            ]

            # First call uses failing func
            await session.run("Initial prompt", max_iterations=2)

            # It should have called chat twice because the first terminal call failed
            assert mock_chat.call_count == 2
