# Design Document: User Authentication with Tokens

## 1. Overview
This document describes the design for implementing token-based authentication (JWT) for the Ajapopaja Build application, covering both FastAPI HTTP endpoints and WebSockets.

## 2. Authentication Flow
- **Scheme**: JWT (JSON Web Tokens).
- **Mechanism**:
    - **Access Token**: Short-lived (e.g., 15-30 minutes), included in the `Authorization: Bearer <token>` header for HTTP requests and as a query parameter for WebSockets.
    - **Refresh Token**: Longer-lived (e.g., 7 days), stored in an `HttpOnly` cookie to prevent XSS-based theft. Used to obtain new access tokens.

## 3. Backend Implementation (FastAPI)

### 3.1 HTTP Endpoints
- **Security Dependency**: Use `fastapi.security.OAuth2PasswordBearer` to extract the access token.
- **Token Validation**: Use `python-jose` to decode and verify the JWT signature.
- **Dependency Injection**:
    ```python
    async def get_current_user(token: str = Depends(oauth2_scheme)) -> User:
        # Verify token, check user in DB
        # Raise HTTPException(status_code=401) on failure
        ...

    @router.get("/pipelines/")
    async def list_pipelines(user: User = Depends(get_current_user)):
        ...
    ```

### 3.2 WebSocket Security
- **Authentication**: Since the browser `WebSocket` API does not support custom headers, the access token will be passed via a query parameter.
- **Connection Handshake**:
    ```python
    @app.websocket("/ws/{client_id}")
    async def websocket_endpoint(
        websocket: WebSocket,
        client_id: str,
        token: str = Query(...)
    ):
        try:
            user = await verify_token(token)
            await websocket.accept()
            # Add to manager with user context
        except AuthError:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
    ```

### 3.3 Error Handling
- **HTTP**: Return `401 Unauthorized` or `403 Forbidden` with a clear detail message.
- **WebSocket**: Close the connection with a specific code (e.g., `1008`) or send a `system:auth_failed` message before closing.

## 4. Frontend Implementation

### 4.1 Authentication Service (`AuthService`)
- Manages local state (current user, access token).
- Handles login, logout, and token refreshing.
- Persists user info (non-sensitive) in `localStorage` if needed for UI state across reloads.

### 4.2 Shared HTTP Client Facility
- **Interceptor/Wrapper**: A `BaseClient` or a shared `fetch` wrapper that:
    1. Automatically adds the `Authorization` header if a token is present.
    2. Intercepts `401` responses.
    3. Attempts to refresh the token using the refresh cookie.
    4. Retries the original request or redirects to login if refresh fails.

### 4.3 WebSocket Client Integration
- `WebSocketClient` should:
    1. Retrieve the latest token from `AuthService` before connecting.
    2. Construct the URL with the token query parameter: `ws://.../ws/browser?token=<token>`.
    3. Handle token expiration by reconnecting with a fresh token.

## 5. Security Considerations
- **HttpOnly Cookies**: Refresh tokens MUST be stored in `HttpOnly`, `Secure`, and `SameSite=Strict` cookies.
- **Token Expiration**: Access tokens must be short-lived.
- **Sensitive Data**: Never log passwords or raw tokens.
- **CORS**: Ensure `allow_credentials=True` is set in FastAPI CORS middleware to allow cookies.
