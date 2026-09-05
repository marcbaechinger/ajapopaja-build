# Installation Guide

This guide describes how to build the **Ajapopaja Build** Docker image and install it
as a Linux system service. It is a manual, step-by-step walkthrough of what the
`docker-build.sh` and `deploy-local.sh` scripts automate.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Build the Docker image](#2-build-the-docker-image)
3. [Configure environment variables](#3-configure-environment-variables)
4. [Install as a Linux systemd service](#4-install-as-a-linux-systemd-service)
5. [Manage the service](#5-manage-the-service)
6. [First-time setup: create the admin user](#6-first-time-setup-create-the-admin-user)
7. [Troubleshooting](#7-troubleshooting)

---

## 1. Prerequisites

On the host machine you need:

- **Docker** (with `docker build` and `docker run` available).
- **MongoDB** — a running instance, reachable from the container
  (e.g. on the host at `host.docker.internal:27017`).
- **Ollama** — required for the built-in AI Assistant and the CoderBot
  (e.g. on the host at `host.docker.internal:11434`).
- **Node.js / npm** — only needed on the host if you build the frontend outside
  Docker; the Docker build does this for you.
- A **workspace root** directory on the host that contains the git repositories
  the app should operate on (e.g. `/home/<user>/repos`).

---

## 2. Build the Docker image

The image is a multi-stage build: it compiles the frontend, then assembles a
final image containing the Python backend, the `pi` coding agent (Node.js), and
the frontend build artifacts.

### 2.1 Using the build script

```bash
./docker-build.sh [VERSION]
```

- `VERSION` defaults to `latest`.
- The script tags the image as `ajapopaja-build:<VERSION>` and passes the current
  git commit as the build version.

### 2.2 Building manually

```bash
docker build --build-arg BUILD_VERSION=$(git rev-parse --short HEAD) \
  -t ajapopaja-build:latest .
```

### 2.3 What the image contains

- The compiled frontend (served from `/app/frontend_dist`).
- The Python backend (installed with `uv sync --frozen --no-dev`).
- **Node.js 22** and the **`pi` coding agent** (installed globally via npm).
- A pi model configuration at `/root/.pi/agent/models.json` exposing only the
  models listed in `docker/pi-agent/models.json`
  (`qwen3.6:27b` and `deepseek-v4-flash:cloud`).
- Git configured with `safe.directory '*'` so it can operate on mounted
  workspaces owned by a different host user.

---

## 3. Configure environment variables

The application is configured through environment variables. When running as a
systemd service, these live in the **environment file** `/etc/ajapopaja-build.env`
(see [section 4](#4-install-as-a-linux-systemd-service)).

### 3.1 The environment file

Create `/etc/ajapopaja-build.env` with the variables you need. A typical example:

```ini
MONGODB_URI=mongodb://host.docker.internal:27017/
DATABASE_NAME=ajapopaja_build_prod
PORT=8081
OLLAMA_HOST=http://host.docker.internal:11434
WORKSPACES_ROOT=/home/marc-baechinger/monolit/code
CODERBOT_DEFAULT_MODEL=deepseek-v4-flash:cloud
```

### 3.2 Variable reference

| Variable | Required | Description |
|----------|----------|-------------|
| `MONGODB_URI` | **Yes** | MongoDB connection string. Use `host.docker.internal` to reach a MongoDB running on the host. |
| `DATABASE_NAME` | No | Name of the MongoDB database. Default: `ajapopaja_build_prod`. |
| `PORT` | No | HTTP port the app listens on. Default: `8081`. |
| `OLLAMA_HOST` | **Yes** (for AI features) | URL of the Ollama server. Use `http://host.docker.internal:11434` to reach Ollama on the host. |
| `OLLAMA_MODEL` | No | Default model for the built-in AI Assistant. Default: `gpt-oss:20b` (or `gpt-oss:120b` when `OLLAMA_API_KEY` is set). |
| `OLLAMA_API_KEY` | No | Optional API key for cloud-hosted/proxied Ollama. When set, the app connects to `https://ollama.com`. |
| `WORKSPACES_ROOT` | **Yes** | Absolute path (on the host) to the directory containing the git repositories the app manages. Must exist and be mounted into the container. |
| `CODERBOT_DEFAULT_MODEL` | No | Model used by the CoderBot when spawning `pi` sessions. If unset, no `--model` flag is passed to `pi`. |
| `SANDBOX_ROOT` | No | Directory inside the container where bot sandboxes are created. Default: `/data/ajapopaja/sandboxes`. |
| `MCP_AUTHENTICATION_ENABLED` | No | Set `true` to enable MCP authentication. Default: `false`. |
| `BASEBOT_LOG_ENABLED` | No | Set `false` to disable bot logging. Default: `true`. |

### 3.3 Important notes

- **`WORKSPACES_ROOT` must be mounted into the container.** The systemd service
  mounts the host's `/home` (and `/Users`) into the container, so a workspace
  root under `/home` (e.g. `/home/<user>/monolit/code`) is visible inside the
  container at the same path. If you use a different root, add a matching
  `-v <host-path>:<host-path>` mount to the service file.
- **`host.docker.internal`** resolves to the host machine from inside the
  container. It is enabled by the `extra_hosts` entry in `docker-compose.yml`.
- **All env-file variables are forwarded automatically.** The service uses
  docker-compose with `env_file: /etc/ajapopaja-build.env`, so **every** variable
  in the env file is passed into the container automatically. You do **not** need
  to add individual `-e` flags when adding new variables.

---

## 4. Install as a Linux systemd service

The service file `ajapopaja-build.service` runs the container via docker-compose,
loads the image from a tarball, and forwards the environment variables.

### 4.1 The service file

```ini
[Unit]
Description=Ajapopaja Build Service
After=docker.service
Requires=docker.service

[Service]
Restart=always
# Loads variables for ${PORT} interpolation in docker-compose.yml.
# All variables are forwarded to the container via env_file in the compose file.
EnvironmentFile=/etc/ajapopaja-build.env
WorkingDirectory=/data/ajapopaja
ExecStartPre=-/usr/bin/docker compose down
ExecStartPre=-/usr/bin/docker rm -f ajapopaja-build
# Load the image in case it was updated or missing
ExecStartPre=/usr/bin/docker load -i /data/ajapopaja/docker/ajapopaja-build.tar
# Run compose in the foreground so the process stays alive as long as the
# container runs. With `-d` the command exits immediately and Restart=always
# would tear the container down and recreate it in an endless loop.
ExecStart=/usr/bin/docker compose up
ExecStop=/usr/bin/docker compose down

[Install]
WantedBy=multi-user.target
```

Key points:

- `EnvironmentFile=/etc/ajapopaja-build.env` loads your configuration (used for
  `${PORT}` interpolation in the compose file).
- `WorkingDirectory=/data/ajapopaja` points to where `docker-compose.yml` is
  installed.
- `ExecStartPre` tears down any previous container and loads the image from
  `/data/ajapopaja/docker/ajapopaja-build.tar`.
- `ExecStart` starts the stack with `docker compose up` (foreground). Running
  in the foreground keeps the process alive for as long as the container runs,
  so systemd only restarts the unit when the container actually stops. Do **not**
  use `-d` here: with `Restart=always`, a detached `up -d` exits immediately and
  systemd would tear the container down and recreate it in an endless loop.
- `ExecStop` stops the stack with `docker compose down`.

### 4.2 The docker-compose.yml

The compose file (installed to `/data/ajapopaja/docker-compose.yml`) encapsulates
ports, volumes, host mapping, and env forwarding:

```yaml
services:
  ajapopaja-build:
    image: ajapopaja-build:latest
    container_name: ajapopaja-build
    restart: always
    env_file:
      - /etc/ajapopaja-build.env
    ports:
      - "${PORT:-8081}:${PORT:-8081}"
    volumes:
      - /home:/home
      - /Users:/Users
      - /tmp/nvimsocket:/tmp/nvimsocket
    extra_hosts:
      - "host.docker.internal:host-gateway"
```

`env_file` forwards **every** variable in `/etc/ajapopaja-build.env` into the
container automatically, so you never need to list individual `-e` flags.

### 4.3 Install the service

```bash
# 1. Build and export the image to a tarball
./docker-build.sh latest
sudo mkdir -p /data/ajapopaja/docker
docker save -o /data/ajapopaja/docker/ajapopaja-build.tar ajapopaja-build:latest
sudo chmod 644 /data/ajapopaja/docker/ajapopaja-build.tar

# 2. Install the docker-compose.yml to the location used by the service
sudo cp docker-compose.yml /data/ajapopaja/docker-compose.yml

# 3. Create the environment file (see section 3)
sudo nano /etc/ajapopaja-build.env

# 4. Install the service unit
sudo cp ajapopaja-build.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable ajapopaja-build
```

> **Tip:** The `deploy-local.sh` script automates all of the above (build, export,
> copy the compose file, create the env file if missing, and install the service).

---

## 5. Manage the service

Once installed, manage the app with `systemctl`:

### Start the service

```bash
sudo systemctl start ajapopaja-build
```

### Stop the service

```bash
sudo systemctl stop ajapopaja-build
```

### Restart the service

```bash
sudo systemctl restart ajapopaja-build
```

### Show status

```bash
sudo systemctl status ajapopaja-build
```

### Follow the logs

```bash
sudo journalctl -u ajapopaja-build -f
```

### View recent logs (last 100 lines)

```bash
sudo journalctl -u ajapopaja-build -n 100
```

### Enable/disable start on boot

```bash
sudo systemctl enable ajapopaja-build   # start on boot
sudo systemctl disable ajapopaja-build  # do not start on boot
```

> After editing `/etc/ajapopaja-build.env` or the service file, run
> `sudo systemctl daemon-reload` and `sudo systemctl restart ajapopaja-build`
> to apply the changes.

---

## 6. First-time setup: create the admin user

After the image is built (and before or after starting the service), create the
initial user in MongoDB:

```bash
docker run --rm \
  --add-host=host.docker.internal:host-gateway \
  -e MONGODB_URI=mongodb://host.docker.internal:27017/ \
  ajapopaja-build:latest \
  uv run --package api python api/src/api/seed_user.py
```

---

## 7. Troubleshooting

### The app cannot read a mounted git repository ("dubious ownership")

The container runs as root, but mounted workspaces may be owned by a different
host user. The image already sets `git config --global --add safe.directory '*'`,
so this should not occur. If it does, confirm the image was rebuilt after that
change.

### `CODERBOT_DEFAULT_MODEL` is always `None`

With docker-compose, all env-file variables are forwarded automatically via
`env_file`. If the value is still `None`, confirm:

- The variable is present in `/etc/ajapopaja-build.env`.
- The compose file at `/data/ajapopaja/docker-compose.yml` has the
  `env_file: /etc/ajapopaja-build.env` entry.
- The service was restarted after the change:
  `sudo systemctl restart ajapopaja-build`.

Then verify the container sees it:

```bash
docker exec ajapopaja-build printenv CODERBOT_DEFAULT_MODEL
```

### The container cannot reach MongoDB or Ollama

Use `host.docker.internal` in `MONGODB_URI` and `OLLAMA_HOST`, and make sure the
compose file includes the `extra_hosts` entry
(`host.docker.internal:host-gateway`).

### `WORKSPACES_ROOT` does not exist error

The path set in `WORKSPACES_ROOT` must exist on the host and be mounted into the
container. Create the directory and add a matching `volumes` entry to
`docker-compose.yml` if it is not under `/home` or `/Users`.
