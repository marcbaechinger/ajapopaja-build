# Design Document: MCP API for Autonomous Task Execution (`dd_mcp_api_autonomous.md`)

## 1. Overview
This document defines the interaction model and API surface for an AI agent (LLM) to autonomously execute tasks within the Ajapopaja Build system using the Model Context Protocol (MCP). The goal is to enable a "zero-touch" workflow where the agent fetches, plans, implements, and verifies tasks.

## 2. Agent Workflow (Lifecycle)

The LLM agent follows a standardized state-machine-driven workflow:

1.  **Ingestion**: Call `get_next_task(pipeline_id)`.
    - If a task is found, the system marks it as `inprogress`.
2.  **Strategic Planning (Internal/External)**:
    - **Check Design Doc**: Inspect the `design_doc` field of the retrieved task.
    - **Drafting**: If `design_doc` is empty or insufficient, the agent must generate a technical design/plan.
    - **Sync**: Call `update_task_design_doc(task_id, design_doc)` to persist the plan. This allows humans to observe the agent's intent before implementation.
3.  **Implementation**:
    - Use filesystem/shell tools to modify code.
    - Verify implementation against the `design_doc`.
4.  **Version Control**:
    - Perform a `git commit` following the project's tagging conventions (e.g., `[backend]`, `[frontend]`).
5.  **Finalization**:
    - Call `complete_task(task_id, commit_hash, completion_info)`.
    - The system marks the task as `implemented` and triggers automated verification.

## 3. Required MCP API (Tools)

To support this workflow, the `ajapopaja_mcp` server must expose the following tools:

### `get_next_task`
- **Description**: Fetches the first available `scheduled` task in a pipeline and marks it `inprogress`.
- **Arguments**: 
  - `pipeline_id` (string): The ID of the pipeline to pull from.
- **Returns**: A JSON object containing `id`, `title`, `description`, `design_doc`, and `version`.

### `update_task_design_doc`
- **Description**: Updates the design document field for a specific task. Used for autonomous planning.
- **Arguments**:
  - `task_id` (string): The target task ID.
  - `design_doc` (string): The Markdown-formatted design document.
  - `version` (integer): Current version for optimistic concurrency control (OCC).
- **Returns**: Success confirmation or version mismatch error.

### `complete_task`
- **Description**: Finalizes a task implementation.
- **Arguments**:
  - `task_id` (string): The target task ID.
  - `commit_hash` (string): The full hash of the git commit containing the work.
  - `completion_info` (string): A brief summary of what was accomplished.
  - `version` (integer): Current version for OCC.
- **Returns**: Success confirmation and verification results.

### `get_task_status`
- **Description**: (Optional/Utility) Retrieves current status and verification results for a task.
- **Arguments**:
  - `task_id` (string): The target task ID.
- **Returns**: Current state and any verification errors.

## 4. Implementation Details

### Shared Core
All tools must utilize the existing `backend/core/src/core/queries/task.py` functions to ensure business logic consistency (e.g., OCC version checking and WebSocket broadcasting).

### Optimistic Concurrency Control (OCC)
The `version` field is mandatory for `update_task_design_doc` and `complete_task` to prevent race conditions between the AI agent and human managers editing the same task in the SPA.

### Error Handling
- **Task Not Found**: Return a clear error if the ID is invalid.
- **Version Mismatch**: If the DB version is higher than the provided version, the agent must refresh its state.
- **Verification Failure**: If `complete_task` triggers a verification failure, the system automatically creates a follow-up "system" task. The agent should be notified of this in the return value.
