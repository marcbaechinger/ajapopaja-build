# Pi Process Server — Design Overview

This directory holds the design for a **standalone Pi process manager server**. It
extracts the session-management functionality currently embedded in the
ajapopaja backend (`backend/api/src/api/coderbot/manager.py`,
`session.py`, `pi_rpc_process.py`, `pi_session_store.py`) into a separate,
independently deployable service. A remote UI (such as the ajapopaja UI) can then
create, pause, resume, archive and delete Pi sessions that are executed, stored
and archived by this server.

The server is a Node.js / TypeScript application because the Pi SDK is built for
Node.js; it uses the SDK in-process instead of the Python std-I/O `pi --mode rpc`
approach.

## Documents

| Document | Contents |
|----------|----------|
| [dd_architecture.md](dd_architecture.md) | Server architecture, components, session lifecycle state machine, on-disk layout. |
| [dd_rest_api.md](dd_rest_api.md) | Public REST API for remote session management. |
| [dd_websocket_protocol.md](dd_websocket_protocol.md) | WebSocket protocol, message envelope, message types and PiView mapping. |
| [dd_data_model_auth.md](dd_data_model_auth.md) | MongoDB collections/documents, token authentication, session access grants. |
| [dd_project_structure.md](dd_project_structure.md) | Node/TypeScript project layout, build tooling and dependency plan. |

## Scope

The server is intentionally *focused*: it owns the Pi process lifecycle and the
data needed to resume/render a session. It does **not** own ajapopaja's domain
concepts (pipelines, tasks, pull requests, Gitea, etc.). Those are either passed
through as opaque metadata on a session (e.g. `pipeline_id`, `task_id`) or live
entirely in the calling application. This keeps the server reusable by any UI.

## Key decisions (summary)

- One Pi process per *running* session; the manager enforces a concurrency cap.
- The Pi SDK is used **in-process**; a subprocess transport is kept as an
  escape hatch for isolation and cwd-per-process constraints.
- Sessions are durable: a MongoDB record + an on-disk directory (native Pi
  session file, event log, workspace, metadata sidecar).
- Archiving is a distinct lifecycle state that moves a session to cold storage
  (compressed bundle) and releases the hot working directory.
- Token-based authentication (JWT + refresh, plus opaque API tokens stored
  hashed) and per-session access grants (owner / editor / viewer).
