# Frontend State Centralization

**Status:** Proposed
**Scope:** `frontend/src` — SPA state management
**Related:** [`dd_data_manager.md`](./dd_data_manager.md), [`dd_datamanager_test_strategy.md`](./dd_datamanager_test_strategy.md), [`dd_local_storage_manager.md`](./dd_local_storage_manager.md), [`dd_spa_architecture.md`](../dd_spa_architecture.md)

---

## 1. Context and Goal

The SPA's main views (`DashboardView`, `PipelineDetailView`) hold a significant
amount of application state. Some of it is server domain data (pipelines, tasks,
design docs, pull requests, git status, bot runs), some is UI state (collapsed
cards, selected task, current history page) and some is persisted preference
state (theme, pending-review badges, assistant panel geometry).

[`dd_data_manager.md`](./dd_data_manager.md) (and section 10 of
[`dd_spa_architecture.md`](../dd_spa_architecture.md)) already proposed a
`DataManager` as the **single source of truth** for domain entities. This
document:

1. checks whether that design has been implemented,
2. inventories where the state actually lives today and whether it is
   consistent,
3. proposes a concrete migration to a consistent state architecture.

---

## 2. Is `dd_data_manager.md` Implemented?

**Verdict: partially.** The `DataManager` class exists exactly as specified and
is unit-tested, but the architectural intent — that it be the *single source of
truth* all views read from — is largely unrealized. It behaves today as a
write-through event relay plus a small cache; views still keep their own
authoritative copies and keep fetching directly.

### 2.1 Responsibility checklist

| `dd_data_manager.md` responsibility | Implemented? | Evidence |
| --- | --- | --- |
| Cache `Pipeline` / `Task` / `DesignDocHistory` in `Map`s | ✅ Yes | `DataManager.ts` (`pipelines`, `tasks`, `designDocs`) |
| Subscription API `on(query, cb) -> unsubscribe` | ✅ Yes | `DataManager.on()` + listener map |
| WebSocket integration (task/pipeline/design/bot events) | ⚠️ Partial | Handles `TASK_*`, `PIPELINE_UPDATED`, `DESIGN_DOC_UPDATED`, bot lifecycles; **missing `PIPELINE_CREATED` / `PIPELINE_DELETED`** |
| Optimistic `updateTask` / `updatePipeline` | ✅ Yes | `updateTask` / `updatePipeline`; optimistic use in `trigger_coderbot` |
| `removeTask` with `{ id, deleted: true }` payload | ✅ Yes | `removeTask()` + `TASK_DELETED` |
| Data conversion to domain models (`_id` → `id`) | ✅ Yes | `new Task(...)` / `new Pipeline(...)`; covered by tests |
| Instantiated in `AppContext` and exposed as `context.dataManager` | ✅ Yes | `AppContext.ts` |
| Views consume it instead of direct WS handling | ❌ No | `DashboardView` uses `wsClient.on` + direct clients; `PipelineDetailView` keeps its own cache |
| Cache read API is actually used | ❌ No | `getTasksByPipeline`, `getPipeline`, `getDesignDoc` have **no callers**; only `AppContext.getTask` reads |
| DataManager is the single source of truth | ❌ No | See §4 |

### 2.2 Concrete evidence

- **The read side of the cache is dead code.** `getTasksByPipeline`,
  `getPipeline` and `getDesignDoc` are never called outside tests. Only
  `getTask` is used, from `AppContext.initOnePrompt`.
- **`PipelineDetailView` writes to `DataManager` but never reads from it.**
  `loadPipeline()` and `refreshTasks()` call `updatePipeline` / `updateTask`,
  but the view then continues to render from its own `this.pipeline` and
  `this.allLoadedTasks`. `updateSingleTask` is fed by DataManager
  notifications, but reads/writes the local `allLoadedTasks` array.
- **`DashboardView` bypasses `DataManager` entirely.** It subscribes to
  `wsClient` directly and re-fetches `pipelineClient.list()` plus
  `taskClient.listByPipeline()` for every pipeline on every task event.
- **Entities other than Pipeline/Task/DesignDoc are absent:** pull requests,
  git status and bot-run state are not modeled in `DataManager` at all.
- **`DataManager` re-broadcasts rather than owns process state.** Bot events are
  forwarded as `ws:${type}:${pipelineId}` queries; the actual `docbotState`,
  `reviewbotState`, `archbotState`, `coderbotState` fields live in
  `PipelineDetailView`.

So `dd_data_manager.md` is a **partial, "phase 1" implementation**: the
mechanism is there, adoption is not.

---

## 3. Current State Inventory (Who stores what, where)

### 3.1 Core / app-level

| Owner | State | Where | Persistence | Notes |
| --- | --- | --- | --- | --- |
| `AppContext` | `{ theme }`, plus DOM `data-theme` | `AppContext.state` | ❌ Not persisted (read from DOM attribute on boot) | Toggle updates the DOM but never writes storage |
| `DataManager` | `pipelines`, `tasks`, `designDocs`, listener map | In-memory `Map` | ❌ Volatile | Fed by WS; read by almost nobody |
| `WebSocketClient` | socket, handlers, reconnect backoff, `lastSentMessage`, `clientId` | In-memory | ❌ Volatile | Correct place for transport state |
| `AuthService` | access/refresh token, current user | `LocalStorageManager('auth')` | ✅ `localStorage` | Only service using `LocalStorageManager` for auth |
| `CoderBotService` | `blocks`, `openBlocks`, `messageHistory`, `currentTaskId`, `currentPipelineId`, `isSessionActive`, `sessionStartTime`, `loadedSessionKey` | In-memory + **raw `localStorage['ajapopaja:coderbot:session']`** | ⚠️ Raw key, bypasses `LocalStorageManager` | Active-session state overlaps `coderbotState` in `PipelineDetailView` |
| `AssistantService` | listener list only | In-memory | ❌ Volatile | Stateless fan-out of WS responses |
| `AssistantPanel` | `{ position, size }` settings, open/history flags | `LocalStorageManager('assistant')` + in-memory | ✅ settings | `isOpen`, `hasLoadedHistory`, DOM refs are UI state |

### 3.2 `DashboardView`

| State | Where | Persistence | Fetch strategy |
| --- | --- | --- | --- |
| Available pipelines + their tasks | **None cached** — rendered immediately | ❌ | `pipelineClient.list()` + `taskClient.listByPipeline()` on **every** `refreshList()` |
| `container`, `unsubs` | In-memory | ❌ | — |
| WS subscriptions | `context.wsClient.on(...)` for `PIPELINE_CREATED/DELETED` and 5 `TASK_*` events | ❌ | Each event triggers a full re-fetch of all pipelines and all their tasks |
| `PipelineItemView` | `pipeline`, `statsTasks`, `boundEl`, derived "recently implemented" | Transient render helper | ❌ | Renders from data passed by the view |

> The dashboard has **no cache**; the `DataManager` already receives the same
> events but is not consulted.

### 3.3 `PipelineDetailView` (+ subcomponents)

Server-derived state held **locally**, mirroring or duplicating `DataManager`:

| Field | Kind | In `DataManager`? | Notes |
| --- | --- | --- | --- |
| `pipeline: Pipeline \| null` | Domain | Written, never read | `loadPipeline()` mirrors it |
| `allLoadedTasks: Task[]` | Domain | Written per task, never read | Authoritative for rendering; `refreshTasks()` refetches |
| `pullRequests: any[]` | Domain | ❌ Absent | Fetched via `PullRequestClient`; typed `any[]` despite a `PullRequest` model |
| `gitStatus: GitStatusDetails` | Domain | ❌ Absent | Fetched via `PipelineClient.getGitStatus`, debounced locally |
| `docbotState` / `reviewbotState` / `archbotState` / `coderbotState` | Process/domain | ❌ Absent (only re-broadcast) | Driven by `ws:${event}:${pipelineId}` queries |
| `pendingReviews: string[]` | Derived domain | ❌ Absent | Persisted under `pipeline:pending_reviews:${id}`; also derivable from `task.review_md` |
| `docbotPreviewData` | Domain (preview) | ❌ Absent | Loaded via **raw `fetch()`**, not a client |

Pure **UI / ephemeral** state (correctly local to the view):

| Field | Purpose |
| --- | --- |
| `selectedTask` / `selectedTaskId` | Which task is open in the mid panel |
| `collapsedTasks`, `collapsedSpecs` | Collapse toggles |
| `historyPage` | History feed pagination |
| `isFirstLoad`, `pendingSpecEditTaskId` | One-shot flow flags |
| `activeEditors: Map<string, EasyMDE>` | Editor instances |
| `enginePiView`, `enginePiMountedKey` | Mounted `PiView` DOM handle |
| `keydownHandler`, `container`, `unsubs`, timers | Infrastructure |

`pullRequests`, `gitStatus` and bot states are **not** UI state; they are
server domain state that happens to live in the view because `DataManager` does
not model it yet.

### 3.4 Persistence map

| Storage key / namespace | Written by | Managed by |
| --- | --- | --- |
| `auth:*` | `AuthService` | `LocalStorageManager` ✅ |
| `assistant:*` | `AssistantPanel` | `LocalStorageManager` ✅ |
| `pipeline:pending_reviews:<id>` | `PipelineDetailView` | `LocalStorageManager` ✅ |
| `ajapopaja:coderbot:session` | `CoderBotService` | **raw `localStorage`** ❌ |
| `data-theme` (DOM only, not stored) | `AppContext` | **not persisted** ❌ |

---

## 4. Is It Consistent? Identified Inconsistencies

The current implementation is **not consistent**. The same class of data is
retrieved, cached and updated through different mechanisms depending on which
view touches it.

1. **Two parallel task caches.** `PipelineDetailView.allLoadedTasks` and
   `DataManager.tasks` both hold tasks. The view is authoritative for rendering;
   `DataManager` is a shadow copy that can silently drift if a code path updates
   one without the other (`removeTaskFromInProgressOnPullRequest` mutates only
   the local array and DOM, never `DataManager`).
2. **Read paths bypass the store.** `getTasksByPipeline()`, `getPipeline()`,
   `getDesignDoc()` have no production callers, so "single source of truth"
   holds only in documentation.
3. **Dashboard ignores `DataManager`.** It subscribes to raw
   `WebSocketClient` events and re-fetches everything. `PIPELINE_CREATED` /
   `PIPELINE_DELETED` are not handled by `DataManager`, so the store's pipeline
   cache is incomplete for the dashboard.
4. **Refresh storms.** Every `TASK_CREATED/UPDATED/STATUS_UPDATED/COMPLETED/
   DELETED` event makes `DashboardView` issue `1 + N` HTTP requests (all
   pipelines and all their tasks) even though the WS payload already carries the
   changed task. This is the opposite of the `DataManager` design goal
   ("eliminate duplicated HTTP requests").
5. **Missing domain slices.** Pull requests, git status and bot-run state are
   first-class domain state but are not in `DataManager`; they are fetched and
   cached ad hoc in `PipelineDetailView`.
6. **Inconsistent typing.** `pullRequests: any[]` while `PullRequest` is a
   domain class. `docbotPreviewData: any`.
7. **Client bypass.** `PipelineDetailView.fetchDocBotPreview()` uses a raw
   `fetch('/api/...')`, violating the `dd_spa_architecture.md` rule that UI code
   never makes raw HTTP calls. (There is no `DocBotClient.getPreview` method.)
8. **Bot state split across layers.** `CoderBotService` tracks the lifecycle of
   the active session (`isSessionActive`, `currentTaskId`, `currentPipelineId`)
   while `PipelineDetailView.coderbotState` tracks a UI interpretation of the
   same lifecycle. `docbot`/`reviewbot`/`archbot` states have no home other than
   the view.
9. **Inconsistent persistence.** `CoderBotService` writes a raw
   `ajapopaja:coderbot:session` key instead of using `LocalStorageManager`; the
   theme is not persisted at all, so it resets on reload even though the DOM
   attribute is read at boot.
10. **Redundant derived state.** `pendingReviews` is persisted locally, yet the
    same information is derivable from `task.review_md` in the task cache;
    persisted and server-derived values can disagree.
11. **Ad-hoc query strings.** `DataManager.on()` uses string keys
    (`pipeline:tasks:<id>`, `ws:<TYPE>:<id>`) with no typed/central definitions,
    which makes it easy to introduce typos and hard to discover available
    state.

---

## 5. Proposed Target Architecture

Adopt a clear **state taxonomy** and route each kind of state to exactly one
owner.

| State class | Owner | Characteristics |
| --- | --- | --- |
| **Server domain state** — pipelines, tasks, design docs, pull requests, git status, bot-run status | `DataManager` (in-memory cache) | Single source of truth; only written by clients/WS; views subscribe & read |
| **Long-lived session/stream state** — CoderBot log blocks, assistant conversation | `CoderBotService` / `AssistantService` | High-frequency streams kept out of `DataManager`; exposed via their own subscriptions, but *session metadata* (active task/pipeline) is mirrored into `DataManager` |
| **Ephemeral view state** — selection, collapse, pagination, editor handles | The owning view/component | Never shared; discarded on unmount |
| **Persisted UI preferences** — theme, panel geometry, pending badges | `LocalStorageManager` namespaces | Always via `LocalStorageManager`; never raw `localStorage` |

### 5.1 Expand `DataManager` into the domain store

Add slices (all normalized to domain models) and typed query helpers:

- **Pipelines:** keep `pipelines`; add a *collection* view with
  `getPipelines()` / `setPipelines(list)` so the dashboard does not need to
  fetch per render.
- **Pull requests:** `pullRequests: Map<string, PullRequest>` +
  `getPullRequestsByPipeline(id)`, `setPullRequestsForPipeline(id, prs)`,
  `updatePullRequest(pr)`; query `pipeline:pullrequests:<id>`.
- **Git status:** `gitStatus: Map<string, GitStatusDetails>` +
  `getGitStatus(id)`, `updateGitStatus(id, status)`; query
  `pipeline:git:<id>`.
- **Bot/process state:** `botState: Map<string, BotState>` keyed by pipeline,
  with `getBotState(id)` / `updateBotState(id, patch)`; query
  `pipeline:bots:<id>`, replacing the `ws:<TYPE>:<id>` relay.
- **Design docs:** keep the existing `designDocs` cache and finally read from it.
- **Subscribe to `PIPELINE_CREATED` / `PIPELINE_DELETED`** so the pipeline
  collection (and dashboard) stays correct without refetching.

Add a thin **load facade** so the store, not the view, performs I/O and
de-duplicates in-flight requests (mirroring the existing `historyLoadPromise`
pattern in `CoderBotService`):

```ts
await dataManager.loadPipelines(pipelineClient);
await dataManager.loadTasks(taskClient, pipelineId);
await dataManager.loadPullRequests(pullRequestClient, pipelineId);
await dataManager.loadGitStatus(pipelineClient, pipelineId);
```

Views then render from the cache and subscribe to changes. HTTP is only used to
seed or refresh; WS deltas keep the cache current.

### 5.2 Keep the boundary explicit

- `CoderBotService` continues to own the streaming log (blocks, raw text) and
  history replay — pushing every render block into `DataManager` would be
  counter-productive. However, its **session metadata** (`taskId`,
  `pipelineId`, `active`, `startTime`) is mirrored into `DataManager` (or a
  dedicated typed store) and subscribed to by `PipelineDetailView`, so there is
  one canonical answer to "is a CoderBot running, and for which pipeline?".
- `AssistantService` stays as-is (transient conversation stream).

### 5.3 Centralize query keys

Replace literal query strings with exported constants/builders, e.g.:

```ts
export const queries = {
  pipeline: (id: string) => `pipeline:${id}`,
  pipelineTasks: (id: string) => `pipeline:tasks:${id}`,
  pipelinePullRequests: (id: string) => `pipeline:pullrequests:${id}`,
  pipelineGit: (id: string) => `pipeline:git:${id}`,
  pipelineBots: (id: string) => `pipeline:bots:${id}`,
  pipelineList: () => 'pipeline:list',
};
```

---

## 6. Migration Plan

The migration is intentionally phased so each step is independently shippable
and testable.

### Phase 1 — Extend `DataManager` (no view changes)

1. Add the pipeline-collection, pull-request, git-status and bot-state slices
   plus typed query builders from §5.1/§5.3.
2. Subscribe to `PIPELINE_CREATED` / `PIPELINE_DELETED`.
3. Add the async load facade with in-flight de-duplication.
4. Extend `DataManager.test.ts` / `DataManager.robust.test.ts` for the new
   slices and collection events.

### Phase 2 — Migrate `DashboardView`

1. Remove all `wsClient.on(...)` subscriptions; subscribe to
   `queries.pipelineList()` and `queries.pipelineTasks(id)` instead.
2. Replace `refreshList()`'s direct `pipelineClient.list()` /
   `taskClient.listByPipeline()` loop with `dataManager.loadPipelines(...)` and
   a per-pipeline task load, rendered from the cache.
3. Keep `PipelineItemView` as a pure renderer fed from `getPipelines()` /
   `getTasksByPipeline()`.
4. Update `DashboardView.test.ts` to assert it no longer calls the clients on
   every WS event and that it renders from `DataManager`.

### Phase 3 — Migrate `PipelineDetailView`

1. Delete `pipeline`, `allLoadedTasks`, `pullRequests`, `gitStatus` and the
   four bot-state fields from the view. Read them from `DataManager`.
2. Subscribe to `pipeline:<id>`, `pipeline:tasks:<id>`,
   `pipeline:pullrequests:<id>`, `pipeline:git:<id>`, `pipeline:bots:<id>`.
3. Keep the 500 ms git-status debounce (per
   [`dd_git_status_debounce.md`](./dd_git_status_debounce.md)), but move it
   behind `dataManager.loadGitStatus(...)` / the store so it is not view-local.
4. Replace `fetchPullRequests()` / `refreshPullRequests()` with store loads.
5. Replace raw `fetch()` in `fetchDocBotPreview()` with a `DocBotClient` method
   that returns domain data; cache the preview in `DataManager`.
6. Replace `removeTaskFromInProgressOnPullRequest()` with a real task update
   once the backend emits one (tracked as a backend follow-up), or at minimum
   route it through `dataManager.updateTask()` so the shadow cache cannot drift.
7. Derive `pendingReviews` from `task.review_md` in the task cache (or keep a
   small `DataManager` UI slice), removing the duplicate local persistence.
8. Retain only ephemeral UI fields in the view (selection, collapse, pagination,
   editor handles, `enginePiView`, one-shot flow flags).

### Phase 4 — Consolidate persistence and session state

1. Route `CoderBotService` session persistence through
   `LocalStorageManager.getInstance('coderbot')` and migrate any existing
   `ajapopaja:coderbot:session` value.
2. Persist `theme` through `LocalStorageManager.getInstance('ui')` (and keep
   the DOM attribute for no-flash boot), or document the DOM-only approach.
3. Document the canonical namespaces (`auth`, `assistant`, `pipeline`, `ui`,
   `coderbot`).

### Phase 5 — Cleanup

1. Remove or use the previously dead getters.
2. Add selector helpers for common derivations (e.g. "completed tasks of a
   pipeline") so views stop re-implementing filters.
3. Ban raw `fetch()` in `ui/` via lint/review; all I/O goes through clients.

---

## 7. Verification

- **Unit tests:** extend `DataManager.test.ts` and
  `DataManager.robust.test.ts` per
  [`dd_datamanager_test_strategy.md`](./dd_datamanager_test_strategy.md) to
  cover the new slices, collection events, typed queries and load-facade
  de-duplication.
- **View tests:** update `DashboardView.test.ts` and
  `PipelineDetailView.test.ts` to assert views read/render from `DataManager`
  and no longer subscribe to `wsClient` directly.
- **Behavioral checks (manual):**
  - Create/schedule/implement/delete a task: dashboard stats and the detail
    view update from a single WS event, with **no** full refetch.
  - Open a second tab: both tabs converge on the same pipeline/task state.
  - Reload while a bot runs: git status, bot banner and CoderBot session
    restore from cache/persistence.
- **Full suite:** `cd backend && uv run pytest` and
  `cd frontend && CI=true npm run test` must stay green after each phase.

---

## 8. Non-Goals and Risks

**Non-goals**

- Introducing a third-party state library (Redux/Zustand). The existing
  `WebSocketClient` + client + `DataManager` model is sufficient and already
  partially built.
- Moving high-frequency stream buffers (CoderBot blocks, assistant messages)
  into `DataManager`.

**Risks**

- **Optimistic-concurrency (OCC) conflicts.** Centralizing tasks means the
  store must be the single owner of `version`; every optimistic update must
  reconcile with the next WS `TASK_UPDATED`. Add tests around version drift.
- **Event ordering.** Rendering from a shared cache assumes WS ordering; the
  store should ignore stale updates (compare `version`/`updated_at`).
- **Migration churn.** The phased plan keeps each PR small; do not delete the
  view-local caches until the `DataManager` slices are proven by tests.
- **Backend gap.** `PULL_REQUEST_CREATED` currently implies a task status
  transition that is not broadcast as a task update. Fully removing
  `removeTaskFromInProgressOnPullRequest()` depends on a backend change and is
  therefore explicitly out of scope for the frontend-only migration.
