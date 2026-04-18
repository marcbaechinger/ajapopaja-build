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


def _nvim_client_call(method: str, params: list) -> Dict:
    """Helper to send JSON-RPC requests to the Neovim socket."""
    if not os.path.exists(NVIM_SOCKET):
        return {
            "success": False,
            "error": f"Neovim socket not found at {NVIM_SOCKET}. Ensure Neovim is running with '--listen {NVIM_SOCKET}'.",
        }

    payload = {
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
        "id": 1,
    }

    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
            s.settimeout(2.0)
            s.connect(NVIM_SOCKET)
            s.sendall(json.dumps(payload).encode("utf-8"))

            try:
                response_data = s.recv(4096)
                if response_data:
                    response = json.loads(response_data.decode("utf-8"))
                    if "error" in response and response["error"]:
                        return {"success": False, "error": response["error"]}
                    return {"success": True, "response": response}
            except socket.timeout:
                return {"success": True, "info": "Command sent, but no response received (timeout)."}

        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


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

        cmd = f"edit {full_path}"
        if line_number:
            cmd += f" | {line_number}"

        return _nvim_client_call("nvim_command", [cmd])

    except Exception as e:
        return {"success": False, "error": str(e)}


@register_tool(tool_type=WRITE_ACCESS)
async def nvim_set_quickfix(
    pipeline_id: str, matches: list, title: str = "Assistant Search Results"
) -> Dict:
    """
    Sets the quickfix list in Neovim to a list of file locations and opens the quickfix window.
    This provides the user with a list of file locations to jump to in their Neovim editor.

    Args:
        pipeline_id: The ID of the pipeline (used to resolve absolute path).
        matches: A list of dicts. Each dict MUST contain:
                 - 'filename': Path to the file relative to the project root.
                 - 'lnum': Line number (1-based).
                 - 'text': Text or description for the quickfix entry.
        title: The title for the quickfix list (optional).
    """
    try:
        pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
        if not pipeline or not pipeline.workspace_abs_path:
            return {"success": False, "error": "Workspace path not found"}

        # Resolve paths to absolute
        resolved_matches = []
        for match in matches:
            if "filename" in match:
                try:
                    full_path = str(safe_join(pipeline.workspace_abs_path, match["filename"]))
                    match["filename"] = full_path
                except ValueError:
                    # If invalid path, we skip or keep relative? Skipping the match might be safer
                    continue
            resolved_matches.append(match)

        # We use Lua to call setqflist and open the window
        # 'r' tells Neovim to replace the current list
        # Passing resolved_matches via arguments to avoid string escaping issues
        lua_script = f"""
        local matches, title = ...
        vim.fn.setqflist(matches, 'r', {{title = title}})
        vim.cmd('copen') -- Automatically open the quickfix window for the user
        """

        return _nvim_client_call("nvim_exec_lua", [lua_script, [resolved_matches, title]])

    except Exception as e:
        return {"success": False, "error": str(e)}

