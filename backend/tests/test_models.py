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

from datetime import datetime
from pathlib import Path

import pytest
from pydantic import ValidationError

from core import config
from core.models.models import (
    ChatMessage,
    DesignDocHistory,
    Pipeline,
    PipelineStatus,
    StateTransition,
    Task,
    TaskStatus,
    User,
    UserChat,
)


@pytest.mark.asyncio
async def test_pipeline_version_default(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline")
    assert pipeline.version == 1
    assert pipeline.status == PipelineStatus.ACTIVE
    assert pipeline.deleted is False


@pytest.mark.asyncio
async def test_pipeline_workspace_path_validation(init_mock_db, monkeypatch):
    # Set a known workspaces root
    root = Path("/tmp/workspaces")
    monkeypatch.setattr(config, "WORKSPACES_ROOT", root)

    # Test relative path (normal case)
    pipeline = Pipeline(name="Rel Path", workspace_path="my-project")
    assert pipeline.workspace_path == "my-project"
    assert pipeline.workspace_abs_path == root / "my-project"

    # Test migration of absolute path inside root
    abs_path = root / "another-project"
    pipeline2 = Pipeline(name="Abs Path Inside", workspace_path=str(abs_path))
    assert pipeline2.workspace_path == "another-project"
    assert pipeline2.workspace_abs_path == root / "another-project"

    # Test absolute path outside root (should be nullified)
    outside_path = "/usr/bin/something"
    pipeline3 = Pipeline(name="Outside Path", workspace_path=outside_path)
    assert pipeline3.workspace_path is None
    assert pipeline3.workspace_abs_path is None

    # Test empty/None path
    pipeline4 = Pipeline(name="Empty Path", workspace_path="")
    assert pipeline4.workspace_path == ""
    pipeline5 = Pipeline(name="None Path", workspace_path=None)
    assert pipeline5.workspace_path is None


@pytest.mark.asyncio
async def test_task_defaults_and_history(init_mock_db):
    task = Task(title="Test Task", pipeline_id="123")
    assert task.version == 1
    assert task.status == TaskStatus.CREATED
    assert task.type == "manual"
    assert task.deleted is False
    assert task.history == []

    # Add a state transition
    transition = StateTransition(
        from_status=TaskStatus.CREATED,
        to_status=TaskStatus.SCHEDULED,
        by="user",
    )
    task.history.append(transition)
    task.status = TaskStatus.SCHEDULED
    await task.insert()

    saved_task = await Task.get(task.id)
    assert len(saved_task.history) == 1
    assert saved_task.history[0].to_status == TaskStatus.SCHEDULED
    assert saved_task.history[0].by == "user"
    assert isinstance(saved_task.history[0].timestamp, datetime)


@pytest.mark.asyncio
async def test_task_design_doc(init_mock_db):
    task = Task(
        title="Test Task", pipeline_id="123", design_doc="This is a design doc."
    )
    await task.insert()

    saved_task = await Task.get(task.id)
    assert saved_task.design_doc == "This is a design doc."


@pytest.mark.asyncio
async def test_design_doc_history(init_mock_db):
    history = DesignDocHistory(
        task_id="task_123", version=1, design_doc="First version"
    )
    await history.insert()

    saved = await DesignDocHistory.find_one(DesignDocHistory.task_id == "task_123")
    assert saved.version == 1
    assert saved.design_doc == "First version"


@pytest.mark.asyncio
async def test_user_model(init_mock_db):
    user = User(
        username="johndoe", hashed_password="hashed_password", email="john@example.com"
    )
    await user.insert()

    saved_user = await User.find_one(User.username == "johndoe")
    assert saved_user.email == "john@example.com"
    assert saved_user.disabled is False
    assert isinstance(saved_user.created_at, datetime)


@pytest.mark.asyncio
async def test_user_chat_and_messages(init_mock_db):
    msg = ChatMessage(role="user", content="Hello", thought="Thinking...")
    chat = UserChat(user_id="user_123", history=[msg])
    await chat.insert()

    saved_chat = await UserChat.find_one(UserChat.user_id == "user_123")
    assert len(saved_chat.history) == 1
    assert saved_chat.history[0].role == "user"
    assert saved_chat.history[0].content == "Hello"
    assert saved_chat.history[0].thought == "Thinking..."


@pytest.mark.asyncio
async def test_invalid_task_status():
    # Pydantic should catch invalid status strings
    with pytest.raises(ValidationError):
        Task(title="Invalid", pipeline_id="123", status="invalid_status")
