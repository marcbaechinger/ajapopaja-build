# SPA Architecture Design Document (`dd_spa_architecture.md`)

## 1. Overview

This document defines the architecture and design principles for the Ajapopaja Build Single Page Application (SPA). The SPA is built using **Vanilla TypeScript** and **Tailwind CSS v4**, adhering to Object-Oriented (OO) principles to ensure a maintainable, extensible, and replaceable codebase.

- **Main Entry Point**: `frontend/src/main.ts`
- **Global Styles**: `frontend/src/style.css`

## 2. Core Architectural Principles

- **OO Design**: Every major entity and UI component is represented as a class or a well-defined interface.
- **Component Decomposition**: Large views are broken down into subcomponents to promote reuse and simplify testing.
- **Interfaces**: Used extensively for backend clients and UI collaborators to allow for easy swapping (e.g., MockClient vs. HttpClient).

- **Domain Models**: `frontend/src/core/domain.ts`

## 3. Application Lifecycle & Context
### `AppContext`

- Initialized when the page loads.
- Acts as a Singleton or a shared instance passed to components.
- Holds the global state (current user, active pipeline, theme status).
- Manages instances of collaborators (Backend Clients, Action Registry, Navigator).
- Handles global keyboard shortcuts (e.g., `Ctrl+K` for global search).
- **DataManager**: Provides a single source of truth for domain entities.  The `DataManager` instance is created with the `WebSocketClient` and exposed as `dataManager`.  Components use this instance to register listeners (`on`) and to read cached data.

- **File Path**: `frontend/src/core/AppContext.ts`
## 4. Backend Communication

### Dedicated Clients

- All HTTP communication is encapsulated in client classes (e.g., `PipelineClient`, `TaskClient`).
- Clients provide a high-level TS API that uses domain entities (`Pipeline`, `Task`).
- UI and App code **never** make raw `fetch` calls; they interact solely with client methods.
- **Data Conversion**: All JSON responses (API or WebSocket) MUST be converted into domain model objects (e.g., `new Task(data)`) to ensure type safety and proper property mapping (like `_id` to `id`).

- **Base Client**: `frontend/src/core/clients/BaseClient.ts`
- **Pipeline Client**: `frontend/src/core/clients/PipelineClient.ts`
- **Task Client**: `frontend/src/core/clients/TaskClient.ts`
- **DocBot Client**: `frontend/src/core/clients/DocBotClient.ts`
  - Handles DocBot review actions such as commit, revert, and cancel review.

### Optimistic Concurrency Control (OCC)

- **Versioning**: Every entity (Pipeline, Task) includes a `version` (integer) field.
- **Conditional Updates**: Update requests must include the `version` the client is currently holding.
- **Conflict Handling**:
  - The server returns `HTTP 409 Conflict` if the version in the DB is newer.
  - The frontend `Client` catches this and notifies the UI to handle the conflict (e.g., via a "Merge or Overwrite" dialog).

### Real-Time Synchronization

- **WebSocket Protocol**: A generic message-based protocol over a single WebSocket connection (registered at root `/ws/{client_id}`).
- **Message Structure**: `{ "type": "TASK_UPDATED", "payload": { ... } }`.
- **WebSocketClient**: Manages the persistent connection, automatic reconnection, and subscription-based event handling (`on(type, handler)`).

- **File Path**: `frontend/src/core/WebSocketClient.ts`

## 5. Action Registry & Event Delegation

### Centralized Action Registry

- Decouples UI triggers from implementation logic.
- **Event Delegation**: A single listener on `document.body` intercepts clicks on elements with `data-action-click`.
- **Workflow**:
    1. User clicks `<button data-action-click="create_task" data-pipeline-id="123">`.
    2. Registry finds the `"create_task"` handler.
    3. Handler extracts data from attributes or the `closest('[data-view-id]')` container.
    4. Handler performs logic (API call -> Model Update -> DOM Update).

- **File Path**: `frontend/src/core/ActionRegistry.ts`

## 6. Layout & Navigation

### View Management

- **Main Views**: `PipelineDetailView`, `DashboardView`, `LoginView`.
- **Container**: All main views render into the `#content` DOM element.
- **Navigator**:
  - Listens to `hashchange` events (e.g., `#pipeline/123`).
  - Maps hashes to View constructors.
  - Handles "Back" button support and initial routing.

- **Navigator**: `frontend/src/core/Navigator.ts`
- **Login View**: `frontend/src/ui/views/LoginView.ts`
- **Dashboard View**: `frontend/src/ui/views/DashboardView.ts`
- **Pipeline Detail View**: `frontend/src/ui/views/PipelineDetailView.ts`

### UI Consistency

- Standardized Tailwind classes for common elements (cards, buttons, inputs).
- Focus on UX: Keyboard shortcuts, proper `tabindex`, and auto-focusing primary inputs in dialogs.

## 7. Templates & Component System

### Composition Pattern

- Components are classes or functions that return HTML strings (using template literals) or DOM fragments.
- **Data Attributes**: Root elements of views use `data-view-type` and `data-view-id`.
- **Traversal**: Child elements find context using `el.closest("[data-view-container]")`.

- **Task Item**: `frontend/src/ui/components/TaskItem.ts`
  - Displays a concise view of a single task.
  - Renders the task ID in a highlighted badge and provides a copy button (`data-action-click="copy_task_id"`).
  - The copy action is handled by the global `ActionRegistry` and provides visual feedback.
- **Task Column**: `frontend/src/ui/components/TaskColumn.ts`
- **Task Form**: `frontend/src/ui/components/TaskForm.ts`
- **Pipeline Stats**: `frontend/src/ui/components/PipelineStatsView.ts`

## 8. Dialog System

### `BaseDialog`

- An abstract base class providing a consistent foundation for all modal dialogs.
- Uses native HTML `<dialog>` elements with custom Tailwind styling.
- Features standardized backdrop blur, animations (fade/scale/shake), and fixed top-margin positioning for stability.
- **Promise Pattern**: Returns a Promise that resolves when the dialog is closed, facilitating async workflows.

- **Base Dialog**: `frontend/src/ui/components/dialog_common.ts`

### Specialized Dialogs & Panels

- **`ConfirmationDialog`**: For simple confirm/cancel flows.
- **`SearchDialog`**: Provides global task search with keyword and status filtering, debounced input, and pagination.
- **`LogViewerDialog`**: Real-time streaming of backend logs using the Fetch API (ReadableStream) with automatic "Follow Mode" scrolling.
- **`StatsDialog`**: Visualizes pipeline health and velocity using the `PipelineStatsView` component.
- **`DesignDocDialog`**: Dedicated reader for full Design Documents with Markdown rendering.
- **`AssistantPanel`**: Integrated side panel providing a chat interface to the internal AI assistant, enabling conversational task tracking, context queries, and tool execution.

- **Confirmation Dialog**: `frontend/src/ui/components/ConfirmationDialog.ts`
- **Search Dialog**: `frontend/src/ui/components/SearchDialog.ts`
- **Log Viewer Dialog**: `frontend/src/ui/components/LogViewerDialog.ts`
- **Stats Dialog**: `frontend/src/ui/components/StatsDialog.ts`
- **Design Doc Dialog**: `frontend/src/ui/components/DesignDocDialog.ts`
- **Assistant Panel**: `frontend/src/ui/components/AssistantPanel.ts`

## 9. Advanced UI Features

### Markdown Rendering & Styling

- Integrated `marked` for Markdown parsing and `dompurify` for safe injection.
- **Prose Styling**: Standardized typography using Tailwind Typography (`prose`) with custom theme overrides.
- **Code Highlighting**: Global CSS overrides for fenced code blocks, ensuring high contrast and consistent dark backgrounds across all previews and displays.

- **CSS Overrides**: `frontend/src/style.css`

### Real-Time Logs

- Streaming log implementation that handles chunked data transfer and UI updates without blocking the main thread.

## 10. DataManager

The Data Manager acts as a single source of truth for all domain entities exposed by the SPA. It owns and caches instances of `Pipeline`, `Task`, `DesignDocHistory`, and other entities defined in `frontend/src/core/domain.ts`. The manager exposes a subscription API that components use to react to data changes, eliminating duplicated HTTP requests and ensuring consistent state across the UI.

### Core Responsibilities

- **Caching**: Stores domain objects in memory using `Map` keyed by entity id.
- **Subscription**: Maintains a map of listeners keyed by a query string (e.g., `pipeline:123`, `task:456`).  Callers register callbacks via `on(query, callback)` and receive notifications when the corresponding data changes.
- **WebSocket Integration**: Subscribes to real‑time events (`TASK_UPDATED`, `PIPELINE_UPDATED`, `DESIGN_DOC_UPDATED`, bot and process status events).  Upon receiving a message, it updates the cache and triggers the relevant listeners.
- **Optimistic Updates**: Exposes `updateTask` and `updatePipeline` helpers that mutate the cache immediately and notify listeners, allowing components to reflect changes before server confirmation.
- **Removal**: Handles deletion of tasks via `removeTask` and propagates deletions to listeners.
- **Data Conversion**: Wraps raw payloads in domain model instances (`new Task(data)`, `new Pipeline(data)`), ensuring type safety and normalizing fields such as `_id` → `id`.

## 11. Recommended Libraries

- **`marked`**: For Markdown parsing.
- **`dompurify`**: To sanitize HTML strings before insertion.
- **`easymde`**: For a rich Markdown editing experience.

## 12. Authentication

The SPA maintains user sessions via JWT stored securely in `localStorage`.

### 12.1. `AuthService`

The central manager for user sessions:

- **State Management**: Tracks current user and access tokens.
- **Session Persistence**: Saves/restores tokens from `localStorage` on page reload.
- **Login/Logout Logic**: Interacts with the `/api/auth` endpoints to authenticate users and manage token lifecycle.

- **File Path**: `frontend/src/core/AuthService.ts`

### 12.2. `BaseClient` & Token Refresh

The `BaseClient` automatically intercepts outbound requests to manage authorization:

1. **Authorization Header**: Injects the `Authorization: Bearer <token>` header into all API requests.
2. **401 Interception**: If a request fails with a `401 Unauthorized`, the client attempts an automatic token refresh via the `AuthService`.
3. **Redirection**: If a refresh is not possible (e.g., expired refresh token), the user is redirected to the `LoginView`.

### 12.3. Routing Security

A high-level `requireAuth` wrapper protects specific routes within `main.ts`. It verifies the `AuthService.isAuthenticated()` state before rendering views like the `DashboardView` or `PipelineDetailView`.

### 12.4. WebSocket Security & Re-Authentication

The `WebSocketClient` retrieves the latest access token from the `AuthService` and appends it to the connection URL as a query parameter during the `connect()` phase.
If a WebSocket message fails due to an expired token (e.g., an `assistant_error` with `Unauthorized`), the `WebSocketClient` automatically intercepts the failure, requests a token refresh via the `AuthService`, and retries the last sent message upon a successful refresh (similar to the HTTP 401 interception in `BaseClient`).
