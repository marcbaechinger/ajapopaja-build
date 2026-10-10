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

import asyncio
import importlib
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api.coderbot.manager import (
    CoderBotManager,
    InteractiveSessionAlreadyActiveError,
    InteractiveSessionBusyError,
    InteractiveSessionNotSupportedError,
    NoActiveInteractiveSessionError,
)
from api.websocket_manager import WSMessage
from core import config
from core.models.models import (
    PiSession,
    PiSessionKind,
    PiSessionStatus,
    Task,
    TaskStatus,
)


@pytest.mark.asyncio
async def test_config_per_component_defaults_to_ollama(monkeypatch):
    monkeypatch.setenv("OLLAMA_MODEL", "global-model")
    monkeypatch.delenv("ASSISTANT_MODEL", raising=False)
    monkeypatch.delenv("ARCHBOT_MODEL", raising=False)
    monkeypatch.delenv("REVIEWBOT_MODEL", raising=False)
    monkeypatch.delenv("DOCBOT_MODEL", raising=False)
    importlib.reload(config)
    assert config.ASSISTANT_MODEL == "global-model"
    assert config.ARCHBOT_MODEL == "global-model"
    assert config.REVIEWBOT_MODEL == "global-model"
    assert config.DOCBOT_MODEL == "global-model"


@pytest.mark.asyncio
async def test_config_per_component_overrides(monkeypatch):
    monkeypatch.setenv("ARCHBOT_MODEL", "cloud-x")
    importlib.reload(config)
    assert config.ARCHBOT_MODEL == "cloud-x"
    assert config.ASSISTANT_MODEL == config.OLLAMA_MODEL


@pytest.mark.asyncio
async def test_config_coderbot_model_precedence(monkeypatch):
    monkeypatch.setenv("CODERBOT_MODEL", "coderbot-alias")
    monkeypatch.setenv("CODERBOT_DEFAULT_MODEL", "coderbot-legacy")
    importlib.reload(config)
    assert config.CODERBOT_MODEL == "coderbot-alias"

    monkeypatch.delenv("CODERBOT_MODEL", raising=False)
    monkeypatch.setenv("CODERBOT_DEFAULT_MODEL", "coderbot-legacy")
    importlib.reload(config)
    assert config.CODERBOT_MODEL == "coderbot-legacy"

    monkeypatch.delenv("CODERBOT_MODEL", raising=False)
    monkeypatch.delenv("CODERBOT_DEFAULT_MODEL", raising=False)
    importlib.reload(config)
    assert config.CODERBOT_MODEL is None


@pytest.mark.asyncio
async def test_config_host_and_api_default():
    importlib.reload(config)
    assert config.ASSISTANT_HOST == config.OLLAMA_HOST
    assert config.REVIEWBOT_API_KEY == config.OLLAMA_API_KEY


@pytest.mark.asyncio
async def test_config_default_model_none_when_unset(monkeypatch):
    monkeypatch.delenv("CODERBOT_DEFAULT_MODEL", raising=False)
    importlib.reload(config)
    assert config.CODERBOT_DEFAULT_MODEL is None


@pytest.mark.asyncio
async def test_config_default_model_reflects_env(monkeypatch):
    monkeypatch.setenv("CODERBOT_DEFAULT_MODEL", "env-model:cloud")
    importlib.reload(config)
    assert config.CODERBOT_DEFAULT_MODEL == "env-model:cloud"


@pytest.mark.asyncio
async def test_manager_initializes_with_config_default_model(monkeypatch):
    monkeypatch.setenv("CODERBOT_DEFAULT_MODEL", "env-model:cloud")
    importlib.reload(config)
    manager = CoderBotManager()
    assert manager._default_model == "env-model:cloud"


@pytest.mark.asyncio
async def test_manager_default_model_is_none(monkeypatch):
    monkeypatch.delenv("CODERBOT_DEFAULT_MODEL", raising=False)
    importlib.reload(config)
    manager = CoderBotManager()
    assert manager._default_model is None


@pytest.mark.asyncio
async def test_manager_set_default_model():
    manager = CoderBotManager()
    manager.set_default_model("custom-model:cloud")
    assert manager._default_model == "custom-model:cloud"

    manager.set_default_model(None)
    assert manager._default_model is None


@pytest.mark.asyncio
async def test_manager_process_task_passes_default_model(init_mock_db):
    manager = CoderBotManager()
    manager.set_default_model("custom-model:cloud")

    task = MagicMock()
    task.pipeline_id = "p1"
    task.id = "t1"

    with patch("api.coderbot.manager.CoderBotSession") as mock_session_cls:
        await manager.process_task(task)

        assert mock_session_cls.call_count == 1
        kwargs = mock_session_cls.call_args.kwargs
        assert kwargs["pipeline_id"] == "p1"
        assert kwargs["task_id"] == "t1"
        assert kwargs["model"] == "custom-model:cloud"
        assert kwargs["session_uid"]
        assert kwargs["session_record"] is not None


@pytest.mark.asyncio
async def test_manager_process_task_passes_none_model_by_default(
    monkeypatch, init_mock_db
):
    monkeypatch.delenv("CODERBOT_DEFAULT_MODEL", raising=False)
    importlib.reload(config)
    manager = CoderBotManager()

    task = MagicMock()
    task.pipeline_id = "p1"
    task.id = "t1"

    with patch("api.coderbot.manager.CoderBotSession") as mock_session_cls:
        await manager.process_task(task)

        assert mock_session_cls.call_count == 1
        kwargs = mock_session_cls.call_args.kwargs
        assert kwargs["pipeline_id"] == "p1"
        assert kwargs["task_id"] == "t1"
        assert kwargs["model"] is None
        assert kwargs["session_uid"]
        assert kwargs["session_record"] is not None


@pytest.mark.asyncio
async def test_manager_process_task_seeds_label_with_task_title(init_mock_db):
    """A batch CoderBot session is seeded with the task title as its label."""
    manager = CoderBotManager()

    task = MagicMock()
    task.pipeline_id = "p1"
    task.id = "t1"
    task.title = "Implement the widget"

    with patch("api.coderbot.manager.CoderBotSession") as mock_session_cls:
        await manager.process_task(task)
        record = mock_session_cls.call_args.kwargs["session_record"]

    assert record.label == "Implement the widget"

    stored = await PiSession.find_one(PiSession.uid == record.uid)
    assert stored is not None
    assert stored.label == "Implement the widget"


@pytest.mark.asyncio
async def test_manager_process_task_marks_scheduled_task_in_progress(init_mock_db):
    """A queued SCHEDULED task is transitioned to INPROGRESS at enqueue time."""
    manager = CoderBotManager()

    task = Task(title="Queued task", pipeline_id="p1", status=TaskStatus.SCHEDULED)
    await task.insert()

    with (
        patch("api.coderbot.manager.CoderBotSession"),
        patch.object(manager, "_ensure_worker_running"),
        patch(
            "api.coderbot.manager.ws_manager.broadcast", new_callable=AsyncMock
        ) as mock_broadcast,
    ):
        await manager.process_task(task)

    updated = await Task.get(str(task.id))
    assert updated.status == TaskStatus.INPROGRESS
    transitions = [(t.from_status, t.to_status, t.by) for t in updated.history]
    assert (TaskStatus.SCHEDULED, TaskStatus.INPROGRESS, "coderbot") in transitions

    status_msgs = [
        c
        for c in mock_broadcast.await_args_list
        if isinstance(c.args[0], WSMessage) and c.args[0].type == "TASK_STATUS_UPDATED"
    ]
    assert len(status_msgs) == 1
    payload = status_msgs[0].args[0].payload
    assert payload["id"] == str(task.id)
    assert payload["status"] == TaskStatus.INPROGRESS


@pytest.mark.asyncio
async def test_manager_process_task_marks_created_task_in_progress(init_mock_db):
    """A queued CREATED task is also transitioned to INPROGRESS at enqueue time."""
    manager = CoderBotManager()

    task = Task(title="New task", pipeline_id="p1", status=TaskStatus.CREATED)
    await task.insert()

    with (
        patch("api.coderbot.manager.CoderBotSession"),
        patch.object(manager, "_ensure_worker_running"),
        patch(
            "api.coderbot.manager.ws_manager.broadcast", new_callable=AsyncMock
        ) as mock_broadcast,
    ):
        await manager.process_task(task)

    updated = await Task.get(str(task.id))
    assert updated.status == TaskStatus.INPROGRESS
    transitions = [(t.from_status, t.to_status, t.by) for t in updated.history]
    assert (TaskStatus.CREATED, TaskStatus.INPROGRESS, "coderbot") in transitions

    status_msgs = [
        c
        for c in mock_broadcast.await_args_list
        if isinstance(c.args[0], WSMessage) and c.args[0].type == "TASK_STATUS_UPDATED"
    ]
    assert len(status_msgs) == 1
    assert status_msgs[0].args[0].payload["status"] == TaskStatus.INPROGRESS


@pytest.mark.asyncio
async def test_manager_process_task_skips_transition_for_non_queueable_status(
    init_mock_db,
):
    """A task already INPROGRESS is neither transitioned nor broadcast, but queued."""
    manager = CoderBotManager()

    task = Task(title="Running task", pipeline_id="p1", status=TaskStatus.INPROGRESS)
    await task.insert()

    with (
        patch("api.coderbot.manager.CoderBotSession"),
        patch.object(manager, "_ensure_worker_running"),
        patch(
            "api.coderbot.manager.task_queries.transition_task",
            new_callable=AsyncMock,
        ) as mock_transition,
        patch(
            "api.coderbot.manager.ws_manager.broadcast", new_callable=AsyncMock
        ) as mock_broadcast,
    ):
        await manager.process_task(task)

    mock_transition.assert_not_called()
    mock_broadcast.assert_not_awaited()
    assert manager._queue.qsize() == 1

    updated = await Task.get(str(task.id))
    assert updated.status == TaskStatus.INPROGRESS


@pytest.mark.asyncio
async def test_manager_process_task_transitions_before_enqueue(init_mock_db):
    """The INPROGRESS transition must happen before the session is enqueued."""
    manager = CoderBotManager()

    task = Task(title="Ordered task", pipeline_id="p1", status=TaskStatus.SCHEDULED)
    await task.insert()

    observed_statuses = []
    original_put = manager._queue.put

    async def recording_put(session):
        observed_statuses.append(task.status)
        await original_put(session)

    with (
        patch("api.coderbot.manager.CoderBotSession"),
        patch.object(manager, "_ensure_worker_running"),
        patch.object(manager._queue, "put", side_effect=recording_put),
        patch("api.coderbot.manager.ws_manager.broadcast", new_callable=AsyncMock),
    ):
        await manager.process_task(task)

    assert observed_statuses == [TaskStatus.INPROGRESS]


@pytest.mark.asyncio
async def test_manager_process_task_enqueues_when_transition_fails(init_mock_db):
    """A failed enqueue-time transition must not prevent enqueueing the session."""
    manager = CoderBotManager()

    task = Task(title="Resilient task", pipeline_id="p1", status=TaskStatus.SCHEDULED)
    await task.insert()

    with (
        patch("api.coderbot.manager.CoderBotSession"),
        patch.object(manager, "_ensure_worker_running"),
        patch(
            "api.coderbot.manager.task_queries.transition_task",
            new_callable=AsyncMock,
            side_effect=RuntimeError("db unavailable"),
        ),
        patch(
            "api.coderbot.manager.ws_manager.broadcast", new_callable=AsyncMock
        ) as mock_broadcast,
    ):
        await manager.process_task(task)

    assert manager._queue.qsize() == 1
    mock_broadcast.assert_not_awaited()

    # The task is left untouched; CoderBotSession.run() will retry the transition.
    updated = await Task.get(str(task.id))
    assert updated.status == TaskStatus.SCHEDULED


@pytest.mark.asyncio
async def test_manager_process_pr_iteration_seeds_label_with_task_title(init_mock_db):
    """A PR-iteration CoderBot session is also seeded with the task title."""
    manager = CoderBotManager()

    task = Task(title="Iterate the widget", pipeline_id="p1")
    await task.insert()

    pr = MagicMock()
    pr.id = "pr1"
    pr.pipeline_id = "p1"
    pr.task_id = str(task.id)
    pr.subject = "Stale subject"

    with patch("api.coderbot.manager.CoderBotSession") as mock_session_cls:
        await manager.process_pr_iteration(pr, "please fix the review")
        record = mock_session_cls.call_args.kwargs["session_record"]

    assert record.label == "Iterate the widget"


@pytest.mark.asyncio
async def test_stop_session_active():
    manager = CoderBotManager()

    # Mock session
    mock_session = MagicMock()
    mock_session.task_id = "test_task"
    mock_session.run = asyncio.Future()
    mock_session.run.set_result(None)

    manager._active_session = mock_session

    stopped = manager.stop_session("test_task")

    assert stopped is True
    mock_session.stop.assert_called_once()


@pytest.mark.asyncio
async def test_stop_session_inactive():
    manager = CoderBotManager()

    # No active session
    stopped = manager.stop_session("test_task")
    assert stopped is False

    # Active session with different task_id
    mock_session = MagicMock()
    mock_session.task_id = "other_task"
    manager._active_session = mock_session

    stopped = manager.stop_session("test_task")
    assert stopped is False
    mock_session.stop.assert_not_called()


@pytest.mark.asyncio
async def test_manager_tracks_active_session():
    manager = CoderBotManager()

    class MockSession:
        def __init__(self, task_id):
            self.task_id = task_id
            self.pipeline_id = "p1"
            self.stop_called = False
            self.started_event = asyncio.Event()

        async def run(self):
            self.started_event.set()
            # Simulate running
            await asyncio.sleep(0.5)

        def stop(self):
            self.stop_called = True

    session = MockSession("test_task")

    # Use patch to prevent real CoderBotSession instantiation in process_task
    # or just manually enqueue since we want to test the queue processing logic
    await manager._queue.put(session)

    worker_task = asyncio.create_task(manager._process_queue())

    await session.started_event.wait()

    # Ensure it's tracked as active
    assert manager._active_session == session

    # Stop it
    stopped = manager.stop_session("test_task")
    assert stopped is True
    assert session.stop_called is True

    # Cleanup
    worker_task.cancel()
    try:
        await worker_task
    except asyncio.CancelledError:
        pass


@pytest.mark.asyncio
async def test_get_active_session_returns_none_when_no_session():
    manager = CoderBotManager()
    assert manager.get_active_session() is None


@pytest.mark.asyncio
async def test_get_active_session_returns_active_session():
    manager = CoderBotManager()
    mock = MagicMock()
    mock.pipeline_id = "p1"
    mock.task_id = "t1"
    mock.start_time = None
    mock.session_uid = None
    mock.model = None
    manager._active_session = mock
    assert manager.get_active_session() == {
        "pipeline_id": "p1",
        "task_id": "t1",
        "session_uid": None,
        "is_active": True,
        "start_time": None,
        "model": None,
    }


@pytest.mark.asyncio
async def test_get_active_session_returns_last_session_inactive():
    manager = CoderBotManager()
    mock = MagicMock()
    mock.pipeline_id = "p1"
    mock.task_id = "t1"
    mock.start_time = None
    mock.session_uid = None
    mock.model = None
    manager._last_session = mock
    assert manager.get_active_session() == {
        "pipeline_id": "p1",
        "task_id": "t1",
        "session_uid": None,
        "is_active": False,
        "start_time": None,
        "model": None,
    }


@pytest.mark.asyncio
async def test_get_active_session_includes_start_time():
    from datetime import UTC, datetime

    manager = CoderBotManager()
    mock = MagicMock()
    mock.pipeline_id = "p1"
    mock.task_id = "t1"
    mock.start_time = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
    mock.session_uid = None
    mock.model = None
    manager._active_session = mock
    assert manager.get_active_session() == {
        "pipeline_id": "p1",
        "task_id": "t1",
        "session_uid": None,
        "is_active": True,
        "start_time": "2026-01-02T03:04:05+00:00",
        "model": None,
    }


# ---------------------------------------------------------------------------
# Interactive session management
# ---------------------------------------------------------------------------


def _interactive_session_mock(**overrides):
    session = MagicMock()
    session.pipeline_id = "p1"
    session.bot_type = "interactive"
    session.session_uid = "u1"
    session.session_id = None
    session.session_file = None
    session.session_dir = None
    session.start_time = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
    session.model = None
    session.start_interactive = AsyncMock()
    session.stop = AsyncMock()
    session.wait = AsyncMock(return_value=None)
    # Pretend the session already emitted its own start broadcast by default.
    session._started_broadcast = True
    session._stopped_broadcast = False
    for key, value in overrides.items():
        setattr(session, key, value)
    return session


@pytest.mark.asyncio
async def test_start_interactive_session_rejects_second_session():
    manager = CoderBotManager()
    manager._interactive_session = MagicMock()
    pipeline = MagicMock()
    pipeline.repo_uri = "https://github.com/example/repo.git"

    with pytest.raises(InteractiveSessionAlreadyActiveError):
        await manager.start_interactive_session(pipeline)


@pytest.mark.asyncio
async def test_start_interactive_session_requires_remote_repo():
    manager = CoderBotManager()
    pipeline = MagicMock()
    pipeline.repo_uri = None

    with pytest.raises(InteractiveSessionNotSupportedError):
        await manager.start_interactive_session(pipeline)


@pytest.mark.asyncio
async def test_start_interactive_session_runs_in_remote_repo_without_sandbox(
    init_mock_db,
):
    manager = CoderBotManager()
    manager.set_default_model("custom-model:cloud")

    pipeline = MagicMock()
    pipeline.id = "p1"
    pipeline.repo_uri = "https://github.com/example/repo.git"
    pipeline.workspace_abs_path = "/tmp/remote/repo"

    session = _interactive_session_mock()

    with (
        patch(
            "api.coderbot.manager.git_utils.ensure_repo_cloned", new_callable=AsyncMock
        ) as mock_clone,
        patch(
            "api.coderbot.manager.InteractivePiSession", return_value=session
        ) as mock_cls,
        patch.object(manager, "_watch_interactive_session", new_callable=AsyncMock),
        patch("api.coderbot.manager.ws_manager.broadcast", new_callable=AsyncMock),
        patch("api.coderbot.manager.CoderBotSession") as mock_batch,
    ):
        info = await manager.start_interactive_session(pipeline)

    mock_clone.assert_awaited_once_with(pipeline)
    mock_cls.assert_called_once()
    kwargs = mock_cls.call_args.kwargs
    assert kwargs["model"] == "custom-model:cloud"
    assert kwargs["cwd"] == "/tmp/remote/repo"
    assert kwargs["pipeline_id"] == "p1"
    assert kwargs["session_uid"]
    session.start_interactive.assert_awaited_once_with(cwd="/tmp/remote/repo")
    # No batch/sandbox session is created for an interactive session.
    mock_batch.assert_not_called()
    assert manager._interactive_session is session
    assert info["pipeline_id"] == "p1"
    assert info["uid"] == "u1"
    assert info["is_active"] is True
    assert info["busy"] is False
    assert info["start_time"] == "2026-01-02T03:04:05+00:00"


@pytest.mark.asyncio
async def test_start_interactive_session_broadcasts_started(init_mock_db):
    manager = CoderBotManager()
    pipeline = MagicMock()
    pipeline.id = "p1"
    pipeline.repo_uri = "https://github.com/example/repo.git"
    pipeline.workspace_abs_path = "/tmp/remote/repo"

    session = _interactive_session_mock(_started_broadcast=False)

    with (
        patch(
            "api.coderbot.manager.git_utils.ensure_repo_cloned", new_callable=AsyncMock
        ),
        patch("api.coderbot.manager.InteractivePiSession", return_value=session),
        patch.object(manager, "_watch_interactive_session", new_callable=AsyncMock),
        patch(
            "api.coderbot.manager.ws_manager.broadcast", new_callable=AsyncMock
        ) as mock_broadcast,
    ):
        await manager.start_interactive_session(pipeline)

    started = [
        c.args[0]
        for c in mock_broadcast.await_args_list
        if c.args[0].type == "INTERACTIVE_STARTED"
    ]
    assert len(started) == 1
    assert started[0].payload["pipeline_id"] == "p1"
    assert started[0].payload["bot_type"] == "interactive"


@pytest.mark.asyncio
async def test_get_interactive_session_returns_info():
    manager = CoderBotManager()
    assert manager.get_interactive_session() is None

    session = _interactive_session_mock()
    manager._interactive_session = session
    assert manager.get_interactive_session() == {
        "pipeline_id": "p1",
        "uid": "u1",
        "is_active": True,
        "start_time": "2026-01-02T03:04:05+00:00",
        "busy": False,
        "model": None,
    }


@pytest.mark.asyncio
async def test_send_interactive_message_requires_session():
    manager = CoderBotManager()
    with pytest.raises(NoActiveInteractiveSessionError):
        await manager.send_interactive_message("hello")


@pytest.mark.asyncio
async def test_send_interactive_message_rejects_when_busy():
    manager = CoderBotManager()
    manager._interactive_session = _interactive_session_mock()

    async def _never():
        await asyncio.sleep(3600)

    manager._interactive_turn_task = asyncio.create_task(_never())
    try:
        with pytest.raises(InteractiveSessionBusyError):
            await manager.send_interactive_message("again")
    finally:
        manager._interactive_turn_task.cancel()
        try:
            await manager._interactive_turn_task
        except asyncio.CancelledError:
            pass


@pytest.mark.asyncio
async def test_send_interactive_message_spawns_background_turn():
    manager = CoderBotManager()
    session = _interactive_session_mock()
    manager._interactive_session = session

    with patch.object(
        manager, "_drive_interactive_turn", new_callable=AsyncMock
    ) as mock_drive:
        await manager.send_interactive_message("hello")
        assert manager._interactive_turn_task is not None
        await manager._interactive_turn_task

    mock_drive.assert_awaited_once_with(session, "hello")


@pytest.mark.asyncio
async def test_drive_interactive_turn_broadcasts_turn_ended():
    manager = CoderBotManager()

    class FakeInteractiveSession:
        pipeline_id = "p1"
        bot_type = "interactive"

        async def send_user_message(self, text):
            yield "chunk"

    with patch(
        "api.coderbot.manager.ws_manager.broadcast", new_callable=AsyncMock
    ) as mock_broadcast:
        await manager._drive_interactive_turn(FakeInteractiveSession(), "hi")

    types = [c.args[0].type for c in mock_broadcast.await_args_list]
    assert "INTERACTIVE_TURN_ENDED" in types
    assert manager._interactive_turn_task is None


@pytest.mark.asyncio
async def test_drive_interactive_turn_broadcasts_error_on_failure():
    manager = CoderBotManager()

    class FailingInteractiveSession:
        pipeline_id = "p1"
        bot_type = "interactive"

        async def send_user_message(self, text):
            raise RuntimeError("boom")
            yield ""  # pragma: no cover - marks this an async generator

    with patch(
        "api.coderbot.manager.ws_manager.broadcast", new_callable=AsyncMock
    ) as mock_broadcast:
        await manager._drive_interactive_turn(FailingInteractiveSession(), "hi")

    errors = [
        c.args[0]
        for c in mock_broadcast.await_args_list
        if c.args[0].type == "INTERACTIVE_ERROR"
    ]
    assert len(errors) == 1
    assert errors[0].payload["message"] == "boom"
    assert manager._interactive_turn_task is None


@pytest.mark.asyncio
async def test_stop_interactive_session_terminates_and_clears():
    manager = CoderBotManager()
    session = _interactive_session_mock()
    manager._interactive_session = session

    with patch(
        "api.coderbot.manager.ws_manager.broadcast", new_callable=AsyncMock
    ) as mock_broadcast:
        stopped = await manager.stop_interactive_session()

    assert stopped is True
    session.stop.assert_awaited_once()
    assert manager._interactive_session is None
    stopped_msgs = [
        c.args[0]
        for c in mock_broadcast.await_args_list
        if c.args[0].type == "INTERACTIVE_STOPPED"
    ]
    assert len(stopped_msgs) == 1


@pytest.mark.asyncio
async def test_stop_interactive_session_returns_false_without_session():
    manager = CoderBotManager()
    assert await manager.stop_interactive_session() is False


@pytest.mark.asyncio
async def test_watch_interactive_session_broadcasts_stopped_on_unexpected_exit():
    manager = CoderBotManager()
    session = _interactive_session_mock()
    manager._interactive_session = session

    with patch(
        "api.coderbot.manager.ws_manager.broadcast", new_callable=AsyncMock
    ) as mock_broadcast:
        await manager._watch_interactive_session(session)

    assert manager._interactive_session is None
    stopped_msgs = [
        c.args[0]
        for c in mock_broadcast.await_args_list
        if c.args[0].type == "INTERACTIVE_STOPPED"
    ]
    assert len(stopped_msgs) == 1


@pytest.mark.asyncio
async def test_batch_and_interactive_sessions_coexist():
    manager = CoderBotManager()
    batch = MagicMock()
    interactive = MagicMock()
    manager._active_session = batch
    manager._interactive_session = interactive

    assert manager._active_session is batch
    assert manager._interactive_session is interactive


# ---------------------------------------------------------------------------
# Durable session registry lifecycle
# ---------------------------------------------------------------------------
def _pipeline():
    pipeline = MagicMock()
    pipeline.id = "p1"
    pipeline.repo_uri = "https://github.com/example/repo.git"
    pipeline.workspace_abs_path = "/tmp/remote/repo"
    return pipeline


@pytest.mark.asyncio
async def test_registry_create_pause_resume_list_discard(init_mock_db):
    manager = CoderBotManager()
    session = _interactive_session_mock(_started_broadcast=False)

    with (
        patch(
            "api.coderbot.manager.git_utils.ensure_repo_cloned", new_callable=AsyncMock
        ),
        patch("api.coderbot.manager.InteractivePiSession", return_value=session),
        patch.object(manager, "_watch_interactive_session", new_callable=AsyncMock),
        patch("api.coderbot.manager.ws_manager.broadcast", new_callable=AsyncMock),
    ):
        record = await manager.create_interactive_session(_pipeline())

        assert record.status == PiSessionStatus.RUNNING
        assert record.uid in manager._sessions

        listed = await manager.list_sessions(kind=PiSessionKind.INTERACTIVE)
        assert [r.uid for r in listed] == [record.uid]

        assert await manager.pause_session(record.uid) is True
        paused = await manager.get_session(record.uid)
        assert paused.status == PiSessionStatus.PAUSED

        resumed = await manager.resume_session(record.uid)
        assert resumed.status == PiSessionStatus.RUNNING
        assert resumed.resume_count == 1

        assert await manager.discard_session(record.uid) is True
        assert record.uid not in manager._sessions
        discarded = await PiSession.find_one(PiSession.uid == record.uid)
        assert discarded.status == PiSessionStatus.DISCARDED


@pytest.mark.asyncio
async def test_pause_current_when_resuming(init_mock_db):
    manager = CoderBotManager()
    session = _interactive_session_mock(_started_broadcast=False)

    with (
        patch(
            "api.coderbot.manager.git_utils.ensure_repo_cloned", new_callable=AsyncMock
        ),
        patch("api.coderbot.manager.InteractivePiSession", return_value=session),
        patch.object(manager, "_watch_interactive_session", new_callable=AsyncMock),
        patch("api.coderbot.manager.ws_manager.broadcast", new_callable=AsyncMock),
    ):
        first = await manager.create_interactive_session(_pipeline())
        second = await manager.create_interactive_session(_pipeline())
        # resume the first session, pausing the currently running second one
        await manager.pause_session(second.uid)
        manager._running_uid = second.uid
        resumed = await manager.resume_session(first.uid, pause_current=True)

    assert resumed.uid == first.uid
    second_record = await manager.get_session(second.uid)
    assert second_record.status == PiSessionStatus.PAUSED


@pytest.mark.asyncio
async def test_reconcile_on_startup_flips_running_to_paused(init_mock_db):
    manager = CoderBotManager()
    record = PiSession(
        uid="u-run",
        kind=PiSessionKind.INTERACTIVE,
        status=PiSessionStatus.RUNNING,
        pipeline_id="p1",
    )
    await record.insert()

    await manager.reconcile_on_startup()

    reloaded = await manager.get_session("u-run")
    assert reloaded.status == PiSessionStatus.PAUSED
    assert reloaded.last_error == "server restarted"


@pytest.mark.asyncio
async def test_discard_unknown_session_raises(init_mock_db):
    from api.coderbot.manager import PiSessionNotFoundError

    manager = CoderBotManager()
    with pytest.raises(PiSessionNotFoundError):
        await manager.discard_session("missing")


@pytest.mark.asyncio
async def test_resume_without_pausing_raises_when_busy(init_mock_db):
    from api.coderbot.manager import PiSessionBusyError

    manager = CoderBotManager()
    record = PiSession(
        uid="uid",
        kind=PiSessionKind.INTERACTIVE,
        status=PiSessionStatus.PAUSED,
        pipeline_id="p1",
    )
    await record.insert()
    manager._running_uid = "other"
    with pytest.raises(PiSessionBusyError):
        await manager.resume_session("uid", pause_current=False)


@pytest.mark.asyncio
async def test_manager_process_task_prefers_pipeline_coderbot_model(init_mock_db):
    """A pipeline's ``coderbot_model`` override is used for batch sessions."""
    from core.models.models import Pipeline

    manager = CoderBotManager()
    manager.set_default_model("default-model:cloud")
    pipeline = Pipeline(name="P", coderbot_model="pipe-model:cloud")
    await pipeline.insert()

    task = MagicMock()
    task.pipeline_id = str(pipeline.id)
    task.id = "t1"

    with (
        patch(
            "api.coderbot.manager.pipeline_queries.get_pipeline_by_id",
            new_callable=AsyncMock,
            return_value=pipeline,
        ),
        patch("api.coderbot.manager.CoderBotSession") as mock_session_cls,
    ):
        await manager.process_task(task)
        kwargs = mock_session_cls.call_args.kwargs

    assert kwargs["model"] == "pipe-model:cloud"
    assert kwargs["session_record"].model == "pipe-model:cloud"


@pytest.mark.asyncio
async def test_manager_process_task_falls_back_to_default_model(init_mock_db):
    """Without a pipeline override the manager default is used."""
    from core.models.models import Pipeline

    manager = CoderBotManager()
    manager.set_default_model("default-model:cloud")
    pipeline = Pipeline(name="P")
    await pipeline.insert()

    task = MagicMock()
    task.pipeline_id = str(pipeline.id)
    task.id = "t1"

    with (
        patch(
            "api.coderbot.manager.pipeline_queries.get_pipeline_by_id",
            new_callable=AsyncMock,
            return_value=pipeline,
        ),
        patch("api.coderbot.manager.CoderBotSession") as mock_session_cls,
    ):
        await manager.process_task(task)
        kwargs = mock_session_cls.call_args.kwargs

    assert kwargs["model"] == "default-model:cloud"


@pytest.mark.asyncio
async def test_manager_process_pr_iteration_prefers_pipeline_model(init_mock_db):
    """PR iteration sessions also honour the pipeline's coderbot_model."""
    from core.models.models import Pipeline

    manager = CoderBotManager()
    manager.set_default_model("default-model:cloud")
    pipeline = Pipeline(name="P", coderbot_model="pr-pipe-model:cloud")
    await pipeline.insert()

    pr = MagicMock()
    pr.id = "pr1"
    pr.pipeline_id = str(pipeline.id)
    pr.task_id = ""
    pr.subject = "Iterate"

    with (
        patch(
            "api.coderbot.manager.pipeline_queries.get_pipeline_by_id",
            new_callable=AsyncMock,
            return_value=pipeline,
        ),
        patch("api.coderbot.manager.CoderBotSession") as mock_session_cls,
    ):
        await manager.process_pr_iteration(pr, "fix it")
        kwargs = mock_session_cls.call_args.kwargs

    assert kwargs["model"] == "pr-pipe-model:cloud"
