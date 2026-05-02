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
from typing import Dict

from fastapi import APIRouter
from pymongo import AsyncMongoClient


from core.utils import git_utils

from ..assistant.tools.nvim_tools import get_nvim_socket_path, is_nvim_available
from ..ollama_utils import is_ollama_available

router = APIRouter(prefix="/system", tags=["system"])


@router.get("/health")
async def health_check() -> Dict[str, dict]:
    """
    Return a JSON dictionary describing the health of the system
    components that this service is aware of.

    Components reported:
      * mongodb  – requires a connection to the configured MongoDB instance.
      * ollama   – a simple ping to the Ollama HTTP endpoint.
      * nvim     – whether the Neovim socket defined by NVIM_SOCKET is
                    present and is a Unix domain socket.
    """
    results: Dict[str, dict] = {}

    try:
        mongodb_uri = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
        client = AsyncMongoClient(mongodb_uri, serverSelectionTimeoutMS=2000)
        await client.admin.command("ping")
        results["mongodb"] = {"status": "ok", "details": "Connected"}
    except Exception as e:
        results["mongodb"] = {"status": "error", "details": str(e)}

    if await is_ollama_available():
        results["ollama"] = {"status": "ok", "details": "Ollama is reachable"}
    else:
        results["ollama"] = {
            "status": "error",
            "details": "Ollama is not responding or not configured correctly",
        }

    try:
        nvim_socket = get_nvim_socket_path()
        if is_nvim_available():
            results["nvim"] = {
                "status": "ok",
                "details": f"Socket found and verified at {nvim_socket}",
            }
        else:
            if not os.path.exists(nvim_socket):
                results["nvim"] = {
                    "status": "error",
                    "details": f"Socket not found at {nvim_socket}",
                }
            else:
                results["nvim"] = {
                    "status": "error",
                    "details": f"File at {nvim_socket} is not a socket",
                }
    except Exception as e:
        results["nvim"] = {"status": "error", "details": str(e)}

    return results


@router.get("/git-status/{pipeline_id}")
async def get_git_status(pipeline_id: str) -> Dict[str, int]:
    """
    Return a summary of the git status for the workspace associated with
     the given pipeline_id.
    """
    try:
        repo = await git_utils.get_repo_for_pipeline(pipeline_id)
        return git_utils.get_git_status_summary(repo)
    except Exception:
        return {"staged": 0, "unstaged": 0, "untracked": 0}
