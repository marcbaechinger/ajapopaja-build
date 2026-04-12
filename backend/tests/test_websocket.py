import pytest
from unittest.mock import AsyncMock
from api.websocket_manager import ConnectionManager, WSMessage

@pytest.mark.asyncio
async def test_websocket_connect_disconnect():
    # We don't need the DB for these tests
    manager = ConnectionManager()
    websocket = AsyncMock()
    
    await manager.connect(websocket)
    assert len(manager.active_connections) == 1
    assert websocket in manager.active_connections
    websocket.accept.assert_called_once()
    
    manager.disconnect(websocket)
    assert len(manager.active_connections) == 0
    assert websocket not in manager.active_connections

@pytest.mark.asyncio
async def test_websocket_broadcast():
    manager = ConnectionManager()
    ws1 = AsyncMock()
    ws2 = AsyncMock()
    
    await manager.connect(ws1)
    await manager.connect(ws2)
    
    message = WSMessage(type="TEST", payload={"foo": "bar"})
    await manager.broadcast(message)
    
    expected_data = message.model_dump_json()
    ws1.send_text.assert_called_once_with(expected_data)
    ws2.send_text.assert_called_once_with(expected_data)

@pytest.mark.asyncio
async def test_websocket_handle_message():
    manager = ConnectionManager()
    websocket = AsyncMock()
    
    handler_called = False
    async def mock_handler(msg, ws):
        nonlocal handler_called
        handler_called = True
        assert msg.type == "HELLO"
        assert ws == websocket
        
    manager.register_handler("HELLO", mock_handler)
    
    await manager.handle_message('{"type": "HELLO", "payload": {}}', websocket)
    assert handler_called
