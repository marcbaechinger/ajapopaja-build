# Ajapopaja Build

[![CI](https://github.com/marcbaechinger/ajapopaja-build/actions/workflows/ci.yml/badge.svg)](https://github.com/marcbaechinger/ajapopaja-build/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Version](https://img.shields.io/badge/version-0.4.0-green.svg)](https://github.com/marcbaechinger/ajapopaja-build/releases)

Welcome to **Ajapopaja Build** – an automated task‑pipeline manager for Coding AI
agents, with a human‑supervised management layer. It helps you break work into
tasks, let agents design, implement, and review the changes, and approve the
results before they land.

---

## What is it?

A pipeline of **tasks** that move through a clear lifecycle
(`created → scheduled → in progress → implemented`). A web dashboard gives you
full control, while a set of autonomous **agents** do the heavy lifting. The
project is a monorepo:

- **`backend/`** – a `uv` workspace (`core` models, `api` FastAPI server, `ajapopaja_mcp` MCP server).
- **`frontend/`** – a Vite + TypeScript Single Page Application (Tailwind CSS).
- **`design/`** – architecture and bot design documents.
- **`INSTALL.md`** – full production installation guide (Docker + systemd).

---

## Autonomous agents

Agents work on real code inside isolated sandboxes and report back through the UI:

- **CoderBot** 🧑‍💻 – the end‑to‑end coder. It implements tasks described in design
  documents by driving the **Pi** coding agent in headless mode, then submits a
  **pull request** for your approval. Accept it (optionally auto‑committing the
  change) or reject it – all in the dashboard.
- **ArchitectureBot** 📐 – drafts a design document for a task with one click.
- **ReviewBot** 🔍 – performs an automated technical review of an implemented task
  (spec + design doc + git diff) and stores the review in the task.
- **DocBot** 📝 – creates design documents, code comments, and documentation.
- **BotManager** ⚙️ – queues and serializes every bot so only one LLM session runs
  at a time.

## Key features

- **Remote git repositories** – a pipeline can point at a remote repository
  (`repo_uri`) on Gitea, GitHub, or any git host; the app clones it into a
  dedicated workspace and, on PR acceptance, pushes back with authenticated
  credentials that never reach the frontend.
- **Pull‑request workflow** – every CoderBot change becomes a PR that is reviewed
  and committed (or rejected) in the UI.
- **Human‑in‑the‑loop design review** – tasks can require a design document that
  you approve before implementation starts.
- **MCP + Pi integration** – AI agents connect over the Model Context Protocol; a
  `pi` skill and `mcp_client.py` CLI make task search/management scriptable.
- **Real‑time UI** – WebSocket‑driven dashboard with a git‑status indicator,
  multi‑layout columns, persisted state, and a streaming logs viewer.
- **Compact pipeline history** – the `PipelineHistoryView` lists the implemented
  tasks in a compact, paged feed (page size 10) at the bottom of the right
  sidebar, below the streaming CoderBot activity log.
- **Detailed CoderBot activity** – the `PiView` terminal‑style log streams live
  session output with follow‑mode auto‑scroll, collapsible `thinking`/`tool`
  blocks, an error visibility toggle, copy‑to‑clipboard, an elapsed‑time
  indicator, and empty / session‑ended states.
- **Read‑only file browser** – the **File Browser** tab lets you inspect a
  pipeline's repository without a session: navigate directories, view
  syntax‑highlighted files, and copy paths. Its listing / content panel can be
  resized vertically (`FileBrowseView` `resizable` option) so you can tune the
  visible height.
- **Interactive coding session** – a stateful, multi‑turn Pi chat attached to a
  pipeline's repository. The agent is pinned to that repository (no
  filesystem‑wide searches outside it) and can read and manage pipeline tasks
  through the bundled `ajapopaja` skill using the pipeline's UID.
- **Session manager** – a global right‑hand drawer (Sessions button in every
  header, `Ctrl/Cmd+J`) lists the single active session plus every paused,
  completed or failed session with status, pipeline, label, turn count, model
  and relative activity. Switching is one safe action: the backend pauses the
  current session and resumes the chosen one with its history intact. Pipeline
  detail views surface a `Resume` primary action and an inline per‑pipeline
  session list.
- **Configurable keyboard shortcuts** – PiView ships with global shortcuts
  (`/` focus search, `f` toggle follow, `n`/`N` next/prev error, `c` copy,
  `x` clear, `s` stop, `t` thinking, `b` collapse, `e` error visibility, `k`
  show search bar) that can be per‑instance remapped via the `keyboardBindings`
  option.
- **Secure by default** – JWT‑based authentication across the API, sandboxed
  workspaces with path‑traversal protection, and Markdown sanitization.

---

## Installation

**Production (Docker + Linux systemd service):** follow the complete guide in
[**`INSTALL.md`**](INSTALL.md) – it covers building the Docker image, configuring
environment variables, and installing/applying the systemd service.

**Staging (second, isolated container):** run the same image against a clean
database and its own host directories:

```bash
git pull && ./deploy-local.sh staging \
  && sudo systemctl restart ajapopaja-build-staging \
  && sudo journalctl -u ajapopaja-build-staging -f
```

See [INSTALL.md §7](INSTALL.md#7-run-an-isolated-staging-instance) for the full
staging workflow and the list of isolated dependencies.

**Friendly domain names:** once deployed, production is on
`http://ajapopaja` (port 8081) and staging on `http://ajapopaja.stage` (port
8082). `deploy-local.sh` adds the corresponding `/etc/hosts` entries
automatically via `scripts/setup-hostnames.sh`; the nginx reverse-proxy and
dnsmasq alternatives are documented in [INSTALL.md §7.5](INSTALL.md#75-friendly-domain-names-ajapopaja--ajapopajastage).

**Quick local dev setup:**

```bash
# Backend (Python 3.11+, uv, MongoDB, Ollama)
cd backend && uv sync

# Frontend
cd frontend && npm install

# Run them
cd backend  && uv run --package api uvicorn api.main:app --reload   # http://localhost:8000
cd frontend && npm run dev                                          # http://localhost:5173
```

See [`INSTALL.md`](INSTALL.md) and [`CONTRIBUTING.md`](CONTRIBUTING.md) for
environment variables and development guidelines.

---

## Usage workflow

1. In the dashboard, create a **Pipeline** and point it at a local workspace or
   a remote repository.
2. Create **Tasks** – give each a technical spec and choose whether it needs a
   design document (and which agent should handle it).
3. Let the agent pick up the task: CoderBot implements it, ArchBot drafts a
   design, ReviewBot reviews it.
4. Review the results (design docs, diffs, PRs) in the UI and **accept** or
   **reject** them.

---

## Testing

```bash
# Backend (runs in parallel by default via pytest-xdist)
cd backend && uv run pytest

# Run serially when needed (e.g. debugging ordering-sensitive behavior)
cd backend && uv run pytest -n0

# Frontend
cd frontend && CI=true npm run test
```

Backend tests are configured with `pytest-xdist` and `addopts = -n auto` in
`backend/pytest.ini`, so the default `uv run pytest` command distributes tests
across all available CPU cores. Pass `-n0` to force single-process (serial)
execution.

---

## Seeding the test database

[`scripts/setup_test_db.py`](scripts/setup_test_db.py) is a standalone script that
seeds a MongoDB database with the tasks of the `test_repo` pipeline from
[`scripts/test_repo_tasks_data.json`](scripts/test_repo_tasks_data.json). It is
**idempotent** and leaves every task in the `CREATED` state so they can be
scheduled and executed afterwards.

**Prerequisites:** a running MongoDB (e.g. `mongodb://localhost:27017`) and the
backend workspace synced (`cd backend && uv sync`).

```bash
# Use the defaults (localhost MongoDB + ajapopaja_build_prod + default data file)
python scripts/setup_test_db.py

# Seed an isolated test database
python scripts/setup_test_db.py --db mytestdb

# Point at a remote MongoDB with a custom data file
python scripts/setup_test_db.py --uri mongodb://host:27017 --db prod \
    --data /path/to/tasks.json
```

**Options:**

- `--uri` – MongoDB connection string (default: `mongodb://localhost:27017`).
- `--db` – target database name to seed (default: `ajapopaja_build_prod`).
- `--data` – path to the JSON array of task objects (default:
  `scripts/test_repo_tasks_data.json`). Each object may only contain the fields
  `title`, `description`, `spec`, `want_design_doc`, `type`, and `order`; the
  task status is always forced to `CREATED`.

The script creates a fresh `test_repo` Pipeline if none exists and skips tasks
whose titles already exist for that pipeline, so re-running it never duplicates
rows.

---

## Generating a database overview dashboard

[`scripts/generate_db_overview.py`](scripts/generate_db_overview.py) produces a
self-contained, static HTML dashboard that gives an admin a bird's-eye view of
every collection in a MongoDB database, the storage it consumes, and the shape
of the data it holds. It puts extra emphasis on pipelines, tasks, pull requests
and Pi sessions while still listing every collection generically (document
counts, storage/index sizes, inferred fields, indexes and sample documents).
Sensitive fields such as tokens and passwords are always redacted.

The generated page is a single `.html` file with all CSS and JavaScript inlined,
so it can be opened offline, emailed, or archived.

**Prerequisites:** a running MongoDB (e.g. `mongodb://localhost:27017`).

```bash
# Use the defaults (localhost MongoDB + ajapopaja_build_prod + db_overview.html)
python scripts/generate_db_overview.py

# Point at a remote MongoDB and a custom output file
python scripts/generate_db_overview.py --uri mongodb://host:27017 --db prod \
    --output /tmp/overview.html
```

**Options:**

- `--uri` – MongoDB connection string (default: `mongodb://localhost:27017`).
- `--db` – database name to inspect (default: `ajapopaja_build_prod`).
- `--output` / `-o` – output HTML file (default: `db_overview.html`).
- `--sample-size` – how many documents per collection to sample for field
  inference and preview (default: `20`).

---

## Release history

See [**`RELEASENOTES.md`**](RELEASENOTES.md). The current release is **0.4.0**.

---

## License

Licensed under the **Apache License 2.0**. See [LICENSE](LICENSE) and
[LICENSE_COMPLIANCE.md](LICENSE_COMPLIANCE.md) for dependency licensing details.

> Note: this repository has a `pre-push` hook that blocks unintentional pushes.
> To push to GitHub manually, set `ALLOW_PUSH=true git push`.
