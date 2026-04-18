import pytest
from unittest.mock import patch, MagicMock, AsyncMock
from api.assistant.session import AssistantSession
from core.models.models import ChatMessage

@pytest.mark.asyncio
async def test_llm_loop_retry_logic():
    # Setup mock user and history
    history = [ChatMessage(role="user", content="hello")]
    mock_on_update = AsyncMock()

    session = AssistantSession(user_id="test_user", history=history, on_update=mock_on_update)
    session._save_history = AsyncMock()

    # Mock ollama.chat to fail 2 times then succeed
    call_count = 0
    def mock_chat(*args, **kwargs):
        nonlocal call_count
        call_count += 1
        if call_count <= 2:
            raise Exception(f"Mocked JSON decode error {call_count}")
        else:
            return [{"message": {"content": "success"}}]

    with patch("api.assistant.session.asyncio.to_thread", new_callable=AsyncMock) as mock_to_thread:
        # We need the side effect to act as a normal async function returning chunks
        mock_to_thread.side_effect = mock_chat
        
        await session._run_llm_loop()

        # The loop should have run 3 times
        assert call_count == 3
        # System messages should have been added for the errors
        assert any("Mocked JSON decode error 1" in msg.content for msg in session.history if msg.role == "system")
        assert any("Mocked JSON decode error 2" in msg.content for msg in session.history if msg.role == "system")
        # Final success message should be in history
        assert any("success" in msg.content for msg in session.history if msg.role == "assistant")

@pytest.mark.asyncio
async def test_llm_loop_max_retries():
    # Setup mock user and history
    history = [ChatMessage(role="user", content="hello")]
    mock_on_update = AsyncMock()

    session = AssistantSession(user_id="test_user", history=history, on_update=mock_on_update)
    session._save_history = AsyncMock()

    # Mock ollama.chat to always fail
    def mock_chat_fail(*args, **kwargs):
        raise Exception("Persistent error")

    with patch("api.assistant.session.asyncio.to_thread", new_callable=AsyncMock) as mock_to_thread:
        mock_to_thread.side_effect = mock_chat_fail
        
        await session._run_llm_loop()

        # Check that it eventually stopped and sent an error update
        mock_on_update.assert_any_call({
            "type": "error",
            "message": "Assistant failed to produce a valid response after multiple attempts."
        })
