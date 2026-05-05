import argparse
import asyncio
import json
import logging
import sys
from typing import Any, Dict, Optional

import httpx

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("mcp-tester")


class MCPHttpClient:
    def __init__(self, base_url: str):
        self.base_url = base_url.rstrip("/")
        # FastMCP uses the root of the mounted path
        self.endpoint = (
            f"{self.base_url}/mcp/"
            if not self.base_url.endswith("/mcp/")
            else self.base_url
        )
        self.session_id = None
        self.client = httpx.AsyncClient(timeout=30.0)

    async def close(self):
        await self.client.aclose()

    async def connect(self):
        """Initializes the MCP session using streamable-http."""
        init_params = {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "mcp-tester-cli", "version": "1.0.0"},
        }
        res = await self._send_rpc("initialize", init_params)
        if res:
            logger.info("🟢 Session established via initialize!")
            await self._send_rpc("notifications/initialized", {})
        else:
            logger.error("🔴 Failed to initialize session.")
            sys.exit(1)

    async def _send_rpc(
        self, method: str, params: Optional[Dict] = None
    ) -> Optional[Dict[str, Any]]:
        is_notification = method.startswith("notifications/")
        payload = {
            "jsonrpc": "2.0",
            "method": method,
        }
        if not is_notification:
            payload["id"] = method.replace("/", "-")
        if params:
            payload["params"] = params

        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }

        if self.session_id:
            headers["mcp-session-id"] = self.session_id

        logger.info(f"Sending RPC: {method}...")

        try:
            # We use stream so we can parse SSE events as they arrive,
            # though usually it's just one event with the result for streamable-http.
            async with self.client.stream(
                "POST", self.endpoint, headers=headers, json=payload
            ) as response:
                if response.status_code >= 400:
                    logger.error(
                        f"🔴 HTTP {response.status_code}: {await response.aread()}"
                    )
                    return None

                # Check for mcp-session-id in headers and save it
                if "mcp-session-id" in response.headers:
                    self.session_id = response.headers["mcp-session-id"]

                if is_notification:
                    # Notifications don't expect a response in the JSON-RPC sense.
                    # Over streamable-http, we just assume it's accepted if HTTP is 200.
                    return {"result": {}}

                # Parse the SSE response
                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        data_str = line[6:].strip()
                        try:
                            data_json = json.loads(data_str)
                            if "error" in data_json:
                                err = json.dumps(data_json["error"], indent=2)
                                logger.error(f"❌ RPC Error: {err}")
                            return data_json
                        except json.JSONDecodeError:
                            logger.error(
                                f"Failed to parse JSON from data line: {data_str}"
                            )

                return None
        except Exception as e:
            logger.error(f"Request failed: {e}")
            return None

    async def list_tools(self) -> Optional[Dict[str, Any]]:
        result = await self._send_rpc("tools/list")
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
        params = {"name": name, "arguments": arguments}
        result = await self._send_rpc("tools/call", params)

        if result and "result" in result:
            content = result["result"].get("content", [])
            for item in content:
                if item.get("type") == "text":
                    logger.info(f"📝 Tool Output:\n{item.get('text')}")
            return result
        return None


async def run_get_next_task(client: MCPHttpClient, pipeline_id: str):
    logger.info(f"--- Action: Get Next Task (Pipeline: {pipeline_id}) ---")
    await client.call_tool("get_next_task", {"pipeline_id": pipeline_id})


async def run_get_task_status(client: MCPHttpClient, task_id: str):
    logger.info(f"--- Action: Get Task Status(Task: {task_id}) ---")
    await client.call_tool("get_task_status", {"task_id": task_id})


async def run_get_task_details(client: MCPHttpClient, task_id: str):
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
    logger.info(f"--- Action: Update Task Design Doc (ID: {task_id}) ---")
    args = {
        "task_id": task_id,
        "design_doc": design_doc,
        "version": version,
    }
    await client.call_tool("update_task_design_doc", args)


async def main():
    parser = argparse.ArgumentParser(
        description="CLI tool to test MCP server tools over stateless streamable HTTP.",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--url", default="http://localhost:8000", help="Base URL of the FastAPI server"
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

    subparsers.add_parser("list", help="List all available tools on the MCP server")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        return

    client = MCPHttpClient(args.url)

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

    await client.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)
