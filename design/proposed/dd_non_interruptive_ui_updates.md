# Design Document: Non-Interruptive UI Updates

## 1. Overview
Currently, the Ajapopaja Build web application updates its UI in real-time using WebSockets when changes are made via the FastAPI endpoints or the MCP server. While surgical DOM updates have improved performance and reduced complete page reloads, real-time injections can still disrupt the user's workflow, cause layout shifts, or destroy active local state.

This document identifies scenarios where these real-time updates might interrupt a user interacting with the `PipelineDetailView` and proposes strategies to address them.

## 2. Identified Scenarios & Interruptions

### 2.1 Active Local Editing (Design Documents)
- **Problem:** A user is writing a design document using the EasyMDE editor. If an external event (e.g., the MCP agent updating the task status) triggers an update for that specific task, re-rendering the task's DOM node via `innerHTML` replacement would destroy the editor instance and all unsaved text.
- **Current Mitigation:** We currently skip external updates for tasks whose IDs are in the `activeEditors` map.
- **Drawback:** The UI goes stale. If the agent completes the task or modifies its title while the user is writing the design doc, the user won't see those changes until they refresh or save.

### 2.2 Focus & Form Inputs
- **Problem:** A user is typing in the "Add New Task" input, or potentially modifying a task's title (if inline editing is introduced). A sudden `refreshTasks()` call (e.g., from a `TASK_CREATED` event) might steal focus, wipe out the typed text, or abruptly shift the input field out from under their cursor.

### 2.3 Scroll Jumping & Layout Shifts
- **Problem:** A user is reading the description of a task midway down the page. The MCP agent completes a task at the top of the list, moving it to the "Completed Tasks" section.
- **Consequence:** The content above the user's viewport suddenly shrinks, causing the page to violently scroll up and the user to lose their reading position or accidentally click the wrong button (e.g., clicking "Delete Task" when they meant to click "Schedule Execution").

### 2.4 Stale Confirmation Dialogs
- **Problem:** A user clicks "Delete Task" or "Mark as Failed", opening a confirmation dialog. While they are reading the prompt, the MCP agent completes or deletes the task in the background.
- **Consequence:** The user confirms an action on a task that is no longer in the expected state (or no longer exists), leading to an error or unexpected behavior.

## 3. Proposed Solutions

### 3.1 Pending Update Indicators & Queues
Instead of silently skipping updates when a task is locked by an active editor, we should queue the incoming WebSocket payload and notify the user.
- **Implementation:** Show a small, non-intrusive "Update Pending (Refresh)" badge on the task header.
- **Action:** Once the user saves or cancels their local edits, automatically apply the queued update. Alternatively, allow the user to click the badge to discard their local changes and pull the latest state.

### 3.2 Focus-Aware DOM Replacement (Diffing)
Replacing a DOM node's `outerHTML` or `innerHTML` is a blunt instrument that destroys focus and input state.
- **Implementation:** Before applying an update via `TaskItem.render()`, check if any element within the target `taskEl` matches `document.activeElement`.
- **Alternative:** Transition from full string-based replacement to a lightweight virtual DOM diffing approach (like `morphdom`). This allows the browser to update only the changed text nodes or attributes (like the status badge) without touching the active `<textarea>` or `<input>`.

### 3.3 Scroll Anchoring and Animation
To prevent jarring layout shifts when tasks move between sections (e.g., from "Task Sequence" to "Last Completed Task"):
- **Implementation:** Utilize modern CSS features like `overflow-anchor: auto;` to ask the browser to minimize scroll shifts.
- **Animation:** When an element is added or removed, apply a CSS transition to its `max-height`, `opacity`, and `padding` to smoothly collapse or expand the space it occupies, giving the user visual context of what changed.

### 3.4 Dialog Validation and Pre-flight Checks
- **Implementation:** When a confirmation dialog resolves (e.g., the user clicks "Confirm Delete"), perform a quick pre-flight check or rely on optimistic concurrency control (OCC) using the task's `version` number. If the backend returns a `409 Conflict` or a `404 Not Found`, catch the error gracefully, close the dialog, and display a toast notification explaining that the task was modified externally.
