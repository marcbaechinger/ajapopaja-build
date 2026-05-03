# Backend API Design Document (`dd_backend_api.md`)

## 1. Overview

This document defines the architecture and design patterns for the Ajapopaja Build FastAPI backend. The goals are to ensure consistent routing, decouple database access from endpoint logic, and provide a robust, real‑time communication layer via WebSockets.

## 2. Router Design & Naming Conventions

The API is organized into feature‑based routers (e.g., `PipelineRouter`, `TaskRouter`) to keep the codebase modular.

### URI Naming Convention

- **Plural nouns** for collections: `/pipelines`, `/tasks`.
- **Nesting** for child resources: `/pipelines/{id}/tasks`.
- **Verbs** for specific actions (if not standard CRUD): `/tasks/{id}/retry`.
- **Kebab‑case** for multi‑word paths: `/user-settings`.

### Standard Endpoints

| Resource | Method | URI | Description |
| :--- | :--- | :--- | :--- |
| **Pipeline** | GET | `/pipelines` | List all pipelines. |
| | POST | `/pipelines` | Create a new pipeline. |
| | GET | `/pipelines/{id}` | Get details of a single pipeline. |
| **Task** | GET | `/pipelines/{id}/tasks` | List all tasks for a pipeline. |
| | POST | `/pipelines/{id}/tasks` | Create a task in a pipeline. |
| | PATCH | `/tasks/{id}` | Update task (status, title, etc.). |

## 2.1 Editor Commands Router

The `editor` router exposes endpoints for executing editor‑specific actions. The primary endpoint is `POST /editor/quickfix/{task_id}`, which opens a quickfix list in Neovim for the specified task. A generic endpoint `POST /editor/call/{command}` allows future editor commands to be added without changing the API contract. These routes are protected by authentication and use the same dependency injection as other routers.

### Endpoints

| Method | URI | Description | Parameters |
|--------|-----|-------------|------------|
| POST | `/editor/quickfix/{task_id}` | Opens Neovim quickfix list for a task. | `task_id` path parameter; user authentication via JWT. |
| POST | `/editor/call/{command}` | Invokes an editor command by name. | `command` path parameter; JSON body with options. |

## 3. Decoupling Database Access

We follow a **Repository/Query Pattern** to prevent Beanie/MongoDB logic from leaking into the routers.

Database access is separated into feature‑based modules within a `queries/` directory (e.g., `queries/pipeline.py`, `queries/task.py`, `queries/dashboard.py`).

- **Endpoints**: Responsible for request validation, security, and response formatting.
- **Query Modules**: Dedicated Python modules containing functions that perform the actual DB operations.
- **Benefits**: Easier testing, swappable persistence layers, and cleaner endpoint logic.

**Example Structure:**

```python
# In backend/core/src/core/queries/pipeline.py
async def get_all_pipelines() -> List[Pipeline]:
    return await Pipeline.find_all().to_list()

# In backend/api/src/api/routes/pipeline.py
from core.queries import pipeline as pipeline_queries

@router.get("/", response_model=List[Pipeline])
async def list_pipelines():
    return await pipeline_queries.get_all_pipelines()
```

## 4. Error Handling & HTTP Mapping

A centralized exception handler translates internal domain errors into appropriate HTTP responses.

| Domain/DB Error | HTTP Status | Description |
| :--- | :--- | :--- |
| `EntityNotFoundError` | `404 Not Found` | Resource does not exist. |
| `VersionMismatchError` | `409 Conflict` | OCC conflict (Optimistic Concurrency Control). |
| `ValidationError` | `422 Unprocessable Entity` | Invalid input data. |
| `UnauthorizedError` | `401 Unauthorized` | Missing or invalid authentication. |

## 5. WebSocket Communication

The backend provides a single WebSocket endpoint (`/ws`) for real‑time, bi‑directional communication.

### Generic Message Protocol

All messages follow a common JSON structure:

```json
{
  "type": "MESSAGE_NAME",
  "id": "optional-correlation-id",
  "payload": { ... }
}
```

### Supported Protocols & Message Types

- **Global Events**: `TASK_UPDATED`, `GEMINI_PROCESS_STARTED`, `VIBE_PROCESS_STOPPED`, etc., broadcasted by the server.
- **AI Assistant Protocol**: Bidirectional messages for the integrated Assistant, including `assistant_message`, `assistant_response`, `assistant_error`, `assistant_load_history`, and tool negotiation messages (`assistant_confirm`, `assistant_reject`).
- **Log Streaming**: Backend logic allows streaming logs via WebSockets or Fetch streams for background execution processes.

### Server Responsibilities

- **Connection Management**: Track active client connections.
- **Broadcasting**: Send updates (e.g., `TASK_STATUS_CHANGED`) to relevant clients.
- **Message Handling**: Extensible registry for handling incoming client messages.

### Message Registry (Server Side)

Similar to the frontend, the server maintains a registry of handlers mapped to message `type`. This allows adding new real‑time features without modifying the core WebSocket loop.

## 6. MCP Interface

The system provides a Model Context Protocol (MCP) server allowing AI agents to interact with the pipeline autonomously.

### Core MCP Tools

- **`get_next_task`**: Fetches and reserves the next scheduled task for an agent.
- **`update_task_design_doc`**: Allows agents to propose implementation plans.
- **`complete_task`**: Finalizes implementation with commit references and summaries.
- **`get_task_status`**: Polls for verification results or current state.

- **MCP Server**: `backend/mcp/src/ajapopaja_mcp/server.py`

## 7. Implementation Strategy

1. **Refactor `main.py`**: Move existing logic into `routes/` and `repositories/`.
2. **Add OCC Support**: Update models to include a `version` field and implement version checks in repository functions.

## 8. Authentication & Security

The backend implements the **OAuth2 Password Bearer** flow for securing API access.

### 8.1. Authentication Implementation

- **JWT**: Tokens are issued using the **HS256** algorithm with a configurable `AUTH_SECRET_KEY`.
- **Token Expiration**: Access tokens expire after 30 minutes; refresh tokens are valid for 7 days.
- **Password Security**: User passwords are never stored in plain text; they are hashed using **bcrypt** before persistence in MongoDB.
- **Protected Routes**: Most endpoints in the `/api` prefix require an `Authorization: Bearer <token>` header.

### 8.2. WebSocket Handshake Security

Since standard browser `WebSocket` APIs do not support setting custom headers, the server allows authentication via a `token` query parameter during the initial handshake:

- **Endpoint**: `/ws/{client_id}?token=<jwt>`
- **Validation**: The server decodes and validates the JWT; if invalid or missing, the connection is closed immediately with a `4001` (Unauthorized) policy violation code.

### 8.3. Log Redaction

To prevent sensitive information (like JWTs) from leaking into access logs, the backend implements a custom `logging.Filter` (`TokenRedactionFilter`). This filter automatically identifies and redacts the `token` query parameter from all Uvicorn access and error logs before they are written to the console or files.
