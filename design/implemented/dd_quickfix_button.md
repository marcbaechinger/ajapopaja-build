# Design Document: Quickfix Button for Implemented Tasks

## 1. Overview
This document describes the **Quickfix** feature that enables users to open a Neovim quickfix list containing the changes introduced by an *implemented* task directly from the web UI. The feature comprises a FastAPI endpoint under the editor router, a new client method, and UI changes in `TaskItem` and `PipelineDetailView`.

## 2. Backend API

### 2.1 Endpoint
```
POST /editor/quickfix/{task_id}
```
- **Auth**: Requires a valid user token.
- **Pre‑conditions**: `task.status == IMPLEMENTED` and `task.commit_hash` is present.
- **Logic**:
  1. Retrieve the task via `task_queries.get_task_by_id(task_id)`.
  2. Call `git_commit_hunks(task.pipeline_id, task.commit_hash)` to obtain a JSON array of hunks.
  3. Convert each hunk to the format expected by `nvim_set_quickfix`:
     ```json
     {
       "filename": hunk["file"],
       "lnum": hunk["first_line"],
       "text": "[" + hunk["type"] + "] " + task.title
     }
     ```
  4. Invoke `nvim_set_quickfix(task.pipeline_id, matches, title="Task: " + task.title)`.
  5. Return `{"status": "ok"}` on success; otherwise propagate a 4xx/5xx error.

### 2.2 Generic Editor Command Endpoint
```
POST /editor/call/{command}
```
- **Command**: `quickfix` with payload `{"task_id": "..."}`
- **Response**: Same as `/editor/quickfix/{task_id}`.

### 2.3 Dependencies
- `git_commit_hunks`: Extracts file‑level change hunks from a given commit.
- `nvim_set_quickfix`: Sends a quickfix list to the Neovim instance listening on the configured socket.
- `TaskQueries`: Provides task retrieval and validation.

## 3. Frontend Integration

### 3.1 EditorClient
```ts
export class EditorClient extends BaseClient {
  // ... existing methods
  async call(command: string, options: Record<string, any>): Promise<void> {
    await this.fetch(`${this.baseUrl}/editor/call/${command}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });
  }

  async quickfix(taskId: string): Promise<void> {
    return this.call('quickfix', { task_id: taskId });
  }
}
```

### 3.2 PipelineDetailView
- Registers the `open_quickfix` action in `registerActions()`.
- On click, it retrieves the task id, calls `editorClient.quickfix(taskId)`, and optionally displays a transient success or error notification.

## 4. Interaction Flow
```
[UI] Click Quickfix button
  ↓
[Client] POST /editor/call/quickfix
  ↓
[Server] Fetch task → git_commit_hunks → nvim_set_quickfix → return 200
  ↓
[Neovim] Quickfix window opens with files and line numbers
```

## 5. Rationale
- **Namespace**: The editor‑specific functionality is now isolated under the `/editor` router, clarifying separation from task management endpoints.
- **Reusability**: The generic `/editor/call/{command}` endpoint allows future editor commands to be added without new routes.
- **Consistency**: The frontend uses `EditorClient` for editor interactions, keeping action handling centralized.

## 6. Future Considerations
- **Batch Quickfix**: Support opening multiple tasks in a single quickfix list.
- **Accessibility**: Add ARIA labels and keyboard shortcuts for the new button.
- **Testing**: The backend unit tests already mock `git_commit_hunks` and `nvim_set_quickfix`; UI tests verify button rendering.

---

**Author**: Marc Baechinger
**Last updated**: 2026‑05‑02