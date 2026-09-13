# Design Document: Task.order

## 1. Purpose

`Task.order` is an integer field on a task that controls the vertical ordering
of tasks in two places: the **backlog** (tasks in `CREATED` / `PROPOSED`) and
the **execution queue** (tasks in `SCHEDULED`). Historically the field had no
clear documentation, different components used it inconsistently, and its
default value and semantics were implicit. This document clarifies the current
behaviour, proposes a clean and consistent model for the field, and lists the
concrete backend and frontend changes needed to implement it.

## 2. Current Use (as documented)

### 2.1 Backend

- **Model default** — `backend/core/src/core/models/models.py`: `Task.order`
  defaults to `0`. No field documentation exists in the model.
- **Query-level sorting** —
  `backend/core/src/core/queries/task.py`:
  - `get_tasks_by_pipeline()` sorts by `+order, +scheduled_at, +created_at`
    (ascending order, lower first, with timestamp tie-breakers).
  - `get_tasks_for_tool("default")` sorts by `+order, +scheduled_at, +created_at`,
    while other sort orders (`last_created_first`, `last_implemented_first`) do
    not use `order`.
  - `get_next_task()` (used by MCP and the `/next` route) selects the first
    `SCHEDULED` task sorted by `+order, +scheduled_at, +created_at`, i.e. the
    lowest `order` wins. `order` therefore already drives MCP scheduling.
- **Updating order** — `update_task_details()` accepts an `order` parameter and
  writes it directly (`task.order = order`). This is exposed by
  `PATCH /tasks/{id}` and used in the UI to move tasks up/down.
- **Automatic ordering side-effect** — `complete_task()` creates a system task
  on verification failure with `order=task.order - 1`, implicitly "bumping" the
  fix task ahead of its parent.

### 2.2 Frontend

- **Model default** — `frontend/src/core/domain.ts`: `Task.order` defaults to
  `0` (same as the backend).
- **Backlog sorting** —
  `frontend/src/ui/components/BacklogView.ts`: the `taskSort()` helper sorts the
  `PROPOSED` and `CREATED` sections by `updated_at` (falling back to
  `created_at`), **most recent first**. It does **not** use `order` at all, so the
  backlog is *not* ordered by priority in the UI.
- **Execution engine sorting** —
  `frontend/src/ui/components/ExecutionEngineView.ts`: the `orderSort()` helper
  sorts the `SCHEDULED` (and `INPROGRESS`/`FAILED`) sections by `order`
  ascending (lower first), matching MCP's `get_next_task`.
- **Rendering of the value** —
  - `frontend/src/ui/components/TaskItem.ts` renders `Order: ${order}` and the
    `move_task_up` / `move_task_down` buttons that adjust order by ±1 via
    `PATCH /tasks/{id}`.
  - `BacklogTaskView.ts` and `ExecutionEngineItemView.ts` do **not** render the
    `order` value.

## 3. Problems with the Current Use

1. **Default of `0` is ambiguous.** Because `0` is also a valid priority, new
   tasks created with the default are indistinguishable from tasks explicitly
   prioritised at `0`, and a "default" task outranks any task with a positive
   order.
2. **Backlog is not ordered by priority.** `BacklogView` sorts by recency, so
   the user has no way to express relative priority in the backlog through the
   UI; the `move up`/`move down` controls update `order`, but the sidebar does
   not honour it.
3. **`order` is not shown in the backlog or the queue** list items, making the
   priority invisible and the value hard to reason about.
4. **Inconsistent presentation.** `order` is shown and editable in the task body
   (`TaskItem`) but invisible in both sidebars (`BacklogTaskView`,
   `ExecutionEngineItemView`).
5. **No clear documentation** of the negative-value support and the ascending
   (lower-first) convention.

## 4. Proposed Semantics

We standardise `Task.order` as a **priority / position** integer with the
following rules:

- **Scope:** `order` sorts **backlog** items (`CREATED`, `PROPOSED`) and
  **scheduled** items (`SCHEDULED`) for execution.
- **Sort direction:** tasks are sorted in **ascending** order — the **lowest**
  `order` value is shown / executed **first**.
- **Default value:** `100`, so newly created tasks sort **below** any task that
  has been explicitly prioritised (which is conventionally assigned a low,
  often negative, value). This keeps the default distinct from meaningful
  priority values.
- **Sign:** `order` **may be negative**. Negative values give stronger priority
  than any non-negative default; this is already relied upon in
  `complete_task()` (`order=task.order - 1`) and the design-bot tests.
- **Tie-breakers:** when two tasks share the same `order`, the existing
  tie-breakers apply (`scheduled_at` then `created_at` for scheduled tasks) so
  ordering remains deterministic.
- **Display:** the `order` value is rendered in the backlog list items
  (`BacklogTaskView`) and in the execution queue list items
  (`ExecutionEngineItemView`, restricted to `SCHEDULED` tasks).

## 5. Proposed Changes

### 5.1 Backend

**`backend/core/src/core/models/models.py`**

- Change the default of `Task.order` from `0` to `100`.

**`backend/core/src/core/queries/task.py`**

- No functional change required: `get_next_task()`, `get_tasks_by_pipeline()`,
  and `get_tasks_for_tool("default")` already sort by `+order` (ascending,
  lower-first) followed by the timestamp tie-breakers. With the new default of
  `100`, a freshly created task will naturally sort below any explicitly
  prioritised task. Negative values are already handled correctly by the
  ascending sort.
- `update_task_details()` already supports writing arbitrary (including
  negative) `order` values, so no change is needed there.

### 5.2 Frontend

**`frontend/src/core/domain.ts`**

- Change the default of `Task.order` from `0` to `100` to match the backend.

**`frontend/src/ui/components/BacklogView.ts`**

- Replace the recency-based `taskSort()` with an **order-ascending** sort
  (lower order first), so the `PROPOSED` and `CREATED` backlog sections honour
  priority. Keep the same stable behaviour for ties.

**`frontend/src/ui/components/BacklogTaskView.ts`**

- Render the `order` value in each backlog list item (e.g. a compact `#<order>`
  chip), making the backlog priority visible to the user.

**`frontend/src/ui/components/ExecutionEngineItemView.ts`**

- Render the `order` value for tasks in the queue (`SCHEDULED`), matching the
  order-ascending sort already applied by `ExecutionEngineView`.

**`frontend/src/ui/components/ExecutionEngineView.ts`**

- No functional change required: it already sorts the `SCHEDULED` section by
  `order` ascending via `orderSort()`.

### 5.3 Tests

- **Backend:** existing `tests/queries/test_task_ordering.py` explicitly sets
  `order` values and asserts `get_next_task` returns the lowest `order` first; it
  remains valid. Add a test verifying the new default (`order == 100`) on a newly
  created task.
- **Frontend:** update `BacklogView.test.ts` to assert backlog sections are
  sorted by `order` ascending (with negative orders supported); add assertions
  that `BacklogTaskView` renders the order value and that
  `ExecutionEngineItemView` renders it for `SCHEDULED` tasks (and omits it
  otherwise).

## 6. Design Decisions

- **Default `100` over `0`:** keeps the default distinct from user-assigned
  priorities, makes the backlog and queue read naturally (default tasks sink),
  and matches the existing convention in `setup_test_db.py` which seeds task
  orders.
- **Ascending / lower-first:** matches the existing execution-engine and MCP
  behaviour, so UI and scheduling stay consistent.
- **Allow negatives:** negatives give the strongest priority and are already used
  internally; we simply document and keep that support.
- **Restrict queue display to `SCHEDULED`:** the requirement specifies the order
  is shown for tasks scheduled for execution; `INPROGRESS` and `FAILED` tasks are
  no longer in the queue, so we leave their items unchanged.

## 7. Summary

The change makes `Task.order` a documented, consistently-interpreted integer
priority: default `100`, ascending (lower-first) sorting, negatives allowed,
used to order both the backlog (`CREATED`/`PROPOSED`) and the execution queue
(`SCHEDULED`) in the UI and by MCP's `get_next_task`, and rendered in both the
backlog and queue list items. The backend already sorts by `order` everywhere
it matters; the frontend needs its default updated, its backlog sort switched to
`order`, and the value surfaced in the two sidebar components.
