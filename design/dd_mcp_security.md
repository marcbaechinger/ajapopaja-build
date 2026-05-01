# MCP Security Design Document

## 1. Purpose
The MCP (Model Context Protocol) server exposes endpoints under `/mcp` that previously accepted requests without authentication. This document records the architectural decisions that secure these endpoints using the existing JWT infrastructure.

## 2. Security Requirements
- **Authentication**: All non‑`OPTIONS` requests to `/mcp` must be authenticated with a JWT that is valid for the Management API.
- **Token Flexibility**: Clients may provide the token either in the `Authorization: Bearer <token>` header or as a `token` query parameter. This dual‑mechanism accommodates SSE clients that cannot set custom headers.
- **Error Handling**: Unauthorized requests return `401 Unauthorized` with a JSON payload explaining the error.
- **CORS**: `OPTIONS` pre‑flight requests are exempt from authentication to preserve normal CORS behaviour.
- **Log Redaction**: The `TokenRedactionFilter` configured in `main.py` must also redact the `token` query parameter for all `/mcp` logs.

## 3. Implementation Overview
### 3.1. ASGI Middleware
Because the MCP server is mounted as a raw ASGI application within FastAPI, standard FastAPI dependencies cannot be applied directly. An ASGI middleware is used to intercept requests and perform token validation.

```python
async def mcp_auth_middleware(scope, receive, send):
    if scope["type"] != "http" or not scope["path"].startswith("/mcp"):
        await app(scope, receive, send)
        return
    if scope["method"] == "OPTIONS":
        await app(scope, receive, send)
        return
    token = extract_token(scope)
    if not token:
        await send_unauthorized(send)
        return
    try:
        user = get_current_user_from_token(token)
    except Exception:
        await send_unauthorized(send)
        return
    await app(scope, receive, send)
```

#### 3.1.1. Path & Method Filtering
- Only requests where `scope["path"].startswith("/mcp")` are examined.
- `OPTIONS` requests bypass authentication to support CORS pre‑flight.

#### 3.1.2. Token Extraction
1. Look for `Authorization: Bearer <token>` in headers.
2. If absent, look for a `token` query parameter.

#### 3.1.3. Validation
`get_current_user_from_token(token)` from `backend/api/src/api/auth.py` is reused. The same token validation logic applies as for the Management API.

#### 3.1.4. Response
- On success: call the wrapped ASGI app (`mcp_app`).
- On failure: return a `401` response with JSON `{"detail": "Unauthorized"}`.

### 3.2. Mounting the MCP App
The MCP FastAPI application is instantiated with `path="/"` so that its internal routes resolve to `/mcp/<subpath>` without duplicating the `/mcp` prefix.

```python
mcp_app = mcp.http_app(path="/")
app.mount("/mcp", mcp_app, name="mcp")
```

### 3.3. Log Redaction
The existing `TokenRedactionFilter` is configured globally. The middleware must not interfere; the filter continues to redact the `token` query parameter from all access logs.

## 4. Testing Strategy
- **Integration tests** in `tests/test_mcp_server.py` cover:
  - No token → 401
  - Invalid token → 401
  - Valid token (header or query) → 200/400 (depending on request payload)
  - OPTIONS requests → 200
- Manual testing with an SSE client (Gemini CLI / Claude Desktop) using a valid JWT.

## 5. Client Configuration
Clients that cannot send headers (e.g., SSE clients) must include the JWT as a query parameter:

```json
{ "mcpServers": { "ajapopaja": { "command": "npx", "args": ["-y", "@modelcontextprotocol/client-sse", "--url", "http://localhost:8000/mcp/sse?token=YOUR_JWT_TOKEN"] } } }
```

Header‑based configuration is also supported when available.

## 6. Token Strategy
- The same JWTs used by the Management API are valid for MCP.
- For long‑lived CLI usage, tokens can be generated with extended expiration (e.g., 365 days). No refresh flow is required.
- Revocation can be implemented via a token revocation list if needed.

---

### 7. Summary
The MCP security design leverages existing JWT authentication, adds a lightweight ASGI middleware to protect `/mcp` routes, and accommodates both header‑based and query‑parameter‑based token delivery. This preserves the current architecture while enhancing security for MCP clients.
