# ReviewBot Design Document

## 1. Overview

The **ReviewBot** is an autonomous AI agent that performs a technical review of a completed task within a pipeline. It analyses the task specification, design document, and git diff of the implementation, then produces a structured Markdown review stored in `Task.review_md`. The review can be viewed or deleted via the UI. The ReviewBot operates as a subclass of `BaseBotSession` and uses the existing read‑only tools (`read_source_file`, `list_project_structure`, `git_show_commit`, `grep`). Its terminating tool is `save_review`, which writes the review to the database and emits a WebSocket event so the front‑end can display a badge.

## 2. System Architecture

```
+----------------+          +-----------------+          +-----------------
|  Task Update  |  --->   |  ReviewBotMgr   |  --->   | ReviewBotSession |
| (completed)   |          | (queues session)|          | (Ollama loop)   |
+----------------+          +-----------------+          +-----------------
        |                           |                      |
        |                           |                      |
        |          +-----------------+            |
        |          | ReviewBotRouter |            |
        |          +-----------------+            |
        |                               |            |
        |                               |  (save_review) |
        +-------------------------------+            |
                                      +------------->+  Task model update (review_md)
```

### 2.1 Components

| Component | Responsibility |
|-----------|----------------|
| `ReviewBotManager` | Queues completed tasks for review. |
| `ReviewBotSession` | Implements the AI loop; inherits from `BaseBotSession`. |
| `ReviewBotRouter` | Exposes `/trigger` and `/review` endpoints. |
| `save_review` tool | Persist review and broadcast via WebSocket. |
| `Task` model | New field `review_md` stores the Markdown review. |
| Front‑end | `ReviewDialog` displays the review; UI shows badge and triggers bot. |

### 2.2 Interaction Flow

1. A task is marked **IMPLEMENTED** and contains a `commit_hash`. 
2. The UI can trigger a review through `/pipelines/{pipeline_id}/reviewbot/trigger/{task_id}`. 
3. `ReviewBotManager` creates a `ReviewBotSession` and enqueues it. 
4. `ReviewBotSession` builds an initial prompt including task metadata and the diff, then calls the LLM. 
5. The LLM returns a tool call `save_review` with the review markdown. 
6. `save_review` writes to `Task.review_md`, broadcasts `REVIEWBOT_REVIEW_READY`, and the UI displays a badge. 
7. Clicking the badge opens `ReviewDialog`, which offers a delete button that calls the `DELETE /review` endpoint.

## 3. Design Principles

- **Minimal API surface** – Only two endpoints are exposed. 
- **Read‑only tooling** – The bot has access only to safe read operations. 
- **Separation of concerns** – The manager queues sessions; the session handles LLM interaction. 
- **Idempotency** – Triggering a review twice on the same task does not duplicate the review. 
- **WebSocket notifications** – Keep UI in sync without polling.

## 4. Implementation Highlights

- **Session logic** uses the same `BaseBotSession` infrastructure as `DocBot`. 
- The system instruction is a *Senior Technical Reviewer* persona with explicit criteria (quality, design, tests, performance, security). 
- The terminating tool `save_review` is registered in a dedicated `reviewbot_registry`. 
- The `Task` model gains an optional `review_md: Optional[str]`. 
- Front‑end introduces `ReviewDialog` and updates `TaskItem` to show review buttons. 
- WebSocket events `REVIEWBOT_STARTED`, `REVIEWBOT_COMPLETED`, `REVIEWBOT_REVIEW_READY` drive UI badges.

## 5. Test Strategy

| Test Area | Approach |
|-----------|----------|
| Unit | Test `ReviewBotSession.get_initial_prompt` constructs prompt correctly (mock `task_queries`, `git_utils`). |
| Unit | Test `save_review` updates `Task.review_md` and emits WebSocket message (mock `task_queries`, `manager.broadcast`). |
| Integration | End‑to‑end: trigger review via router, wait for `REVIEWBOT_REVIEW_READY`, fetch task and verify `review_md` is set. |
| Integration | Delete review via router and ensure `review_md` is `None` and UI badge disappears. |
| Front‑end | Render `ReviewDialog` with review content; test delete button triggers API call and updates state. |
| Front‑end | Verify `TaskItem` shows correct button based on `review_md` presence. |

All tests use the existing testing utilities (`pytest`, `vitest`) and rely on mocked database and WebSocket components.

---

**Reference**: Design principles for autonomous agents are outlined in `implemented/dd_autonomous_docbot.md`. ReviewBot extends those patterns to a review context.

