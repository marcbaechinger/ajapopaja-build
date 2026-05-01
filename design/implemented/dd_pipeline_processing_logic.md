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
   - A user creates a `Task` and can optionally provide a `spec` and set `want_design_doc` to `True`.
   - The user schedules the task.

2. **Agent Processing (MCP Server)**:
   - The LLM calls the `get_next_task` tool via the MCP server.
   - The LLM checks `task.want_design_doc`.
   
   **Scenario A: `want_design_doc` is True and `design_doc` is Empty/None**
   - The LLM writes a design document based on the `spec`.
   - The LLM calls the `update_task_design_doc` tool to save the `design_doc`.
   - The MCP server transitions the `Task` status to `PROPOSED`.
   - The LLM considers this task handled for now and calls `get_next_task()` to continue with other tasks.
   
   **Scenario B: `design_doc` is already provided or `want_design_doc` is False**
   - The LLM implements the task, commits, and calls `complete_task`.

3. **User Verification (UI/API)**:
   - When a task is in the `PROPOSED` state, it appears in a new "Review" section in the UI.
   - **Rejected**: User clicks "Reject". Status -> `DISCARDED`.
   - **Accepted**: User clicks "Accept". Status -> `SCHEDULED`. Task is now eligible for implementation.

## 4. Backend Implementation Details

### 4.1 Routes (`backend/api/src/api/routes/task.py`)
- `POST /tasks/{task_id}/accept-design`: Transitions status from `PROPOSED` to `SCHEDULED`.
- `POST /tasks/{task_id}/reject-design`: Transitions status from `PROPOSED` to `DISCARDED`.
- Update `POST /pipelines/{pipeline_id}/tasks`: Allow including `spec` and `want_design_doc` in the request body.

### 4.2 Queries (`backend/core/src/core/queries/task.py`)
- `accept_design(task_id, version)`: Validates version, updates status to `SCHEDULED`, appends to history, increments version.
- `reject_design(task_id, version)`: Validates version, updates status to `DISCARDED`, appends to history, increments version.
- `update_task_details`: Ensure `design_doc` updates can trigger status transition to `PROPOSED` if `want_design_doc` is true and currently `INPROGRESS`.

## 5. Frontend Implementation Details

### 5.1 PipelineDetailView.ts
- **Layout**: Introduce a new section titled "Proposed for Review" placed above the main "Task Sequence" list.
- **Filtering**:
    - **Review Section**: Show tasks where `status === PROPOSED`.
    - **Open Tasks Section**: Show tasks where `status` is one of `CREATED`, `SCHEDULED`, `INPROGRESS`, or `FAILED`.
    - **Completed Section**: Show tasks where `status` is `IMPLEMENTED` or `DISCARDED`.
- **Actions**:
    - Register `accept_design` action: Calls `taskClient.acceptDesign()`.
    - Register `reject_design` action: Calls `taskClient.rejectDesign()`.

### 5.2 TaskItem.ts
- **Review UI**: When `status === PROPOSED`, render the `design_doc` (via markdown preview) and display two prominent buttons: 
    - `Accept Design` (Green/Primary)
    - `Reject Design` (Red/Muted)
- **Compact View**: Ensure the collapsed state still shows the `PROPOSED` status badge clearly.

## 6. Sorting Logic

To ensure the most critical tasks are seen first, the following sorting will be applied in the UI:

### 6.1 Open Tasks Section
Tasks will be sorted primarily by status weight, then by their `order` field:
1.  **`INPROGRESS`**: Currently being worked on by an agent.
2.  **`SCHEDULED`**: Ready for an agent to pick up.
3.  **`FAILED`**: Automation failed and needs manual intervention.
4.  **`CREATED`**: New tasks not yet in the execution queue.

### 6.2 Proposed Tasks Section
- Sorted by `updated_at` (Newest first) so the most recently proposed designs appear at the top for review.

### 6.3 Completed Tasks Section
- Sorted by `updated_at` (Newest first) as per current implementation.
