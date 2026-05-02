# Design Proposal: Autonomous Self‑Documentation Agent (`DocBot`)

## 1. Goal

The `DocBot` is an autonomous AI agent designed to maintain the project's architectural and design documentation. It analyzes completed tasks and their corresponding git commits to ensure that any significant design changes or new principles are reflected in the reference documentation.

## 2. Architecture

### 2.1 Component Overview

The feature is implemented in the `backend/api/src/api/docbot/` module.

- **`DocBotManager`**: Orchestrates the documentation process. It is triggered after a task is marked as completed.
- **`DocBotSession`**: Manages the autonomous interaction loop with Ollama. Unlike the human‑facing `AssistantSession`, it does not require user approval for tool calls and operates on a "finish‑on‑completion" basis.
- **`DocBotRegistry`**: A specialized registry containing tools relevant for documentation.
- **Tools**:
  - Standard read‑only tools: `read_source_file`, `list_project_structure`, `git_show_commit`, `grep_search` from `backend/api/src/api/assistant/tools/`.
  - Documentation‑specific tools:
    - `list_ref_docs()`: Lists all reference documentation files available in the `design/` directory, including subdirectories.
    - `read_ref_doc(path)`: Reads a specific documentation file. Paths are relative to `design/` and may include subdirectories; a leading `design/` prefix is automatically stripped.
    - `update_ref_doc(path, content, reason)`: Creates or updates a documentation file. Paths are relative to `design/`, may include subdirectories, and a leading `design/` prefix is automatically stripped. This tool is **not** terminal; multiple calls can be made in a single session.
    - `update_markdown_section(pipeline_id, filename, markdown_heading, markdown_section, reason)`: Replaces a specific section of a documentation file. The heading must match exactly; the section content may optionally start with a header of the same level. The tool is **not** terminal.
    - `no_doc_update_needed(reason)`: Signals that the change does not require documentation updates.
    - `document_update_completed(reason)`: Signals that all documentation updates for the session have been finalized. This tool is terminal.

### 2.2 Data Flow

1. **Trigger**: A task is completed via `complete_task`.
2. **Context Injection**: `DocBotManager` gathers task details and the git diff.
3. **Session Start**: `DocBotSession` is initialized with a specialized system instruction.
4. **Autonomous Loop**: The session interacts with Ollama, performs research, and may call tools.
5. **Finalization**: The session ends when `document_update_completed` or `no_doc_update_needed` is called.

### 2.3 Lifecycle Events and UI Feedback

DocBot now emits two key lifecycle events that the front‑end consumes for real‑time user feedback:

- **`DOCBOT_STARTED`**: Broadcast when the `DocBotSession` begins processing a task.
- **`DOCBOT_COMPLETED`**: Broadcast after the session finishes, including the result payload.

The UI reacts by showing banners and a review dialog when a preview becomes available.

### 2.4 Implementation Details

- **`DocBotSession`**: Subclass of `BaseBotSession`. Implements `is_terminal_tool` to return `"document_update_completed"` and `"no_doc_update_needed"`.
- **`update_ref_doc`**: Writes the file, updates `session.has_updates = True`, caches a diff, and triggers a preview event.
- **`update_markdown_section`**: Reads the file, replaces the specified section, writes back, sets `session.has_updates = True`, and triggers a preview event.
- **`document_update_completed`**: Validates that at least one update has been made (`session.has_updates == True`) before allowing completion.

### 2.5 Manual Trigger Endpoint

A REST endpoint `POST /pipelines/{pipeline_id}/docbot/trigger/{task_id}` allows manual initiation of a DocBot session.

### 2.6 User‑Facing Inline Diff Preview

The `update_ref_doc` and `update_markdown_section` tools produce a diff preview. The front‑end can retrieve this preview via an API endpoint and present it for review, commit, or revert.

## 3. Testing Strategy

- Mock Ollama interactions.
- Validate `update_ref_doc` and `update_markdown_section` write files and produce correct diffs.
- Verify that `document_update_completed` enforces at least one update.

