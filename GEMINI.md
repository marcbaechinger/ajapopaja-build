# Gemini CLI Project Context: Ajapopaja Build

This document provides a condensed, high-signal context for Gemini CLI and other AI agents to autonomously and effectively operate within the **Ajapopaja Build** workspace.

## 1. System Architecture (Condensed)
- **Central Authority**: MongoDB stores all Pipelines and Tasks.
- **State Machine**: Tasks follow a strict lifecycle: `created` -> `scheduled` -> `inprogress` -> `implemented` | `failed` | `discarded`.
- **Components**:
    - `backend/core`: Shared Beanie/Pydantic models and DB initialization. **Modify models here first.**
    - `backend/api`: FastAPI server for human/SPA management.
    - `backend/mcp`: MCP server (`ajapopaja_mcp`) for AI agent task execution.
    - `frontend/`: Vite SPA with Tailwind CSS v4 for the management UI.

## 2. Operational Mandates for AI Agents
- **Recommended CWD**: Always start in the project root `/home/marc-baechinger/monolit/code/ajapopaja-build/`.
- **Git Commit Conventions**: 
    - The first line of the commit message must start with a `[topic]` tag (e.g., `[backend]`, `[frontend]`, `[infra]`, `[bugfix]`, `[cleanup]`, `[design]`, `[test]`).
    - The first letter of the first line after the tag must be capitalized (e.g., `[backend] Setup API`).
    - The topic tag should denote the module or type of change.
    - Additional details belong in the description after a single blank line.
    - **Always suggest a commit message** once a task is completed and wait for user confirmation before committing.
- **Dependency Management**: Use `uv` for all Python operations. It manages the workspace and local `core` linking.
- **Execution Wrapper**: Always use `uv run --package <pkg>` from the `backend/` directory or provide the full path to `backend/.venv/bin/`.
- **Naming Note**: The MCP package is named `ajapopaja_mcp` to avoid conflicts with the `mcp` SDK.

## 3. Critical Commands & Paths

| Action | Command (from Root) |
| :--- | :--- |
| **Start API** | `cd backend && uv run --package api uvicorn api.main:app --reload` |
| **Start MCP** | `cd backend && uv run --package ajapopaja-mcp python mcp/src/ajapopaja_mcp/server.py` |
| **Start SPA** | `cd frontend && npm run dev` |
| **Run Python Tests** | `cd backend && uv run pytest` |
| **Watch Python Tests**| `cd backend && uv run ptw` |
| **Run JS Tests**     | `cd frontend && CI=true npm run test` |
| **Run JS Build/Lint** | `cd frontend && npm run build` |

## 4. Development Workflow
1.  **Architecture First**: Consult `design/dd_architecture.md` before structural changes.
2.  **Model Consistency**: If task logic changes, update `backend/core/src/core/models/models.py` and ensure both API and MCP are aligned.
3.  **Validation**: After any backend change, verify with `uv run pytest`. After frontend changes, ensure `npm run build` succeeds.
4.  **Environment**: Ensure `MONGODB_URI` and `DATABASE_NAME` are set in your execution environment.

## 5. Documentation Reference
- `design/`: Full architectural and setup docs.
- `GETTING_STARTED.md`: Detailed human/dev onboarding.
- `backend/pyproject.toml`: Workspace configuration.
