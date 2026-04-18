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

import socket
import json
import os
from typing import Dict, Optional
from api.assistant.decorators import register_tool
from core.queries import pipeline as pipeline_queries
from core.utils.path_utils import safe_join
from pathlib import Path

# Tool Categories
WRITE_ACCESS = "write_access"

NVIM_SOCKET = "/tmp/nvimsocket"


@register_tool(tool_type=WRITE_ACCESS)
async def open_file_in_nvim(
    pipeline_id: str, path: str, line_number: Optional[int] = None
) -> Dict:
    """
    Opens a file in a running Neovim instance and jumps to a specific line.
    Connects to a Neovim instance listening on /tmp/nvimsocket using JSON-RPC.

    Args:
        pipeline_id: The ID of the pipeline (used to resolve absolute path).
        path: Path to the file relative to the project root.
        line_number: Optional line number to jump to (1-based).
    """
    try:
        pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
        if not pipeline or not pipeline.workspace_abs_path:
            return {"success": False, "error": "Workspace path not found"}

        try:
            full_path = str(safe_join(pipeline.workspace_abs_path, path))
        except ValueError as e:
            return {"success": False, "error": str(e)}

        if not os.path.exists(NVIM_SOCKET):
            return {
                "success": False,
                "error": f"Neovim socket not found at {NVIM_SOCKET}. Ensure Neovim is running with '--listen {NVIM_SOCKET}'.",
            }

        # Command to open file and jump to line
        # Using nvim_command for simplicity as requested in the design
        cmd = f"edit {full_path}"
        if line_number:
            cmd += f" | {line_number}"

        # Neovim JSON-RPC request format
        # [type, msgid, method, params] for standard RPC
        # But design doc suggests "JSON response indicating success or failure" and "minimal dependencies (socket and json)"
        # Standard JSON-RPC 2.0
        payload = {
            "jsonrpc": "2.0",
            "method": "nvim_command",
            "params": [cmd],
            "id": 1,
        }

        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
            s.settimeout(2.0)
            s.connect(NVIM_SOCKET)
            s.sendall(json.dumps(payload).encode("utf-8"))

            # Wait for response
            try:
                response_data = s.recv(4096)
                if response_data:
                    response = json.loads(response_data.decode("utf-8"))
                    if "error" in response and response["error"]:
                        return {"success": False, "error": response["error"]}
                    return {"success": True, "response": response}
            except socket.timeout:
                # Some configurations might not return a response for nvim_command if it's treated as a notification
                # but we provided an 'id', so it should.
                return {"success": True, "info": "Command sent, but no response received (timeout)."}

        return {"success": True}

    except Exception as e:
        return {"success": False, "error": str(e)}
