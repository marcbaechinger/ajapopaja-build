# Design Document: Granular Task Updates

**Task ID:** 69dea05fed8dfe2c07581a80
**Status:** PROPOSED

## 1. Goal
Optimize the `PipelineDetailView` to avoid full re-renders when a task is created, updated, or deleted. This improves performance and preserves UI state (like scroll position and focus) better than a total refresh.

## 2. Current State
- `TASK_UPDATED`: Mostly uses `updateSingleTask` which replaces the task card in-place. However, it calls `refreshTasks()` if the task moves between "Open" and "Completed" sections.
- `TASK_CREATED`: Calls `refreshTasks()` (full 3-column re-render).
- `TASK_DELETED`: Calls `refreshTasks()` (full 3-column re-render).
- `refreshTasks()`: Re-fetches all tasks from the server and re-renders the entire view content.

## 3. Proposed Changes

### 3.1. Partial DOM Manipulation
Instead of a full re-render, we will use targeted DOM updates for all task lifecycle events.

#### A. Task Creation
- A new `insertTaskIntoColumn(task)` method will:
    - Render the task card using `TaskItem.render()`.
    - Identify the correct column based on status.
    - Append or insert the card into the corresponding `#{id}-list`.
    - Remove "No tasks" placeholder if it exists.
    - Update column header counts.
    - Update the top summary stats.

#### B. Task Deletion
- A new `removeTaskFromDOM(taskId)` method will:
    - Find the element by ID and remove it.
    - If the column list is now empty, re-render the "No tasks" placeholder.
    - Update column header counts.
    - Update the top summary stats.

#### C. Task Movement (Status Changes)
- `updateSingleTask` will be improved to:
    - Check if the task's new status requires it to move to a different column.
    - If it moves:
        - Remove from old column.
        - Insert into new column.
    - Special handling for "Last Completed" vs "Older Completed" list in the History column.

### 3.2. Local State Management
- Maintain `this.allLoadedTasks` correctly in response to all WS events.
- Implement `updateHeaderStats()` and `updateColumnStats(columnId)` to refresh counts without re-rendering lists.

### 3.3. Column Identification
Map `TaskStatus` to Column IDs:
- `PROPOSED` -> `proposed-list`
- `CREATED` -> `backlog-list`
- `INPROGRESS` -> `inprogress-list`
- `FAILED` -> `failed-list`
- `SCHEDULED` -> `scheduled-list`
- `IMPLEMENTED` / `DISCARDED` -> `completed-task-list` (or `last-completed-task`)

## 4. Implementation Details

### 4.1. Helper: `getTaskColumnId(status)`
Returns the ID of the list container for a given status.

### 4.2. Helper: `updateColumnHeader(columnId)`
Updates the count in the `<h3>` of the column.

### 4.3. Refining `updateSingleTask`
Handle the transition logic:
1. If status changed and it belongs in a different column:
    - Remove from current parent.
    - Check if previous parent is now empty.
    - Find new parent.
    - Insert into new parent (handling sort order if necessary).

## 5. Verification Plan
1. **Manual Testing**:
    - Create a task: Verify it appears in the backlog without flickering the whole page.
    - Schedule a task: Verify it moves from Backlog to Queue.
    - Accept design: Verify it moves from Proposed to Backlog/Queue.
    - Delete a task: Verify it disappears and counts update.
2. **Automated Testing**:
    - Existing tests in `PipelineDetailView.test.ts` (if any) or create new ones for partial updates.
    - Verify `allLoadedTasks` remains in sync with the DOM.
