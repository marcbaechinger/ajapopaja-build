# Getting Started with Ajapopaja Build

Welcome to **Ajapopaja Build**, the most awesome developer pipeline for coding AI! This document provides a quick reference for developers (human and AI) to set up, run, and test the project.

## 1. Project Overview

The project is structured as a monorepo:
- **`backend/`**: A `uv` workspace containing:
    - `core`: Shared Beanie/Pydantic models and database logic.
    - `api`: FastAPI management server.
    - `ajapopaja_mcp`: MCP server for AI agent interactions.
- **`frontend/`**: A Vite-based Single Page Application (SPA) with Tailwind CSS v4.
- **`design/`**: Architectural and project setup documentation.

---

## 2. Developer Environment Setup

### Prerequisites
- **Python 3.11+**
- **Node.js 18+**
- **uv**: Modern Python package manager.
- **MongoDB**: A running instance (local or Atlas).

### Installation
1.  **Clone and Enter Workspace**:
    ```bash
    git clone <repo-url>
    cd ajapopaja-build
    ```
2.  **Initialize Backend**:
    ```bash
    cd backend
    uv sync
    ```
3.  **Initialize Frontend**:
    ```bash
    cd frontend
    npm install
    ```

---

## 3. Running the System

### Configuration
Set the following environment variables (or use a `.env` file in the root):
- `MONGODB_URI`: Connection string (default: `mongodb://localhost:27017`)
- `DATABASE_NAME`: Database name (default: `ajapopaja_build`)

### Execution Commands

| Component | Command | URL/Access |
| :--- | :--- | :--- |
| **FastAPI Server** | `cd backend && uv run --package api uvicorn api.main:app --reload` | [http://localhost:8000](http://localhost:8000) |
| **API Docs (Swagger)** | (Run FastAPI first) | [http://localhost:8000/docs](http://localhost:8000/docs) |
| **MCP Server** | `cd backend && uv run --package ajapopaja-mcp python mcp/src/ajapopaja_mcp/server.py` | Stdout/JSON-RPC |
| **SPA Frontend** | `cd frontend && npm run dev` | [http://localhost:5173](http://localhost:5173) |

---

## 4. Testing & Quality Assurance

### Python Backend
Run all backend tests from the `backend/` directory:
```bash
cd backend
uv run pytest
```
**Watch Mode** (Runs tests on file change):
```bash
cd backend
uv run ptw
```

### Frontend SPA
Run frontend tests or linting from the `frontend/` directory:
```bash
cd frontend
npm run test -- --watch=false # One-time run (uses CI=true internally if needed)
# OR
cd frontend
CI=true npm run test         # Explicit non-interactive mode
```
**Watch Mode** (Runs vitest in interactive mode):
```bash
cd frontend
npm run test
```

---

## 5. Engineering Guidelines for AI Agents (Gemini CLI / Claude)

### Recommended CWD
- **Root Directory (`ajapopaja-build/`)**: Always start here to maintain full context of design docs, frontend, and backend.

### Development Loop
1.  **Read Design Docs**: Check `design/` for architectural truth.
2.  **Use Shared Core**: Always update models in `backend/core/src/core/models/models.py` first.
3.  **Sync Workspace**: If you add dependencies, run `uv sync` in `backend/`.
4.  **Verify via API**: Use the FastAPI Swagger UI (`/docs`) to verify new task logic.
5.  **MCP Integration**: Test new tools using the MCP Inspector or by running the server directly.

### Deployment & CI
- For CI environments, use `CI=true npm test` for JS and `pytest` for Python.
- Do not commit `.venv` or `node_modules`.
