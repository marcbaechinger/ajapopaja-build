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
from typing import List, Optional
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from ollama import Message

from api.bot.base_session import BaseBotSession
from api.bot.tool_registry import ToolDefinition, ToolRegistry


class ConcreteBotSession(BaseBotSession):
    """A concrete implementation of BaseBotSession for testing."""

    def __init__(
        self,
        pipeline_id: str,
        task_id: str,
        use_custom_feedback: bool = False,
        use_custom_turn_warning: bool = False,
    ):
        super().__init__(pipeline_id, task_id)
        self.pipeline_and_task_id_args = []
        self.use_custom_feedback = use_custom_feedback
        self.use_custom_turn_warning = use_custom_turn_warning

    def get_system_instruction(self) -> str:
        return "Test instruction"

    async def get_initial_prompt(self) -> str:
        return "Test prompt"

    def get_tools(self) -> List[ToolDefinition]:
        async def test_tool(pipeline_id: str, task_id: str, param1: str):
            """
            Tests code.

            Args:
                param1: A string parameter
            """
            self.pipeline_and_task_id_args.append([pipeline_id, task_id])
            return {"result": f"processed {param1}"}

        async def terminal_tool(pipeline_id: str, task_id: str):
            self.pipeline_and_task_id_args.append([pipeline_id, task_id])
            return {"status": "finished"}

        registry = ToolRegistry()
        registry.register_tool(test_tool)
        registry.register_tool(terminal_tool)
        return registry.list_tools()

    def is_terminal_tool(self, tool_name: str) -> bool:
        """
        Call the terminal action.

        Args:
            tool_name: The name of the terminal tool.
        """
        return tool_name == "terminal_tool"

    def get_default_feedback(
        self, pipeline_id: str, task_id: str, assistant_message: str
    ) -> str:
        return (
            "Custom feedback"
            if self.use_custom_feedback
            else super().get_default_feedback(pipeline_id, task_id, assistant_message)
        )

    def get_turn_warning(self, remaining: int) -> Optional[str]:
        """
        Returns a warning message when turns are running low.
        Subclasses can override this to customize the messages.

        Args:
            remaining: Number of turns remaining.

        Returns:
            Warning message or None if no warning is needed.
        """
        if remaining == 5:
            return (
                "Only 5 custom warning"
                if self.use_custom_turn_warning
                else super().get_turn_warning(remaining)
            )
        if remaining == 1:
            return (
                "Only 1 custom warning"
                if self.use_custom_turn_warning
                else super().get_turn_warning(remaining)
            )
        return None


class AsyncIter:
    def __init__(self, items):
        self.items = items

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self.items:
            raise StopAsyncIteration
        return self.items.pop(0)


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
async def test_base_session_end_of_turns_warnings():
    session = ConcreteBotSession("p1", "t1")
    session.on_event = AsyncMock()

    # Mock Ollama tool call response
    mock_response_1 = MagicMock()
    mock_response_1.message.content = "I will call a tool."
    mock_tool_call_1 = MagicMock()
    mock_tool_call_1.function.name = "test_tool"
    mock_tool_call_1.function.arguments = json.dumps({"param1": "value1"})
    mock_response_1.message.tool_calls = [mock_tool_call_1]

    with patch.object(session.client, "chat") as mock_chat:
        mock_chat.side_effect = lambda *args, **kwargs: AsyncIter([mock_response_1])

        await session.run(max_iterations=20)

        five_warning = False
        last_warning = False
        for item in session.history:
            if "Only 5 calls" in item["content"]:
                five_warning = True
            elif "Only 1 call" in item["content"]:
                last_warning = True

        assert five_warning
        assert last_warning


@pytest.mark.asyncio
async def test_base_session_end_of_turns_custom_warnings():
    session = ConcreteBotSession("p1", "t1", use_custom_turn_warning=True)
    session.on_event = AsyncMock()

    # Mock Ollama tool call response
    mock_response_1 = MagicMock()
    mock_response_1.message.content = "I will call a tool."
    mock_tool_call_1 = MagicMock()
    mock_tool_call_1.function.name = "test_tool"
    mock_tool_call_1.function.arguments = json.dumps({"param1": "value1"})
    mock_response_1.message.tool_calls = [mock_tool_call_1]

    with patch.object(session.client, "chat") as mock_chat:
        mock_chat.side_effect = lambda *args, **kwargs: AsyncIter([mock_response_1])

        await session.run(max_iterations=20)

        five_warning = False
        last_warning = False
        for item in session.history:
            if "Only 5 custom warning" in item["content"]:
                five_warning = True
            elif "Only 1 custom warning" in item["content"]:
                last_warning = True

        assert five_warning
        assert last_warning


@pytest.mark.asyncio
async def test_base_session_default_text_reponse():
    session = ConcreteBotSession("p1", "t1")
    mock_response = MagicMock()
    mock_response.message.content = "What should I do?"
    mock_response.message.tool_calls = None

    with patch.object(session.client, "chat") as mock_chat:
        mock_chat.return_value = AsyncIter([mock_response])

        await session.run(max_iterations=4)

        assert mock_chat.call_count == 4
        first_call = mock_chat.call_args_list[-1]
        messages_sent_to_chat = first_call.kwargs["messages"]
        turns = 0
        for msg in messages_sent_to_chat:
            if msg["role"] == "user":
                if turns == 0:
                    assert msg["content"] == "Test prompt"
                else:
                    assert "task ID: t1" in msg["content"]
                    assert "pipeline ID: p1" in msg["content"]
                turns += 1


@pytest.mark.asyncio
async def test_base_session_custom_text_reponse():
    session = ConcreteBotSession("p1", "t1", use_custom_feedback=True)
    mock_response = MagicMock()
    mock_response.message.content = "What should I do?"
    mock_response.message.tool_calls = None

    with patch.object(session.client, "chat") as mock_chat:
        mock_chat.return_value = AsyncIter([mock_response])

        await session.run(max_iterations=4)

        assert mock_chat.call_count == 4
        first_call = mock_chat.call_args_list[-1]
        messages_sent_to_chat = first_call.kwargs["messages"]
        turns = 0
        for msg in messages_sent_to_chat:
            if msg["role"] == "user":
                if turns == 0:
                    assert msg["content"] == "Test prompt"
                else:
                    assert msg["content"] == "Custom feedback"
                turns += 1


@pytest.mark.asyncio
async def test_base_session_iteration_limit():
    session = ConcreteBotSession("p1", "t1")

    mock_response = MagicMock()
    mock_response.message.content = "Thinking..."
    mock_response.message.tool_calls = None

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
    # Verify pipeline_id and task_id got injected.
    assert len(session.pipeline_and_task_id_args) == 1
    assert session.pipeline_and_task_id_args[0] == ["p1", "t1"]

    # Test session injection
    async def tool_with_session(session: BaseBotSession):
        return {"pipeline_id": session.pipeline_id}

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
        assert result == {"pipeline_id": "p1"}

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
async def test_base_session_iteration_limit_warnings():
    session = ConcreteBotSession("p1", "t1")

    mock_response = MagicMock()
    mock_response.message.content = None
    mock_response.message.tool_calls = [
        Message.ToolCall(
            function=Message.ToolCall.Function(
                name="test_tool", arguments={"param1": "zurich"}
            )
        ),
    ]

    with patch.object(session.client, "chat") as mock_chat:
        mock_chat.side_effect = lambda *args, **kwargs: AsyncIter([mock_response])

        await session.run(max_iterations=20)

        assert mock_chat.call_count == 20
        first_call = mock_chat.call_args_list[-1]
        messages_sent_to_chat = first_call.kwargs["messages"]
        left_5_found = False
        last_found = False
        for msg in messages_sent_to_chat:
            if "Only 5 calls left" in msg["content"]:
                left_5_found = True
            elif "Only 1 call left" in msg["content"]:
                last_found = True

        assert left_5_found
        assert last_found


@pytest.mark.asyncio
async def test_base_session_iteration_limit_custom_warnings():
    session = ConcreteBotSession("p1", "t1", use_custom_step_warnings=True)

    mock_response = MagicMock()
    mock_response.message.content = None
    mock_response.message.tool_calls = [
        Message.ToolCall(
            function=Message.ToolCall.Function(
                name="test_tool", arguments={"param1": "zurich"}
            )
        ),
    ]

    with patch.object(session.client, "chat") as mock_chat:
        mock_chat.side_effect = lambda *args, **kwargs: AsyncIter([mock_response])

        await session.run(max_iterations=20)

        assert mock_chat.call_count == 20
        first_call = mock_chat.call_args_list[-1]
        messages_sent_to_chat = first_call.kwargs["messages"]
        custom_warning_found = False
        for msg in messages_sent_to_chat:
            if "Custom step warning" in msg["content"]:
                custom_warning_found = True

        assert custom_warning_found


@pytest.mark.asyncio
async def test_base_session_is_tool_error():
    session = ConcreteBotSession("p1", "t1")
    assert session._is_tool_error("Error: something went wrong") is True
    assert session._is_tool_error({"error": "broken"}) is True
    assert session._is_tool_error("Success") is False
    assert session._is_tool_error({"status": "ok"}) is False
