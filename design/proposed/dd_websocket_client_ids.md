# Design Document: WebSocket Client Identification

**Task ID:** 69de9b83ed8dfe2c07581a7e
**Status:** PROPOSED

## 1. Goal
Improve the WebSocket connection model to support multiple concurrent connections from the same user (e.g., across multiple browser tabs) and provide better traceability in server logs.

## 2. Current State
- The frontend hardcodes `"browser"` as the `client_id` in the WebSocket URL: `/ws/browser`.
- The backend logs the `client_id` but doesn't use it for connection management.
- If multiple tabs are opened, they all identify as `"browser"`, making logs ambiguous.

## 3. Options for Client ID Generation

### Option A: Random string per session (Chosen)
Generate a unique, random ID each time the `WebSocketClient` is initialized.
- **Implementation**: Use `crypto.randomUUID()` or a simple base64/hex random string.
- **Pros**: 
    - Every tab is guaranteed to have a unique ID.
    - Simplest to implement.
- **Cons**: 
    - The ID changes on every page reload.

### Option B: Persistent ID per browser (localStorage)
Store a generated ID in `localStorage` and reuse it.
- **Implementation**: Check `localStorage` for `ws_client_id`, generate if missing.
- **Pros**: 
    - Persistent across reloads.
- **Cons**: 
    - All tabs in the same browser share the same ID. This doesn't help distinguishing multiple tabs for the same user.

### Option C: Tab-specific Persistence (sessionStorage)
Store a generated ID in `sessionStorage`.
- **Implementation**: Check `sessionStorage` for `ws_session_id`, generate if missing.
- **Pros**: 
    - Persistent across reloads in the *same* tab.
    - Unique for *different* tabs.
- **Cons**: 
    - Slightly more state management.

## 4. Proposed Change

### 4.1. Frontend (`WebSocketClient.ts`)
- In the constructor, generate a random 8-character hex string as `clientId`.
- Update `baseUrl` to use this `clientId`: `${protocol}//${url.host}/ws/${this.clientId}`.

### 4.2. Backend (`websocket_manager.py`)
- Update `ConnectionManager` to store connections in a dictionary `active_connections: Dict[str, WebSocket]`.
- This allows the server to potentially send targeted messages to specific clients in the future.
- Update `connect`, `add_connection`, and `disconnect` methods to handle the `client_id`.

### 4.3. Backend (`main.py`)
- Pass the `client_id` from the URL to `manager.add_connection(websocket, client_id)`.

## 5. Implementation Plan
1.  Update `backend/api/src/api/websocket_manager.py` to use a `Dict` for connections.
2.  Update `backend/api/src/api/main.py` to pass the `client_id` to the manager.
3.  Update `frontend/src/core/WebSocketClient.ts` to generate and use a random `clientId`.

## 6. Verification Plan
- **Log Inspection**: Confirm that multiple browser tabs show unique IDs in the Uvicorn logs.
- **Functionality**: Ensure real-time updates still work across all tabs.
- **Tests**: Run existing WebSocket tests in `backend/tests/test_websocket.py`.
