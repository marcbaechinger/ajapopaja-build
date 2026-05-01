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

from ..assistant.tools.nvim_tools import get_nvim_socket_path, is_nvim_available
from ..ollama_utils import is_ollama_available

router = APIRouter(prefix="/system", tags=["system"])


@router.get("/health")
async def health_check() -> Dict:
    """
    Returns the health status of various system components.
    """
    results = {}

    # Ollama Check
    if await is_ollama_available():
        results["ollama"] = {"status": "ok", "details": "Ollama is reachable"}
    else:
        results["ollama"] = {
            "status": "error",
            "details": "Ollama is not responding or not configured correctly",
        }

    # Nvim Socket Check
    try:
        socket_path = get_nvim_socket_path()
        if is_nvim_available():
            results["nvim"] = {
                "status": "ok",
                "details": f"Socket found and verified at {socket_path}",
            }
        else:
            if not os.path.exists(socket_path):
                results["nvim"] = {
                    "status": "error",
                    "details": f"Socket not found at {socket_path}",
                }
            else:
                results["nvim"] = {
                    "status": "error",
                    "details": f"File at {socket_path} is not a socket",
                }
    except Exception as e:
        results["nvim"] = {"status": "error", "details": str(e)}

    return results
