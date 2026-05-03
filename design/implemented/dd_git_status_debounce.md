# Design Document: Debounced Git Status Refresh

## 1. Context
`PipelineDetailView.ts` performs an HTTP request to `systemClient.getGitStatus` whenever the view loads, a task completes, or the user presses the *Refresh Git Status* button. Because these triggers can occur in rapid succession, the request may be fired multiple times concurrently, leading to race conditions and unnecessary traffic.

## 2. Objective
Introduce a 500 ms debounce that consolidates rapid events into a single refresh while guaranteeing that the status is eventually refreshed after the last event.

## 3. Debounce Mechanism
- **Timer**: `gitStatusRefreshTimer` stores the `setTimeout` handle.
- **In‑Progress Flag**: `gitStatusRefreshInProgress` indicates a request is underway.
- **Pending Flag**: `gitStatusRefreshPending` signals that a new refresh was requested during an in‑progress call.
- **Public API**: `scheduleRefreshGitStatus()` replaces all previous callers. It either starts the timer or marks a pending request.
- **Internal Call**: `refreshGitStatusInternal()` performs the HTTP call, updates the UI, and, after completion, checks the pending flag to restart the timer if necessary.

## 4. Integration Points
All existing callers (`loadPipeline`, WebSocket task updates, and the manual button) invoke `scheduleRefreshGitStatus()`. No further changes are required to external modules.

## 5. Benefits
- **Network Efficiency**: At most one request per 500 ms.
- **Race‑Safety**: A pending request after the current one finishes automatically triggers a fresh refresh.
- **User Experience**: Rapid clicks or events do not produce UI jitter.
