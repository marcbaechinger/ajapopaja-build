# MCP Security Design Document

## 1. Purpose
The MCP (Model Context Protocol) server exposes endpoints under `/mcp`. Historically these endpoints required JWT authentication for all non‑`OPTIONS` requests. To improve developer ergonomics and local testing, authentication has become opt‑in: by default the server accepts requests without a token, and the feature can be enabled via configuration.

## 2. Security Requirements
- **Optional Authentication**: Clients may send a JWT in the `Authorization: Bearer <token>` header or a `token` query parameter. If the configuration property `MCP_AUTHENTICATION_ENABLED` is `False`, the server accepts the request regardless of the presence of a token.
- **Configuration Flag**: `MCP_AUTHENTICATION_ENABLED` defaults to `False`. Setting it to `True` restores the original mandatory authentication behaviour.
- **Token Flexibility**: When authentication is enabled, the same dual‑mechanism (header or query) as before is supported to accommodate SSE clients.
- **Error Handling**: Unauthorized requests return `401 Unauthorized` with a JSON payload explaining the error, but only when authentication is enabled.
- **CORS**: `OPTIONS` pre‑flight requests are exempt from authentication to preserve normal CORS behaviour.
- **Log Redaction**: The `TokenRedactionFilter` configured in `main.py` continues to redact the `token` query parameter for all `/mcp` logs.

## 3. Configuration
```python
# backend/core/src/core/config.py
MCP_AUTHENTICATION_ENABLED = (
    os.getenv("MCP_AUTHENTICATION_ENABLED", "false").lower() == "true"
)
```
When set to `True`, the middleware will enforce token validation.

## 4. Implementation Overview
### 4.1. ASGI Middleware
The MCP FastAPI application is mounted as a raw ASGI app within the main FastAPI instance. An ASGI middleware intercepts requests to `/mcp` and applies the following logic:

```python
async def mcp_auth_middleware(scope, receive, send):
    # Bypass for non‑HTTP or non‑/mcp paths
    if scope["type"] != "http" or not scope["path"].startswith("/mcp"):
        await mcp_app(scope, receive, send)
        return

    # Allow CORS pre‑flight
    if scope["method"] == "OPTIONS":
        await mcp_app(scope, receive, send)
        return

    # If authentication is disabled, skip validation
    if not config.MCP_AUTHENTICATION_ENABLED:
        await mcp_app(scope, receive, send)
        return

    # Extract token from header or query
    token = extract_token(scope)
    if not token:
        await send_unauthorized(send)
        return

    try:
        user = get_current_user_from_token(token)
    except Exception:
        await send_unauthorized(send)
        return

    # Token valid; forward to the MCP app
    await mcp_app(scope, receive, send)
```

#### 4.1.1. Path & Method Filtering
Only requests where `scope["path"].startswith("/mcp")` are inspected. `OPTIONS` requests bypass authentication.

#### 4.1.2. Token Extraction
The helper `extract_token(scope)` looks first for an `Authorization: Bearer <token>` header, then for a `token` query parameter.

#### 4.1.3. Validation
`get_current_user_from_token(token)` from `backend/api/src/api/auth.py` is reused. A failed validation results in a `401 Unauthorized` response.

### 4.2. Mounting the MCP App
```python
mcp_app = mcp.http_app(path="/")
app.mount("/mcp", mcp_app, name="mcp")
```
This mounts the MCP FastAPI instance so that its internal routes resolve to `/mcp/<subpath>` without duplicating the `/mcp` prefix.

### 4.3. Log Redaction
The existing `TokenRedactionFilter` remains in place, ensuring that the `token` query parameter is masked in all access logs.

## 5. Testing Strategy
Integration tests in `tests/test_mcp_server.py` cover both authentication states:
- **Disabled (default)**: Requests without a token are accepted (status code ≠ 401). The test may hit a `RuntimeError` from the test‑environment lifespan.
- **Enabled**: Using `monkeypatch`, set `MCP_AUTHENTICATION_ENABLED` to `True`. Requests without a token now return `401 Unauthorized`.

Manual verification steps are identical to the original design, with the addition that the server now runs with authentication turned off unless the environment variable is set.

## 6. Client Configuration
Clients that cannot set custom headers (e.g., SSE clients) include the JWT as a query parameter:

```json
{ "mcpServers": { "ajapopaja": { "command": "npx", "args": ["-y", "@modelcontextprotocol/client-sse", "--url", "http://localhost:8000/mcp/sse?token=YOUR_JWT_TOKEN"] } } }
```

Header‑based configuration is also supported when available.

## 7. Token Strategy
- The same JWTs used by the Management API are valid for MCP when authentication is enabled.
- Tokens can be generated with extended expiration for long‑lived CLI usage.
- Revocation can be implemented via a token revocation list if needed.

---

### 8. Summary
MCP security now defaults to unauthenticated access, making local development and testing easier. When required, authentication can be enabled with a single configuration flag, preserving the robust JWT validation and flexible token delivery mechanisms that existed before.
