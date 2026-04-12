# Backend API Design Document (`dd_backend_api.md`)

## 1. Overview
This document defines the architecture and design patterns for the Ajapopaja Build FastAPI backend. The goals are to ensure consistent routing, decouple database access from endpoint logic, and provide a robust, real-time communication layer via WebSockets.

## 2. Router Design & Naming Conventions
The API is organized into feature-based routers (e.g., `PipelineRouter`, `TaskRouter`) to keep the codebase modular.

### URI Naming Convention
- **Plural nouns** for collections: `/pipelines`, `/tasks`.
- **Nesting** for child resources: `/pipelines/{id}/tasks`.
- **Verbs** for specific actions (if not standard CRUD): `/tasks/{id}/retry`.
- **Kebab-case** for multi-word paths: `/user-settings`.

### Standard Endpoints
| Resource | Method | URI | Description |
| :--- | :--- | :--- | :--- |
| **Pipeline** | GET | `/pipelines` | List all pipelines. |
| | POST | `/pipelines` | Create a new pipeline. |
| | GET | `/pipelines/{id}` | Get details of a single pipeline. |
| **Task** | GET | `/pipelines/{id}/tasks` | List all tasks for a pipeline. |
| | POST | `/pipelines/{id}/tasks` | Create a task in a pipeline. |
| | PATCH | `/tasks/{id}` | Update task (status, title, etc.). |

## 3. Decoupling Database Access
We follow a **Repository/Query Pattern** to prevent Beanie/MongoDB logic from leaking into the routers. 

Database access is separated into feature-based modules within a `queries/` directory (e.g., `queries/pipeline.py`, `queries/task.py`, `queries/dashboard.py`).

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
The backend provides a single WebSocket endpoint (`/ws`) for real-time, bi-directional communication.

### Generic Message Protocol
All messages follow a common JSON structure:
```json
{
  "type": "MESSAGE_NAME",
  "id": "optional-correlation-id",
  "payload": { ... }
}
```

### Server Responsibilities
- **Connection Management**: Track active client connections.
- **Broadcasting**: Send updates (e.g., `TASK_STATUS_CHANGED`) to relevant clients.
- **Message Handling**: Extensible registry for handling incoming client messages.

### Message Registry (Server Side)
Similar to the frontend, the server maintains a registry of handlers mapped to message `type`. This allows adding new real-time features without modifying the core WebSocket loop.

## 6. Implementation Strategy
1.  **Refactor `main.py`**: Move existing logic into `routes/` and `repositories/`.
2.  **Add OCC Support**: Update models to include a `version` field and implement version checks in repository functions.
3.  **Implement WebSocket Layer**: Create the `/ws` endpoint and message dispatcher.
