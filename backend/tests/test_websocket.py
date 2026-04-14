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

import pytest
from unittest.mock import AsyncMock
from api.websocket_manager import ConnectionManager, WSMessage

@pytest.mark.asyncio
async def test_websocket_connect_disconnect():
    # We don't need the DB for these tests
    manager = ConnectionManager()
    websocket = AsyncMock()
    client_id = "test_client"
    
    await manager.connect(websocket, client_id)
    assert len(manager.active_connections) == 1
    assert manager.active_connections[client_id] == websocket
    websocket.accept.assert_called_once()
    
    manager.disconnect(websocket, client_id)
    assert len(manager.active_connections) == 0
    assert client_id not in manager.active_connections

@pytest.mark.asyncio
async def test_websocket_broadcast():
    manager = ConnectionManager()
    ws1 = AsyncMock()
    ws2 = AsyncMock()
    
    await manager.connect(ws1, "c1")
    await manager.connect(ws2, "c2")
    
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
