# Design Document: Pi Process Server — Node/TypeScript Project Structure

## 1. Overview

The server is a Node.js / TypeScript application to stay close to the Pi SDK
(which is built for Node.js). It drives Pi through `pi --mode rpc` subprocesses
(via the SDK's `RpcClient`), manages each session's git workspace, and uses
MongoDB for bookkeeping plus a small HTTP/WebSocket stack for the remote API.

This is a **separate project** (not part of the current monorepo). The layout
below is a first skeleton; implementation details can be filled in incrementally.

## 2. Runtime & language

- **Runtime:** Node.js LTS (>= 20). ESM modules.
- **Language:** TypeScript, strict mode.
- **Package manager:** npm (pnpm optional).
- **Primary dependency:** the Pi SDK package (for `RpcClient` over `pi --mode rpc`)
  plus a runnable Pi CLI binary; pin the exact package at implementation time.
- **Git:** `simple-git` (or `isomorphic-git`) for clone/commit/branch/sync.

## 3. Proposed layout

```text
pi-process-server/
├── package.json
├── tsconfig.json
├── tsconfig.build.json
├── .eslintrc.cjs
├── .prettierrc
├── vitest.config.ts
├── .env.example
├── Dockerfile
├── README.md
├── src/
│   ├── index.ts                    # entrypoint: wire config -> app -> listen
│   ├── config.ts                   # env parsing + validation (zod)
│   ├── server/
│   │   ├── app.ts                  # HTTP + WS composition
│   │   ├── http/
│   │   │   ├── router.ts
│   │   │   ├── auth.ts             # login/refresh/token endpoints
│   │   │   ├── sessions.ts         # lifecycle endpoints
│   │   │   ├── grants.ts
│   │   │   ├── git.ts              # git status/sync/commit endpoints
│   │   │   ├── pull_requests.ts    # PR lifecycle endpoints
│   │   │   └── hooks.ts            # Gitea pr-state webhook receiver
│   │   ├── ws/
│   │   │   ├── gateway.ts          # handshake, subscribe, fan-out
│   │   │   └── protocol.ts         # message envelope + types
│   │   └── middleware/
│   │       ├── authn.ts            # bearer/JWT/PAT resolution
│   │       └── authz.ts            # grant enforcement
│   ├── session/
│   │   ├── manager.ts              # SessionManager (registry + state machine)
│   │   ├── handle.ts               # SessionHandle (record + live runner)
│   │   ├── lifecycle.ts            # state transitions / guards
│   │   └── reconcile.ts            # startup reconciliation
│   ├── runner/
│   │   ├── types.ts                # SessionRunner interface
│   │   ├── subprocess-runner.ts    # pi --mode rpc via RpcClient (default)
│   │   ├── sdk-runner.ts           # in-process Pi SDK (future)
│   │   └── events.ts               # PiEvent -> ServerEvent mapping
│   ├── git/
│   │   ├── service.ts              # clone/init, branch, commit, fetch/pull
│   │   ├── status.ts               # working-tree status
│   │   └── auth.ts                 # credential resolution (http.extraHeader)
│   ├── pr/
│   │   ├── manager.ts              # PullRequestManager (records + lifecycle)
│   │   ├── submit.ts               # push + remote PR creation
│   │   └── reconcile.ts            # webhook/poller state mirroring
│   ├── store/
│   │   ├── mongo.ts                # connection + collections
│   │   ├── models/
│   │   │   ├── user.ts
│   │   │   ├── api-token.ts
│   │   │   ├── session.ts
│   │   │   ├── grant.ts
│   │   │   └── pull-request.ts
│   │   └── queries/                # typed accessors
│   ├── fs/
│   │   ├── layout.ts               # PI_SERVER_ROOT layout helpers
│   │   ├── event-log.ts            # events.jsonl append/read
│   │   ├── meta.ts                 # meta.json sidecar
│   │   └── archive.ts              # tar.zst pack/unpack
│   ├── bus/
│   │   └── event-bus.ts            # in-process pub/sub
│   └── util/
│       ├── ids.ts                  # uid generation
│       ├── errors.ts               # typed error -> HTTP mapping
│       └── logger.ts
└── test/
    ├── unit/                       # manager, lifecycle, fs, auth
    ├── integration/                # HTTP + Mongo (mongodb-memory-server)
    └── fixtures/
```

## 4. Key modules

| Module | Responsibility | Ports from (today) |
|--------|----------------|--------------------|
| `session/manager.ts` | registry, concurrency guard, lifecycle ops, reconcile | `CoderBotManager` |
| `session/lifecycle.ts` | state machine + transitions + guards | status enum logic |
| `runner/subprocess-runner.ts` | spawn `pi --mode rpc` via `RpcClient`, capture identity, relay events | `PiRpcProcess` verbatim |
| `runner/sdk-runner.ts` | in-process Pi SDK (future) | `InteractivePiSession` |
| `store/models/session.ts` | `PiSession` document | `PiSession` model |
| `fs/layout.ts` + `fs/event-log.ts` + `fs/meta.ts` | on-disk layout, event replay, crash sidecar | `pi_session_store.py` |
| `fs/archive.ts` | archive/restore bundles | new |
| `server/ws/protocol.ts` | WS envelope + types + legacy aliases | `websocket_manager.py` + `WSMessage` |
| `server/middleware/authn.ts` + `authz.ts` | token resolution + grant checks | `api/auth.py` |
| `git/service.ts` + `git/status.ts` | workspace clone/commit/sync + status | `SandboxGitHelper` + `git_helper.py` |
| `pr/manager.ts` + `pr/submit.ts` + `pr/reconcile.ts` | PR records, remote submission, reconciliation | `routes/pull_request.py` + `GiteaClient` |
| `server/http/hooks.ts` | Gitea `pr-state` webhook receiver | `api/git_hosting/*` |

## 5. Dependencies (npm)

Runtime:

- `@pi/agent` (Pi SDK) — `RpcClient` for the `pi --mode rpc` subprocess runner.
- `simple-git` — clone/commit/branch/fetch/pull in the session workspace.
- `fastify` (or `express`) + `@fastify/websocket` — HTTP + WS.
- `mongodb` (official driver) or `mongoose` — Mongo access.
- `argon2` — password hashing; `jsonwebtoken` (or `jose`) — JWT.
- `zod` — config/request validation.
- `pino` — logging.
- `async-mutex` — per-lane locks.
- `tar` + `zstd`/`zlib` — archive bundles.
- `gitea-api` (or plain `fetch` against Gitea's REST API) — remote PR creation + webhook registration.

Dev:

- `typescript`, `tsx` (dev runner), `tsup`/`esbuild` (build).
- `vitest` — tests.
- `mongodb-memory-server` — integration tests without a real Mongo.
- `eslint` + `@typescript-eslint`, `prettier`.

## 6. Build & run

```jsonc
// package.json scripts (sketch)
{
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.build.json",       // or tsup src/index.ts --format esm
    "start": "node dist/index.js",
    "lint": "eslint src test",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

Build outputs to `dist/` (ESM, NodeNext). CI runs `lint` + `typecheck` + `test`
+ `build`.

## 7. Configuration (env)

| Variable | Default | Meaning |
|----------|---------|---------|
| `PI_SERVER_ROOT` | `./data/pi-server` | Root of session dirs + archives. |
| `MONGODB_URI` | `mongodb://localhost:27017` | MongoDB connection. |
| `MONGODB_DB` | `pi_server` | Database name. |
| `AUTH_JWT_SECRET` | *(required; warn on dev default)* | JWT signing secret. |
| `AUTH_ACCESS_TTL` | `15m` | Access token lifetime. |
| `AUTH_REFRESH_TTL` | `7d` | Refresh token lifetime. |
| `AUTH_PAT_PREFIX` | `psrv_` | PAT prefix for lookups. |
| `PI_SERVER_PORT` | `8080` | HTTP/WS listen port. |
| `PI_SESSION_PERSISTENCE_ENABLED` | `true` | Master switch (fall back to `--no-session`). |
| `PI_SESSION_EVENT_LOG_ENABLED` | `true` | Write `events.jsonl`. |
| `PI_SESSION_RETAIN_WORKSPACE` | `true` | Keep batch workspace for resume. |
| `PI_SESSION_WORKSPACE_TTL_DAYS` | `14` | GC age for non-running workspaces. |
| `PI_SESSION_AUTO_RESUME` | `false` | Restore newest interactive at startup. |
| `PI_SESSION_MAX_RUNNING` | `2` | Running lanes (1 batch + 1 interactive). |
| `ARCHIVE_KEY` | *(unset)* | Optional archive encryption key. |
| `GIT_PUSH_USERNAME` | *(empty)* | Global username for push/PR to remote repos. |
| `GIT_PUSH_TOKEN` | *(empty)* | Global token for push/PR (repo write scope). |
| `GITEA_WEBHOOK_SECRET` | *(empty)* | HMAC secret for the `pr-state` webhook. |
| `GITEA_PR_POLL_ENABLED` | `false` | Enable the polling PR reconciler. |
| `GITEA_PR_POLL_INTERVAL` | `60` | Poll interval (seconds). |
| `PI_SERVER_PUBLIC_URL` | *(empty)* | Public base URL used to build webhook targets. |

## 8. Why the subprocess runner (and when to use the SDK)

- **Subprocess (`subprocess-runner.ts`)** is the default: it drives `pi --mode rpc`
  over std-I/O (via the SDK `RpcClient` or a ported `PiRpcProcess`), which gives
  OS-level process isolation, one process per session `cwd`, and parity with the
  current Python backend — including the built-in codemode/MCP extensions the CLI
  loads automatically.
- **In-process (`sdk-runner.ts`)** is a future escape hatch for SDK-only features
  (fork/import, session introspection, custom resource loaders).

Both implement `SessionRunner`, so the manager is agnostic to the transport.

## 9. Incremental build plan

1. **Skeleton:** config, logger, HTTP server, Mongo connection, `/health`.
2. **Runner:** `subprocess-runner.ts` (port of `PiRpcProcess`) first, to reach
   parity with the current backend quickly; then `sdk-runner.ts`.
3. **Manager + lifecycle:** registry, create/pause/resume, concurrency, reconcile.
4. **Storage:** layout, event log, meta sidecar, archive/restore.
5. **Git + PR:** workspace clone/init, commit/sync, PR records, submit, webhook/poller reconcile.
6. **Auth + grants:** login/refresh, PATs, grant middleware.
7. **WebSocket:** gateway, subscription, fan-out, legacy aliases.
8. **Hardening:** tests, Dockerfile, docs.
