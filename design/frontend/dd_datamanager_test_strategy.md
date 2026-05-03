# Design Document: DataManager Test Strategy

## 1. Context
`DataManager.ts` is the central hub for data management and event distribution in the frontend. It manages the lifecycle of `Task` and `Pipeline` objects, maintains an internal cache, and bridges WebSocket events to UI listeners. Currently, the test suite (`DataManager.test.ts`) covers basic initialization, caching, and simple event notification, but lacks depth in verifying complex WebSocket event flows and robustness.

## 2. Objective
Enhance the `DataManager` test suite to ensure reliable data consistency and correct event propagation for all supported WebSocket events and edge cases.

## 3. Implementation Plan

### 3.1. Improve WebSocket Event Mocking
Currently, the test manually extracts handlers from `vi.fn()`. This should be formalized in a helper to easily "emit" events into the `DataManager`.

### 3.2. Verification of Complex Events
- **Bot Lifecycle**: Test `DOCBOT_STARTED`, `DOCBOT_COMPLETED`, and `DOCBOT_PREVIEW_READY`. Ensure they notify the correct `pipeline:status:*` and `task:status:*` queries.
- **Design Doc Updates**: Test `DESIGN_DOC_UPDATED` and verify `DesignDocHistory` objects are correctly instantiated and cached.
- **ArchBot Completion**: Verify that when `ARCHBOT_COMPLETED` carries a full task object, the cache is updated correctly.

### 3.3. Cache Consistency & Domain Mapping
- Verify that `updateTask` and `updatePipeline` always produce `Task` and `Pipeline` instances (not just plain objects).
- Verify that `_id` is correctly mapped to `id` (via domain classes).
- Verify that updating a task with new properties (e.g., `design_doc` or `review_md`) triggers the specific `task:design:*` or `task:review:*` notifications.

### 3.4. Event Bus Robustness
- **Multiple Listeners**: Confirm that multiple callbacks registered for the same query are all executed.
- **Unsubscription**: Confirm that the returned unsubscription function from `on()` effectively stops notifications.
- **Error Isolation**: Confirm that if one listener throws an error, other listeners for the same query are still notified.

### 3.5. Task Deletion
- Verify that `TASK_DELETED` removes the task from the cache and notifies the pipeline with a `{ deleted: true }` payload.

## 4. Test Strategy (Verification)
The strategy will be verified by implementing the enhanced test suite in `frontend/src/core/DataManager.test.ts` (or a supplementary test file) and ensuring all tests pass with `npm run test`.
