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

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("mcp-tester")


class MCPHttpClient:
    def __init__(self, base_url: str, auth_token: Optional[str] = None):
        self.base_url = base_url.rstrip("/")
        # FastMCP uses the root of the mounted path
        self.endpoint = (
            f"{self.base_url}/mcp/"
            if not self.base_url.endswith("/mcp/")
            else self.base_url
        )
        self.auth_token = auth_token
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

        if self.auth_token:
            headers["Authorization"] = f"Bearer {self.auth_token}"

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


def _decode_json(value: Any) -> Any:
    """Decode a JSON string, returning the original value when it is not JSON."""
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
    logger.info(f"--- Action: Get Next Task (Pipeline: {pipeline_id}) ---")
    await client.call_tool("get_next_task", {"pipeline_id": pipeline_id})


async def run_get_task_status(client: MCPHttpClient, task_id: str):
    logger.info(f"--- Action: Get Task Status(Task: {task_id}) ---")
    await client.call_tool("get_task_status", {"task_id": task_id})


async def run_get_task_details(client: MCPHttpClient, task_id: str):
    logger.info(f"--- Action: Get Task Details(Task: {task_id}) ---")
    await client.call_tool("get_task_details", {"task_id": task_id})


async def run_create_task(
    client: MCPHttpClient,
    pipeline_id: str,
    title: str,
    spec: Optional[str] = None,
    design_doc: Optional[str] = None,
    description: Optional[str] = None,
    want_design_doc: bool = False,
    status: str = "created",
    order: Optional[int] = None,
):
    logger.info(f"--- Action: Create Task (Pipeline: {pipeline_id}) ---")
    args: Dict[str, Any] = {
        "pipeline_id": pipeline_id,
        "title": title,
        "status": status,
    }
    if spec is not None:
        args["spec"] = spec
    if design_doc is not None:
        args["design_doc"] = design_doc
    if description is not None:
        args["description"] = description
    if want_design_doc:
        args["want_design_doc"] = want_design_doc
    if order is not None:
        args["order"] = order
    await client.call_tool("create_task", args)


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


async def run_update_task_spec(
    client: MCPHttpClient,
    task_id: str,
    spec: str,
    version: int,
):
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

    create_task_parser = subparsers.add_parser(
        "create-task", help="Create a new task in a pipeline"
    )
    create_task_parser.add_argument("pipeline_id", help="The 24-char hex pipeline ID")
    create_task_parser.add_argument("--title", required=True, help="Task title")
    create_task_parser.add_argument("--spec", help="Markdown-formatted specification")
    create_task_parser.add_argument(
        "--design-doc", dest="design_doc", help="Markdown-formatted design document"
    )
    create_task_parser.add_argument("--description", help="Task description")
    create_task_parser.add_argument(
        "--want-design-doc",
        dest="want_design_doc",
        action="store_true",
        help="Require an approved design document before implementation",
    )
    create_task_parser.add_argument(
        "--status", default="created", help="Initial task status (created | scheduled)"
    )
    create_task_parser.add_argument(
        "--order", type=int, help="Priority/position (lower sorts first)"
    )

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
    elif args.command == "create-task":
        await run_create_task(
            client,
            args.pipeline_id,
            args.title,
            args.spec,
            args.design_doc,
            args.description,
            args.want_design_doc,
            args.status,
            args.order,
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
