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

from api.archbot.manager import ArchBotManager
from api.bot.session_config import BaseBotSessionConfig
from api.docbot.manager import DocBotManager
from api.reviewbot.manager import ReviewBotManager
from api.specagent.manager import SpecAgentManager
from core import config
from core.models.models import Pipeline


def _task():
    task = MagicMock()
    task.pipeline_id = "p1"
    task.id = "t1"
    return task


@patch("api.archbot.manager.bot_manager.enqueue", new_callable=AsyncMock)
@patch("api.archbot.manager.ArchBotSession")
@pytest.mark.asyncio
async def test_archbot_manager_passes_per_component_config(
    mock_cls, mock_enqueue, monkeypatch
):
    monkeypatch.setattr(config, "ARCHBOT_MODEL", "arch-model")
    monkeypatch.setattr(config, "ARCHBOT_HOST", "arch-host")
    monkeypatch.setattr(config, "ARCHBOT_API_KEY", "arch-key")
    mock_cls.return_value = MagicMock()

    await ArchBotManager.process_task(_task())

    mock_cls.assert_called_once()
    kwargs = mock_cls.call_args.kwargs
    assert isinstance(kwargs["session_config"], BaseBotSessionConfig)
    assert kwargs["session_config"].model == "arch-model"
    assert kwargs["session_config"].host == "arch-host"
    assert kwargs["session_config"].api_key == "arch-key"
    assert kwargs["task_id"] == "t1"


@patch("api.reviewbot.manager.bot_manager.enqueue", new_callable=AsyncMock)
@patch("api.reviewbot.manager.ReviewBotSession")
@pytest.mark.asyncio
async def test_reviewbot_manager_passes_per_component_config(
    mock_cls, mock_enqueue, monkeypatch
):
    monkeypatch.setattr(config, "REVIEWBOT_MODEL", "review-model")
    monkeypatch.setattr(config, "REVIEWBOT_HOST", "review-host")
    monkeypatch.setattr(config, "REVIEWBOT_API_KEY", "review-key")
    mock_cls.return_value = MagicMock()

    await ReviewBotManager.process_completed_task(_task())

    mock_cls.assert_called_once()
    kwargs = mock_cls.call_args.kwargs
    assert isinstance(kwargs["session_config"], BaseBotSessionConfig)
    assert kwargs["session_config"].model == "review-model"
    assert kwargs["session_config"].host == "review-host"
    assert kwargs["session_config"].api_key == "review-key"


@patch("api.docbot.manager.bot_manager.enqueue", new_callable=AsyncMock)
@patch("api.docbot.manager.DocBotSession")
@pytest.mark.asyncio
async def test_docbot_manager_passes_per_component_config(
    mock_cls, mock_enqueue, monkeypatch
):
    monkeypatch.setattr(config, "DOCBOT_MODEL", "doc-model")
    monkeypatch.setattr(config, "DOCBOT_HOST", "doc-host")
    monkeypatch.setattr(config, "DOCBOT_API_KEY", "doc-key")
    mock_cls.return_value = MagicMock()

    await DocBotManager.process_completed_task(_task())

    mock_cls.assert_called_once()
    kwargs = mock_cls.call_args.kwargs
    assert isinstance(kwargs["session_config"], BaseBotSessionConfig)
    assert kwargs["session_config"].model == "doc-model"
    assert kwargs["session_config"].host == "doc-host"
    assert kwargs["session_config"].api_key == "doc-key"


@patch("api.archbot.manager.bot_manager.enqueue", new_callable=AsyncMock)
@patch("api.archbot.manager.ArchBotSession")
@patch(
    "api.archbot.manager.pipeline_queries.get_pipeline_by_id",
    new_callable=AsyncMock,
)
@pytest.mark.asyncio
async def test_archbot_manager_prefers_pipeline_model_override(
    mock_get_pipeline, mock_cls, mock_enqueue, monkeypatch, init_mock_db
):
    monkeypatch.setattr(config, "ARCHBOT_MODEL", "config-arch")
    mock_get_pipeline.return_value = Pipeline(name="p", archbot_model="pipe-arch")
    mock_cls.return_value = MagicMock()

    await ArchBotManager.process_task(_task())

    assert mock_get_pipeline.await_args.args[0] == "p1"
    assert mock_cls.call_args.kwargs["session_config"].model == "pipe-arch"


@patch("api.reviewbot.manager.bot_manager.enqueue", new_callable=AsyncMock)
@patch("api.reviewbot.manager.ReviewBotSession")
@patch(
    "api.reviewbot.manager.pipeline_queries.get_pipeline_by_id",
    new_callable=AsyncMock,
)
@pytest.mark.asyncio
async def test_reviewbot_manager_uses_general_ollama_override(
    mock_get_pipeline, mock_cls, mock_enqueue, monkeypatch, init_mock_db
):
    monkeypatch.setattr(config, "REVIEWBOT_MODEL", "config-review")
    mock_get_pipeline.return_value = Pipeline(name="p", ollama_model="general-x")
    mock_cls.return_value = MagicMock()

    await ReviewBotManager.process_completed_task(_task())

    assert mock_cls.call_args.kwargs["session_config"].model == "general-x"


@patch("api.docbot.manager.bot_manager.enqueue", new_callable=AsyncMock)
@patch("api.docbot.manager.DocBotSession")
@patch(
    "api.docbot.manager.pipeline_queries.get_pipeline_by_id",
    new_callable=AsyncMock,
)
@pytest.mark.asyncio
async def test_docbot_manager_falls_back_to_config_when_no_override(
    mock_get_pipeline, mock_cls, mock_enqueue, monkeypatch, init_mock_db
):
    monkeypatch.setattr(config, "DOCBOT_MODEL", "config-doc")
    mock_get_pipeline.return_value = Pipeline(name="p")
    mock_cls.return_value = MagicMock()

    await DocBotManager.process_completed_task(_task())

    assert mock_cls.call_args.kwargs["session_config"].model == "config-doc"


@patch("api.specagent.manager.bot_manager.enqueue", new_callable=AsyncMock)
@patch("api.specagent.manager.SpecAgentSession")
@pytest.mark.asyncio
async def test_specagent_manager_passes_per_component_config(
    mock_cls, mock_enqueue, monkeypatch
):
    monkeypatch.setattr(config, "SPECAGENT_MODEL", "spec-model")
    monkeypatch.setattr(config, "SPECAGENT_HOST", "spec-host")
    monkeypatch.setattr(config, "SPECAGENT_API_KEY", "spec-key")
    mock_cls.return_value = MagicMock()

    await SpecAgentManager.process_task(_task())

    mock_cls.assert_called_once()
    kwargs = mock_cls.call_args.kwargs
    assert isinstance(kwargs["session_config"], BaseBotSessionConfig)
    assert kwargs["session_config"].model == "spec-model"
    assert kwargs["session_config"].host == "spec-host"
    assert kwargs["session_config"].api_key == "spec-key"
    assert kwargs["task_id"] == "t1"


@patch("api.specagent.manager.bot_manager.enqueue", new_callable=AsyncMock)
@patch("api.specagent.manager.SpecAgentSession")
@patch(
    "api.specagent.manager.pipeline_queries.get_pipeline_by_id",
    new_callable=AsyncMock,
)
@pytest.mark.asyncio
async def test_specagent_manager_prefers_pipeline_model_override(
    mock_get_pipeline, mock_cls, mock_enqueue, monkeypatch, init_mock_db
):
    monkeypatch.setattr(config, "SPECAGENT_MODEL", "config-spec")
    mock_get_pipeline.return_value = Pipeline(name="p", specagent_model="pipe-spec")
    mock_cls.return_value = MagicMock()

    await SpecAgentManager.process_task(_task())

    assert mock_cls.call_args.kwargs["session_config"].model == "pipe-spec"
