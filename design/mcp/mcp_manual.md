# Ajapopaja Build MCP Manual

This manual describes the Ajapopaja Build MCP (Model Context Protocol) server and how to interact with it via HTTP. This server is intended for use by AI agents (LLMs) to perform automated tasks within the Ajapopaja ecosystem.

## 1. Connectivity & Authentication

### 1.1 Base URL
The MCP server is integrated into the Ajapopaja Build API and is typically mounted at:
`http://<host>:<port>/mcp`

### 1.2 Authentication
Requests must be authenticated using a JSON Web Token (JWT). The token can be provided in two ways:
1.  **Authorization Header**: `Authorization: Bearer <token>`
2.  **Query Parameter**: `?token=<token>`

Authentication is required if `MCP_AUTHENTICATION_ENABLED` is set to `true` in the backend configuration.

## 2. Protocol

The server implements the Model Context Protocol over HTTP using **JSON-RPC 2.0**.

### 2.1 Calling Tools
To execute a tool, send a `POST` request to:
`/mcp/tools/call`

**Request Body (JSON-RPC 2.0):**
```json
{
  "jsonrpc": "2.0",
  "id": "unique-request-id",
  "method": "tools/call",
  "params": {
    "name": "tool_name",
    "arguments": {
      "arg1": "value1",
      "arg2": "value2"
    }
  }
}
```

**Successful Response:**
```json
{
  "jsonrpc": "2.0",
  "id": "unique-request-id",
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Return value of the tool (string or JSON stringified)"
      }
    ]
  }
}
```

## 3. Tool Reference

### 3.1 `get_next_task`
Fetches the first available `scheduled` task in a pipeline and marks it as `inprogress`.

*   **Arguments:**
    *   `pipeline_id` (string): The 24-char hex ID of the pipeline.
*   **Workflow Note:** 
    *   If the returned task has `want_design_doc: true`, you **MUST** provide a design proposal using `update_task_design_doc` before implementing.
    *   The task will move to `proposed` status once the design is set.
    *   Stop working on the task and call `get_next_task` again to pick up another task (possibly the same one after it's approved and re-scheduled).
*   **Returns:** A dictionary with task details or an error message.

### 3.2 `update_task_design_doc`
Updates the design document field for a specific task.

*   **Arguments:**
    *   `task_id` (string): The 24-char hex ID of the task.
    *   `design_doc` (string): The Markdown-formatted design document.
    *   `version` (integer): Current task version for optimistic concurrency control (OCC).
*   **Side Effects:** Automatically moves tasks to `proposed` if `want_design_doc` is `True`.
*   **Returns:** A success message or error string.

### 3.3 `complete_task`
Finalizes a task implementation.

*   **Arguments:**
    *   `task_id` (string): The 24-char hex ID of the task.
    *   `commit_hash` (string): The full git commit hash (7-40 hex chars) containing the work.
    *   `completion_info` (string): A brief summary of what was accomplished.
    *   `version` (integer): Current task version for OCC.
*   **Requirement:** If `want_design_doc` was `True`, the design must have been approved by a user before calling this tool.
*   **Returns:** A status message, including warnings if automated verification failed.

### 3.4 `search_tasks`
Search for tasks based on keywords, statuses, or pipeline.

*   **Arguments:**
    *   `keywords` (optional string): Matches title, spec, or design doc.
    *   `statuses` (optional list of strings): Filter by status (e.g., `["created", "inprogress"]`).
    *   `pipeline_id` (optional string): Filter by pipeline ID.
    *   `page` (optional integer): Page number (0-based, default: 0).
    *   `limit` (optional integer): Max tasks to return (default: 10).
*   **Returns:** A paginated list of task summaries.

### 3.5 `get_task_details`
Retrieves full details for a task, including spec, design, and transition history.

*   **Arguments:**
    *   `task_id` (string): The 24-char hex ID of the task.
*   **Returns:** Comprehensive task dictionary or error.

### 3.6 `get_task_status`
Retrieves current status and verification results for a task.

*   **Arguments:**
    *   `task_id` (string): The 24-char hex ID of the task.
*   **Returns:** Dictionary containing `id`, `status`, `version`, and `verification` results.

## 4. Task State Machine

Agents should respect the following task status transitions:

1.  **Scheduled**: Task is ready to be picked up by an agent.
2.  **In Progress**: Agent is currently working on the task (set by `get_next_task`).
3.  **Proposed**: Agent has submitted a design doc for a task that requires one (set by `update_task_design_doc`).
4.  **Implemented**: Agent has successfully committed and finalized the task (set by `complete_task`).
5.  **Failed**: Task implementation or verification failed.

## 5. Error Handling

The server uses standard JSON-RPC error codes:
-   `-32600`: Session not found (often indicates server reload or timeout).
-   `-32601`: Method not found.
-   `-32602`: Invalid params.
-   `-32603`: Internal error.

In addition, tools return semantic error strings or dictionaries containing an `"error"` key for domain-specific failures (e.g., "Task not found", "Version mismatch").
