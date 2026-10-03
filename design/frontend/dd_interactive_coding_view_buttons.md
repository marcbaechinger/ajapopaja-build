# Design: Clarify the Buttons in the InteractiveCodingView

**Status:** Proposed
**Scope:** `frontend/src/ui/components/InteractiveCodingView.ts` (+ wiring in `PipelineDetailView.ts`, tests)
**Related:** [`dd_interactive_session_management.md`](./dd_interactive_session_management.md), [`dd_piview_improvements.md`](./dd_piview_improvements.md), [`dd_spa_architecture.md`](../dd_spa_architecture.md)

---

## 1. Background

The header of `InteractiveCodingView` currently renders **three** controls side
by side:

| Button | Element id | Handler | Effect |
|--------|-----------|---------|--------|
| **Switch session** | `#interactive-switch-session-btn` | `switchSession()` | Dispatches the `toggle-session-manager` window event (opens the global session drawer), or runs the host `onSwitchSession` callback. |
| **Pause** | `#interactive-pause-btn` | `pauseSession()` | `service.pauseSession()` → `POST /api/coderbot/sessions/{uid}/pause`. |
| **Stop Session** | `#interactive-stop-btn` | `stopSession()` | `service.stopSession(pipelineId)` → legacy `POST /api/coderbot/interactive/stop`. |

Two problems motivate this task:

1. **"Switch session" is redundant.** Since the session manager was introduced
   ([`dd_interactive_session_management.md`](./dd_interactive_session_management.md))
   switching is reachable from several other, better-scoped places:
   * the global **Sessions** header button (`SessionManagerButton`, rendered in
     both the dashboard and pipeline headers) which opens `SessionManagerPanel`;
   * the `Ctrl/Cmd+J` shortcut (registered in `AppContext.setupGlobalShortcuts`);
   * the inline per-pipeline session list (`#pipeline-session-list`) and the
     **Resume Session** button in `PipelineDetailView`.
   A fourth, in-view entry point adds noise without adding reach.

2. **"Pause" vs "Stop" is unclear, and they are functionally identical.** Both
   end the Pi process and leave the durable session **resumable**; there is no
   separate *stopped* state. Because the two buttons have the same outcome, the
   user cannot tell what the difference is — and there isn't one.

### 1.1 Pause vs. Stop vs. Discard — the actual semantics

Analysing the backend (`backend/core/src/core/models/models.py`,
`backend/api/src/api/coderbot/manager.py`, `.../router.py`) and the frontend
service (`frontend/src/core/InteractiveCodingService.ts`) shows:

| Action | Endpoint | Process | Durable record | Session file |
|--------|----------|---------|----------------|--------------|
| **Pause** (`pauseSession`) | `POST /sessions/{uid}/pause` | stopped | `status = PAUSED` | retained |
| **Stop** (legacy) | `POST /interactive/stop` | stopped | `status = PAUSED` | retained |
| **Discard** | `POST /sessions/{uid}/discard` | stopped | `status = DISCARDED` | released |

The `PiSessionStatus` enum confirms there is **no `STOPPED` state** — the only
"deliberately ended but resumable" state is:

```python
class PiSessionStatus(str, Enum):
    STARTING  = "starting"
    RUNNING   = "running"
    PAUSED    = "paused"     # deliberately stopped, resumable
    COMPLETED = "completed"  # batch finished, resumable
    FAILED    = "failed"     # resumable
    DISCARDED = "discarded"  # resources released
```

`CoderBotManager.stop_interactive_session()` and `CoderBotManager.pause_session(uid)`
both end by setting `record.status = PiSessionStatus.PAUSED`. Likewise the
frontend `InteractiveCodingService.stopSession()` and `pauseSession()` both call
`setActive(false)` and mark the session `'paused'`. The only real difference is
plumbing: `pauseSession` targets the **durable UID** and calls
`persistSession()` (so the session can be offered for *resume* after a reload),
whereas the legacy `stopSession` is pipeline-scoped and leaves no resume hint.

**Conclusion:** Pause and Stop produce the same observable result (a resumable,
paused session). Pause is the strictly better implementation of that result
(UID-scoped + persisted). Therefore **Pause alone is sufficient**, and the
"Stop Session" button is removed.

The genuinely destructive action is **Discard** (releases the retained
workspace and Pi session file). It is deliberately *not* offered in this header
— it lives behind a confirmation in the session manager / inline session rows
(`data-session-action="discard"`), which is the correct place for it.

---

## 2. Proposed Changes

### 2.1 Target header (after)

```
┌ Interactive Coding Session · Session active ───────────────── [ ⏸ Pause ] ┐
```

* **Remove** `#interactive-switch-session-btn` ("Switch session").
* **Remove** `#interactive-stop-btn` ("Stop Session").
* **Keep** `#interactive-pause-btn` ("Pause"), with an explicit tooltip
  ("Stop the agent now; the session stays resumable").
* **Disable** the Pause button whenever the session is not active (already
  paused / stopped), so the control always reflects a legal action.

### 2.2 `InteractiveCodingView` (object model)

The view is a small, self-contained component that composes `PiView` and
`InteractivePromptView`. Removing the two buttons lets us slim its public
surface to a single lifecycle hook:

```ts
export interface InteractiveCodingViewOptions {
  pipelineId: string;
  /** Invoked by the "Pause" control (defaults to service.pauseSession). */
  onPause?: () => void;
  // REMOVED: onStop?, onSwitchSession?
}
```

Changes inside the class:

* Delete fields `onStop`, `onSwitchSession` and their constructor assignments.
* Delete the public `stopSession()` and `switchSession()` methods (now dead —
  the host and the session manager own those flows).
* Simplify `pauseSession()`: call the strongly-typed
  `this.service.pauseSession()` directly (drop the `as unknown as {…}` cast and
  the silent fallback to `stopSession`; the durable service always implements
  pause). Keep the `onPause` override for host-provided behaviour.
* In `template()`, drop the two `<button>` blocks (Switch session and Stop
  Session).
* In `render()`, drop the two `addEventListener` calls for the removed ids.
* In `updateComposerState()`, additionally toggle the Pause button's `disabled`
  state and styling from the existing `active` flag, and align the status /
  placeholder copy with the pause-only vocabulary:
  * `busy` → "Agent working…"
  * `active` → "Session active"
  * otherwise → status "Paused", placeholder "Session paused — resume it from
    the session manager."

Because the view no longer exposes `stop`, the `showFooter: false` composition
of `PiView` remains the single owner of the session controls (the reused log's
own footer Stop stays hidden — no duplicate).

### 2.3 `PipelineDetailView` wiring

`syncInteractiveSession()` constructs the view with an `onStop` callback. Remove
that option (the button no longer exists); the view now relies solely on
`onPause`/service defaults. The registered but now-unreferenced
`stop_interactive_session` action can be retired in the same change to avoid
dead code (no rendered element uses
`data-action-click="stop_interactive_session"`).

The service-level `stopSession()` **stays**: it is still part of the
`PiSessionService` interface consumed by `PiView`, and it remains the fallback
for the legacy pipeline-scoped stop path elsewhere. Only the *button* is removed.

---

## 3. Implementation Plan

1. **Edit `frontend/src/ui/components/InteractiveCodingView.ts`**
   1. Update `InteractiveCodingViewOptions`: remove `onStop` and
      `onSwitchSession`; keep `pipelineId` and `onPause`.
   2. Remove the `onStop` / `onSwitchSession` fields and constructor lines.
   3. Remove the `stopSession()` and `switchSession()` methods.
   4. Rewrite `pauseSession()` to `await this.service.pauseSession()` (keep the
      `onPause` override + error alert).
   5. In `render()`, delete the `#interactive-stop-btn` and
      `#interactive-switch-session-btn` listener registrations.
   6. In `template()`, delete both button blocks; keep the Pause button with an
      added `title`.
   7. In `updateComposerState()`, set the Pause button `disabled` when
      `!active` and update the status/placeholder copy.
2. **Edit `frontend/src/ui/views/PipelineDetailView.ts`**
   1. Drop the `onStop` option from the `new InteractiveCodingView(...)` call.
   2. Remove the now-unused `stop_interactive_session` action registration (or
      leave it with a comment if removal risks other flows — it is unreferenced
      in templates).
3. **Update tests**
   1. `InteractiveCodingView.test.ts`: delete the `stopSession` tests; assert the
      template no longer contains `interactive-switch-session-btn` /
      `interactive-stop-btn`, that Pause is present, that clicking it calls
      `service.pauseSession`, that `onPause` overrides it, and that the button is
      disabled when inactive.
   2. `PipelineDetailView.test.ts`: adjust any assertion that relied on the
      removed `onStop` wiring (the service-mock `stopSession` stays valid for the
      legacy action tests).
4. **Docs**: add a short note to `RELEASENOTES.md` describing the simplified
   controls and the Pause/Stop/Discard semantics.
5. **Verify**: `cd frontend && CI=true npm run test`, then
   `cd frontend && npm run build`.

---

## 4. Alternatives Considered

* **Keep "Stop" and clarify the label** (e.g. "Stop & discard" vs "Pause").
  Rejected: there is no distinct non-destructive stop outcome to label — Stop
  *is* Pause. Making Stop the destructive action would silently collide with the
  existing, confirmation-guarded **Discard**, duplicating a destructive path in
  the wrong place.
* **Rename "Pause" → "Stop" and remove Pause.** Rejected: "Pause" better conveys
  reversibility/resumability, which matches `PAUSED  # deliberately stopped,
  resumable` and the resume affordances already built around it.
* **Keep "Switch session" as a scoped shortcut.** Rejected as redundant with the
  global Sessions button, `Ctrl/Cmd+J`, and the inline per-pipeline list; a
  fourth entry point in a chat header adds noise.
* **Move the Pause control into `PiView`'s footer.** Rejected: the view
  intentionally composes `PiView` with `showFooter: false` so it owns its own
  session controls; merging them would couple the reusable log to session
  lifecycle concerns.

---

## 5. Test Strategy

**Unit / component (vitest + jsdom) — `InteractiveCodingView.test.ts`**

* Template contains the Pause button and **not** the Switch/Stop buttons.
* Clicking Pause calls `service.pauseSession()`.
* `onPause` overrides the default and prevents the service call.
* Pause button is `disabled` when `isActive()` is false, enabled otherwise.
* Status text / placeholder reflect active / working / paused.
* `destroy()` still tears down the composed `PiView` and prompt view.

**Regression — `PipelineDetailView.test.ts`**

* The interactive view is still constructed and mounted on `INTERACTIVE_STARTED`
  and torn down on `INTERACTIVE_STOPPED` (existing XOR-with-TaskItem test) with
  no `onStop` option.

**Manual**

1. Start an interactive session → header shows only **Pause**.
2. Click Pause → agent stops, status becomes "Paused", session appears as
   resumable in the Sessions drawer and inline list.
3. Resume from the drawer → session continues with history intact.
4. Confirm Discard still requires its confirmation dialog and releases the
   workspace (unchanged).
5. Confirm `Ctrl/Cmd+J` and the header **Sessions** button still open the
   session manager (switch flow unchanged).

**Suite:** `cd frontend && CI=true npm run test`; `cd frontend && npm run build`.
