# Design Document: Task Workflow Specification Update (Proposed State)

## 1. Overview
The current task workflow needs to support a new optional planning phase where an AI agent can propose a design document for a task before implementation begins. This allows users to review and approve the design before the agent modifies the codebase. 

## 2. Model Changes (`backend/core/src/core/models/models.py`)

### 2.1 TaskStatus Enum
Add a new state `PROPOSED` to the `TaskStatus` enum.
```python
class TaskStatus(str, Enum):
    # ... existing states ...
    PROPOSED = "proposed"
```

### 2.2 Task Document
Add two new fields to the `Task` model:
- `spec`: A string containing the raw specification or instructions.
- `want_design_doc`: A boolean flag indicating whether a design document must be generated and approved before implementation.

```python
class Task(Document):
    # ... existing fields ...
    spec: Optional[str] = None
    want_design_doc: bool = False
```

## 3. Workflow Logic

1. **Task Creation & Scheduling**: 
   - A user creates a `Task`.
   - The user schedules the task, optionally providing a title and setting `want_design_doc` to `True` or `False`.

2. **Agent Processing (MCP Server)**:
   - The LLM calls the `get_next_task` tool via the MCP server.
   - The LLM checks `task.want_design_doc`.
   
   **Scenario A: `want_design_doc` is True and `design_doc` is Empty/None**
   - The LLM writes a design document.
   - The LLM calls the `update_task_design_doc` tool to save the `design_doc`.
   - The MCP server (or a new MCP tool `propose_task`) transitions the `Task` status to `PROPOSED`.
   - The LLM considers this task handled for now and calls `get_next_task()` to continue with other tasks.
   
   **Scenario B: `design_doc` is already provided or `want_design_doc` is False**
   - If `task.design_doc == None`, the LLM may optionally write a design doc (as it already does).
   - The LLM implements the task by modifying code.
   - The LLM commits the changes.
   - The LLM calls `complete_task` to mark the task as `IMPLEMENTED`.

3. **User Verification (UI/API)**:
   - When a task is in the `PROPOSED` state, the user reviews the generated `design_doc` in the frontend UI.
   - **Rejected**: The user rejects the design. The system transitions the task status to `DISCARDED`.
   - **Accepted**: The user accepts the design. The system transitions the task status back to `SCHEDULED` (now with an existing `design_doc`). The task is now eligible to be picked up by the LLM again for implementation (since `design_doc` is no longer empty).

## 4. MCP Server Updates (`backend/mcp/src/ajapopaja_mcp/server.py`)
- Update the logic in the MCP server or the core queries to support transitioning a task to `PROPOSED` upon updating the design doc if `want_design_doc` is true.
- Ensure that `get_next_task` only picks up `SCHEDULED` tasks, naturally ignoring `PROPOSED` tasks.

## 5. API & UI Updates
- Add API endpoints to handle "Accept Design" and "Reject Design" actions.
- Update frontend views (`TaskItem`, `PipelineDetailView`) to render the `PROPOSED` state and provide "Accept" and "Reject" buttons.
- Add UI controls for setting `spec` and `want_design_doc` during task creation.
