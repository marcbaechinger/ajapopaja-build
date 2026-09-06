# Ajapopaja Build

[![CI](https://github.com/marcbaechinger/ajapopaja-build/actions/workflows/ci.yml/badge.svg)](https://github.com/marcbaechinger/ajapopaja-build/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![Version](https://img.shields.io/badge/version-0.3.0-green.svg)](https://github.com/marcbaechinger/ajapopaja-build/releases)

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

- **Pull‑request workflow** – every CoderBot change becomes a PR that is reviewed
  and committed (or rejected) in the UI.
- **Human‑in‑the‑loop design review** – tasks can require a design document that
  you approve before implementation starts.
- **MCP + Pi integration** – AI agents connect over the Model Context Protocol; a
  `pi` skill and `mcp_client.py` CLI make task search/management scriptable.
- **Real‑time UI** – WebSocket‑driven dashboard with a git‑status indicator,
  multi‑layout columns, persisted state, and a streaming logs viewer.
- **Secure by default** – JWT‑based authentication across the API, sandboxed
  workspaces with path‑traversal protection, and Markdown sanitization.

---

## Installation

**Production (Docker + Linux systemd service):** follow the complete guide in
[**`INSTALL.md`**](INSTALL.md) – it covers building the Docker image, configuring
environment variables, and installing/applying the systemd service.

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

1. In the dashboard, create a **Pipeline** and point it at a local workspace.
2. Create **Tasks** – give each a technical spec and choose whether it needs a
   design document (and which agent should handle it).
3. Let the agent pick up the task: CoderBot implements it, ArchBot drafts a
   design, ReviewBot reviews it.
4. Review the results (design docs, diffs, PRs) in the UI and **accept** or
   **reject** them.

---

## Testing

```bash
# Backend
cd backend && uv run pytest

# Frontend
cd frontend && CI=true npm run test
```

---

## Release history

See [**`RELEASENOTES.md`**](RELEASENOTES.md). The current release is **0.3.0**.

---

## License

Licensed under the **Apache License 2.0**. See [LICENSE](LICENSE) and
[LICENSE_COMPLIANCE.md](LICENSE_COMPLIANCE.md) for dependency licensing details.

> Note: this repository has a `pre-push` hook that blocks unintentional pushes.
> To push to GitHub manually, set `ALLOW_PUSH=true git push`.
