# Design Document: Pi Process Server — REST API

## 1. Overview

The server exposes a JSON REST API for remote session management. It is the
superset of the endpoints the ajapopaja `coderbot` router offers today
(`/coderbot/sessions`, `/coderbot/interactive/*`, `/coderbot/trigger/*`,
`/coderbot/stop/*`), reorganized under a `/v1/sessions` resource and extended
with archiving/restoring and git workspace + pull-request management
(see [dd_git_workflow.md](dd_git_workflow.md)).

All endpoints require a bearer token (`Authorization: Bearer <token>`) except
the auth/login and token-mint endpoints. Authorization is described in
[dd_data_model_auth.md](dd_data_model_auth.md).

Conventions:

- Base path: `/v1`.
- `{uid}` is the stable session identifier (UUID v4 string).
- Errors are `application/json` with a stable shape:
  `{ "error": { "code": "session_not_found", "message": "...", "details": {...} } }`
  and an appropriate HTTP status.

## 2. Resource model (session payload)

```jsonc
{
  "uid": "3f6c...",
  "kind": "interactive",            // "interactive" | "batch" (aliases coderbot)
  "status": "running",              // lifecycle state (§ architecture)
  "owner": "alice",
  "label": "refactor parser",
  "pipeline_id": "…",               // opaque caller metadata
  "task_id": "…",
  "pi_session_id": "…",
  "pi_session_file": "/data/…/sessions/<uid>/pi-sessions/--cwd--/….jsonl",
  "session_dir": "/data/…/sessions/<uid>/pi-sessions",
  "cwd": "/repo/…",
  "repo_uri": "https://gitea/org/repo.git",   // remote origin (when cloned)
  "workspace_path": "/data/…/sessions/<uid>/workspace",
  "model": "gpt-oss:120",
  "skill_names": ["ajapopaja"],
  "bot_type": "interactive",
  "resume_count": 2,
  "last_error": null,
  "created_at": "2026-…",
  "updated_at": "2026-…",
  "last_active_at": "2026-…",
  "archived_at": null
}
```

## 3. Endpoints

### 3.1 Auth (no session access required)

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/v1/auth/login` | Exchange username/password for an access + refresh token. |
| `POST` | `/v1/auth/refresh` | Refresh an access token. |
| `POST` | `/v1/auth/tokens` | Mint a personal access token (returns once; stores hash). |
| `GET`  | `/v1/auth/tokens` | List your tokens (metadata only). |
| `DELETE` | `/v1/auth/tokens/{id}` | Revoke a token. |

### 3.2 Session lifecycle

| Method | Path | Purpose | Status codes |
|--------|------|---------|--------------|
| `POST` | `/v1/sessions` | Create + start a session. | `201`, `400`, `401`, `403`, `409` |
| `GET` | `/v1/sessions` | List sessions (filter by `kind`, `status`, `owner`, `pipeline_id`, `archived`). | `200` |
| `GET` | `/v1/sessions/{uid}` | Session detail. | `200`, `404`, `403` |
| `PATCH` | `/v1/sessions/{uid}` | Update mutable fields (`label`, `model`). | `200`, `404`, `403` |
| `POST` | `/v1/sessions/{uid}/pause` | Persist + stop, keep resumable. | `200`, `404`, `409`, `403` |
| `POST` | `/v1/sessions/{uid}/resume` | Respawn Pi with stored session file. | `200`, `400`, `404`, `409`, `403` |
| `POST` | `/v1/sessions/{uid}/message` | Send a prompt (interactive turn or batch follow-up). | `202`, `404`, `409`, `403` |
| `POST` | `/v1/sessions/{uid}/archive` | Pause + move to cold storage. | `202`, `404`, `409`, `403` |
| `POST` | `/v1/sessions/{uid}/restore` | Materialize an archived session back to `paused`. | `200`, `404`, `409`, `403` |
| `DELETE` | `/v1/sessions/{uid}` | Permanently delete record + artifacts. | `204`, `404`, `409`, `403` |
| `GET` | `/v1/sessions/{uid}/history` | Raw Pi events for UI replay. | `200`, `404`, `403` |
| `GET` | `/v1/sessions/{uid}/messages` | Final `AgentMessage[]` via Pi `get_messages` (best-effort, live only). | `200`, `404` |

### 3.3 Grants (session access)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/v1/sessions/{uid}/grants` | List access grants. |
| `PUT` | `/v1/sessions/{uid}/grants/{username}` | Grant `viewer`/`editor`/`owner` to a user. |
| `DELETE` | `/v1/sessions/{uid}/grants/{username}` | Revoke a grant. |

### 3.4 Git workspace

| Method | Path | Purpose | Status codes |
|--------|------|---------|--------------|
| `GET` | `/v1/sessions/{uid}/git/status` | Working-tree status: branch, `HEAD`, ahead/behind vs `origin`, dirty files, recent commits, local `pi/*` branches. | `200`, `404`, `403` |
| `POST` | `/v1/sessions/{uid}/git/sync` | `git fetch origin` (always) + fast-forward pull of the default branch when the session is idle. | `200`, `404`, `409`, `403` |
| `POST` | `/v1/sessions/{uid}/git/commit` | Stage + commit the working tree on the feature branch (`message`, `branch_name`); returns the commit sha. | `200`, `404`, `409`, `403` |

### 3.5 Pull requests

| Method | Path | Purpose | Status codes |
|--------|------|---------|--------------|
| `GET` | `/v1/pull_requests` | List PRs (filter by `session_uid`, `status`, `repo_uri`). | `200` |
| `GET` | `/v1/pull_requests/{pr_id}` | PR detail. | `200`, `404`, `403` |
| `POST` | `/v1/pull_requests` | Create a PR from the session's current branch/commits (`session_uid`, `branch_name?`, `title`, `body?`). | `201`, `400`, `403`, `409` |
| `PATCH` | `/v1/pull_requests/{pr_id}` | Update `title`/`body`. | `200`, `404`, `403` |
| `POST` | `/v1/pull_requests/{pr_id}/submit` | Push the feature branch + create the remote PR → `submitted`. | `200`, `404`, `409`, `403` |
| `POST` | `/v1/pull_requests/{pr_id}/reject` | Local reject → `rejected`. | `200`, `404`, `409`, `403` |
| `GET` | `/v1/pull_requests/{pr_id}/diff` | Re-derived `git diff base_commit head_commit`. | `200`, `404`, `403` |

### 3.6 Webhook (inbound)

| Method | Path | Purpose | Status codes |
|--------|------|---------|--------------|
| `POST` | `/v1/hooks/gitea/pr-state` | Gitea PR/push event receiver (HMAC); mirrors remote PR state. No user JWT. | `200`, `202`, `400` |

## 4. Request/response examples

### Create

```http
POST /v1/sessions
Authorization: Bearer <access-token>
Content-Type: application/json

{
  "kind": "interactive",
  "label": "refactor parser",
  "cwd": "/repo/example",          // or pipeline_id, resolved server-side
  "repo_uri": "https://gitea/org/example.git", // optional; cloned if set
  "model": "gpt-oss:120",          // optional; else server default
  "skill_names": ["ajapopaja"],
  "metadata": { "pipeline_id": "…", "task_id": "…" }  // opaque passthrough
}
```

```http
201 Created
Location: /v1/sessions/3f6c...
{ "session": { "uid": "3f6c...", "status": "running", ... } }
```

### Resume with a follow-up prompt

```http
POST /v1/sessions/3f6c.../resume
Content-Type: application/json

{ "pause_current": true, "message": "continue with the remaining TODOs" }
```

### Archive

```http
POST /v1/sessions/3f6c.../archive
```

`202 Accepted` — archiving runs asynchronously; the client observes
`session.archived` over the WebSocket (or polls `GET /v1/sessions/{uid}`).

## 5. Error codes

| HTTP | code | Meaning |
|------|------|---------|
| 400 | `invalid_request` | Malformed body / bad transition. |
| 401 | `unauthorized` | Missing/invalid/expired token. |
| 403 | `forbidden` | No access to the session or insufficient role. |
| 404 | `session_not_found` / `not_found` | Unknown `uid`. |
| 409 | `session_busy` | A turn is in flight / another session running. |
| 409 | `already_running` | A running session blocks the operation. |
| 409 | `invalid_state` | Operation not allowed in current state (e.g. pause an archived session). |
| 429 | `rate_limited` | Too many requests / sessions. |
| 409 | `git_dirty` | The working tree has uncommitted changes blocking the operation. |
| 409 | `pr_not_submittable` | PR is not in `open` state / branch or commits are missing. |

## 6. Relationship to the current ajapopaja API

| Today (`/api/coderbot/...`) | This server (`/v1/...`) |
|-----------------------------|--------------------------|
| `GET /sessions` | `GET /sessions` |
| `POST /sessions` | `POST /sessions` |
| `GET /sessions/{uid}` | `GET /sessions/{uid}` |
| `PATCH /sessions/{uid}` | `PATCH /sessions/{uid}` |
| `POST /sessions/{uid}/pause` | `POST /sessions/{uid}/pause` |
| `POST /sessions/{uid}/resume` | `POST /sessions/{uid}/resume` |
| `POST /sessions/{uid}/message` | `POST /sessions/{uid}/message` |
| `POST /sessions/{uid}/discard` | `DELETE /sessions/{uid}` (delete) or `POST .../archive` (cold) |
| `GET /sessions/{uid}/history` | `GET /sessions/{uid}/history` |
| `GET /sessions/{uid}/messages` | `GET /sessions/{uid}/messages` |
| `POST /interactive/start/{pipeline_id}` | `POST /sessions` with `kind=interactive` |
| `POST /interactive/message` | `POST /sessions/{uid}/message` |
| `POST /interactive/stop` | `POST /sessions/{uid}/pause` |
| `POST /trigger/{task_id}`, `POST /stop/{task_id}` | caller-side; not owned by this server |

The `discard` semantics split into **delete** (permanent) and **archive**
(recoverable), which is the new capability this server adds on top of the
current backend.
