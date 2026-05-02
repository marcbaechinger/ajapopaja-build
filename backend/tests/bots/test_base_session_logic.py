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

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api.assistant.tool_registry import ToolDefinition
from api.bot.base_session import BaseBotSession


class ConcreteBotSession(BaseBotSession):
    """A concrete implementation of BaseBotSession for testing."""

    def get_system_instruction(self) -> str:
        return "Test instruction"

    async def get_initial_prompt(self) -> str:
        return "Test prompt"

    def get_tools(self):
        async def test_tool(param1: str, pipeline_id: str = None):
            return {"result": f"processed {param1}"}

        async def terminal_tool():
            return {"status": "finished"}

        return [
            ToolDefinition(
                name="test_tool",
                description="A test tool",
                type="read_only",
                parameters={
                    "type": "object",
                    "properties": {"param1": {"type": "string"}},
                    "required": ["param1"],
                },
                func=test_tool,
            ),
            ToolDefinition(
                name="terminal_tool",
                description="Finishes the task",
                type="read_only",
                parameters={"type": "object", "properties": {}},
                func=terminal_tool,
            ),
        ]

    def is_terminal_tool(self, tool_name: str) -> bool:
        return tool_name == "terminal_tool"


@pytest.mark.asyncio
async def test_base_session_run_loop():
    session = ConcreteBotSession("p1", "t1")
    session.on_event = AsyncMock()

    # Mock Ollama response
    mock_response_1 = MagicMock()
    mock_response_1.message.content = "I will call a tool."
    mock_tool_call_1 = MagicMock()
    mock_tool_call_1.function.name = "test_tool"
    mock_tool_call_1.function.arguments = json.dumps({"param1": "value1"})
    mock_response_1.message.tool_calls = [mock_tool_call_1]

    mock_response_2 = MagicMock()
    mock_response_2.message.content = "I am done."
    mock_tool_call_2 = MagicMock()
    mock_tool_call_2.function.name = "terminal_tool"
    mock_tool_call_2.function.arguments = "{}"
    mock_response_2.message.tool_calls = [mock_tool_call_2]

    # Mocking the async iterator for session.client.chat
    async def mock_chat_stream(*args, **kwargs):
        if "test_tool" in kwargs.get("tools", [])[0]["function"]["name"]:
            # First call
            yield mock_response_1
        else:
            # Second call (after tool result)
            yield mock_response_2

    # Correct way to mock the async stream returned by client.chat
    class AsyncIter:
        def __init__(self, items):
            self.items = items

        def __aiter__(self):
            return self

        async def __anext__(self):
            if not self.items:
                raise StopAsyncIteration
            return self.items.pop(0)

    with patch.object(session.client, "chat") as mock_chat:
        # First call returns test_tool call, second call returns terminal_tool call
        mock_chat.side_effect = [
            AsyncIter([mock_response_1]),
            AsyncIter([mock_response_2]),
        ]

        await session.run(max_iterations=5)

        assert mock_chat.call_count == 2
        assert session.on_event.call_args_list[0][0][0] == "bot_started"
        assert session.on_event.call_args_list[1][0][0] == "bot_completed"

        # Verify history
        assert len(session.history) >= 5  # sys, user, asst(tc), tool, asst(tc), tool
        assert session.history[0]["role"] == "system"
        assert session.history[1]["role"] == "user"
        assert session.history[2]["role"] == "assistant"
        assert "tool_calls" in session.history[2]
        assert session.history[3]["role"] == "tool"
        assert session.history[3]["name"] == "test_tool"


@pytest.mark.asyncio
async def test_base_session_iteration_limit():
    session = ConcreteBotSession("p1", "t1")

    mock_response = MagicMock()
    mock_response.message.content = "Thinking..."
    mock_response.message.tool_calls = None

    class AsyncIter:
        def __init__(self, items):
            self.items = items

        def __aiter__(self):
            return self

        async def __anext__(self):
            if not self.items:
                raise StopAsyncIteration
            return self.items.pop(0)

    with patch.object(session.client, "chat") as mock_chat:
        mock_chat.return_value = AsyncIter([mock_response])

        # Should stop after 2 iterations
        await session.run(max_iterations=2)

        assert mock_chat.call_count == 2


@pytest.mark.asyncio
async def test_base_session_prepare_ollama_tools():
    session = ConcreteBotSession("p1", "t1")
    tools = session._prepare_ollama_tools()

    assert len(tools) == 2
    assert tools[0]["function"]["name"] == "test_tool"
    # Ensure injected params are removed from parameters
    assert "pipeline_id" not in tools[0]["function"]["parameters"]["properties"]


@pytest.mark.asyncio
async def test_base_session_execute_tool():
    session = ConcreteBotSession("p1", "t1")

    # Test successful execution with injection
    result = await session._execute_tool("test_tool", {"param1": "data"})
    assert result == {"result": "processed data"}

    # Test session injection
    async def tool_with_session(session: BaseBotSession):
        return {"session_id": session.pipeline_id}

    with patch.object(session, "get_tools") as mock_get_tools:
        mock_get_tools.return_value = [
            ToolDefinition(
                name="session_tool",
                description="desc",
                type="read_only",
                parameters={"type": "object", "properties": {}},
                func=tool_with_session,
            )
        ]
        result = await session._execute_tool("session_tool", {})
        assert result == {"session_id": "p1"}

    # Test tool not found
    result = await session._execute_tool("unknown", {})
    assert "Error: Tool unknown not found" in result

    # Test tool error handling
    with patch.object(session, "_find_tool_definition") as mock_find:
        mock_func = AsyncMock(side_effect=ValueError("Test crash"))
        mock_def = MagicMock(func=mock_func)
        mock_find.return_value = mock_def

        result = await session._execute_tool("test_tool", {"param1": "x"})
        assert "Error: ValueError - Test crash" in result


@pytest.mark.asyncio
async def test_base_session_is_tool_error():
    session = ConcreteBotSession("p1", "t1")
    assert session._is_tool_error("Error: something went wrong") is True
    assert session._is_tool_error({"error": "broken"}) is True
    assert session._is_tool_error("Success") is False
    assert session._is_tool_error({"status": "ok"}) is False
