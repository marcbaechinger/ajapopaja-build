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

import logging
import os
import socket
import stat
from typing import Any, Dict, Optional

import msgpack

from api.assistant.decorators import register_tool
from core.queries import pipeline as pipeline_queries
from core.utils.path_utils import safe_join

logger = logging.getLogger(__name__)

# Tool Categories
WRITE_ACCESS = "write_access"


def get_nvim_socket_path() -> str:
    """
    Returns the Neovim Unix socket path.
    Defaults to '/tmp/nvimsocket' but can be overridden via NVIM_SOCKET env var.
    """
    return os.getenv("NVIM_SOCKET", "/tmp/nvimsocket")


# Cache for Neovim availability
_nvim_available: bool | None = None


def is_nvim_available() -> bool:
    """
    Checks if Neovim is running and listening on the expected Unix socket.
    The result is cached to avoid repeated file system checks.
    """
    global _nvim_available
    if _nvim_available is not None:
        return _nvim_available

    socket_path = get_nvim_socket_path()
    try:
        if os.path.exists(socket_path):
            mode = os.stat(socket_path).st_mode
            if stat.S_ISSOCK(mode):
                _nvim_available = True
                return True
            else:
                logger.warning(f"File at {socket_path} exists but is not a socket.")
        else:
            logger.info(f"Neovim socket not found at {socket_path}.")
    except Exception as e:
        logger.error(f"Error checking Neovim availability: {e}")

    _nvim_available = False
    return False


def _nvim_client_call(method: str, params: list) -> Dict[str, Any]:
    """Helper to send MessagePack-RPC requests to the Neovim socket."""
    socket_path = get_nvim_socket_path()
    if not is_nvim_available():
        return {
            "success": False,
            "error": (
                f"Neovim socket not found at {socket_path}. "
                f"Ensure Neovim is running with '--listen {socket_path}'."
            ),
        }

    # MessagePack-RPC Request format: [type, msgid, method, params]
    # type 0 = Request
    # msgid = An integer ID to match responses
    payload = [0, 1, method, params]

    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
            s.settimeout(2.0)
            s.connect(socket_path)

            # Use msgpack to pack the list into binary
            s.sendall(bytes(msgpack.packb(payload)))  # type: ignore[arg-type]

            try:
                response_data = s.recv(4096)
                if response_data:
                    # Unpack the binary response
                    # Format: [type, msgid, error, result]
                    response = msgpack.unpackb(response_data)

                    # Index 2 is the 'error' field
                    if response[2] is not None:
                        # decode error msg if it's bytes
                        err = response[2]
                        if (
                            isinstance(err, list)
                            and len(err) > 1
                            and isinstance(err[1], bytes)
                        ):
                            err = err[1].decode("utf-8")
                        elif isinstance(err, bytes):
                            err = err.decode("utf-8")
                        return {"success": False, "error": str(err)}

                    return {"success": True, "response": response[3]}
            except socket.timeout:
                return {
                    "success": True,
                    "info": "Command sent, but no response received (timeout).",
                }

        return {"success": True}
    except Exception as e:
        return {"success": False, "error": str(e)}


@register_tool(tool_type=WRITE_ACCESS, is_available=is_nvim_available)
async def nvim_open_file(
    pipeline_id: str, path: str, line_number: Optional[int] = None
) -> Dict[str, Any]:
    """
    Opens a file in the user's running Neovim instance.
    Optionally jumps to a specific line. Use this tool to display
    a file directly in the user's editor so they can view or edit it.
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

        print(f"opening in vim: {cmd}")

        return _nvim_client_call("nvim_command", [cmd])

    except Exception as e:
        return {"success": False, "error": str(e)}


@register_tool(tool_type=WRITE_ACCESS, is_available=is_nvim_available)
async def nvim_open_selection(
    pipeline_id: str, path: str, start_line: int, end_line: int
) -> Dict[str, Any]:
    """
    Opens a file in a running Neovim instance and selects a range of lines.
    Connects to a Neovim instance listening on /tmp/nvimsocket using JSON-RPC.

    Args:
        pipeline_id: The ID of the pipeline (used to resolve absolute path).
        path: Path to the file relative to the project root.
        start_line: The starting line number of the selection (1-based).
        end_line: The ending line number of the selection (1-based).
    """
    try:
        pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
        if not pipeline or not pipeline.workspace_abs_path:
            return {"success": False, "error": "Workspace path not found"}

        try:
            full_path = str(safe_join(pipeline.workspace_abs_path, path))
        except ValueError as e:
            return {"success": False, "error": str(e)}

        cmd = f"edit {full_path} | {start_line} | normal! V{end_line}G"

        print(f"opening and selecting in vim: {cmd}")

        return _nvim_client_call("nvim_command", [cmd])

    except Exception as e:
        return {"success": False, "error": str(e)}


@register_tool(tool_type=WRITE_ACCESS, is_available=is_nvim_available)
async def nvim_set_quickfix(
    pipeline_id: str, matches: list[dict], title: str = "Assistant Search Results"
) -> Dict[str, Any]:
    """
    Sets the quickfix list in Neovim to a list of file locations.
    This provides the user with a list of file locations to jump to
    in their Neovim editor.

    Args:
        pipeline_id: The ID of the pipeline (used to resolve absolute path).
        matches: A array of dicts. Each dict MUST contain:
            [{"filename": "path/to/file", "lnum": 10, "text": "desc"},...]
        title: The title for the quickfix list (optional).
    """
    try:
        pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
        if not pipeline or not pipeline.workspace_abs_path:
            return {"success": False, "error": "Workspace path not found"}

        # Passing resolved_matches via arguments to avoid string escaping issues
        print(f"raw matches {matches}")
        # Ensure matches is a list
        if isinstance(matches, str):
            # If the LLM sent a raw string, try to parse it
            parsed_matches = []
            for line in matches.strip().split("\n"):
                # Assuming format "path:line" or "path:line:text"
                parts = line.split(":", 2)
                if len(parts) >= 2:
                    parsed_matches.append(
                        {
                            "filename": parts[0].strip(),
                            "lnum": int(parts[1].strip())
                            if parts[1].strip().isdigit()
                            else 1,
                            "text": parts[2].strip() if len(parts) > 2 else line,
                        }
                    )
            matches = parsed_matches

        # Now your existing path resolution logic will work on a list of dicts
        resolved_matches = []
        for match in matches:
            # Check if match is actually a dict
            if not isinstance(match, dict):
                continue
            if "filename" in match:
                try:
                    full_path = str(
                        safe_join(pipeline.workspace_abs_path, match["filename"])
                    )
                    match["filename"] = full_path
                except ValueError:
                    continue
            resolved_matches.append(match)

        # We use Lua to call setqflist and open the window
        # 'r' tells Neovim to replace the current list
        # Passing resolved_matches via arguments to avoid string escaping issues
        print(f"resolved matches {resolved_matches}")
        lua_script = """
        local matches, title = ...  
        vim.fn.setqflist({}, 'r', { title = title, items = matches })
        vim.cmd('copen')
        """

        return _nvim_client_call(
            "nvim_exec_lua", [lua_script, [resolved_matches, title]]
        )

    except Exception as e:
        return {"success": False, "error": str(e)}


@register_tool(tool_type=WRITE_ACCESS, is_available=is_nvim_available)
async def nvim_show_diff(
    pipeline_id: str, path: str, commit_hash: str = "HEAD~1"
) -> Dict[str, Any]:
    """
    Shows a side-by-side diff between the current file and a version in Neovim.

    Args:
        pipeline_id: The ID of the pipeline (used to resolve absolute path).
        path: Path to the file relative to the project root.
        commit_hash: The commit hash or reference to compare against.
    """
    try:
        pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
        if not pipeline or not pipeline.workspace_abs_path:
            return {"success": False, "error": "Workspace path not found"}

        # Verify the file exists and is within the workspace
        try:
            full_path = safe_join(pipeline.workspace_abs_path, path)
            if not os.path.exists(full_path):
                return {"success": False, "error": f"File does not exist: {path}"}
            if not os.path.isfile(full_path):
                return {"success": False, "error": f"Path is not a file: {path}"}
        except ValueError as e:
            return {"success": False, "error": f"Invalid path: {str(e)}"}

        # We need to change to the workspace directory first to ensure git commands work
        lua_script = f"""
        vim.cmd('cd {pipeline.workspace_abs_path}')
        vim.cmd('DiffviewOpen {commit_hash}^..{commit_hash} -- {path}')
        """

        return _nvim_client_call("nvim_exec_lua", [lua_script, []])

    except Exception as e:
        return {"success": False, "error": str(e)}


@register_tool(tool_type=WRITE_ACCESS, is_available=is_nvim_available)
async def nvim_diffview_open(pipeline_id: str, commit_hash: str) -> Dict[str, Any]:
    """
    Opens a side-by-side diff view for a given commit hash in Neovim.
    This typically requires the 'diffview.nvim' plugin.

    Args:
        pipeline_id: The ID of the pipeline (used to resolve absolute path).
        commit_hash: The commit hash or reference to open.
    """
    try:
        pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
        if not pipeline or not pipeline.workspace_abs_path:
            return {"success": False, "error": "Workspace path not found"}

        # We need to change to the workspace directory first to ensure git commands work
        lua_script = f"""
        vim.cmd('cd {pipeline.workspace_abs_path}')
        vim.cmd('DiffviewOpen {commit_hash}^..{commit_hash}')
        """

        return _nvim_client_call("nvim_exec_lua", [lua_script, []])

    except Exception as e:
        return {"success": False, "error": str(e)}
