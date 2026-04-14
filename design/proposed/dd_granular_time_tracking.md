# Design Document: Granular Task Time Tracking

**Task ID:** 69de9f60ed8dfe2c07581a7f
**Status:** PROPOSED

## 1. Goal
Improve task time tracking to distinguish between design and implementation phases, especially when design document reviews are involved. This provides better insights into agent productivity and bottlenecks in the pipeline.

## 2. Current State
- `PipelineStatsView` calculates "Completion Duration" as the time from `created_at` to the first `IMPLEMENTED` status in the history.
- This includes idle time in `created` and `scheduled` states.
- It doesn't distinguish between the time spent designing and the time spent implementing.

## 3. Proposed Metrics

### 3.1. Design Time
The total time the task spent in `inprogress` state *before* it reached the `proposed` state.
- **Start**: First transition to `inprogress`.
- **End**: First transition to `proposed`.

### 3.2. Implementation Time
The total time the task spent in `inprogress` state *after* it reached the `proposed` state, or from the start if `want_design_doc` was false.
- **Start**: First transition to `inprogress` that occurs *after* the `proposed` state was reached (or the first `inprogress` if no `proposed` state ever existed).
- **End**: Transition to `implemented`.

### 3.3. Idle Time (Wait Time)
Time the task spent waiting for action:
- **Approval Wait**: Time from `proposed` to the next `scheduled`.
- **Queue Wait**: Time from `scheduled` to the next `inprogress`.

### 3.4. Lead Time
The total time from the *first* `scheduled` event to the `implemented` event. This represents the "time to delivery" from the moment the task was prioritized.

## 4. Implementation Plan

### 4.1. Frontend (`PipelineStatsView.ts`)
Update `PipelineStatsView` to include new calculation methods:
- `getTaskDurations(task: Task)`: Returns an object with `designTime`, `implementationTime`, `approvalWait`, and `totalWorkTime`.
- Update `calculateCompletionTimes` to use `totalWorkTime` instead of `created_at` to `implemented`.
- Update `render` to show a more detailed breakdown in the `StatsDialog`.

### 4.2. UI Enhancements
- Add a new section in the `StatsDialog` showing the average and median "Active Work Time" vs "Total Lead Time".
- If a task is selected or in a detailed view, show its specific phase breakdown.

## 5. Calculation Logic (Pseudo-code)
```typescript
function getTaskDurations(task: Task) {
  let designTime = 0;
  let implementationTime = 0;
  let hasReachedProposed = false;
  let lastInprogressStart = null;

  task.history.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  for (let i = 0; i < task.history.length; i++) {
    const event = task.history[i];
    const timestamp = new Date(event.timestamp).getTime();

    if (event.to_status === 'inprogress') {
      lastInprogressStart = timestamp;
    } else if (lastInprogressStart !== null) {
      const duration = timestamp - lastInprogressStart;
      if (hasReachedProposed) {
        implementationTime += duration;
      } else {
        designTime += duration;
      }
      lastInprogressStart = null;
    }

    if (event.to_status === 'proposed') {
      hasReachedProposed = true;
    }
  }
  
  return { designTime, implementationTime, totalWorkTime: designTime + implementationTime };
}
```

## 6. Verification Plan
- **Unit Tests**: Add tests to `PipelineStatsView.test.ts` to verify calculation logic with various history scenarios (with/without design docs, multiple inprogress cycles).
- **Manual Verification**: Check the `StatsDialog` in the UI to ensure the new metrics are displayed correctly and make sense for existing tasks.
