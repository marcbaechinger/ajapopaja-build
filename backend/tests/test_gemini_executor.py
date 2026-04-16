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
from unittest.mock import patch, MagicMock
from core.models.models import Task, TaskStatus, Pipeline, PipelineStatus
from api.gemini_executor import GeminiExecutor

@pytest.fixture(autouse=True)
def clear_executor():
    GeminiExecutor._processes.clear()
    yield
    GeminiExecutor._processes.clear()

@pytest.mark.asyncio
async def test_ensure_running_starts_process(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline", workspace_path="/tmp/test_ws")
    await pipeline.insert()
    pipeline_id = str(pipeline.id)

    with patch("subprocess.Popen") as mock_popen, \
         patch("builtins.open", MagicMock()):
        
        mock_process = MagicMock()
        mock_process.poll.return_value = None
        mock_popen.return_value = mock_process

        await GeminiExecutor.ensure_running(pipeline_id)

        assert mock_popen.called
        args, kwargs = mock_popen.call_args
        assert "gemini --approval-mode yolo" in args[0]
        assert f"pipeline {pipeline_id}" in args[0]
        assert kwargs["cwd"] == "/tmp/test_ws"
        assert pipeline_id in GeminiExecutor._processes

@pytest.mark.asyncio
async def test_stop_running(init_mock_db):
    pipeline_id = "test_pipeline"
    mock_process = MagicMock()
    mock_process.poll.return_value = None
    GeminiExecutor._processes[pipeline_id] = mock_process

    GeminiExecutor.stop_running(pipeline_id)

    assert mock_process.terminate.called
    assert pipeline_id not in GeminiExecutor._processes

@pytest.mark.asyncio
async def test_ensure_running_idempotent(init_mock_db):
    pipeline_id = "test_pipeline"
    mock_process = MagicMock()
    mock_process.poll.return_value = None
    GeminiExecutor._processes[pipeline_id] = mock_process

    with patch("subprocess.Popen") as mock_popen:
        await GeminiExecutor.ensure_running(pipeline_id)
        assert not mock_popen.called
