# Design Document: PipelineDetailView Improvements

## 1. Overview
Currently, the `PipelineDetailView` displays all tasks (both open and implemented) in a single, mixed list. This pushes actionable tasks down the page, reducing visibility. This design document outlines a new UI structure to separate implemented tasks from open ones and introduces local sorting capabilities for the open tasks list.

## 2. Goals
- **Separate Implemented Tasks**: Remove implemented tasks from the primary list of actionable tasks.
- **Inspectable History**: Provide a way for users to view implemented tasks on demand.
- **Local View Sorting**: Allow users to change the sort order of the open tasks (e.g., sort by creation date or status) purely for viewing purposes, without affecting the actual execution order (`order` field) defined for the LLM.

## 3. UI/UX Changes

### 3.1 Task Segmentation
The `PipelineDetailView` will be split into two distinct sections within the "Task Sequence" area:
1. **Open Tasks**: Contains tasks that are `CREATED`, `SCHEDULED`, `INPROGRESS`, or `FAILED`.
2. **Completed Tasks**: Contains tasks that are `IMPLEMENTED` or `DISCARDED`.

### 3.2 Completed Tasks Section
- Place the "Completed Tasks" list below the "Open Tasks" list.
- Wrap the entire "Completed Tasks" list inside an HTML `<details>` element (disclosure widget) so it remains collapsed by default.
- The summary could read: `View Completed Tasks ({count})`.

### 3.3 Local Sorting for Open Tasks
- **Sort Controls**: Add a dropdown or toggle buttons above the "Open Tasks" list allowing the user to select a sorting strategy:
  - `Execution Order` (Default): Sorts by the task's `order` field.
  - `Newest First`: Sorts by `created_at` descending.
  - `Status`: Sorts grouped by `status`.
- **State Management**: The chosen sort order will be stored locally in the component's state (e.g., a `currentSortOrder` variable) and potentially persisted in `localStorage`.
- **Data Integrity**: Ensure that actions like "Move Up" or "Move Down" (which modify the actual `order` field) are either disabled when not sorting by "Execution Order" or explicitly warn the user.

## 4. Implementation Details

### 4.1 `PipelineDetailView.ts`
- **Data Filtering**: In `refreshTasks()`, filter the fetched tasks into two arrays: `openTasks` and `completedTasks`.
- **Applying Sort**: Before rendering `openTasks`, apply a sorting function based on the `currentSortOrder` state.
- **Rendering**: 
  - Map over `openTasks` to render the primary list.
  - Map over `completedTasks` to render the secondary list inside the `<details>` container.
- **Action Handlers**: Register a new action to handle changes to the sort selection dropdown, which updates the local state and re-renders the list.

### 4.2 `TaskItem.ts`
- Ensure the "Move Up" and "Move Down" buttons explicitly reference the `order` property, and consider hiding or disabling them if the local sort order is not "Execution Order", to prevent user confusion.
