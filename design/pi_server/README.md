# Pi Process Server — Design Overview

This directory holds the design for a **standalone Pi process manager server**: a
separately deployable service that owns the lifecycle of Pi coding-agent
processes and their durable state. Any remote UI (or CLI) can create, pause,
resume, archive and delete Pi sessions that are executed, stored and archived by
this server.

The server is a Node.js / TypeScript application because the Pi SDK is built for
Node.js; it drives Pi through `pi --mode rpc` subprocesses over std-I/O.

## Documents

| Document | Contents |
|----------|----------|
| [dd_architecture.md](dd_architecture.md) | Server architecture, components, session lifecycle state machine, on-disk layout. |
| [dd_git_workflow.md](dd_git_workflow.md) | Git workspace + pull-request workflow: clone, commit, submit, reconcile, sync. |
| [dd_rest_api.md](dd_rest_api.md) | Public REST API for remote session management. |
| [dd_websocket_protocol.md](dd_websocket_protocol.md) | WebSocket protocol, message envelope, message types and client-side rendering. |
| [dd_data_model_auth.md](dd_data_model_auth.md) | MongoDB collections/documents, token authentication, session access grants. |
| [dd_project_structure.md](dd_project_structure.md) | Node/TypeScript project layout, build tooling and dependency plan. |

## Scope

The server is intentionally *focused*: it owns the Pi process lifecycle, the
git workspace each session works in, and the pull requests produced from it.
Application-specific workflow domains (e.g. pipelines, task queues) stay out of
scope and are carried as opaque metadata on a session. This keeps the server
reusable by any UI.

## Key decisions (summary)

- One Pi process per *running* session; the manager enforces a concurrency cap.
- Pi is driven through `pi --mode rpc` subprocesses over std-I/O; the in-process
  SDK is a future escape hatch.
- Each session owns a git workspace cloned from a remote repo; commits become
  pull requests (no patch blob in the DB), reconciled back via webhook.
- Sessions are durable: a MongoDB record + an on-disk directory (native Pi
  session file, event log, workspace, metadata sidecar).
- Archiving is a distinct lifecycle state that moves a session to cold storage
  (compressed bundle) and releases the hot working directory.
- Token-based authentication (JWT + refresh, plus opaque API tokens stored
  hashed) and per-session access grants (owner / editor / viewer).
