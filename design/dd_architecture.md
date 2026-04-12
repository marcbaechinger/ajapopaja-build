# Architecture Design Document (`dd_architecture.md`)

## 1. Introduction
This document defines the architecture for the "Ajapopaja Build" system—an advanced, automated task pipeline manager designed for Coding AI Agents (like Gemini CLI or Claude). The system aims to provide a robust infrastructure for defining, managing, and sequentially executing development pipelines.

## 2. Core Components
The system is composed of four primary interconnected components:

1.  **MongoDB (Database)**
    *   **Role**: Central data store for the entire application.
    *   **Responsibilities**:
        *   Store Pipeline definitions and metadata.
        *   Store Task entities linked to pipelines.
        *   Maintain the strict lifecycle state of each task (`created`, `scheduled`, `inprogress`, `implemented`, `discarded`, `failed`).
        *   Provide fast, atomic updates to task states to prevent race conditions when multiple agents or human managers interact with the system simultaneously.

2.  **FastAPI Server (Management API)**
    *   **Role**: The central management backend serving the Single Page Application (SPA).
    *   **Responsibilities**:
        *   Provide a RESTful HTTP API to manage Pipelines and Tasks (CRUD operations).
        *   Enforce business logic regarding state transitions (e.g., a task cannot move from `created` directly to `implemented` without being `scheduled` and `inprogress`).
        *   Serve as the backend for the human-facing management UI.
        *   Expose WebSockets for real-time UI updates when the MCP server or human managers change task states.

3.  **MCP Server (Model Context Protocol)**
    *   **Role**: The direct interface for the Coding AI Agent (Gemini/Claude).
    *   **Responsibilities**:
        *   Expose tools and resources to the LLM via the standard Model Context Protocol.
        *   Allow the LLM to query the *next available task* in the currently active pipeline.
        *   Provide tools for the LLM to update the status of the task it is currently working on (e.g., transitioning from `inprogress` to `implemented` or `failed`).
        *   Provide necessary context (requirements, attached design docs, or related code snippets) attached to the task directly to the LLM.

4.  **SPA Frontend (Management UI)**
    *   **Role**: The human-facing web interface.
    *   **Responsibilities**:
        *   Provide a high-usability interface to create and manage pipelines.
        *   Allow users to define tasks, reorder them, and assign them to specific pipelines.
        *   Monitor the live progress of the AI agent as it burns down the pipeline tasks.

## 3. Component Interaction & Data Flow
1.  **Human Setup**: A user accesses the **SPA Frontend**, which communicates with the **FastAPI Server** to create a new Pipeline and populate it with Tasks in the **MongoDB**. Tasks are initially set to the `created` state.
2.  **Scheduling**: The user reviews the pipeline and marks tasks as `scheduled` via the SPA.
3.  **Agent Execution**:
    *   The Coding AI Agent connects to the **MCP Server**.
    *   The agent calls an MCP tool (e.g., `get_next_task()`).
    *   The MCP Server queries **MongoDB**, finds the next `scheduled` task, updates its state to `inprogress`, and returns the task details to the agent.
4.  **Completion/Failure**:
    *   The agent performs the required coding work.
    *   Upon completion, the agent calls an MCP tool (e.g., `mark_task_implemented(task_id)`).
    *   The MCP Server updates the task state in **MongoDB** to `implemented` (or `failed` if an error occurred).
5.  **Monitoring**: The user observes these state changes in real-time via the **SPA Frontend**, which receives events from the **FastAPI Server** over a WebSocket connection.

## 4. Shared Core Logic
To maintain consistency and avoid code duplication, the **FastAPI Server** and the **MCP Server** will share a common Python core library. This core library will encapsulate:
*   Database connection logic.
*   Data models (schemas) representing Pipelines and Tasks.
*   The business logic governing state transitions (Lifecycle Management).

## 5. Technology Constraints & Decisions
*   **Database**: MongoDB (via Beanie ODM)
*   **Backend Languages**: Python (FastAPI, MCP SDK, websockets)
*   **Frontend Technologies**: TypeScript (Vanilla), Tailwind CSS v4.
*   *Note: Further specific library and tooling choices are detailed in the `dd_project_setup.md` document.*
