# SPA Architecture Design Document (`dd_spa_architecture.md`)

## 1. Overview
This document defines the architecture and design principles for the Ajapopaja Build Single Page Application (SPA). The SPA is built using **Vanilla TypeScript** and **Tailwind CSS v4**, adhering to Object-Oriented (OO) principles to ensure a maintainable, extensible, and replaceable codebase.

## 2. Core Architectural Principles
- **OO Design**: Every major entity and UI component is represented as a class or a well-defined interface.
- **Component Decomposition**: Large views are broken down into subcomponents to promote reuse and simplify testing.
- **Interfaces**: Used extensively for backend clients and UI collaborators to allow for easy swapping (e.g., MockClient vs. HttpClient).

## 3. Application Lifecycle & Context
### `AppContext`
- Initialized when the page loads.
- Acts as a Singleton or a shared instance passed to components.
- Holds the global state (current user, active pipeline, theme status).
- Manages instances of collaborators (Backend Clients, Action Registry, Navigator).

## 4. Backend Communication
### Dedicated Clients
- All HTTP communication is encapsulated in client classes (e.g., `PipelineClient`, `TaskClient`).
- Clients provide a high-level TS API that uses domain entities (`Pipeline`, `Task`).
- UI and App code **never** make raw `fetch` calls; they interact solely with client methods.

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

## 5. Action Registry & Event Delegation
### Centralized Action Registry
- Decouples UI triggers from implementation logic.
- **Event Delegation**: A single listener on `document.body` intercepts clicks on elements with `data-action-click`.
- **Workflow**:
    1. User clicks `<button data-action-click="create_task" data-pipeline-id="123">`.
    2. Registry finds the `"create_task"` handler.
    3. Handler extracts data from attributes or the `closest('[data-view-id]')` container.
    4. Handler performs logic (API call -> Model Update -> DOM Update).

## 6. Layout & Navigation
### View Management
- **Main Views**: `PipelineView`, `TaskView`, `DashboardView`.
- **Container**: All main views render into the `#content` DOM element.
- **Navigator**:
    - Listens to `hashchange` events (e.g., `#pipeline/123`).
    - Maps hashes to View constructors.
    - Handles "Back" button support and initial routing.

### UI Consistency
- Standardized Tailwind classes for common elements (cards, buttons, inputs).
- Focus on UX: Keyboard shortcuts, proper `tabindex`, and auto-focusing primary inputs in dialogs.

## 7. Templates & Component System
### Composition Pattern
- Components are classes or functions that return HTML strings (using template literals) or DOM fragments.
- **Data Attributes**: Root elements of views use `data-view-type` and `data-view-id`.
- **Traversal**: Child elements find context using `el.closest("[data-view-container]")`.

**Example Pattern:**
```typescript
const TaskItem = (task: Task) => `
  <li class="p-3 border-b border-app-border" data-view-type="task" data-view-id="${task.id}">
    <span class="font-bold">${task.title}</span>
    <button data-action-click="edit_task" class="...">Edit</button>
  </li>
`;
```

## 8. Dialog System
### `ConfirmationDialog`
- Reusable component for simple confirm/cancel flows.
- Uses Tailwind-styled native `<dialog>` elements with backdrop blur.
- **Promise Pattern**: `show(): Promise<boolean>` (resolves to `true` on "Confirm", `false` on "Cancel" or backdrop click).
- Centralized logic for centering, backdrop interaction, and Escape key handling.

## 9. Recommended Libraries
- **`nanoid`**: For generating unique client-side IDs.
- **`dom-purify`**: To sanitize HTML strings before insertion.
## 10. Authentication
The SPA maintains user sessions via JWT stored securely in `localStorage`.

### 10.1. `AuthService`
The central manager for user sessions:
- **State Management**: Tracks current user and access tokens.
- **Session Persistence**: Saves/restores tokens from `localStorage` on page reload.
- **Login/Logout Logic**: Interacts with the `/api/auth` endpoints to authenticate users and manage token lifecycle.

### 10.2. `BaseClient` & Token Refresh
The `BaseClient` automatically intercepts outbound requests to manage authorization:
1.  **Authorization Header**: Injects the `Authorization: Bearer <token>` header into all API requests.
2.  **401 Interception**: If a request fails with a `401 Unauthorized`, the client attempts an automatic token refresh via the `AuthService`.
3.  **Redirection**: If a refresh is not possible (e.g., expired refresh token), the user is redirected to the `LoginView`.

### 10.3. Routing Security
A high-level `requireAuth` wrapper protects specific routes within `main.ts`. It verifies the `AuthService.isAuthenticated()` state before rendering views like the `DashboardView` or `PipelineDetailView`.

### 10.4. WebSocket Security
The `WebSocketClient` retrieves the latest access token from the `AuthService` and appends it to the connection URL as a query parameter during the `connect()` phase.
