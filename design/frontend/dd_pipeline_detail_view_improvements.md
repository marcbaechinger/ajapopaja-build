# Design Document: PipelineDetailView Improvements

## 1. Overview
The `PipelineDetailView` separates actionable tasks from already settled ones and
keeps inspectable history available on demand. Open tasks (actionable work) stay
in the primary "Task Sequence" area, while settled tasks are presented as a
compact history feed in the right sidebar. The open-tasks list supports local
view sorting so the sequence can be inspected in different orders without
affecting the actual execution order defined for the LLM.

## 2. Goals
- **Separate Settled Tasks**: Remove implemented / discarded tasks from the primary list of actionable tasks.
- **Inspectable History**: Provide a way for users to browse all settled tasks in a compact, paged feed.
- **Local View Sorting**: Allow users to change the sort order of the open tasks (e.g., sort by creation date or status) purely for viewing purposes, without affecting the actual execution order (`order` field) defined for the LLM.

## 3. UI/UX

### 3.1 Task Segmentation
The `PipelineDetailView` splits the pipeline's tasks into two groups within the
"Task Sequence" area:
1. **Open Tasks**: Contains tasks that are `CREATED`, `SCHEDULED`, `INPROGRESS`, or `FAILED`.
2. **Completed Tasks**: Contains tasks that are `IMPLEMENTED`, `SUBMITTED`, or `DISCARDED`.

### 3.2 History Feed (PipelineHistoryView)
- The settled tasks are rendered by the `PipelineHistoryView` inside the right
  sidebar, at the bottom of the `ExecutionEngineView`.
- `PipelineHistoryView` renders the settled tasks as a single flat "History Feed"
  list where each item is a `HistoryItemView`.
- The feed is paged with a fixed page size of 10; the first page is shown by
  default and a `PaginationControl` navigates through the remaining pages.
- Settled tasks are ordered by their completion time (newest first).
- There is no separate "last completed" section and no redundant wrapping
  containers or padding.

### 3.3 Local Sorting for Open Tasks
- **Sort Controls**: A dropdown above the "Open Tasks" list allows the user to select a sorting strategy:
  - `Execution Order` (Default): Sorts by the task's `order` field.
  - `Newest First`: Sorts by `created_at` descending.
  - `Status`: Sorts grouped by `status`.
- **State Management**: The chosen sort order is stored locally in the component's state (e.g., a `currentSortOrder` variable) and potentially persisted in `localStorage`.
- **Data Integrity**: Actions like "Move Up" or "Move Down" (which modify the actual `order` field) are either disabled when not sorting by "Execution Order" or explicitly warn the user.

## 4. Implementation Details

### 4.1 `PipelineDetailView.ts`
- **Data Filtering**: In `refreshTasks()`, the fetched tasks are filtered into two groups: `openTasks` and `completedTasks`.
- **Applying Sort**: Before rendering the primary list, a sorting function is applied based on the `currentSortOrder` state.
- **Rendering**:
  - `openTasks` are rendered as the primary list in the "Task Sequence" area.
  - `completedTasks` are passed to the `ExecutionEngineView`, which renders the
    `PipelineHistoryView` feed at the bottom of the right sidebar.
- **Paging**: `prev_history_page` and `next_history_page` actions update the
  local `historyPage` and re-render only the `#history-feed` so the engine
  sections and the CoderBot slot stay untouched.

### 4.2 `TaskItem.ts`
- The "Move Up" and "Move Down" buttons explicitly reference the `order`
  property, and they are hidden or disabled when the local sort order is not
  "Execution Order", preventing user confusion.
