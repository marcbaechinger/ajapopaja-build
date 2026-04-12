# Pipeline & Task Workflow Design Document (`dd_workflow_state_machine.md`)

## 1. Overview
This document defines the state machine and data structures for managing task pipelines executed by Coding AI Agents. The goal is a controlled, iterative workflow where the LLM performs work, commits changes, and the system verifies the results before advancing.

## 2. Extended Data Structures

### `Task` Entity
To support the automated workflow, the `Task` model is extended with metadata regarding execution and verification.

| Field | Type | Description |
| :--- | :--- | :--- |
| `status` | `TaskStatus` | `created`, `scheduled`, `inprogress`, `implemented`, `failed`, `discarded`. |
| `type` | `str` | `manual` (user created) or `system` (generated iteration task). |
| `commit_hash` | `Optional[str]` | The git commit hash provided by the LLM upon completion. |
| `completion_info` | `Optional[str]` | Detailed confirmation message provided by the LLM. |
| `verification` | `Optional[Dict]` | Results of system verification (e.g., test outputs, lint results). |
| `parent_task_id` | `Optional[str]` | ID of the task this system-task is iterating on. |

### `Pipeline` Entity
| Field | Type | Description |
| :--- | :--- | :--- |
| `status` | `str` | `active`, `paused`, `completed`. |

## 3. The LLM Workflow (MCP)

The Coding LLM follows a strict cycle using MCP tools:

1.  **Request Task**: LLM calls `get_next_task()`.
    -   System finds the first `scheduled` task (lowest `order`).
    -   System updates status to `inprogress`.
    -   Returns task title, description, and context.
2.  **Implementation**: LLM implements and tests the code locally.
3.  **Commit**: LLM performs a git commit.
4.  **Confirm Completion**: LLM calls `complete_task(task_id, commit_hash, info)`.
    -   System stores `commit_hash` and `info`.
    -   System updates status to `implemented`.
    -   System triggers **Verification Logic**.

## 4. State Machine & Verification

### State Transitions
- `created` -> `scheduled`: User manually approves task for execution.
- `scheduled` -> `inprogress`: Triggered by `get_next_task()`.
- `inprogress` -> `implemented`: Triggered by `complete_task()`.
- `implemented` -> `scheduled` (Next Task): If verification passes.
- `implemented` -> `created` (System Task): If verification fails, a new system task is injected into the pipeline with higher priority (`order`) to handle the fix.

### Minimal Acceptance Criteria (Initial Implementation)
Initially, verification is successful if:
1.  A non-empty `commit_hash` is provided.
2.  A non-empty `completion_info` message is provided.

### Advanced Verification (Future)
Later versions will include:
- **Clean Test Run**: System executes `npm test` or `pytest` and parses the output.
- **Git Status Check**: System verifies the repo is clean after the reported commit.
- **Static Analysis**: Running linters or security scanners.

## 5. Web UI Requirements
The SPA must support building and managing this stateful pipeline:

- **Pipeline Builder**: A drag-and-drop or list-based interface to reorder tasks (`order` field).
- **Status Dashboard**: Visual indicator of where the LLM is in the pipeline.
- **Task Detail Panel**: View the `commit_hash` and `completion_info` for implemented tasks.
- **Manual Override**: Ability for a human to manually move a task back to `scheduled` or mark it as `failed` to force an iteration.

## 6. API Implementation Notes
- The `TaskRouter` will need new PATCH endpoints for `complete_task`.
- The `PipelineQueries` will need logic to find "the next task" while respecting the `order` and `type` hierarchy.
