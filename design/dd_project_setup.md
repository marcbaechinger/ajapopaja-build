# Project Setup & Technology Choices (`dd_project_setup.md`)

## 1. Introduction
This document outlines the specific technology stack, development tools, and repository structure for the "Ajapopaja Build" system, based on the architecture defined in `dd_architecture.md`.

## 2. Technology Stack Decisions

### 2.1. Backend (Python)
*   **Language**: Python 3.11+
*   **Package & Workspace Manager**: `uv`
    *   *Reasoning*: `uv` is exceptionally fast and natively supports Python workspaces (monorepos). This makes it trivial to create a shared `core` package that both the `api` (FastAPI) and `mcp` (MCP Server) applications can depend on locally without complex relative imports or publishing.
*   **Web Framework**: FastAPI
    *   *Reasoning*: High performance, excellent developer experience with Pydantic, and automatic OpenAPI documentation generation.
*   **MCP Framework**: Official Python MCP SDK (`mcp`)
*   **Database ODM (Object-Document Mapper)**: Beanie (backed by Motor)
    *   *Reasoning*: Beanie is an asynchronous ODM that natively uses Pydantic models. This provides a seamless integration with FastAPI, allowing the exact same models to be used for database serialization, API request validation, and MCP tool schemas.

### 2.2. Frontend (SPA)
*   **Core**: Vanilla JavaScript, HTML5, CSS3.
*   **Build Tool / Dev Server**: Vite
    *   *Reasoning*: Vite provides a lightning-fast development server with Hot Module Replacement (HMR). It simplifies the integration of Tailwind CSS and bundles the vanilla JS application efficiently for production.
*   **Styling**: Tailwind CSS
    *   *Reasoning*: Utility-first CSS framework that allows for rapid UI development without writing custom CSS files. Integrates perfectly into the Vite build pipeline.

## 3. Repository Structure (Monorepo)

The project will be structured as a monorepo containing both the frontend and the Python backend workspace.

```text
ajapopaja-build/
├── design/                 # Design documentation (this folder)
│   ├── dd_architecture.md
│   └── dd_project_setup.md
├── frontend/               # SPA Application
│   ├── index.html          # Main entry point
│   ├── package.json        # NPM dependencies (Vite, Tailwind)
│   ├── src/                # Vanilla JS logic
│   ├── style.css           # Tailwind entry CSS
│   ├── tailwind.config.js  # Tailwind configuration
│   └── vite.config.js      # Vite configuration
└── backend/                # Python Workspace (managed by uv)
    ├── pyproject.toml      # Workspace root configuration
    ├── core/               # Shared logic and DB models
    │   ├── pyproject.toml
    │   └── src/core/
    │       ├── models/     # Beanie Pydantic Models (Pipeline, Task)
    │       └── db.py       # MongoDB connection initialization
    ├── api/                # FastAPI Application
    │   ├── pyproject.toml  # Depends on "core"
    │   └── src/api/
    │       ├── main.py     # FastAPI entry point
    │       └── routes/     # API endpoints
    └── mcp/                # MCP Server Application
        ├── pyproject.toml  # Depends on "core"
        └── src/mcp/
            └── server.py   # MCP Server entry point and tools
```

## 4. Development Workflow

### 4.1. Backend Setup
1.  Initialize the root Python workspace using `uv`.
2.  Create the `core`, `api`, and `mcp` packages.
3.  Configure `pyproject.toml` in the root to define the workspace members.
4.  Add local dependencies so `api` and `mcp` can import from `core`.
5.  Run API via `uv run uvicorn api.main:app --reload`.
6.  Run MCP Server via `uv run python -m mcp.server`.

### 4.2. Frontend Setup
1.  Initialize a Vanilla JS Vite project in the `frontend/` directory.
2.  Install Tailwind CSS as a PostCSS plugin.
3.  Run the development server via `npm run dev` (or `pnpm dev`).

### 4.3. Database Setup
1.  The system assumes a running MongoDB instance (local or Atlas).
2.  Connection strings will be managed via environment variables (e.g., `MONGODB_URI`).
3.  Beanie initialization will occur on application startup in both the FastAPI and MCP servers.
