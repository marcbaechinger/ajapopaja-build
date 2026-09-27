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

from unittest.mock import AsyncMock

import pytest

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


@pytest.mark.asyncio
async def test_add_connection_tracks_username():
    manager = ConnectionManager()
    websocket = AsyncMock()

    await manager.add_connection(websocket, "c1", "alice")

    assert manager.connection_users["c1"] == "alice"


def test_disconnect_clears_username_mapping():
    manager = ConnectionManager()
    websocket = AsyncMock()
    manager.active_connections["c1"] = websocket
    manager.connection_users["c1"] = "alice"

    manager.disconnect(websocket, "c1")

    assert "c1" not in manager.active_connections
    assert "c1" not in manager.connection_users


@pytest.mark.asyncio
async def test_send_to_users_only_reaches_matching_clients():
    manager = ConnectionManager()
    alice_tab1 = AsyncMock()
    alice_tab2 = AsyncMock()
    bob = AsyncMock()

    await manager.add_connection(alice_tab1, "c1", "alice")
    await manager.add_connection(alice_tab2, "c2", "alice")
    await manager.add_connection(bob, "c3", "bob")

    message = WSMessage(type="NOTIFICATION", id="n1", payload={"title": "hi"})
    await manager.send_to_users(message, ["alice"])

    expected = message.model_dump_json()
    alice_tab1.send_text.assert_awaited_once_with(expected)
    alice_tab2.send_text.assert_awaited_once_with(expected)
    bob.send_text.assert_not_awaited()


@pytest.mark.asyncio
async def test_send_to_client_targets_single_connection():
    manager = ConnectionManager()
    ws1 = AsyncMock()
    ws2 = AsyncMock()
    await manager.add_connection(ws1, "c1", "alice")
    await manager.add_connection(ws2, "c2", "bob")

    message = WSMessage(type="NOTIFICATION", id="n2", payload={})
    await manager.send_to_client(message, "c2")

    ws2.send_text.assert_awaited_once_with(message.model_dump_json())
    ws1.send_text.assert_not_awaited()


@pytest.mark.asyncio
async def test_send_to_users_tolerates_dropped_socket():
    manager = ConnectionManager()
    failing = AsyncMock()
    failing.send_text.side_effect = RuntimeError("socket gone")
    healthy = AsyncMock()

    await manager.add_connection(failing, "c1", "alice")
    await manager.add_connection(healthy, "c2", "alice")

    await manager.send_to_users(WSMessage(type="X", payload={}), ["alice"])

    healthy.send_text.assert_awaited_once()


@pytest.mark.asyncio
async def test_send_to_users_empty_targets_is_noop():
    manager = ConnectionManager()
    websocket = AsyncMock()
    await manager.add_connection(websocket, "c1", "alice")

    await manager.send_to_users(WSMessage(type="X", payload={}), [])

    websocket.send_text.assert_not_awaited()
