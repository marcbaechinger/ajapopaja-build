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
import msgpack
from typing import Dict, Optional
from api.assistant.decorators import register_tool
from core.queries import pipeline as pipeline_queries
from core.utils.path_utils import safe_join
from pathlib import Path

# Tool Categories
WRITE_ACCESS = "write_access"

NVIM_SOCKET = "/tmp/nvimsocket"


def _nvim_client_call(method: str, params: list) -> Dict:
    """Helper to send MessagePack-RPC requests to the Neovim socket."""
    if not os.path.exists(NVIM_SOCKET):
        return {
            "success": False,
            "error": f"Neovim socket not found at {NVIM_SOCKET}. Ensure Neovim is running with '--listen {NVIM_SOCKET}'.",
        }

    # MessagePack-RPC Request format: [type, msgid, method, params]
    # type 0 = Request
    # msgid = An integer ID to match responses
    payload = [0, 1, method, params]

    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as s:
            s.settimeout(2.0)
            s.connect(NVIM_SOCKET)

            # Use msgpack to pack the list into binary
            s.sendall(msgpack.packb(payload))

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

        print(f"opening in vim: {cmd}")

        return _nvim_client_call("nvim_command", [cmd])

    except Exception as e:
        return {"success": False, "error": str(e)}


@register_tool(tool_type=WRITE_ACCESS)
async def nvim_open_selection(
    pipeline_id: str, path: str, start_line: int, end_line: int
) -> Dict:
    """
    Opens a file in a running Neovim instance and selects a range of lines in visual mode.
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


@register_tool(tool_type=WRITE_ACCESS)
async def nvim_set_quickfix(
    pipeline_id: str, matches: list[dict], title: str = "Assistant Search Results"
) -> Dict:
    """
    Sets the quickfix list in Neovim to a list of file locations and opens the quickfix window.
    This provides the user with a list of file locations to jump to in their Neovim editor.

    Args:
        pipeline_id: The ID of the pipeline (used to resolve absolute path).
        matches: A array of dicts. Each dict MUST contain: [{"filename": "<str: Path to the file relative to the project root>","lnum": <int: Line number (1-based)>,"text": "<str: Text or description for the quickfix entry>"},...]
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
            # If the LLM sent a raw string, try to parse it into the expected dict format
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


@register_tool(tool_type=WRITE_ACCESS)
async def nvim_show_diff(
    pipeline_id: str, path: str, commit_hash: str = "HEAD~1"
) -> Dict:
    """
    Shows a side-by-side diff between the current file and a previous version in Neovim.

    Args:
        pipeline_id: The ID of the pipeline (used to resolve absolute path).
        path: Path to the file relative to the project root.
        commit_hash: The commit hash or reference to compare against (defaults to HEAD~1).
    """
    try:
        pipeline = await pipeline_queries.get_pipeline_by_id(pipeline_id)
        if not pipeline or not pipeline.workspace_abs_path:
            return {"success": False, "error": "Workspace path not found"}

        try:
            full_path = str(safe_join(pipeline.workspace_abs_path, path))
        except ValueError as e:
            return {"success": False, "error": str(e)}

        # 1. Get the content of the file from the git history
        cmd = ["git", "show", f"{commit_hash}:{path}"]
        try:
            import subprocess

            result = subprocess.run(
                cmd,
                cwd=str(pipeline.workspace_abs_path),
                capture_output=True,
                text=True,
                check=True,
            )
            if result.returncode != 0:
                print(f"GIT ERROR: {result.stderr}")
                return {
                    "success": False,
                    "error": f"Git could not find that file at that commit: {result.stderr}",
                }

            old_content = result.stdout
            print(f"Length of fetched git content: {len(old_content)}")
            print("content: " + old_content)
        except subprocess.CalledProcessError as e:
            return {"success": False, "error": f"Git error: {e.stderr}"}

        # 2. Prepare the Lua script to set up the side-by-side view
        # We pass arguments cleanly to avoid string escaping issues in Lua
        lua_script = """
            local file_path, old_text, commit_short = ...

            -- 1. Setup the 'Current' side
            vim.cmd("edit " .. vim.fn.fnameescape(file_path))
            local original_ft = vim.bo.filetype
            vim.cmd("diffthis")

            -- Create a COMPLETELY NEW scratch buffer
            -- (false = not listed, true = scratch/unnamed)
            local buf = vim.api.nvim_create_buf(false, true)

            -- Fill it with the old text
            local lines = vim.split(old_text, "\\n", {plain=true})
            if lines[#lines] == "" then table.remove(lines) end
            vim.api.nvim_buf_set_lines(buf, 0, -1, false, lines)

            -- Open a vertical split and put the NEW buffer in it
            vim.cmd("vsplit")
            vim.api.nvim_win_set_buf(0, buf)

            -- Configure look and feel
            vim.bo[buf].filetype = original_ft
            vim.bo[buf].buftype = "nofile"
            vim.bo[buf].bufhidden = "wipe"
            pcall(vim.api.nvim_buf_set_name, buf, "git://" .. commit_short .. "/" .. vim.fn.fnamemodify(file_path, ":t"))

            -- 6. Turn on diff for the new window
            vim.cmd("diffthis")
            vim.cmd("diffupdate")
            """

        commit_short = commit_hash[:7]
        return _nvim_client_call(
            "nvim_exec_lua", [lua_script, [full_path, old_content, commit_short]]
        )

    except Exception as e:
        return {"success": False, "error": str(e)}
