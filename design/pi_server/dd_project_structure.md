# Design Document: Pi Process Server — Node/TypeScript Project Structure

## 1. Overview

The server is a Node.js / TypeScript application to stay close to the Pi SDK
(which is built for Node.js). It uses the SDK in-process for running Pi sessions,
MongoDB for bookkeeping, and a small HTTP/WebSocket stack for the remote API.

This is a **separate project** (not part of the current monorepo). The layout
below is a first skeleton; implementation details can be filled in incrementally.

## 2. Runtime & language

- **Runtime:** Node.js LTS (>= 20). ESM modules.
- **Language:** TypeScript, strict mode.
- **Package manager:** npm (pnpm optional).
- **Primary dependency:** the Pi SDK (`@pi/agent` or equivalent package name
  from https://pi.dev/docs/latest/sdk — pin the exact package at implementation
  time).

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
│   │   │   └── grants.ts
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
│   │   ├── sdk-runner.ts           # in-process Pi SDK
│   │   ├── subprocess-runner.ts    # pi --mode rpc escape hatch
│   │   └── events.ts               # PiEvent -> ServerEvent mapping
│   ├── store/
│   │   ├── mongo.ts                # connection + collections
│   │   ├── models/
│   │   │   ├── user.ts
│   │   │   ├── api-token.ts
│   │   │   ├── session.ts
│   │   │   └── grant.ts
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
| `runner/sdk-runner.ts` | spawn Pi via SDK, capture identity, relay events | `PiRpcProcess` + `InteractivePiSession.start_interactive` |
| `runner/subprocess-runner.ts` | spawn `pi --mode rpc`, JSONL framing, `get_state` | `PiRpcProcess` verbatim |
| `store/models/session.ts` | `PiSession` document | `PiSession` model |
| `fs/layout.ts` + `fs/event-log.ts` + `fs/meta.ts` | on-disk layout, event replay, crash sidecar | `pi_session_store.py` |
| `fs/archive.ts` | archive/restore bundles | new |
| `server/ws/protocol.ts` | WS envelope + types + legacy aliases | `websocket_manager.py` + `WSMessage` |
| `server/middleware/authn.ts` + `authz.ts` | token resolution + grant checks | `api/auth.py` |

## 5. Dependencies (npm)

Runtime:

- `@pi/agent` (Pi SDK) — the core runner.
- `fastify` (or `express`) + `@fastify/websocket` — HTTP + WS.
- `mongodb` (official driver) or `mongoose` — Mongo access.
- `argon2` — password hashing; `jsonwebtoken` (or `jose`) — JWT.
- `zod` — config/request validation.
- `pino` — logging.
- `async-mutex` — per-lane locks.
- `tar` + `zstd`/`zlib` — archive bundles.

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

## 8. Why in-process SDK (and when to use the subprocess runner)

- **In-process (`sdk-runner.ts`)** is the default: it matches the SDK's Node
  platform, avoids JSONL framing/parsing code, and gives direct access to typed
  events and commands (`get_state`, `get_messages`, prompts).
- **Subprocess (`subprocess-runner.ts`)** is kept for two reasons: (1) a Pi
  process has a fixed `cwd`, so isolation or a crashed process is easier to reason
  about across a subprocess boundary; (2) it is a direct port of the proven
  Python `PiRpcProcess`, so it is the low-risk fallback if the SDK API changes.

Both implement `SessionRunner`, so the manager is agnostic to the transport.

## 9. Incremental build plan

1. **Skeleton:** config, logger, HTTP server, Mongo connection, `/health`.
2. **Runner:** `subprocess-runner.ts` (port of `PiRpcProcess`) first, to reach
   parity with the current backend quickly; then `sdk-runner.ts`.
3. **Manager + lifecycle:** registry, create/pause/resume, concurrency, reconcile.
4. **Storage:** layout, event log, meta sidecar, archive/restore.
5. **Auth + grants:** login/refresh, PATs, grant middleware.
6. **WebSocket:** gateway, subscription, fan-out, legacy aliases.
7. **Hardening:** tests, Dockerfile, docs.
