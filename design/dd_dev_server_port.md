# Design Doc: Expose the User Dev Server on Container Port 1224

## 1. Background

Pipelines can define **serve commands** (`Pipeline.serve_commands`). When the user
presses *Start* in the dashboard, the request hits the `dev_server` router
(`backend/api/src/api/routes/dev_server.py`), which delegates to the process-wide
singleton `DevProcessManager`
(`backend/core/src/core/services/dev_process_manager.py`). The manager spawns the
configured argv lists as long-running background subprocesses in the pipeline
workspace, with stdout/stderr captured and single-instance enforcement per
pipeline.

Today those dev processes are **unreachable from the host**:

- The `Dockerfile` only declares `EXPOSE 8000` and sets `ENV PORT=8081`; there is
  no notion of a dev-server port.
- `docker-compose.yml` only publishes `"${PORT:-8081}:${PORT:-8081}"` (the API
  port). A dev server started inside the container listens on a container-local
  interface that is never mapped out.
- Subprocesses inherit the container environment verbatim, so a user command
  like `npm run dev` binds to whatever default its framework picks — with no
  guarantee it matches a published port.

Goal: make a dev server started by the user **reachable from the Docker host** at
a single, well-known, configurable port (default **1224**), with minimal moving
parts and without breaking existing deployments.

## 2. Proposed Changes

The change is a *global* dev-server port (one value for the whole container), not
per-pipeline: Docker port publishing is fixed at container-start time and cannot
be re-mapped when a pipeline is started. A single published port is therefore the
only option that does not require restarting the container. The common case — one
person running one dev server at a time — works cleanly.

### 2.1 Configuration (`core/config.py`)

Add a single source of truth, following the existing env-var conventions in the
module:

```python
# Port on which a user-started pipeline dev server is expected to listen inside
# the container. It is published to the host via docker-compose.yml and injected
# into the dev-process environment by DevProcessManager. Must be an integer.
try:
    DEV_SERVER_PORT = int(os.getenv("DEV_SERVER_PORT", "1224"))
except ValueError as e:
    raise RuntimeError("DEV_SERVER_PORT must be an integer") from e
```

This keeps parsing/validation in one place (as `REMOTE_PR_MODE` already does) so
both the manager and tests read the same value.

### 2.2 `DevProcessManager` (`core/services/dev_process_manager.py`)

The manager is the only component that spawns the process, so it owns the
environment contract:

1. **Inject the port into the child environment.** `asyncio.create_subprocess_exec`
   currently passes no `env`, so the child inherits `os.environ`. Build an
   explicit environment that copies the parent and overrides the port keys:

   ```python
   env = {
       **os.environ,
       "DEV_SERVER_PORT": str(config.DEV_SERVER_PORT),
       # Many frameworks (Vite/CRA, uvicorn --port, express) read PORT; set it so
       # user serve commands bind to the published port by default.
       "PORT": str(config.DEV_SERVER_PORT),
   }
   ```

   `PORT` is overridden **only in the child**, so the API's own `PORT` is
   unaffected. This makes zero-config commands (`npm run dev`,
   `uvicorn ... --port $PORT`) work without the user hard-coding the port.

2. **Expose the port in the lifecycle responses.** Add `"port": config.DEV_SERVER_PORT`
   to the dicts returned by `start()` and `status()` so callers/UI can render the
   reachable URL without knowing the config. `stop()` already returns `pid: None`;
   leave it unchanged apart from keeping the shape consistent if desired.

No change to locking, single-instance enforcement, output capture, or process-group
termination is needed — the port is orthogonal to process control.

### 2.3 Dev router (`api/routes/dev_server.py`)

The router stays a thin pass-through: because `start()`/`status()` now include
`port`, the existing endpoints surface it automatically. No new endpoints are
required.

### 2.4 `Dockerfile`

Declare the port so it is discoverable and matches the runtime default:

```dockerfile
ENV DEV_SERVER_PORT=1224
...
EXPOSE 8000 1224
```

`EXPOSE` is documentation/`--publish-all` metadata; the actual host mapping is done
by compose (below). Keeping `ENV` here means the container has the value even when
run directly with `docker run`.

### 2.5 `docker-compose.yml`

Publish the dev-server port alongside the API port:

```yaml
ports:
  - "${PORT:-8081}:${PORT:-8081}"
  - "${DEV_SERVER_PORT:-1224}:${DEV_SERVER_PORT:-1224}"
```

Since `DEV_SERVER_PORT` is present in `/etc/ajapopaja-build.env`, it is already
forwarded into the container by `env_file` (see INSTALL.md §3.3) **and** is
available for `${...}` interpolation, so the container-side value and the published
host port always agree.

### 2.6 Deploy/docs (`INSTALL.md`, `deploy-local.sh`, `Dockerfile` comment)

- `INSTALL.md` §3.1 example env file and §3.2 variable reference: add
  `DEV_SERVER_PORT` (No; default `1224`; *port published to the host on which a
  user-started pipeline dev server listens*).
- `INSTALL.md` §4.2 compose snippet: add the new `ports` line.
- `deploy-local.sh`: seed `DEV_SERVER_PORT=1224` in the generated env file.
- The Serve-commands hint in `PipelineEditDialog.ts` mentions the port is injected
  as `$DEV_SERVER_PORT` / `$PORT`.

### 2.7 Security / exposure note

Publishing the dev port makes whatever the user runs reachable on the host
network. Because `docker-compose.yml` currently publishes the API port on all
interfaces, we match that behavior for consistency; a hardening option is to bind
to loopback only (`"127.0.0.1:${DEV_SERVER_PORT:-1224}:${DEV_SERVER_PORT:-1224}"`).
This is documented rather than enforced to avoid changing existing API exposure
semantics.

## 3. Alternatives Considered

- **Per-pipeline ports.** Each pipeline could get its own port (e.g. stored on
  `Pipeline`), but Docker port mappings are fixed at container start, so this
  would require recreating the container (or a dynamic reverse proxy) whenever a
  pipeline starts — far more complexity than the feature warrants. Rejected in
  favor of one global port.
- **No env injection, docs only.** Just `EXPOSE 1224` and compose mapping, leaving
  users to hard-code `--port 1224`. Simpler, but fragile (user forgets the flag)
  and inconsistent across frameworks. Rejected; injection is cheap and robust.
- **Reverse-proxy sidecar (nginx/traefik) on the API origin.** Would avoid a
  second published port but adds a component and routing config. Overkill for a
  single dev server; rejected.

## 4. Test Strategy

- **Config**: default `1224`, custom integer parsing, and `RuntimeError` on a
  non-integer value (`backend/tests/test_dev_server_config.py`).
- **`DevProcessManager`**: child env injection, `port` in `start()`/`status()`,
  and confirmation the parent environment is not mutated.
- **Routes**: the mocked `start`/`status` responses carry `port` and the router
  passes it through.
- **Static check**: `Dockerfile`, `docker-compose.yml`, and `deploy-local.sh`
  all advertise the dev-server port (`backend/tests/test_deployment_ports.py`).

## 5. Rollout & Backward Compatibility

- Defaults preserve current behavior: existing deployments that do not set
  `DEV_SERVER_PORT` get `1224`; the extra published port is additive.
- `PORT` is only overridden inside dev subprocesses, never for the API process, so
  the API keeps listening on its configured `PORT`.
- Users upgrading must re-copy `docker-compose.yml` (the `deploy-local.sh` script
  already does this) and restart the service.
