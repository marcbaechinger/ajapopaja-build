"""CLI test client for the MCP server over stateless streamable HTTP.

This script exercises the MCP tools exposed by the backend (e.g. ``get_next_task``,
``complete_task``, ``search_tasks``) by speaking JSON-RPC over the streamable HTTP
transport. It is primarily a developer/testing utility: it initializes an MCP
session, then dispatches a single user-selected action to the server and prints
the result.

The transport-level JSON-RPC plumbing lives in :mod:`mcp_rpc` (see
:class:`mcp_rpc.RpcHelper`); this module keeps the higher-level session logic and
the thin command handlers that map CLI arguments onto tool calls.
"""

import argparse
import asyncio
import logging
import os
import sys
from typing import Any, Dict, Optional

import httpx

from mcp_rpc import RpcHelper

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("mcp-tester")


class MCPHttpClient:
    """High-level MCP client that manages a session and exposes tool calls.

    The client owns the MCP session lifecycle (initialization, teardown) and
    provides convenience methods for the tools the server exposes. All low-level
    JSON-RPC transport is delegated to an internal :class:`RpcHelper`.

    Args:
        base_url: The base URL of the FastAPI server, e.g. ``http://localhost:8000``.
        auth_token: Optional bearer token to include in the ``Authorization``
            header of every RPC request.
    """

    def __init__(self, base_url: str, auth_token: Optional[str] = None):
        self.base_url = base_url.rstrip("/")
        # FastMCP uses the root of the mounted path
        self.endpoint = (
            f"{self.base_url}/mcp/"
            if not self.base_url.endswith("/mcp/")
            else self.base_url
        )
        self.client = httpx.AsyncClient(timeout=30.0)
        self.rpc = RpcHelper(self.endpoint, self.client, auth_token=auth_token)

    async def close(self):
        """Close the underlying HTTP client and release resources."""
        await self.client.aclose()

    async def connect(self):
        """Initialize the MCP session using streamable-http.

        Sends the ``initialize`` request and then the ``notifications/initialized``
        notification. Exits the process if initialization fails.
        """
        init_params = {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "mcp-tester-cli", "version": "1.0.0"},
        }
        res = await self.rpc.send("initialize", init_params)
        if res:
            logger.info("🟢 Session established via initialize!")
            await self.rpc.send("notifications/initialized", {})
        else:
            logger.error("🔴 Failed to initialize session.")
            sys.exit(1)

    async def list_tools(self) -> Optional[Dict[str, Any]]:
        """List all tools exposed by the MCP server.

        Returns:
            The raw ``tools/list`` response, or ``None`` on failure.
        """
        result = await self.rpc.send("tools/list")
        if result and "result" in result:
            tools = result["result"].get("tools", [])
            logger.info(f"✅ Found {len(tools)} tools:")
            for t in tools:
                logger.info(
                    f"  - {t['name']}: {t.get('description', 'No description')}"
                )
            return result
        return None

    async def call_tool(
        self, name: str, arguments: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """Invoke a tool on the MCP server and log any text output.

        Args:
            name: The name of the tool to call.
            arguments: The arguments to pass to the tool.

        Returns:
            The raw ``tools/call`` response, or ``None`` on failure.
        """
        params = {"name": name, "arguments": arguments}
        result = await self.rpc.send("tools/call", params)

        if result and "result" in result:
            content = result["result"].get("content", [])
            for item in content:
                if item.get("type") == "text":
                    logger.info(f"📝 Tool Output:\n{item.get('text')}")
            return result
        return None


async def run_get_next_task(client: MCPHttpClient, pipeline_id: str):
    """Fetch the next available task for the given pipeline.

    Args:
        client: The MCP client used to call the tool.
        pipeline_id: The 24-char hex pipeline ID.
    """
    logger.info(f"--- Action: Get Next Task (Pipeline: {pipeline_id}) ---")
    await client.call_tool("get_next_task", {"pipeline_id": pipeline_id})


async def run_get_task_status(client: MCPHttpClient, task_id: str):
    """Fetch the current status of a task.

    Args:
        client: The MCP client used to call the tool.
        task_id: The 24-char hex task ID.
    """
    logger.info(f"--- Action: Get Task Status(Task: {task_id}) ---")
    await client.call_tool("get_task_status", {"task_id": task_id})


async def run_get_task_details(client: MCPHttpClient, task_id: str):
    """Fetch the full details of a task.

    Args:
        client: The MCP client used to call the tool.
        task_id: The 24-char hex task ID.
    """
    logger.info(f"--- Action: Get Task Details(Task: {task_id}) ---")
    await client.call_tool("get_task_details", {"task_id": task_id})


async def run_search_tasks(
    client: MCPHttpClient,
    keywords: Optional[str],
    statuses: Optional[list[str]],
    pipeline_id: Optional[str],
    page: int,
    limit: int,
):
    """Search for tasks by keywords, statuses, and/or pipeline.

    Args:
        client: The MCP client used to call the tool.
        keywords: Optional search keywords.
        statuses: Optional list of status filters.
        pipeline_id: Optional pipeline ID filter.
        page: Page number (0-based).
        limit: Maximum number of results to return.
    """
    logger.info("--- Action: Search Tasks ---")
    args = {}
    if keywords:
        args["keywords"] = keywords
    if statuses:
        args["statuses"] = statuses
    if pipeline_id:
        args["pipeline_id"] = pipeline_id
    args["page"] = page
    args["limit"] = limit
    await client.call_tool("search_tasks", args)


async def run_complete_task(
    client: MCPHttpClient,
    task_id: str,
    commit_hash: str,
    completion_info: str,
    version: int,
):
    """Mark a task as completed.

    Args:
        client: The MCP client used to call the tool.
        task_id: The 24-char hex task ID.
        commit_hash: The git commit hash containing the work.
        completion_info: A brief summary of what was accomplished.
        version: Current task version for optimistic concurrency control (OCC).
    """
    logger.info(f"--- Action: Complete Task (ID: {task_id}) ---")
    args = {
        "task_id": task_id,
        "commit_hash": commit_hash,
        "completion_info": completion_info,
        "version": version,
    }
    await client.call_tool("complete_task", args)


async def run_update_task_design_doc(
    client: MCPHttpClient,
    task_id: str,
    design_doc: str,
    version: int,
):
    """Update the design document for a task.

    Args:
        client: The MCP client used to call the tool.
        task_id: The 24-char hex task ID.
        design_doc: The Markdown-formatted design document.
        version: Current task version for optimistic concurrency control (OCC).
    """
    logger.info(f"--- Action: Update Task Design Doc (ID: {task_id}) ---")
    args = {
        "task_id": task_id,
        "design_doc": design_doc,
        "version": version,
    }
    await client.call_tool("update_task_design_doc", args)


async def run_update_task_spec(
    client: MCPHttpClient,
    task_id: str,
    spec: str,
    version: int,
):
    """Update the specification for a task.

    Args:
        client: The MCP client used to call the tool.
        task_id: The 24-char hex task ID.
        spec: The new specification text.
        version: Current task version for optimistic concurrency control (OCC).
    """
    logger.info(f"--- Action: Update Task Spec (ID: {task_id}) ---")
    args = {
        "task_id": task_id,
        "spec": spec,
        "version": version,
    }
    await client.call_tool("update_task_spec", args)


async def main():
    """Parse CLI arguments and dispatch the selected action to the MCP server."""
    parser = argparse.ArgumentParser(
        description="CLI tool to test MCP server tools over stateless streamable HTTP.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--url", default="http://localhost:8000", help="Base URL of the FastAPI server"
    )
    parser.add_argument(
        "--auth-token",
        default=os.getenv("MCP_AUTH_TOKEN"),
        help=(
            "Bearer token to send in the Authorization header of every RPC request. "
            "Defaults to the MCP_AUTH_TOKEN environment variable."
        ),
    )

    subparsers = parser.add_subparsers(dest="command", help="Available actions")

    get_parser = subparsers.add_parser("get-task", help="Fetch the next available task")
    get_parser.add_argument("pipeline_id", help="The 24-char hex pipeline ID")

    get_parser = subparsers.add_parser("get-task-status", help="Fetch the task status")
    get_parser.add_argument("task_id", help="The 24-char hex task ID")

    get_parser = subparsers.add_parser(
        "get-task-details", help="Fetch the task details"
    )
    get_parser.add_argument("task_id", help="The 24-char hex task ID")

    search_parser = subparsers.add_parser("search-tasks", help="Search for tasks")
    search_parser.add_argument("--keywords", help="Search keywords")
    search_parser.add_argument("--statuses", nargs="+", help="Status filters")
    search_parser.add_argument("--pipeline", help="Pipeline ID filter")
    search_parser.add_argument("--page", type=int, default=0, help="Page number")
    search_parser.add_argument("--limit", type=int, default=10, help="Results limit")

    complete_parser = subparsers.add_parser(
        "complete-task", help="Mark a task as completed"
    )
    complete_parser.add_argument("task_id", help="The 24-char hex task ID")
    complete_parser.add_argument("--commit", required=True, help="Git commit hash")
    complete_parser.add_argument("--info", required=True, help="Completion summary")
    complete_parser.add_argument(
        "--version", type=int, required=True, help="Current task version for OCC"
    )

    design_parser = subparsers.add_parser(
        "update-design-doc", help="Update the design document for a task"
    )
    design_parser.add_argument("task_id", help="The 24-char hex task ID")
    design_parser.add_argument(
        "--design-doc", required=True, help="Markdown-formatted design document"
    )
    design_parser.add_argument(
        "--version", type=int, required=True, help="Current task version for OCC"
    )

    spec_parser = subparsers.add_parser(
        "update-task-spec", help="Update the specification for a task"
    )
    spec_parser.add_argument("task_id", help="The 24-char hex task ID")
    spec_parser.add_argument("--spec", required=True, help="The new specification text")
    spec_parser.add_argument(
        "--version", type=int, required=True, help="Current task version for OCC"
    )

    subparsers.add_parser("list", help="List all available tools on the MCP server")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return

    client = MCPHttpClient(args.url, auth_token=args.auth_token)

    await client.connect()

    if args.command == "list":
        await client.list_tools()
    elif args.command == "get-task-status":
        await run_get_task_status(client, args.task_id)
    elif args.command == "get-task-details":
        await run_get_task_details(client, args.task_id)
    elif args.command == "get-task":
        await run_get_next_task(client, args.pipeline_id)
    elif args.command == "search-tasks":
        await run_search_tasks(
            client, args.keywords, args.statuses, args.pipeline, args.page, args.limit
        )
    elif args.command == "complete-task":
        await run_complete_task(
            client, args.task_id, args.commit, args.info, args.version
        )
    elif args.command == "update-design-doc":
        await run_update_task_design_doc(
            client, args.task_id, args.design_doc, args.version
        )
    elif args.command == "update-task-spec":
        await run_update_task_spec(client, args.task_id, args.spec, args.version)

    await client.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)
