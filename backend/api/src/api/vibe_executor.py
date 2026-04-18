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

import os
import subprocess
import logging
import asyncio
import shutil
from typing import Dict, Optional, Any
from datetime import datetime
from core.queries import pipeline as pipeline_queries
from api.websocket_manager import manager, WSMessage

logger = logging.getLogger(__name__)

class VibeExecutor:
    # Maps pipeline_id -> { "process": Popen, "log_file_path": str }
    _processes: Dict[str, Dict[str, Any]] = {}

    @staticmethod
    def is_available() -> bool:
        """Returns True if the vibe CLI is available in the system path."""
        return shutil.which("vibe") is not None

    @classmethod
    async def ensure_running(cls, pipeline_id: str):
        """Ensures that a Vibe CLI process is running for the given pipeline."""
        if pipeline_id in cls._processes:
            entry = cls._processes[pipeline_id]
            process = entry["process"]
            if process.poll() is None:
                # Process is still running
                return
            else:
                logger.info(f"Vibe process for pipeline {pipeline_id} has terminated. Restarting...")
                del cls._processes[pipeline_id]
                await manager.broadcast(WSMessage(
                    type="VIBE_PROCESS_STOPPED",
                    payload={"pipeline_id": pipeline_id}
                ))

        # Fetch pipeline to get workspace_path
        pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
        if not pipeline:
            logger.error(f"Pipeline {pipeline_id} not found. Cannot start Vibe executor.")
            return

        if not pipeline.manage_vibe:
            logger.debug(f"Vibe management is disabled for pipeline {pipeline_id}.")
            return

        # Determine execution directory
        project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../../"))
        cwd = project_root
        if pipeline.workspace_path:
            if os.path.isabs(pipeline.workspace_path):
                cwd = pipeline.workspace_path
            else:
                cwd = os.path.abspath(os.path.join(project_root, pipeline.workspace_path))

        # Create log directory
        log_dir = os.path.join(project_root, ".logs/vibe")
        os.makedirs(log_dir, exist_ok=True)

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        log_file_path = os.path.join(log_dir, f"pipeline_{pipeline_id}_{timestamp}.log")
        
        # Build command for Vibe CLI
        cmd_str = f'vibe "Use the ajapopaja mcp server to get the next task for pipeline {pipeline_id}. Implement the task, verify it, and complete it. Repeat this until there are no more tasks in the pipeline."'

        logger.info(f"Starting Vibe executor for pipeline {pipeline_id} in {cwd}")
        logger.info(f"Logging to {log_file_path}")

        try:
            log_file = open(log_file_path, "a")
            process = subprocess.Popen(
                cmd_str,
                shell=True,
                cwd=cwd,
                stdout=log_file,
                stderr=log_file,
                start_new_session=True
            )
            cls._processes[pipeline_id] = {
                "process": process,
                "log_file_path": log_file_path
            }
            await manager.broadcast(WSMessage(
                type="VIBE_PROCESS_STARTED",
                payload={"pipeline_id": pipeline_id, "log_file_path": log_file_path}
            ))
        except Exception as e:
            logger.error(f"Failed to start Vibe executor for pipeline {pipeline_id}: {e}")

    @classmethod
    def stop_running(cls, pipeline_id: str):
        """Stops the Vibe CLI process for the given pipeline."""
        if pipeline_id in cls._processes:
            entry = cls._processes[pipeline_id]
            process = entry["process"]
            if process.poll() is None:
                logger.info(f"Stopping Vibe executor for pipeline {pipeline_id}")
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
            del cls._processes[pipeline_id]
            # We don't await broadcast here because this is sync
            try:
                loop = asyncio.get_event_loop()
                if loop.is_running():
                    loop.create_task(manager.broadcast(WSMessage(
                        type="VIBE_PROCESS_STOPPED",
                        payload={"pipeline_id": pipeline_id}
                    )))
            except Exception:
                pass

    @classmethod
    def get_status(cls, pipeline_id: str) -> dict:
        """Returns the status of the Vibe CLI process for the given pipeline."""
        status = {
            "running": False,
            "log_file": None,
            "available": cls.is_available()
        }
        if pipeline_id in cls._processes:
            entry = cls._processes[pipeline_id]
            process = entry["process"]
            if process.poll() is None:
                status["running"] = True
                status["log_file"] = entry["log_file_path"]
            else:
                # Clean up stale process
                del cls._processes[pipeline_id]
        
        return status

    @classmethod
    def stop_all(cls):
        """Stops all running Vibe CLI processes."""
        for pipeline_id in list(cls._processes.keys()):
            cls.stop_running(pipeline_id)