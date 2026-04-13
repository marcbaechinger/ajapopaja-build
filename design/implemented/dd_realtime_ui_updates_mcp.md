# Design Document: Real-Time UI Updates for MCP Server Changes

## 1. Overview
Currently, the Ajapopaja Build web app updates its UI in real-time using WebSockets when changes are made via the FastAPI endpoints. However, the MCP server runs as a separate process and modifies the MongoDB database directly, bypassing the FastAPI application's WebSocket manager. This causes the UI to become stale when the MCP server schedules, updates, or completes tasks. 

This document outlines a solution where the MCP server notifies the FastAPI application of task changes, and the frontend selectively updates specific `TaskItem` views without re-rendering the entire task list.

## 2. Backend Implementation (FastAPI & MCP)

### 2.1 Internal Notification Endpoint
Add an internal API endpoint in the FastAPI application (e.g., in `backend/api/src/api/routes/task.py`) that the MCP server can call to report changes.
```python
@task_router.post("/{task_id}/notify", status_code=202)
async def notify_task_changed(task_id: str):
    # Fetch the updated task from the database
    task = await task_queries.get_task_by_id(task_id)
    # Broadcast a TASK_UPDATED message to all connected WebSocket clients
    await manager.broadcast(WSMessage(
        type="TASK_UPDATED",
        payload=task.model_dump(mode='json')
    ))
    return {"status": "notified"}
```

### 2.2 MCP Server HTTP Client
Modify the MCP server (`backend/mcp/src/ajapopaja_mcp/server.py`) to make an HTTP POST request to this new endpoint whenever it successfully modifies a task (e.g., in `get_next_task`, `update_task_design_doc`, and `complete_task`).
- A simple `httpx` or `aiohttp` client can be used to send the request in a fire-and-forget manner or awaited directly.

## 3. Frontend Implementation (SPA)

### 3.1 Targeted DOM Updates
Currently, the `PipelineDetailView.ts` listens for WebSocket events and calls `refreshTasks()`, which re-fetches all tasks and re-renders the entire list. This approach is inefficient and disrupts local UI state (like open editors).

We will change the WebSocket event handler to perform a targeted DOM replacement:
1. When a `TASK_UPDATED` (or similar) message is received, extract the updated `Task` object from the payload.
2. Find the corresponding DOM element: `const taskEl = document.querySelector(\`[data-view-id="${task._id}"]\`);`
3. If the element exists, generate the new HTML string using `TaskItem.render(task)`.
4. Create a temporary wrapper to hold the new HTML, and then replace the old element with the new one: `taskEl.replaceWith(newElement.firstElementChild);`
5. If the element does not exist (e.g., a newly created task that belongs to the active pipeline), re-render the list or append it to the correct section.

### 3.2 Handling Active Editors
Replacing a `TaskItem`'s DOM node will destroy any active `EasyMDE` instance inside it.
- **Mitigation**: Before replacing the element, check if the task is currently being edited (e.g., by checking `activeEditors.has(task._id)` in `PipelineDetailView`).
- If an editor is active for that specific task, either defer the UI update until the user cancels/saves, or update only the non-editor parts of the DOM (like the status badge and history) without destroying the textarea container. For simplicity, the initial implementation will simply ignore external updates for a task if it is currently being edited locally.

## 4. Summary of Changes
1. **FastAPI**: Add `POST /tasks/{task_id}/notify` endpoint to trigger WebSocket broadcasts.
2. **MCP Server**: Add an HTTP client to call the notify endpoint after DB mutations.
3. **Frontend**: Update `PipelineDetailView.ts` WebSocket listeners to selectively replace `TaskItem` DOM nodes instead of a full `refreshTasks()` reload.
