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
from unittest.mock import MagicMock, patch

import pytest

from api.bot.base_session import BaseBotSession
from api.bot.conversation import prune_value, shorten_content


class MockBotSession(BaseBotSession):
    def get_system_instruction(self) -> str:
        return "Mock System Instruction"

    async def get_initial_prompt(self) -> str:
        return "Initial Prompt"

    def get_tools(self):
        return []

    def is_terminal_tool(self, tool_name: str) -> bool:
        return tool_name == "terminal"


def test_shorten_content():
    text = "a" * 200
    short = shorten_content(text, limit=100)
    assert len(short) == 103
    assert short.endswith("...")

    assert shorten_content("short") == "short"


def test_prune_value():
    # String
    assert prune_value("a" * 200) == ("a" * 100) + "..."

    # List
    assert prune_value([1, 2, 3]) == "[list:int:3]"

    # Dict
    d = {"k1": "v1", "k2": [1, 2], "k3": {"inner": "val"}}
    pruned = prune_value(d)
    assert pruned["k1"] == "v1"
    assert pruned["k2"] == "[list:int:2]"
    assert pruned["k3"] == "[object]"


@pytest.mark.asyncio
async def test_conversation_log_creation(monkeypatch):
    monkeypatch.setattr("core.config.BASEBOT_LOG_ENABLED", False)
    session = MockBotSession("p1", "t1")

    # Mock client.chat to return a simple generator
    async def mock_chat_iter(*args, **kwargs):
        class Chunk:
            def __init__(self, content):
                self.message = MagicMock()
                self.message.content = content
                self.message.tool_calls = []

        yield Chunk("Hello!")

    # Wrap the generator in an async function that can be awaited
    async def mock_chat_call(*args, **kwargs):
        return mock_chat_iter()

    session.client.chat = mock_chat_call

    # We only run for 1 iteration to keep it simple
    with patch.object(session, "get_turn_warning", return_value=None):
        await session.run(max_iterations=1)

    assert len(session.conversation_log) == 3
    assert session.conversation_log[0].role == "user"
    assert session.conversation_log[0].content == "Initial Prompt"
    assert session.conversation_log[1].role == "assistant"
    assert session.conversation_log[1].content == "Hello!"
    assert session.conversation_log[2].role == "user"
    assert "Continue to analyze" in session.conversation_log[2].content


@pytest.mark.asyncio
async def test_get_summary_stats():
    session = MockBotSession("p1", "t1")
    from datetime import UTC, datetime

    from api.bot.conversation import ConversationTurn

    session.conversation_log = [
        ConversationTurn(
            turn_id=1, role="user", content="hi", timestamp=datetime.now(UTC)
        ),
        ConversationTurn(
            turn_id=2,
            role="assistant",
            content="",
            tool_name="t1",
            timestamp=datetime.now(UTC),
        ),
        ConversationTurn(
            turn_id=3,
            role="tool",
            content="ok",
            tool_name="t1",
            success=True,
            timestamp=datetime.now(UTC),
        ),
        ConversationTurn(
            turn_id=4,
            role="tool",
            content="error",
            tool_name="t2",
            success=False,
            timestamp=datetime.now(UTC),
        ),
    ]

    stats = session.get_summary_stats()
    assert stats["total_turns"] == 4
    assert stats["num_tool_calls"] == 2
    assert stats["success_rate"] == 0.5


@pytest.mark.asyncio
async def test_conversation_log_persistence(tmp_path, monkeypatch):
    monkeypatch.setattr("core.config.BASEBOT_LOG_ENABLED", True)
    monkeypatch.setattr("core.config.SANDBOX_ROOT", tmp_path)

    session = MockBotSession("p1", "t1")

    # Manually log a turn
    from api.bot.conversation import create_log_turn

    session._log_turn(create_log_turn(1, "user", "test content"))

    log_file = tmp_path / "logs" / "t1" / "__log.json"
    assert log_file.exists()

    with open(log_file, "r") as f:
        data = json.load(f)
        assert len(data) == 1
        assert data[0]["role"] == "user"
        assert data[0]["content"] == "test content"
