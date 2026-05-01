# Design Document: Opt-in MCP Authentication

## 1. Objective
Currently, all MCP server endpoints under `/mcp` require JWT authentication. To improve ease of use and local development, we want to make this authentication optional. By default, MCP calls should be open (opt-out of authentication), but it can be enabled via configuration.

## 2. Proposed Changes

### 2.1. Configuration Changes (`backend/core/src/core/config.py`)
Add a new configuration property `MCP_AUTHENTICATION_ENABLED` that defaults to `False`.

```python
# MCP Security Configuration
MCP_AUTHENTICATION_ENABLED = os.getenv("MCP_AUTHENTICATION_ENABLED", "false").lower() == "true"
```

### 2.2. Backend Changes (`backend/api/src/api/main.py`)
Modify `mcp_auth_middleware` to check the `config.MCP_AUTHENTICATION_ENABLED` property. If it is `False`, the middleware should immediately delegate to `mcp_app` without validating the token.

```python
from core import config

async def mcp_auth_middleware(scope, receive, send):
    """ASGI middleware to authenticate MCP requests."""
    if scope["type"] != "http":
        await mcp_app(scope, receive, send)
        return

    # NEW: Check if authentication is enabled
    if not config.MCP_AUTHENTICATION_ENABLED:
        await mcp_app(scope, receive, send)
        return

    # Allow OPTIONS for CORS
    if scope["method"] == "OPTIONS":
        await mcp_app(scope, receive, send)
        return
    
    # ... existing token validation logic ...
```

## 3. Verification Plan

### 3.1. Automated Testing
Update `tests/test_mcp_server.py` to test both configurations:
1.  **Default (Disabled)**: Verify that requests without a token are accepted (return 200 or hit the test-environment `RuntimeError` instead of 401).
2.  **Enabled**: Using `monkeypatch` to set `MCP_AUTHENTICATION_ENABLED` to `True`, verify that requests without a token are rejected with 401.

### 3.2. Manual Verification
1.  Start the API server without any environment variables.
2.  Use `curl` or an MCP client to hit `http://localhost:8000/mcp/` without a token. It should succeed.
3.  Restart the server with `MCP_AUTHENTICATION_ENABLED=true`.
4.  Hit the same endpoint without a token. It should return `401 Unauthorized`.
