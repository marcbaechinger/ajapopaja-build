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
import json
import logging
import os
import sys
from pathlib import Path, PurePosixPath
from typing import Any, Dict, Optional
from urllib.parse import urlencode

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


def _decode_json(value: Any) -> Any:
    """Decode a JSON string, returning ``None`` when it is not valid JSON."""
    while isinstance(value, str):
        try:
            value = json.loads(value)
        except (json.JSONDecodeError, TypeError):
            return None
    return value


def _unwrap_tool_payload(payload: Any) -> Any:
    """Unwrap the common single-key envelopes used by MCP structured results."""
    while isinstance(payload, dict) and len(payload) == 1:
        key = next(iter(payload))
        if key not in {"result", "data", "structuredContent", "structured_content"}:
            break
        payload = payload[key]
    return payload


def _extract_tool_payload(response: Any) -> Optional[Dict[str, Any]]:
    """Extract the JSON object returned by an MCP ``tools/call`` response.

    FastMCP exposes tool results either as a ``structuredContent`` object or as
    JSON text in the ``content`` list, depending on the installed protocol
    version. The helper accepts both, as well as a direct payload (useful for
    tests and direct callers).
    """
    if response is None:
        return None

    payload = response
    if isinstance(payload, dict) and "result" in payload:
        rpc_result = payload["result"]
        if isinstance(rpc_result, dict):
            if rpc_result.get("structuredContent") is not None:
                payload = rpc_result["structuredContent"]
            elif rpc_result.get("structured_content") is not None:
                payload = rpc_result["structured_content"]
            elif isinstance(rpc_result.get("content"), list):
                payload = None
                for item in rpc_result["content"]:
                    if not isinstance(item, dict):
                        continue
                    parsed = _decode_json(item.get("text"))
                    if isinstance(parsed, dict):
                        payload = parsed
                        break
                    if item.get("json") is not None:
                        payload = _decode_json(item["json"])
                        break
                if payload is None:
                    return None
            elif "content" not in rpc_result:
                payload = rpc_result
            else:
                return None
        else:
            payload = _decode_json(rpc_result)

    payload = _unwrap_tool_payload(payload)
    if hasattr(payload, "model_dump"):
        payload = payload.model_dump()

    return payload if isinstance(payload, dict) else None


def _print_artifact(payload: Dict[str, Any], as_json: bool = False) -> None:
    """Print artifact metadata to stdout, optionally as compact JSON."""
    if as_json:
        print(json.dumps(payload, default=str, ensure_ascii=False))
    else:
        print(json.dumps(payload, indent=2, default=str, ensure_ascii=False))


def _artifact_download_url(
    client: MCPHttpClient, pipeline_id: str, payload: Dict[str, Any]
) -> str:
    """Build the absolute artifact download URL for the given metadata."""
    download_url = payload.get("download_url")
    if not download_url:
        download_url = f"/api/pipelines/{pipeline_id}/artifact/download"

    if str(download_url).startswith(("http://", "https://")):
        url = str(download_url)
    else:
        url = f"{client.base_url.rstrip('/')}/{str(download_url).lstrip('/')}"

    token = payload.get("download_token")
    separator = "&" if "?" in url else "?"
    return f"{url}{separator}{urlencode({'token': token})}"


async def run_get_artifact(
    client: MCPHttpClient, pipeline_id: str, as_json: bool = False
) -> Optional[Dict[str, Any]]:
    """Fetch and print a pipeline's build artifact metadata and download token."""
    logger.info(f"--- Action: Get Build Artifact (Pipeline: {pipeline_id}) ---")
    response = await client.call_tool(
        "get_build_artifact", {"pipeline_id": pipeline_id}
    )
    payload = _extract_tool_payload(response)
    if payload is None:
        logger.error("Failed to retrieve build artifact metadata.")
        return None

    if payload.get("error"):
        logger.error(f"Failed to get build artifact: {payload['error']}")
    _print_artifact(payload, as_json=as_json)
    return payload


async def run_download_artifact(
    client: MCPHttpClient, pipeline_id: str, output: Optional[str] = None
) -> Optional[str]:
    """Download a pipeline's build artifact, streaming it to a local file."""
    logger.info(f"--- Action: Download Build Artifact (Pipeline: {pipeline_id}) ---")
    response = await client.call_tool(
        "get_build_artifact", {"pipeline_id": pipeline_id}
    )
    payload = _extract_tool_payload(response)
    if payload is None:
        logger.error("Failed to retrieve build artifact metadata.")
        return None

    if payload.get("error"):
        logger.error(f"Failed to get build artifact: {payload['error']}")
        return None

    token = payload.get("download_token")
    if not token:
        logger.error(
            f"No downloadable build artifact is configured for pipeline {pipeline_id}."
        )
        return None

    if output is None:
        artifact_name = PurePosixPath(str(payload.get("path") or "")).name
        if not artifact_name:
            logger.error("Artifact metadata did not include a path or filename.")
            return None
        output = artifact_name

    url = _artifact_download_url(client, pipeline_id, payload)
    headers: Dict[str, str] = {}
    auth_token = getattr(client, "auth_token", None)
    if auth_token is None:
        auth_token = getattr(getattr(client, "rpc", None), "auth_token", None)
    if auth_token:
        headers["Authorization"] = f"Bearer {auth_token}"

    output_path = Path(output).expanduser()
    request_kwargs: Dict[str, Any] = {}
    if headers:
        request_kwargs["headers"] = headers

    try:
        async with client.client.stream("GET", url, **request_kwargs) as download:
            status_code = getattr(download, "status_code", 200)
            if status_code >= 400:
                body = b""
                if hasattr(download, "aread"):
                    body = await download.aread()
                detail = body.decode("utf-8", errors="replace") if body else ""
                raise RuntimeError(
                    f"HTTP {status_code} downloading artifact"
                    + (f": {detail}" if detail else "")
                )

            with output_path.open("wb") as file_handle:
                async for chunk in download.aiter_bytes():
                    if chunk:
                        file_handle.write(chunk)
    except Exception as e:
        logger.error(f"Failed to download build artifact: {e}")
        return None

    logger.info(f"✅ Saved build artifact to {output_path}")
    return str(output_path)


# Backwards/alternatively named aliases keep the CLI helpers easy to discover.
run_get_build_artifact = run_get_artifact
run_download_build_artifact = run_download_artifact


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


async def run_create_pull_request(
    client: MCPHttpClient,
    pipeline_id: str,
    title: str,
    body: str = "",
    task_id: Optional[str] = None,
):
    """Push the current branch and open a Gitea pull request.

    Args:
        client: The MCP client used to call the tool.
        pipeline_id: The 24-char hex pipeline ID.
        title: Pull request title.
        body: Pull request description (Markdown).
        task_id: Optional task to link and mark submitted.
    """
    logger.info(f"--- Action: Create Pull Request (Pipeline: {pipeline_id}) ---")
    args: Dict[str, Any] = {
        "pipeline_id": pipeline_id,
        "title": title,
        "body": body,
    }
    if task_id:
        args["task_id"] = task_id
    await client.call_tool("create_pull_request", args)


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

    pr_parser = subparsers.add_parser(
        "create-pull-request",
        help="Push the current branch and open a Gitea pull request",
    )
    pr_parser.add_argument("pipeline_id", help="The 24-char hex pipeline ID")
    pr_parser.add_argument("--title", required=True, help="Pull request title")
    pr_parser.add_argument("--body", default="", help="Pull request description")
    pr_parser.add_argument(
        "--task", dest="task_id", help="Optional task ID to link and mark submitted"
    )

    artifact_parser = subparsers.add_parser(
        "get-artifact", help="Fetch a pipeline's build artifact metadata and token"
    )
    artifact_parser.add_argument("pipeline_id", help="The 24-char hex pipeline ID")
    artifact_parser.add_argument(
        "--json",
        dest="as_json",
        action="store_true",
        help="Print compact JSON suitable for scripting (e.g. jq)",
    )

    download_parser = subparsers.add_parser(
        "download-artifact", help="Download a pipeline's build artifact"
    )
    download_parser.add_argument("pipeline_id", help="The 24-char hex pipeline ID")
    download_parser.add_argument(
        "-o",
        "--output",
        help=(
            "Destination file path "
            "(default: the artifact filename in the current directory)"
        ),
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
    elif args.command == "create-pull-request":
        await run_create_pull_request(
            client, args.pipeline_id, args.title, args.body, args.task_id
        )
    elif args.command == "get-artifact":
        await run_get_artifact(client, args.pipeline_id, as_json=args.as_json)
    elif args.command == "download-artifact":
        await run_download_artifact(client, args.pipeline_id, args.output)

    await client.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(0)
