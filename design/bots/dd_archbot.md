# ArchitectureBot Design Document

## Purpose

`ArchitectureBot` (ArchBot) is an autonomous agent that generates design documents for tasks in the Ajapopaja pipeline. The bot is invoked from the UI when a task is in the **CREATED** state and has no existing design document. It creates a concise markdown design doc following a standardized format and stores it in the task.

## Integration Overview

| Component | Responsibility | Key Files |
|-----------|----------------|-----------|
| **API Router** | Exposes `POST /pipelines/{pipeline_id}/archbot/trigger/{task_id}` to enqueue a session. | `api/archbot/router.py` |
| **Manager** | Enqueues `ArchBotSession` into the global `bot_manager`. | `api/archbot/manager.py` |
| **Session** | Implements the LLM loop using `BaseBotSession`. Provides system instruction, initial prompt, and tool list. | `api/archbot/session.py` |
| **Tools** | Registered via `archbot_registry`; includes file‑system introspection and the terminal tool `save_design_doc`. | `api/archbot/tools.py`, `api/archbot/registry.py` |
| **WebSocket Events** | `ARCHBOT_STARTED` and `ARCHBOT_COMPLETED` broadcast to the frontend for real‑time status. | `api/archbot/session.py` |
| **Frontend** | Button in `TaskItem` triggers the API; `PipelineDetailView` listens for WebSocket events. | `frontend/src/ui/components/TaskItem.ts`, `frontend/src/ui/views/PipelineDetailView.ts` |

## Design Document Format

The bot follows a strict markdown structure:

1. **Background** – context and problem statement.
2. **Proposed Changes** – architectural modifications, new classes, or altered logic (Object‑Oriented Design).
3. **Implementation Plan** – step‑by‑step actions for the preferred option.
4. **Alternatives** – optional brief discussion of other options considered.
5. **Test Strategy** – unit and integration tests required to verify the changes.

The format is enforced by the `save_design_doc` tool which validates non‑empty markdown.

## Operational Flow

1. **Trigger** – User clicks *Auto‑Design* button; the client calls the router.
2. **Validation** – Router checks task state, existence, and absence of a design doc.
3. **Enqueue** – `ArchBotManager` creates an `ArchBotSession` and enqueues it.
4. **Execution** – The session runs the LLM loop, calling tools to inspect the codebase and produce the markdown.
5. **Finalization** – The terminal tool `save_design_doc` stores the document and broadcasts `ARCHBOT_COMPLETED`.
6. **UI Update** – Frontend refreshes the task list to show the new design document.

## Testing Strategy

The implementation includes unit tests for:

- Session initialization and prompt generation.
- Tool registration and invocation.
- Successful saving of the design document via `save_design_doc`.
- WebSocket event broadcasting.

These tests ensure that the bot behaves as expected and that the new API does not regress.
