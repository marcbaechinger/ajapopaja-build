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
from fastapi import status

from api.auth import get_current_user
from api.coderbot.manager import (
    InteractiveSessionAlreadyActiveError,
    InteractiveSessionBusyError,
    InteractiveSessionNotSupportedError,
    NoActiveInteractiveSessionError,
)
from api.main import app


@pytest.mark.asyncio
async def test_trigger_coderbot_unauthenticated(async_client, init_mock_db):
    response = await async_client.post("/api/coderbot/trigger/task_123")
    assert response.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.asyncio
async def test_trigger_coderbot_authenticated(async_client, init_mock_db):
    mock_user = AsyncMock()
    mock_user.username = "testuser"

    app.dependency_overrides[get_current_user] = lambda: mock_user

    try:
        with patch(
            "api.coderbot.router.Task.get", new_callable=AsyncMock
        ) as mock_get_task:
            mock_task = AsyncMock()
            mock_task.id = "task_123"
            mock_task.pipeline_id = "pipe_123"
            mock_get_task.return_value = mock_task

            with patch(
                "api.coderbot.router.coderbot_manager.process_task",
                new_callable=AsyncMock,
            ) as mock_process:
                response = await async_client.post("/api/coderbot/trigger/task_123")
                assert response.status_code == status.HTTP_200_OK
                assert response.json()["status"] == "success"
                mock_process.assert_called_once_with(mock_task)
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_stop_coderbot_unauthenticated(async_client, init_mock_db):
    response = await async_client.post("/api/coderbot/stop/task_123")
    assert response.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.asyncio
async def test_stop_coderbot_authenticated(async_client, init_mock_db):
    mock_user = AsyncMock()
    mock_user.username = "testuser"

    app.dependency_overrides[get_current_user] = lambda: mock_user

    try:
        with patch("api.coderbot.router.coderbot_manager.stop_session") as mock_stop:
            mock_stop.return_value = True
            response = await async_client.post("/api/coderbot/stop/task_123")
            assert response.status_code == status.HTTP_200_OK
            assert response.json()["status"] == "success"
            mock_stop.assert_called_once_with("task_123")
    finally:
        app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Interactive session routes
# ---------------------------------------------------------------------------


def _authenticate():
    mock_user = AsyncMock()
    mock_user.username = "testuser"
    app.dependency_overrides[get_current_user] = lambda: mock_user


@pytest.mark.asyncio
async def test_interactive_session_unauthenticated(async_client, init_mock_db):
    response = await async_client.get("/api/coderbot/interactive/session")
    assert response.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.asyncio
async def test_interactive_start_unauthenticated(async_client, init_mock_db):
    response = await async_client.post("/api/coderbot/interactive/start/p1")
    assert response.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.asyncio
async def test_interactive_message_unauthenticated(async_client, init_mock_db):
    response = await async_client.post(
        "/api/coderbot/interactive/message", json={"message": "hi"}
    )
    assert response.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.asyncio
async def test_interactive_stop_unauthenticated(async_client, init_mock_db):
    response = await async_client.post("/api/coderbot/interactive/stop")
    assert response.status_code == status.HTTP_401_UNAUTHORIZED


@pytest.mark.asyncio
async def test_get_interactive_session(async_client, init_mock_db):
    _authenticate()
    try:
        with patch(
            "api.coderbot.router.coderbot_manager.get_interactive_session"
        ) as mock_get:
            mock_get.return_value = {
                "pipeline_id": "p1",
                "is_active": True,
                "start_time": None,
                "busy": False,
            }
            response = await async_client.get("/api/coderbot/interactive/session")
            assert response.status_code == status.HTTP_200_OK
            assert response.json()["pipeline_id"] == "p1"
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_start_interactive_session(async_client, init_mock_db):
    _authenticate()
    try:
        with (
            patch(
                "api.coderbot.router.Pipeline.get", new_callable=AsyncMock
            ) as mock_get,
            patch(
                "api.coderbot.router.coderbot_manager.start_interactive_session",
                new_callable=AsyncMock,
            ) as mock_start,
        ):
            pipeline = MagicMock()
            pipeline.repo_uri = "https://github.com/example/repo.git"
            mock_get.return_value = pipeline
            mock_start.return_value = {
                "pipeline_id": "p1",
                "is_active": True,
                "start_time": None,
                "busy": False,
            }

            response = await async_client.post("/api/coderbot/interactive/start/p1")
            assert response.status_code == status.HTTP_202_ACCEPTED
            assert response.json()["pipeline_id"] == "p1"
            mock_start.assert_awaited_once_with(pipeline)
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_start_interactive_session_pipeline_not_found(async_client, init_mock_db):
    _authenticate()
    try:
        with patch(
            "api.coderbot.router.Pipeline.get", new_callable=AsyncMock
        ) as mock_get:
            mock_get.return_value = None
            response = await async_client.post("/api/coderbot/interactive/start/nope")
            assert response.status_code == status.HTTP_404_NOT_FOUND
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_start_interactive_session_non_remote_pipeline(
    async_client, init_mock_db
):
    _authenticate()
    try:
        with (
            patch(
                "api.coderbot.router.Pipeline.get", new_callable=AsyncMock
            ) as mock_get,
            patch(
                "api.coderbot.router.coderbot_manager.start_interactive_session",
                new_callable=AsyncMock,
            ) as mock_start,
        ):
            mock_get.return_value = MagicMock(repo_uri=None)
            mock_start.side_effect = InteractiveSessionNotSupportedError("remote only")
            response = await async_client.post("/api/coderbot/interactive/start/p1")
            assert response.status_code == status.HTTP_400_BAD_REQUEST
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_start_interactive_session_already_active(async_client, init_mock_db):
    _authenticate()
    try:
        with (
            patch(
                "api.coderbot.router.Pipeline.get", new_callable=AsyncMock
            ) as mock_get,
            patch(
                "api.coderbot.router.coderbot_manager.start_interactive_session",
                new_callable=AsyncMock,
            ) as mock_start,
        ):
            mock_get.return_value = MagicMock()
            mock_start.side_effect = InteractiveSessionAlreadyActiveError("active")
            response = await async_client.post("/api/coderbot/interactive/start/p1")
            assert response.status_code == status.HTTP_409_CONFLICT
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_send_interactive_message(async_client, init_mock_db):
    _authenticate()
    try:
        with patch(
            "api.coderbot.router.coderbot_manager.send_interactive_message",
            new_callable=AsyncMock,
        ) as mock_send:
            response = await async_client.post(
                "/api/coderbot/interactive/message", json={"message": "do it"}
            )
            assert response.status_code == status.HTTP_202_ACCEPTED
            mock_send.assert_awaited_once_with("do it")
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_send_interactive_message_no_session(async_client, init_mock_db):
    _authenticate()
    try:
        with patch(
            "api.coderbot.router.coderbot_manager.send_interactive_message",
            new_callable=AsyncMock,
        ) as mock_send:
            mock_send.side_effect = NoActiveInteractiveSessionError("none")
            response = await async_client.post(
                "/api/coderbot/interactive/message", json={"message": "hi"}
            )
            assert response.status_code == status.HTTP_404_NOT_FOUND
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_send_interactive_message_busy(async_client, init_mock_db):
    _authenticate()
    try:
        with patch(
            "api.coderbot.router.coderbot_manager.send_interactive_message",
            new_callable=AsyncMock,
        ) as mock_send:
            mock_send.side_effect = InteractiveSessionBusyError("busy")
            response = await async_client.post(
                "/api/coderbot/interactive/message", json={"message": "hi"}
            )
            assert response.status_code == status.HTTP_409_CONFLICT
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_stop_interactive_session(async_client, init_mock_db):
    _authenticate()
    try:
        with patch(
            "api.coderbot.router.coderbot_manager.stop_interactive_session",
            new_callable=AsyncMock,
        ) as mock_stop:
            mock_stop.return_value = True
            response = await async_client.post("/api/coderbot/interactive/stop")
            assert response.status_code == status.HTTP_200_OK
            assert response.json()["status"] == "success"
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_stop_interactive_session_not_found(async_client, init_mock_db):
    _authenticate()
    try:
        with patch(
            "api.coderbot.router.coderbot_manager.stop_interactive_session",
            new_callable=AsyncMock,
        ) as mock_stop:
            mock_stop.return_value = False
            response = await async_client.post("/api/coderbot/interactive/stop")
            assert response.status_code == status.HTTP_404_NOT_FOUND
    finally:
        app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Durable session routes
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_list_sessions(async_client, init_mock_db):
    _authenticate()
    try:
        with patch(
            "api.coderbot.router.coderbot_manager.list_sessions",
            new_callable=AsyncMock,
        ) as mock_list:
            mock_list.return_value = []
            response = await async_client.get("/api/coderbot/sessions")
            assert response.status_code == status.HTTP_200_OK
            assert response.json() == {"sessions": []}
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_create_session_pipeline_not_found(async_client, init_mock_db):
    _authenticate()
    try:
        with patch(
            "api.coderbot.router.Pipeline.get", new_callable=AsyncMock
        ) as mock_get:
            mock_get.return_value = None
            response = await async_client.post(
                "/api/coderbot/sessions",
                json={"pipeline_id": "nope", "kind": "interactive"},
            )
            assert response.status_code == status.HTTP_404_NOT_FOUND
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_pause_session_not_found(async_client, init_mock_db):
    _authenticate()
    try:
        from api.coderbot.manager import PiSessionNotFoundError

        with patch(
            "api.coderbot.router.coderbot_manager.pause_session",
            new_callable=AsyncMock,
        ) as mock_pause:
            mock_pause.side_effect = PiSessionNotFoundError("missing")
            response = await async_client.post("/api/coderbot/sessions/missing/pause")
            assert response.status_code == status.HTTP_404_NOT_FOUND
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_session_history_returns_events(async_client, init_mock_db):
    _authenticate()
    try:
        with patch(
            "api.coderbot.router.read_session_events",
            return_value=[{"type": "agent_start"}],
        ):
            response = await async_client.get("/api/coderbot/sessions/u1/history")
            assert response.status_code == status.HTTP_200_OK
            assert response.json()["events"] == [{"type": "agent_start"}]
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_send_session_message_targets_manager(async_client, init_mock_db):
    _authenticate()
    try:
        with patch(
            "api.coderbot.router.coderbot_manager.send_session_message",
            new_callable=AsyncMock,
        ) as mock_send:
            response = await async_client.post(
                "/api/coderbot/sessions/u1/message", json={"message": "hi"}
            )
            assert response.status_code == status.HTTP_202_ACCEPTED
            mock_send.assert_awaited_once_with("u1", "hi")
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_patch_session_updates_model(async_client, init_mock_db):
    """PATCHing a paused session's model persists it and broadcasts the update."""
    from core.models.models import PiSession, PiSessionKind, PiSessionStatus

    _authenticate()
    try:
        record = PiSession(
            uid="u-model",
            kind=PiSessionKind.INTERACTIVE,
            status=PiSessionStatus.PAUSED,
            pipeline_id="p1",
            model="old-model:cloud",
        )
        await record.insert()

        with (
            patch(
                "api.coderbot.router.coderbot_manager.get_session",
                new_callable=AsyncMock,
                return_value=record,
            ),
            patch(
                "api.coderbot.router.ws_manager.broadcast", new_callable=AsyncMock
            ) as mock_broadcast,
        ):
            response = await async_client.patch(
                "/api/coderbot/sessions/u-model",
                json={"model": "new-model:cloud"},
            )

        assert response.status_code == status.HTTP_200_OK
        assert response.json()["model"] == "new-model:cloud"
        saved = await PiSession.find_one(PiSession.uid == "u-model")
        assert saved.model == "new-model:cloud"
        mock_broadcast.assert_awaited_once()
        assert mock_broadcast.call_args.args[0].type == "SESSION_UPDATED"
    finally:
        app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_patch_session_clears_model_with_blank(async_client, init_mock_db):
    """A blank model clears the override so the session falls back to default."""
    from core.models.models import PiSession, PiSessionKind, PiSessionStatus

    _authenticate()
    try:
        record = PiSession(
            uid="u-model",
            kind=PiSessionKind.INTERACTIVE,
            status=PiSessionStatus.PAUSED,
            pipeline_id="p1",
            model="old-model:cloud",
        )
        await record.insert()

        with (
            patch(
                "api.coderbot.router.coderbot_manager.get_session",
                new_callable=AsyncMock,
                return_value=record,
            ),
            patch("api.coderbot.router.ws_manager.broadcast", new_callable=AsyncMock),
        ):
            response = await async_client.patch(
                "/api/coderbot/sessions/u-model", json={"model": "   "}
            )

        assert response.status_code == status.HTTP_200_OK
        assert response.json()["model"] is None
        saved = await PiSession.find_one(PiSession.uid == "u-model")
        assert saved.model is None
    finally:
        app.dependency_overrides.clear()
