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

"""Tests for pipeline-aware assistant model resolution."""

import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from api.assistant.manager import AssistantManager
from core import config
from core.models.models import Pipeline


@pytest.mark.asyncio
async def test_assistant_manager_resolves_pipeline_model(init_mock_db):
    pipeline = Pipeline(name="P", assistant_model="assistant-pipe")
    await pipeline.insert()

    with patch("api.assistant.manager.AssistantSession") as mock_session_cls:
        mock_session_cls.return_value = MagicMock()
        manager = AssistantManager()
        await manager.get_or_create_session(
            "u1", AsyncMock(), pipeline_id=str(pipeline.id)
        )

    assert mock_session_cls.call_args.kwargs["model"] == "assistant-pipe"


@pytest.mark.asyncio
async def test_assistant_manager_falls_back_to_config(init_mock_db, monkeypatch):
    monkeypatch.setattr(config, "ASSISTANT_MODEL", "config-assistant")
    pipeline = Pipeline(name="P")
    await pipeline.insert()

    with patch("api.assistant.manager.AssistantSession") as mock_session_cls:
        mock_session_cls.return_value = MagicMock()
        manager = AssistantManager()
        await manager.get_or_create_session(
            "u1", AsyncMock(), pipeline_id=str(pipeline.id)
        )

    assert mock_session_cls.call_args.kwargs["model"] == "config-assistant"


@pytest.mark.asyncio
async def test_assistant_manager_refreshes_existing_session_model(init_mock_db):
    pipeline = Pipeline(name="P", assistant_model="assistant-refreshed")
    await pipeline.insert()

    manager = AssistantManager()
    manager.sessions["u1"] = MagicMock()
    manager.last_access["u1"] = time.time()

    session = await manager.get_or_create_session(
        "u1", AsyncMock(), pipeline_id=str(pipeline.id)
    )

    assert session.model == "assistant-refreshed"


@pytest.mark.asyncio
async def test_assistant_manager_general_ollama_override(init_mock_db, monkeypatch):
    monkeypatch.setattr(config, "ASSISTANT_MODEL", "config-assistant")
    pipeline = Pipeline(name="P", ollama_model="general-model")
    await pipeline.insert()

    with patch("api.assistant.manager.AssistantSession") as mock_session_cls:
        mock_session_cls.return_value = MagicMock()
        manager = AssistantManager()
        await manager.get_or_create_session(
            "u1", AsyncMock(), pipeline_id=str(pipeline.id)
        )

    assert mock_session_cls.call_args.kwargs["model"] == "general-model"
