# Design: Staging Instance with an Independent "Fresh Start" Setup

Task: **Create a staging setup with a second Docker container**
(`6ac8016477e2755e5d033766`)

## 1. Goal

Run a **second, independent instance of Ajapopaja Build** next to the existing
production container. The staging instance must:

- have the same end-to-end flow *from source to Docker image* as production,
- listen on a **different port** (and a different dev-server port),
- point at a **clean MongoDB database** (or a small test data set) so a user can
  experience the first-run journey — register, create a first pipeline, create a
  first task, let it be implemented,
- never write into production state: not the production database, not the
  production Gitea repositories, and not the production host directories used
  for Pi sessions, bot sandboxes and cloned remote workspaces,
- be started with a command that is as close as possible to the current one:

  ```bash
  git pull && ./deploy-local.sh && sudo systemctl restart ajapopaja-build \
      && sudo journalctl -u ajapopaja-build -f
  ```

This document first inventories every external dependency and classifies it as
*read-only* or *stateful/write*, then proposes the minimal code and deployment
changes for an isolated staging instance.

## 2. Current production setup (baseline)

The deployed stack is intentionally small:

- **Image** `ajapopaja-build:latest`, built by `docker-build.sh` (multi-stage:
  Vite frontend → Python backend + Node/`pi` + bundled skills) and exported to
  `/data/ajapopaja/docker/ajapopaja-build.tar`.
- **`docker-compose.yml`** (installed to `/data/ajapopaja/docker-compose.yml`)
  defines one service `ajapopaja-build` with:
  - a fixed `container_name: ajapopaja-build`,
  - `env_file: /etc/ajapopaja-build.env`,
  - published ports `${PORT:-8081}` and `${DEV_SERVER_PORT:-1224}`,
  - volumes `/home`, `/Users`, `/tmp/nvimsocket` and
    `/data/ajapopaja/pi_sessions`.
- **`ajapopaja-build.service`** systemd unit with
  `EnvironmentFile=/etc/ajapopaja-build.env`, `WorkingDirectory=/data/ajapopaja`,
  loads the image tarball and runs `docker compose up`.
- **`deploy-local.sh`** builds the image, exports the tarball, installs the
  compose file, creates the env file on first run, and installs the service.

Everything is configured through `/etc/ajapopaja-build.env`; `env_file` forwards
every variable into the container automatically, and the same file is used by
systemd for `${PORT}` interpolation.

## 3. External dependency inventory

The app touches the following external systems. "Write" marks a dependency that
the application mutates and that therefore needs to be **fresh** for staging.

| Dependency | Reached via | Written by the app? | What is written | Prod value | Staging value |
| --- | --- | --- | --- | --- | --- |
| **MongoDB** | `MONGODB_URI` (TCP `host.docker.internal:27017`) | **Yes** (stateful) | pipelines, tasks, users, chats, design-doc history, PR records, Pi session metadata | DB `ajapopaja_build_prod` | DB `ajapopaja_build_staging` (separate DB on the same server) |
| **Ollama** | `OLLAMA_HOST` (HTTP `host.docker.internal:11434`) | No (inference only) | — | shared | shared |
| **Ollama cloud / API key** | `OLLAMA_API_KEY` | No | — | shared or own key | own key optional |
| **Gitea (git hosting)** | per-pipeline `repo_uri` + `repo_token`, global `GIT_PUSH_USERNAME`/`GIT_PUSH_TOKEN` | **Yes** (stateful) | feature branches, commits, pull requests, issue/PR comments | production repos | **separate staging repo(s)** (or a staging org/owner) |
| **Pi sessions** | `PI_SESSIONS_ROOT` (FS) | **Yes** | `events.jsonl`, session state per UID | `/data/ajapopaja/pi_sessions` | `/data/ajapopaja/staging/pi_sessions` |
| **Bot sandboxes** | `SANDBOX_ROOT` (FS) | **Yes** | cloned working trees, bot logs | `/data/ajapopaja/sandboxes` (currently inside the container, not mounted) | `/data/ajapopaja/staging/sandboxes` (mounted 1:1) |
| **Remote workspaces** | `REMOTE_WORKSPACES_ROOT` (FS) | **Yes** | clones of remote repos for remote pipelines | `/data/ajapopaja/remote_workspaces` | `/data/ajapopaja/staging/remote_workspaces` (mounted 1:1) |
| **Workspace root** | `WORKSPACES_ROOT` (FS) | **Yes** | local git operations on repos | `/home/marc-baechinger/monolit/code` | `/data/ajapopaja/staging/workspaces` (mounted 1:1) |
| **Neovim socket** | `NVIM_SOCKET` (unix socket) | Yes (editor buffers) | buffer edits made by the AI Assistant | `/tmp/nvimsocket` | shared (same host editor) |
| **Docker image + daemon** | local socket | image/container | image layers, container filesystem | image `ajapopaja-build:latest` | **same image**, container `ajapopaja-build-staging` |
| **systemd / journald** | local | unit + logs | unit state, logs | `ajapopaja-build.service` | `ajapopaja-build-staging.service` |
| **Secrets** | env | n/a | JWT secret, Gitea token, MCP token | `/etc/ajapopaja-build.env` | `/etc/ajapopaja-build-staging.env` |

### 3.1 Classification rules

1. **Stateful + write → fresh.** MongoDB, Gitea, and every filesystem root the
   app mutates get their own staging instance. This is the core requirement of
   the task and prevents staging runs from corrupting production pipelines,
   PRs, or sessions.
2. **Stateless inference → shared.** Ollama holds model weights but no
   per-instance application state. Sharing it costs nothing and avoids pulling
   the same multi-GB models twice.
3. **Shared read-only infrastructure → shared.** The Docker image and the
   Neovim socket are shared. `WORKSPACES_ROOT` is mounted read/write, but
   staging writes only inside its own staging workspace.
4. **Secrets → per instance.** A separate `AUTH_SECRET_KEY` guarantees that a
   JWT issued by production cannot be replayed against staging and vice versa.
   A separate Gitea token should be scoped to the staging repositories only.

### 3.2 Notable gaps in the current setup

- `SANDBOX_ROOT` and `REMOTE_WORKSPACES_ROOT` are **not mounted** today, so
  production sandboxes and clones live in the container's writable layer and
  vanish on every recreate. For staging we explicitly mount them so the
  "fresh / inspectable" host-directory requirement is met; doing the same for
  production is an optional (and reasonable) improvement.
- There is no `AUTH_SECRET_KEY` in `/etc/ajapopaja-build.env`, so production
  currently falls back to the development default. Staging must set its own.
- Both instances set a refresh cookie named `refresh_token`. Cookies are
  scoped by `(name, domain, path)` and **not** by port, so logging into
  staging overwrites production's refresh cookie (and vice versa). Each
  instance must use a distinct `REFRESH_COOKIE_NAME`; when it is unset the app
  derives the name from `DATABASE_NAME`, which is already distinct per
  instance.
- The `ajapopaja` Gitea push token is global (`GIT_PUSH_TOKEN`) unless a
  pipeline overrides it. Staging should override it (per-pipeline
  `repo_token`, or a staging value in the staging env file).

## 4. Proposed staging topology

| Aspect | Production | Staging |
| --- | --- | --- |
| Container name | `ajapopaja-build` | `ajapopaja-build-staging` |
| Compose project | `ajapopaja` | `ajapopaja-build-staging` |
| Web port | `8081` | `8082` |
| Dev-server port | `1224` | `1225` |
| Env file | `/etc/ajapopaja-build.env` | `/etc/ajapopaja-build-staging.env` |
| Compose working dir | `/data/ajapopaja` | `/data/ajapopaja/staging` |
| MongoDB database | `ajapopaja_build_prod` | `ajapopaja_build_staging` |
| Pi sessions | `/data/ajapopaja/pi_sessions` | `/data/ajapopaja/staging/pi_sessions` |
| Sandboxes | `/data/ajapopaja/sandboxes` | `/data/ajapopaja/staging/sandboxes` |
| Remote workspaces | `/data/ajapopaja/remote_workspaces` | `/data/ajapopaja/staging/remote_workspaces` |
| Workspace root | `/home/<user>/monolit/code` | `/data/ajapopaja/staging/workspaces` |
| systemd unit | `ajapopaja-build.service` | `ajapopaja-build-staging.service` |
| Image tarball | `/data/ajapopaja/docker/ajapopaja-build.tar` | **same tarball** (shared image) |

Staging is deliberately a **second instance of the same image**, not a second
image. There is therefore no second build pipeline to keep in sync: `git pull`
+ `./deploy-local.sh staging` rebuilds once and reloads the shared tarball.

## 5. Proposed changes

### 5.1 Parameterize `docker-compose.yml`

Make the writable roots, container name and env-file path configurable, keeping
today's values as defaults so an unchanged production env file behaves almost
exactly as before:

```yaml
services:
  ajapopaja-build:
    image: ajapopaja-build:latest
    container_name: ${CONTAINER_NAME:-ajapopaja-build}
    restart: always
    # env_file: the runtime variables for the container. The path is resolved
    # from the *interpolation* environment (systemd EnvironmentFile).
    env_file:
      - ${AJAPOPAJA_ENV_FILE:-/etc/ajapopaja-build.env}
    ports:
      - "${PORT:-8081}:${PORT:-8081}"
      - "${DEV_SERVER_PORT:-1224}:${DEV_SERVER_PORT:-1224}"
    volumes:
      # Shared read paths (repos outside the staging root, host editor socket).
      - /home:/home
      - /Users:/Users
      - /tmp/nvimsocket:/tmp/nvimsocket
      # Per-instance writable roots. Host and container paths MUST be identical:
      # Pi and the data models persist absolute paths.
      - ${PI_SESSIONS_ROOT:-/data/ajapopaja/pi_sessions}:${PI_SESSIONS_ROOT:-/data/ajapopaja/pi_sessions}
      - ${SANDBOX_ROOT:-/data/ajapopaja/sandboxes}:${SANDBOX_ROOT:-/data/ajapopaja/sandboxes}
      - ${REMOTE_WORKSPACES_ROOT:-/data/ajapopaja/remote_workspaces}:${REMOTE_WORKSPACES_ROOT:-/data/ajapopaja/remote_workspaces}
      - ${WORKSPACES_ROOT:-/home/marc-baechinger/monolit/code}:${WORKSPACES_ROOT:-/home/marc-baechinger/monolit/code}
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

Notes:

- The `${VAR:-default}` form means production keeps working with its current
  env file. The only production behaviour change is that `SANDBOX_ROOT`,
  `REMOTE_WORKSPACES_ROOT` and `WORKSPACES_ROOT` are now mounted (persisted)
  instead of living in the container layer. This is desirable but should be
  called out in the change log.
- Because compose interpolation reads the variables from the systemd
  `EnvironmentFile`, each unit resolves `${PORT}`, `${PI_SESSIONS_ROOT}`, …
  from its own env file. `env_file` then forwards the same values into the
  container.

**Alternative considered (rejected for now):** a separate
`docker-compose.staging.yml`. It is zero-risk for production but duplicates the
service definition and drifts. A single parameterized file is preferred.

### 5.2 `/etc/ajapopaja-build-staging.env`

```ini
# --- Instance identity -------------------------------------------------------
CONTAINER_NAME=ajapopaja-build-staging
AJAPOPAJA_ENV_FILE=/etc/ajapopaja-build-staging.env

# --- Database: a fresh, dedicated database ----------------------------------
MONGODB_URI=mongodb://host.docker.internal:27017/
DATABASE_NAME=ajapopaja_build_staging

# --- Ports: must differ from production --------------------------------------
PORT=8082
DEV_SERVER_PORT=1225

# --- Writable host directories (mounted 1:1) ---------------------------------
WORKSPACES_ROOT=/data/ajapopaja/staging/workspaces
PI_SESSIONS_ROOT=/data/ajapopaja/staging/pi_sessions
SANDBOX_ROOT=/data/ajapopaja/staging/sandboxes
REMOTE_WORKSPACES_ROOT=/data/ajapopaja/staging/remote_workspaces

# --- AI: shared, stateless ---------------------------------------------------
OLLAMA_HOST=http://host.docker.internal:11434
CODERBOT_DEFAULT_MODEL=deepseek-v4.1-flash:cloud

# --- Git hosting: point at staging repositories ------------------------------
REMOTE_PR_MODE=gitea_pr
GIT_PUSH_USERNAME=<staging-gitea-user>
GIT_PUSH_TOKEN=<staging-gitea-token>

# --- Secrets: never share with production ------------------------------------
AUTH_SECRET_KEY=<fresh-random-staging-secret>
# MCP_AUTHENTICATION_ENABLED=false
# MCP_AUTH_TOKEN=
```

The **production** env file stays where it is. To support the parameterized
compose file it only needs `CONTAINER_NAME=ajapopaja-build`,
`AJAPOPAJA_ENV_FILE=/etc/ajapopaja-build.env` and possibly an explicit
`AUTH_SECRET_KEY`; the remaining defaults apply.

### 5.3 `ajapopaja-build-staging.service`

A sibling unit; production's unit is left untouched.

```ini
[Unit]
Description=Ajapopaja Build Staging Service
After=docker.service
Requires=docker.service

[Service]
Restart=always
EnvironmentFile=/etc/ajapopaja-build-staging.env
WorkingDirectory=/data/ajapopaja/staging
ExecStartPre=-/usr/bin/docker compose -p ajapopaja-build-staging down
ExecStartPre=-/usr/bin/docker rm -f ajapopaja-build-staging
ExecStartPre=/usr/bin/docker load -i /data/ajapopaja/docker/ajapopaja-build.tar
ExecStart=/usr/bin/docker compose -p ajapopaja-build-staging up
ExecStop=/usr/bin/docker compose -p ajapopaja-build-staging down

[Install]
WantedBy=multi-user.target
```

`-p ajapopaja-build-staging` gives the compose project a unique name so the
two stacks never share networks or volumes, even though they live in different
directories. (Production can adopt `-p ajapopaja-build` for symmetry, but it is
not required because its `container_name` is already unique.)

**Future consolidation:** the two units can be replaced by one template unit
`ajapopaja-build@.service` using `%i` for the environment name
(`/etc/ajapopaja-build-%i.env`, `/data/ajapopaja/%i`, `-p ajapopaja-build-%i`).
This is cleaner long-term but requires renaming production's env file to
`/etc/ajapopaja-build-prod.env`; it is *not* required for this task.

### 5.4 Parameterize `deploy-local.sh`

Accept an optional environment name and reuse the existing build/export logic:

```bash
#!/bin/bash
set -e

ENV_NAME="${1:-prod}"
case "$ENV_NAME" in
  prod)    ENV_FILE="/etc/ajapopaja-build.env";           SERVICE="ajapopaja-build";           DATA_DIR="/data/ajapopaja" ;;
  *)       ENV_FILE="/etc/ajapopaja-build-${ENV_NAME}.env"; SERVICE="ajapopaja-build-${ENV_NAME}"; DATA_DIR="/data/ajapopaja/${ENV_NAME}" ;;
esac
DEST_DIR="/data/ajapopaja/docker"
IMAGE_NAME="ajapopaja-build"
VERSION="latest"

echo "1. Building Docker image..."
./docker-build.sh "$VERSION"

echo "2. Ensuring directories exist..."
sudo mkdir -p "$DATA_DIR" "$DEST_DIR"

echo "2b. Installing docker-compose.yml for '$ENV_NAME'..."
sudo cp docker-compose.yml "$DATA_DIR/docker-compose.yml"

# Create the environment file on first run (staging gets an isolated template).
if [ ! -f "$ENV_FILE" ]; then
  # prod template unchanged; staging template points at staging DB/ports/dirs
  sudo cp "deploy/${ENV_NAME}.env.example" "$ENV_FILE"
fi

# Create the per-instance writable roots (read from the env file).
# shellcheck disable=SC1090
sudo bash -c "set -a; . '$ENV_FILE'; set +a; \
  mkdir -p \"\$PI_SESSIONS_ROOT\" \"\$SANDBOX_ROOT\" \
           \"\$REMOTE_WORKSPACES_ROOT\" \"\$WORKSPACES_ROOT\""

echo "3. Exporting shared image to $DEST_DIR/$IMAGE_NAME.tar..."
docker save -o "$DEST_DIR/$IMAGE_NAME.tar" "$IMAGE_NAME:$VERSION"
sudo chmod 644 "$DEST_DIR/$IMAGE_NAME.tar"

echo "4. Installing systemd service..."
sudo cp "ajapopaja-build${ENV_NAME/prod/}.service" /etc/systemd/system/ 2>/dev/null || \
  sudo cp "ajapopaja-build-${ENV_NAME}.service" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable "$SERVICE"

echo "Deployment complete for '$ENV_NAME'."
echo "Start with: sudo systemctl start $SERVICE"
```

(Exact filenames/templates to be finalized during implementation; the point is
that **one** script serves both instances and the image is built and exported
once.)

### 5.5 Bootstrap helper for the first-run experience

A small script (e.g. `scripts/bootstrap_staging.sh`) performs the one-time
setup **outside** the image build:

```bash
#!/bin/bash
set -e
ROOT=/data/ajapopaja/staging
sudo mkdir -p "$ROOT"/{pi_sessions,sandboxes,remote_workspaces,workspaces}

# Optional: seed the staging DB with the generic test_repo pipeline/tasks.
# Leave it out for a truly empty "register from scratch" experience.
# docker run --rm --add-host=host.docker.internal:host-gateway \
#   -e MONGODB_URI=mongodb://host.docker.internal:27017/ \
#   -e DATABASE_NAME=ajapopaja_build_staging \
#   ajapopaja-build:latest \
#   python scripts/setup_test_db.py --db ajapopaja_build_staging
```

`scripts/setup_test_db.py` already accepts `--db`, so no new seeding code is
needed. Note that the script must be reachable from the mounted repo or copied
into the image; today it is not part of the image, so the bootstrap either runs
it from a checkout or the implementation adds it to the image.

## 6. Deployment workflow (target)

The staging workflow mirrors production one-to-one:

```bash
# Deploy/refresh staging
git pull && ./deploy-local.sh staging \
  && sudo systemctl restart ajapopaja-build-staging \
  && sudo journalctl -u ajapopaja-build-staging -f
```

Both instances can run simultaneously and independently:

```bash
sudo systemctl restart ajapopaja-build            # production: :8081
sudo systemctl restart ajapopaja-build-staging    # staging:    :8082
```

A lighter-weight alternative for short-lived tests (no systemd unit, no boot
persistence):

```bash
git pull && ./docker-build.sh latest
cd /data/ajapopaja/staging && \
  docker compose -p ajapopaja-build-staging --env-file /etc/ajapopaja-build-staging.env up
```

## 7. First-run walkthrough on staging

1. Open `http://<host>:8082` (staging web UI) — the production UI on `:8081`
   stays untouched.
2. **Register a new user** via the existing `POST /api/auth/register` endpoint
   (the fresh staging DB has no users) — this is the "first time user"
   experience.
3. Log in and **create a first pipeline**. Point it at a **staging Gitea
   repository** (e.g. a fork or a dedicated `staging` repo), *not* a production
   repository. Because `repo_uri` is stored per pipeline and `GIT_PUSH_TOKEN`
   is staging-scoped, agent branches and PRs land in the staging repo only.
4. **Create a first task** with a spec and schedule it.
5. Let the built-in agents process it (CoderBot clones into
   `/data/ajapopaja/staging/remote_workspaces/*`, runs in
   `/data/ajapopaja/staging/sandboxes/*`, persists sessions under
   `/data/ajapopaja/staging/pi_sessions/*`, and pushes a PR to the staging
   Gitea repo).

Nothing in this flow reads or writes `ajapopaja_build_prod` or the production
host directories.

## 8. Isolation and safety considerations

- **Port collisions.** `PORT`/`DEV_SERVER_PORT` are interpolated per unit, so
  staging uses `8082`/`1225`. The compose mapping publishes all host
  interfaces; restrict to loopback if staging should not be reachable from the
  network (`"127.0.0.1:${PORT}:${PORT}"`).
- **Container / project collisions.** Distinct `container_name` and
  `-p` project names prevent the "container name already in use" error and
  network/volume sharing.
- **Database isolation.** A separate `DATABASE_NAME` on the same MongoDB server
  is sufficient for testing and is the least operational overhead. If harder
  isolation is required (separate credentials, no accidental cross-DB access),
  run a second MongoDB instance on another port and set `MONGODB_URI`
  accordingly. Beanie creates its indexes per database on `init_db`, so a fresh
  DB is fully functional without migrations.
- **Secret isolation.** `AUTH_SECRET_KEY` must differ; otherwise a staging JWT
  is valid against production. `MCP_AUTH_TOKEN` (if auth is enabled) should
  differ too.
- **Cookie-name isolation.** Cookies are shared per host, not per port. Even
  with distinct secrets, production and staging must use distinct refresh
  cookie names or a staging login will evict the production session. The env
  templates set `REFRESH_COOKIE_NAME=refresh_token_prod` and
  `refresh_token_staging`; the app also derives a distinct default from
  `DATABASE_NAME`.
- **Gitea isolation.** The single biggest risk is a staging pipeline pointing at
  a production repo and creating branches/PRs there. Use a separate staging
  repo and a token scoped to it. Optionally set `REMOTE_PR_MODE` so the two
  instances target different remotes.
- **Image sharing / load race.** Both units `docker load` the same tarball.
  Loading is idempotent, but if both services start at once the daemon may
  briefly contend. Starting them sequentially (or loading the image manually
  before `systemctl start`) avoids the race.
- **Disk usage.** Staging retains sandboxes and remote clones (`ttl` applies
  only to Pi session workspaces, default 14 days). Mount them on a path with
  enough space and consider `PI_SESSION_WORKSPACE_TTL_DAYS` for aggressive
  cleanup.
- **Resource pressure.** Both instances share Ollama and the host. If staging is
  only used for UI/flow testing, point it at a smaller/local Ollama model via
  `OLLAMA_MODEL`/`CODERBOT_DEFAULT_MODEL`.

## 9. Backward compatibility and testing

- The parameterized compose file keeps today's defaults, so production only
  needs `CONTAINER_NAME`/`AJAPOPAJA_ENV_FILE` (or relies on the defaults) and a
  re-install of the compose file.
- The existing static deployment tests must be updated to accept the
  parameterized strings:
  - `backend/tests/test_deployment_ports.py` asserts the literal
    `${DEV_SERVER_PORT:-1224}:${DEV_SERVER_PORT:-1224}` (still present) and
    `DEV_SERVER_PORT=1224` in `deploy-local.sh` (the parameterized script must
    still seed it in the templates).
  - `backend/tests/test_docker_session_mount.py` asserts
    `/data/ajapopaja/pi_sessions:/data/ajapopaja/pi_sessions` appears verbatim;
    with `${PI_SESSIONS_ROOT:-…}` wrapping this substring is no longer exact, so
    the assertions need to be relaxed or the default must be written literally
    in the compose file.
- New tests should guard the staging contract:
  - staging env template exists and sets a distinct `DATABASE_NAME`,
    `PORT`, `DEV_SERVER_PORT` and all writable roots;
  - staging service references its own env file, working dir and project name;
  - `deploy-local.sh staging` does not overwrite the production env file.
- Manual verification: start both units, confirm `:8081` shows production data
  while `:8082` is empty, register a staging user, and confirm no files appear
  under the production `PI_SESSIONS_ROOT`/`SANDBOX_ROOT` paths.

## 10. Open questions / out of scope

- **Separate MongoDB instance?** Recommended only if credential/schema-level
  isolation is required; the default proposal is a separate database name.
- **Separate Ollama or model?** Not needed for isolation; a smaller model may be
  useful to reduce host load.
- **Gitea repo layout.** Decide whether staging uses a dedicated repo, a fork,
  or a branch namespace. This is a user/config decision, not a code change.
- **Template systemd unit** (`ajapopaja-build@.service`) as a follow-up to
  remove the duplicated unit; deliberately deferred to avoid touching the
  working production unit.
- **Bootstrap script location.** `scripts/setup_test_db.py` is not currently
  copied into the image; either add it or run the bootstrap from a checkout.
