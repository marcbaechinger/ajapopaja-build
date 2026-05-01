# Design Proposal: Autonomous Self-Documentation Agent (`DocBot`)

## 1. Goal

The `DocBot` is an autonomous AI agent designed to maintain the project's architectural and design documentation. It analyzes completed tasks and their corresponding git commits to ensure that any significant design changes or new principles are reflected in the reference documentation.

## 2. Architecture

### 2.1 Component Overview

The feature will be implemented in a new module `backend/api/src/api/docbot/`.

- **`DocBotManager`**: Orchestrates the documentation process. It is triggered after a task is marked as completed.
- **`DocBotSession`**: Manages the autonomous interaction loop with Ollama. Unlike the human-facing `AssistantSession`, it does not require user approval for tool calls and operates on a "finish-on-completion" basis.
- **`DocBotRegistry`**: A specialized registry containing tools relevant for documentation.
- **Tools**:
  - Standard read‑only tools: `read_source_file`, `list_project_structure`, `git_show_commit`, `grep_search` from `backend/api/src/api/assistant/tools/`.
  - Keep specific Doc Bot tools separated in `backend/api/src/api/docbot/tools.py`.
  - Documentation‑specific tools:
    - `list_ref_docs()`: Lists files in the documentation directory (e.g., `ref_doc/` or `design/`).
    - `read_ref_doc(path)`: Reads a specific documentation file.
    - `update_ref_doc(path, content, reason)`: Updates or creates a documentation file.
    - `no_doc_update_needed(reason)`: Signals that the change does not require documentation updates.

### 2.2 Data Flow

1. **Trigger**: A task is completed via `complete_task`.
2. **Context Injection**: `DocBotManager` gathers:
    - Task details: `spec`, `design_doc`, `completion_info`.
    - Git diff: `git show <commit_hash>`.
3. **Session Start**: `DocBotSession` is initialized with a specialized System Instruction.
4. **Autonomous Loop**:
    - `DocBotSession` sends the context to Ollama.
    - Ollama performs research using tools.
    - If Ollama responds with text instead of a tool, the session automatically follows up with a "Continue" prompt.
5. **Finalization**: The session ends when either `update_ref_doc` or `no_doc_update_needed` is called.

## 3. Implementation Details

### 3.1 `DocBotSession`

This class will wrap `ollama.AsyncClient`. It will maintain its own history and handle tool execution.

```python
class DocBotSession:
    async def run(self, task_info: str, git_diff: str):
        # Initial prompt
        # Loop until terminal tool call or max iterations
```

### 3.2 System Instruction

> "You are a Documentation Architect. Your task is to analyze a completed software change and decide if the project's reference documentation (architecture, design principles, API contracts) needs to be updated.
> You have access to the source code, git history, and the current reference documentation.
> Follow these steps:
>
> 1. Review the task spec, implementation summary, and the git diff.
> 2. Explore the codebase and existing documentation to understand the impact.
> 3. If the change introduces new design patterns, modifies core architecture, or changes public‑facing API contracts, update the relevant documentation.
> 4. If the change is purely implementation details or consistent with existing documentation, call `no_doc_update_needed`.  Do not ask for permission. Act autonomously."

### 3.3 Documentation Storage

Documentation will be stored in a configurable directory, defaulting to `design/` (to leverage existing architectural docs).

## 4. User‑Facing Inline Diff Preview

The DocBot workflow now exposes a preview of the changes it proposes, allowing users to review, commit, or revert the documentation update before it reaches the repository.

### 4.1 Backend Changes

- **In‑memory cache**: The `update_ref_doc` tool writes the file to disk and immediately captures a `git diff --unified=3` of that file. The diff, a derived commit message, and metadata are stored in a per‑task cache.
- **API Endpoints**:
  - `GET /api/pipelines/<pid>/docbot/preview/<task_id>` – Returns the cached diff and suggested commit message.
  - `POST /api/pipelines/<pid>/docbot/review/commit/<task_id>` – Stages the file, commits with the supplied message, and clears the cache.
  - `POST /api/pipelines/<pid>/docbot/review/revert/<task_id>` – Discards the file changes and clears the cache.
  - `POST /api/pipelines/<pid>/docbot/review/cancel/<task_id>` – Keeps the cache for future review.
- **WebSocket push**: When a preview becomes available, the server broadcasts a `DOCBOT_PREVIEW_READY` message with the `task_id`. Clients subscribe to this channel to trigger a UI update.

### 4.2 Front‑End Integration

- **`DocBotDialog` component**: Provides a modal that displays the side‑by‑side diff (using `react‑diff‑view` logic), a textarea pre‑filled with the suggested commit message, and actions for Commit, Revert, or Cancel.
- **Banner**: A yellow banner appears in the `PipelineDetailView` header when a preview is ready. Clicking it opens the dialog.
- **State Management**: The view listens to `DOCBOT_PREVIEW_READY`, fetches the preview data, and manages dialog visibility.

### 4.3 Summary of Flow

1. DocBot writes a new or updated documentation file.
2. `update_ref_doc` caches the unstaged diff and emits a WebSocket event.
3. The UI shows a banner; the user can open the dialog.
4. The user reviews the diff, optionally edits the commit message, and commits or reverts.
5. The backend performs the git operation and clears the cache.

This addition ensures the repository remains clean while giving the task owner a transparent review step.

## 5. Testing Strategy

- **Mock Ollama**: Use a mock client to simulate various LLM responses (tool calls, text, terminal calls).
- **Tool Validation**: Ensure `update_ref_doc` correctly writes to the filesystem and `read_ref_doc` retrieves the latest content.
- **Workflow Test**: A full integration test that feeds a dummy task and diff and verifies the final state (file update or no‑op).

