# Design Document: Quickfix Button for Implemented Tasks

## 1. Overview
This document describes the **Quickfix** feature that enables users to open a Neovim quickfix list containing the changes introduced by an *implemented* task directly from the web UI. The feature comprises a single FastAPI endpoint, a new client method, and UI changes in `TaskItem` and `PipelineDetailView`.

## 2. Backend API

### 2.1 Endpoint
```
POST /tasks/{task_id}/quickfix
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

### 2.2 Dependencies
- **git_commit_hunks**: Extracts file‑level change hunks from a given commit.
- **nvim_set_quickfix**: Sends a quickfix list to the Neovim instance listening on the configured socket.
- **TaskQueries**: Provides task retrieval and validation.

## 3. Frontend Integration

### 3.1 TaskClient
```ts
export class TaskClient extends BaseClient {
  // ... existing methods
  async quickfix(id: string): Promise<void> {
    await this.fetch(`${this.baseUrl}/tasks/${id}/quickfix`, { method: 'POST' });
  }
}
```

### 3.2 TaskItem Component
- A small *Open Quickfix* button is rendered when `task.status === TaskStatus.IMPLEMENTED` **and** `task.commit_hash` exists.
- The button carries `data-action-click="open_quickfix"` and `data-task-id="${taskId}"`.
- The icon uses a simple list or code symbol.

### 3.3 PipelineDetailView
- Registers the `open_quickfix` action in `registerActions()`.
- On click, it retrieves the task id, calls `taskClient.quickfix(taskId)`, and optionally displays a transient success or error notification.

## 4. Interaction Flow
```
[UI] Click Quickfix button
  ↓
[Client] POST /tasks/{id}/quickfix
  ↓
[Server] Fetch task → git_commit_hunks → nvim_set_quickfix → return 200
  ↓
[Neovim] Quickfix window opens with files and line numbers
```

## 5. Rationale
- **Single Responsibility**: The endpoint is a thin adapter that orchestrates existing tools (`git_commit_hunks` and `nvim_set_quickfix`) without duplicating logic.
- **Reusability**: The helper functions can be reused by other features (e.g., a CLI or an AI assistant) that may also need to open a quickfix list.
- **UI Consistency**: The quickfix button follows the same data‑action pattern used throughout the app, keeping action handling centralized.

## 6. Future Considerations
- **Batch Quickfix**: Support opening multiple tasks in a single quickfix list.
- **Accessibility**: Add ARIA labels and keyboard shortcuts for the new button.
- **Testing**: The backend unit tests already mock `git_commit_hunks` and `nvim_set_quickfix`; UI tests verify button rendering.

---

**Author**: Marc Baechinger
**Last updated**: 2026‑05‑02
