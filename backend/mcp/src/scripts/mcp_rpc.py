"""Low-level JSON-RPC transport helpers for the MCP streamable-HTTP client.

This module encapsulates the repetitive plumbing required to talk to an MCP
server over the streamable HTTP transport: building JSON-RPC payloads, managing
the ``mcp-session-id`` header, streaming the request, and parsing the SSE
response. Keeping this logic in a dedicated helper class lets the higher-level
client focus on MCP semantics (tools, sessions) instead of wire details.
"""

import json
import logging
from typing import Any, Dict, Optional

import httpx

logger = logging.getLogger("mcp-tester")


class RpcHelper:
    """Sends JSON-RPC requests over the MCP streamable HTTP transport.

    The helper owns the transport-level concerns of a single MCP session:

    - constructing the JSON-RPC envelope (including request ``id`` generation),
    - tracking and echoing the ``mcp-session-id`` header,
    - streaming the POST request and parsing the SSE ``data:`` lines,
    - distinguishing notifications (no response expected) from requests.

    Args:
        endpoint: The full URL to POST JSON-RPC messages to.
        client: The shared ``httpx.AsyncClient`` used for all requests.
        auth_token: Optional bearer token to include in the ``Authorization``
            header of every request. When set, requests are sent with
            ``Authorization: Bearer <token>``.
    """

    def __init__(
        self,
        endpoint: str,
        client: httpx.AsyncClient,
        auth_token: Optional[str] = None,
    ):
        self.endpoint = endpoint
        self.client = client
        self.auth_token = auth_token
        self.session_id: Optional[str] = None

    async def send(
        self, method: str, params: Optional[Dict] = None
    ) -> Optional[Dict[str, Any]]:
        """Send a JSON-RPC request (or notification) and return its result.

        Args:
            method: The JSON-RPC method name, e.g. ``"tools/list"``. Methods
                prefixed with ``"notifications/"`` are treated as notifications
                and do not expect a JSON-RPC response.
            params: Optional parameters object to include in the payload.

        Returns:
            The parsed JSON-RPC response object, or ``None`` if the request
            failed or no response was received. Notifications return a trivial
            ``{"result": {}}`` on HTTP success.
        """
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
