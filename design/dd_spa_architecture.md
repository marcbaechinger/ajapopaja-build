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

### Specialized Dialogs
- **`ConfirmationDialog`**: For simple confirm/cancel flows.
- **`SearchDialog`**: Provides global task search with keyword and status filtering, debounced input, and pagination.
- **`LogViewerDialog`**: Real-time streaming of backend logs using the Fetch API (ReadableStream) with automatic "Follow Mode" scrolling.
- **`StatsDialog`**: Visualizes pipeline health and velocity using the `PipelineStatsView` component.
- **`DesignDocDialog`**: Dedicated reader for full Design Documents with Markdown rendering.

- **Confirmation Dialog**: `frontend/src/ui/components/ConfirmationDialog.ts`
- **Search Dialog**: `frontend/src/ui/components/SearchDialog.ts`
- **Log Viewer Dialog**: `frontend/src/ui/components/LogViewerDialog.ts`
- **Stats Dialog**: `frontend/src/ui/components/StatsDialog.ts`
- **Design Doc Dialog**: `frontend/src/ui/components/DesignDocDialog.ts`

## 9. Advanced UI Features
### Markdown Rendering & Styling
- Integrated `marked` for Markdown parsing and `dompurify` for safe injection.
- **Prose Styling**: Standardized typography using Tailwind Typography (`prose`) with custom theme overrides.
- **Code Highlighting**: Global CSS overrides for fenced code blocks, ensuring high contrast and consistent dark backgrounds across all previews and displays.

- **CSS Overrides**: `frontend/src/style.css`

### Real-Time Logs
- Streaming log implementation that handles chunked data transfer and UI updates without blocking the main thread.

## 10. MCP Interface
The system provides a Model Context Protocol (MCP) server allowing AI agents to interact with the pipeline autonomously.

### Core MCP Tools
- **`get_next_task`**: Fetches and reserves the next scheduled task for an agent.
- **`update_task_design_doc`**: Allows agents to propose implementation plans.
- **`complete_task`**: Finalizes implementation with commit references and summaries.
- **`get_task_status`**: Polls for verification results or current state.

- **MCP Server**: `backend/mcp/src/ajapopaja_mcp/server.py`

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
1.  **Authorization Header**: Injects the `Authorization: Bearer <token>` header into all API requests.
2.  **401 Interception**: If a request fails with a `401 Unauthorized`, the client attempts an automatic token refresh via the `AuthService`.
3.  **Redirection**: If a refresh is not possible (e.g., expired refresh token), the user is redirected to the `LoginView`.

### 12.3. Routing Security
A high-level `requireAuth` wrapper protects specific routes within `main.ts`. It verifies the `AuthService.isAuthenticated()` state before rendering views like the `DashboardView` or `PipelineDetailView`.

### 12.4. WebSocket Security
The `WebSocketClient` retrieves the latest access token from the `AuthService` and appends it to the connection URL as a query parameter during the `connect()` phase.
