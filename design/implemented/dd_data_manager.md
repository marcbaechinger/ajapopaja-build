# Centralized Data Manager

## Purpose
The Data Manager acts as a single source of truth for all domain entities exposed by the SPA. It owns and caches instances of `Pipeline`, `Task`, `DesignDocHistory`, and other entities defined in `frontend/src/core/domain.ts`. The manager exposes a subscription API that components use to react to data changes, eliminating duplicated HTTP requests and ensuring consistent state across the UI.

## Core Responsibilities
- **Caching**: Stores domain objects in memory using `Map` keyed by entity id.
- **Subscription**: Maintains a map of listeners keyed by a query string (e.g., `pipeline:123`, `task:456`).  Callers register callbacks via `on(query, callback)` and receive notifications when the corresponding data changes.
- **WebSocket Integration**: Subscribes to real‑time events (`TASK_UPDATED`, `PIPELINE_UPDATED`, `DESIGN_DOC_UPDATED`, bot and process status events).  Upon receiving a message, it updates the cache and triggers the relevant listeners.
- **Optimistic Updates**: Exposes `updateTask` and `updatePipeline` helpers that mutate the cache immediately and notify listeners, allowing components to reflect changes before server confirmation.
- **Removal**: Handles deletion of tasks via `removeTask` and propagates deletions to listeners.  Listeners receive a payload of shape `{ id: string, deleted: true }` which indicates the task has been removed from the cache.
- **Data Conversion**: Wraps raw payloads in domain model instances (`new Task(data)`, `new Pipeline(data)`), ensuring type safety and normalizing fields such as `_id` ➜ `id`.

## Integration Points
- **AppContext**: Instantiated in `AppContext.ts` and exposed as `context.dataManager`.  All views and components import the context to register listeners.
- **Views**: Replace direct WebSocket handling with `dataManager.on(...)`.  Example:
  ```ts
  this.unsubs.push(this.context.dataManager.on(`pipeline:tasks:${this.pipelineId}`, (taskOrDeleted) => {
    if (taskOrDeleted.deleted) { /* handle deletion */ } else { this.updateSingleTask(taskOrDeleted); }
  }));
  ```
- **Backend**: No change to API; the Data Manager simply consumes the same WebSocket protocol already defined in the architecture.

## Benefits
- **Consistent UI State**: All components share the same cached objects; updates propagate automatically.
- **Reduced Network Load**: Components no longer perform redundant fetches; data is fetched once and reused.
- **Simplified Testing**: Unit tests can mock a simple `DataManager` instance instead of mocking `fetch` or WebSocket.
- **Real‑time Responsiveness**: WebSocket messages are processed centrally, ensuring all interested parties receive updates in the same order.

## API Overview
- `getPipeline(id) -> Pipeline | undefined`
- `getTask(id) -> Task | undefined`
- `getDesignDoc(id) -> DesignDocHistory | undefined`
- `getTasksByPipeline(pipelineId) -> Task[]`
- `on(query: string, callback: (data?: any) => void) -> () => void`
- `updateTask(task: Task | any) -> Task | undefined`
- `updatePipeline(pipeline: Pipeline | any) -> Pipeline | undefined`
- `removeTask(taskId: string)`

All public methods operate on cached entities and invoke `notify(query)` internally to trigger callbacks.
