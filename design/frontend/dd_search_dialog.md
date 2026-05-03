# Search Dialog Design

## Overview
The **SearchDialog** is a reusable modal that provides a full‑text search over tasks. It builds on the generic `BaseDialog` component and is integrated with the global `ActionRegistry` for action handling. The dialog contains a search input, status filters, results list, and pagination controls.

## Architecture

* **BaseDialog** – The dialog inherits from `BaseDialog`, which supplies a consistent dialog shell, backdrop handling, and a promise‑based `.show()` API.
* **Rendering** – `renderBody()` constructs the DOM structure. The dialog is re‑rendered after initialization and whenever the UI state changes (search results, pagination, etc.).
* **Event Delegation** – A single click listener on the dialog body delegates actions based on the `data-action-click` attribute of the clicked element.

### Action Handling Rules

| Action | Handled in SearchDialog | Behavior |
|--------|------------------------|----------|
| `toggle_task_collapse` | **Yes** | Stops propagation, toggles the task body visibility within the dialog. |
| `delete_task`, `fail_task`, `schedule_task`, `unschedule_task`, `cancel_progress`, `accept_design`, `reject_design` | **Yes** | Stops propagation, performs the action via the task client, then refreshes the search results. |
| `prev_search_page`, `next_search_page` | **Yes** | Stops propagation, adjusts the current page and re‑executes the search. |
| `toggle_design_doc_expand`, `toggle_spec_expand` | **Yes** | Stops propagation, expands/collapses the respective section. |
| **Utility actions** (`copy_task_id`, `open_quickfix`, `trigger_docbot`, `copy_design_doc`, etc.) | **No** | The event is allowed to bubble to the global `ActionRegistry`, which contains handlers that perform the UI‑agnostic work. |

### Why Bubble Utility Actions?
The dialog shows the same actions that appear in the main task list. By letting these actions bubble, the global registry can perform the standard logic (e.g., copying to clipboard, opening a quick‑fix panel). This keeps the dialog lightweight and avoids duplicating business logic.

## User Experience

* **Focus** – The search input automatically receives focus when the dialog opens.
* **Keyboard** – Pressing *Enter* triggers a search.
* **Debounce** – Input changes are debounced to avoid excessive queries.
* **Pagination** – Page changes trigger a fresh search.

## Integration Points

* **TaskClient** – Used to execute CRUD and state‑transition operations.
* **ConfirmationDialog** – Displays confirmation prompts for destructive actions.
* **ActionRegistry** – Handles bubble‑up utility actions.

## Future Work

* Add tests for action propagation.
* Provide a more declarative action‑definition system.

---

This design document reflects the current implementation as of the `6276c4f0` commit.
