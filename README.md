# Ajapopaja Build

Welcome to **Ajapopaja Build**, the advanced, automated task pipeline manager designed for Coding AI Agents (like Gemini CLI or Claude).

---

## 1. How to Use the Servers

### Building the System
The project is structured as a monorepo with a Python backend and a TypeScript/Vite frontend.

1. **Clone the repository:**
   ```bash
   git clone <repo-url>
   cd ajapopaja-build
   ```
2. **Initialize Backend (Python/uv):**
   ```bash
   cd backend
   uv sync
   ```
3. **Initialize Frontend (Node/npm):**
   ```bash
   cd frontend
   npm install
   ```

### Setup Requirements
Ensure you have **Python 3.11+**, **Node.js 18+**, and **uv** installed.
You also need a running **MongoDB** instance (local or Atlas).

Configure the following environment variables (or use a `.env` file in the root):
- `MONGODB_URI`: Connection string (default: `mongodb://localhost:27017`)
- `DATABASE_NAME`: Database name (default: `ajapopaja_build`)

### Starting and Stopping the Servers
Run these commands from the project root. To stop a server, simply use `Ctrl+C` in its terminal window.

- **FastAPI Management Server** (Runs on `http://localhost:8000`):
  ```bash
  cd backend && uv run --package api uvicorn api.main:app --reload
  ```
- **MCP Server** (For AI Agent interactions via stdio):
  ```bash
  cd backend && uv run --package ajapopaja-mcp python mcp/src/ajapopaja_mcp/server.py
  ```
- **SPA Frontend** (Runs on `http://localhost:5173`):
  ```bash
  cd frontend && npm run dev
  ```

---

## 2. Key Features & Recent Achievements

### 🚀 Automated Agent Workflow
- **State Machine Lifecycle**: Tasks follow a strict, reliable path: `created` → `scheduled` -> `inprogress` → `implemented` (or `failed`/`discarded`).
- **Autonomous Design Review**: Agents can be required to submit a Design Document (`want_design_doc`). The system automatically transitions tasks to a `PROPOSED` state for human approval before execution.
- **Smart Title Parsing**: The backend automatically parses the first H1 header (e.g., `# My Feature`) from submitted design docs to update the task title dynamically.
- **Execution Ordering**: Tasks are prioritized by a combination of manual `order` and precise `scheduled_at` timestamps to ensure FIFO execution within priority tiers.

### 🎨 Modern, Real-time UI
- **Multi-Column Dashboard**: A three-column "Execution Engine" layout that separates *Preparation*, *Active Execution*, and *History/Analytics*.
- **Live Updates**: Integrated WebSockets ensure the UI reacts instantly to agent progress and state changes without page refreshes.
- **Advanced History Tracking**: Server-side paging for completed tasks and detailed status history for every task.
- **Adaptive Focus**: Non-active tasks are automatically collapsed to reduce noise, while `INPROGRESS` and `PROPOSED` tasks auto-expand for immediate attention.

### 🤖 AI Agent Integration (MCP)
- **Deep Context for Agents**: The MCP server provides agents with full task specifications, design document requirements, and a `design_doc_ready` flag to skip design phases when already approved.
- **Strict Verification**: Automated verification ensures agents provide valid commit hashes and implementation summaries before marking tasks as complete.

---

## 3. Getting Started for Developers

### Architecture and Design
The system is composed of five interconnected components:
1. **MongoDB**: Central data store for pipelines, tasks, and state machine tracking (`created` -> `scheduled` -> `inprogress` -> `implemented` | `failed` | `discarded`).
2. **FastAPI Server (`backend/api`)**: Management backend offering a RESTful API and WebSockets for real-time UI updates.
3. **MCP Server (`backend/mcp`)**: The direct interface for the AI Agent, allowing it to pull scheduled tasks, update design docs, and complete tasks seamlessly.
4. **SPA Frontend (`frontend/`)**: Human-facing web interface built with Vanilla TypeScript and Tailwind CSS v4 via Vite.
5. **Shared Core (`backend/core`)**: Shared Beanie/Pydantic models and database logic utilized by both the API and MCP servers to maintain data consistency.

### `uv` and `.venv` Setup
The backend uses `uv` workspaces to manage multiple packages (`core`, `api`, `mcp`) efficiently within a single repository.
Running `uv sync` from the `backend/` directory creates a unified `.venv` containing all dependencies and inter-package links. 

*Always execute Python commands using `uv run --package <pkg_name> ...` from the `backend/` directory* to ensure the correct virtual environment and paths are used.

### Testing and Development Tools

**Backend (Python):**
- **Run tests:** `cd backend && uv run pytest`
- **Watch tests:** `cd backend && uv run ptw`
- **API Docs (Swagger):** Available at `http://localhost:8000/docs` when the API server is running.

**Frontend (TypeScript/Vite):**
- **Run tests (CI mode):** `cd frontend && CI=true npm run test`
- **Watch tests:** `cd frontend && npm run test`
- **Build and Lint:** `cd frontend && npm run build`

### Contributing & Design Docs
Before making structural changes, consult the Markdown documents in the `design/` directory. If task logic or structures change, always update the shared models in `backend/core/src/core/models/models.py` first to ensure the API and MCP servers stay aligned.