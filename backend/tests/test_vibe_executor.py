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
import os
from unittest.mock import patch, MagicMock
from core.models.models import Task, TaskStatus, Pipeline, PipelineStatus
from api.vibe_executor import VibeExecutor

@pytest.fixture(autouse=True)
def clear_executor():
    VibeExecutor._processes.clear()
    yield
    VibeExecutor._processes.clear()

@pytest.mark.asyncio
async def test_ensure_running_starts_process(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline", workspace_path="/tmp/test_ws", manage_vibe=True)
    await pipeline.insert()
    pipeline_id = str(pipeline.id)

    with patch("subprocess.Popen") as mock_popen, \
         patch("builtins.open", MagicMock()):
        
        mock_process = MagicMock()
        mock_process.poll.return_value = None
        mock_popen.return_value = mock_process

        await VibeExecutor.ensure_running(pipeline_id)

        assert mock_popen.called
        args, kwargs = mock_popen.call_args
        assert "vibe " in args[0]
        assert f"pipeline {pipeline_id}" in args[0]
        assert kwargs["cwd"] == "/tmp/test_ws"
        assert pipeline_id in VibeExecutor._processes
        assert VibeExecutor._processes[pipeline_id]["process"] == mock_process
        assert "log_file_path" in VibeExecutor._processes[pipeline_id]

@pytest.mark.asyncio
async def test_ensure_running_skips_when_disabled(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline", workspace_path="/tmp/test_ws", manage_vibe=False)
    await pipeline.insert()
    pipeline_id = str(pipeline.id)

    with patch("subprocess.Popen") as mock_popen:
        await VibeExecutor.ensure_running(pipeline_id)
        assert not mock_popen.called
        assert pipeline_id not in VibeExecutor._processes

@pytest.mark.asyncio
async def test_ensure_running_restarts_dead_process(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline", workspace_path="/tmp/test_ws", manage_vibe=True)
    await pipeline.insert()
    pipeline_id = str(pipeline.id)

    with patch("subprocess.Popen") as mock_popen, \
         patch("builtins.open", MagicMock()):
        
        # First call - process starts
        mock_process = MagicMock()
        mock_process.poll.return_value = None
        mock_popen.return_value = mock_process
        
        await VibeExecutor.ensure_running(pipeline_id)
        assert pipeline_id in VibeExecutor._processes
        
        # Second call - process is dead
        mock_process.poll.return_value = 0
        mock_popen.reset_mock()
        
        await VibeExecutor.ensure_running(pipeline_id)
        assert mock_popen.called  # Should restart
        assert pipeline_id in VibeExecutor._processes

@pytest.mark.asyncio
async def test_stop_running(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline", workspace_path="/tmp/test_ws", manage_vibe=True)
    await pipeline.insert()
    pipeline_id = str(pipeline.id)

    with patch("subprocess.Popen") as mock_popen, \
         patch("builtins.open", MagicMock()):
        
        mock_process = MagicMock()
        mock_process.poll.return_value = None
        mock_popen.return_value = mock_process
        
        await VibeExecutor.ensure_running(pipeline_id)
        assert pipeline_id in VibeExecutor._processes
        
        VibeExecutor.stop_running(pipeline_id)
        assert pipeline_id not in VibeExecutor._processes
        mock_process.terminate.assert_called_once()

@pytest.mark.asyncio
async def test_get_status_running(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline", workspace_path="/tmp/test_ws", manage_vibe=True)
    await pipeline.insert()
    pipeline_id = str(pipeline.id)

    with patch("subprocess.Popen") as mock_popen, \
         patch("builtins.open", MagicMock()):
        
        mock_process = MagicMock()
        mock_process.poll.return_value = None
        mock_popen.return_value = mock_process
        
        await VibeExecutor.ensure_running(pipeline_id)
        status = VibeExecutor.get_status(pipeline_id)
        
        assert status["running"] is True
        assert status["log_file"] is not None

@pytest.mark.asyncio
async def test_get_status_not_running(init_mock_db):
    pipeline = Pipeline(name="Test Pipeline", workspace_path="/tmp/test_ws", manage_vibe=True)
    await pipeline.insert()
    pipeline_id = str(pipeline.id)

    status = VibeExecutor.get_status(pipeline_id)
    assert status["running"] is False
    assert status["log_file"] is None

@pytest.mark.asyncio
async def test_stop_all(init_mock_db):
    pipeline1 = Pipeline(name="Test Pipeline 1", workspace_path="/tmp/test_ws", manage_vibe=True)
    pipeline2 = Pipeline(name="Test Pipeline 2", workspace_path="/tmp/test_ws", manage_vibe=True)
    await pipeline1.insert()
    await pipeline2.insert()
    pipeline_id1 = str(pipeline1.id)
    pipeline_id2 = str(pipeline2.id)

    with patch("subprocess.Popen") as mock_popen, \
         patch("builtins.open", MagicMock()):
        
        mock_process = MagicMock()
        mock_process.poll.return_value = None
        mock_popen.return_value = mock_process
        
        await VibeExecutor.ensure_running(pipeline_id1)
        await VibeExecutor.ensure_running(pipeline_id2)
        
        assert len(VibeExecutor._processes) == 2
        
        VibeExecutor.stop_all()
        assert len(VibeExecutor._processes) == 0