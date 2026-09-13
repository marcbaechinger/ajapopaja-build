# Design: Improve PiView design

## 1. Overview
`PiView` is the terminal-style CoderBot activity log used both in the
`CoderBotDialog` and embedded in the right-side `ExecutionEngineView`. This
document proposes a focused set of user-facing features and visual/UX
improvements, each with rationale, so they can be implemented after approval.

## 2. Context (current PiView)
- Renders structured blocks: `text`, `thinking`, `tool`, `bash`, `notice`,
  `error`, `divider`, `verification`.
- Black/green terminal styling; follow-mode auto-scroll; Clear logs; Stop bot;
  configurable log height (`logHeightClass`).
- Efficient block reconciliation (stable id-keyed diffing) — low flicker already.

Current capabilities in code:
- Footer bar with Follow (on/off), Clear, and Stop (only shown while active).
- Block-type-specific DOM with headers/bodies for `tool` and `verification`.
- Error blocks get a `text-red-400` tint; `thinking` is italic/opacity dimmed.
- Follow-mode scroll-to-bottom on every delta.

## 3. Goals
- Make long, dense sessions scannable and triagable (find errors, filter noise).
- Give immediate feedback on live status / elapsed time.
- Reduce visual noise while preserving detail on demand.
- Make the view feel native to the app in both dialog and embedded contexts.

## 4. Proposed Features (what + why)
1. **In-log search / find** — type to highlight matching text and jump through matches.
   *Why:* long sessions are hard to scan; finding a failed tool step or key error
   quickly is the single highest-value action.
2. **Filter by block kind** (e.g. hide `thinking`, only errors, only tool calls).
   *Why:* lets the user focus on what matters (errors vs chatter) and reduces
   cognitive load.
3. **"Jump to next/prev error"** buttons + error summary counter.
   *Why:* verification/failure scanning is the main triage task; quick error
   navigation speeds it up.
4. **Collapsible tool/history blocks** — header-only by default with a
   click-to-expand body, plus "expand all".
   *Why:* tool JSON args can be huge; collapsing reduces visual noise while
   preserving detail on demand.
5. **Copy-to-clipboard** for a single block and the whole log (with timestamps).
   *Why:* users paste failure output/prompts into issues or other tools.
6. **Live session status + elapsed timer** — a small "Running since HH:MM:SS"
   with a pulsing indicator, and a "Session ended" state.
   *Why:* gives immediate feedback that the agent is still active vs finished,
   and how long it ran.
7. **Download log as file**.
   *Why:* archiving/shareability of long runs.
8. **Keyboard shortcuts** (`/` focus search, `f` follow, `n`/`N` next/prev
   error, `c` clear).
   *Why:* power users spend a lot of time in this view; shortcuts improve throughput.

## 5. Visual / UX Improvements (what + why)
1. **Sticky session info + action bar** at the top (task/status/elapsed), so
   context stays visible while scrolling; footer keeps Clear/Stop/Follow.
   *Why:* reduces context-switching when the log is long.
2. **Better visual hierarchy & consistent theme tokens** — distinguish block
   kinds more clearly (subtle left-accent for tool, colored error tint),
   consistent spacing/sizes, readable line-height, and a refined custom scrollbar.
   *Why:* makes the dense log scannable and feels more "native" to the app.
3. **Stream "show more" for long blocks** instead of rendering enormous bodies fully.
   *Why:* avoids overwhelming the user and keeps scroll smooth.
4. **Auto-collapse `thinking` by default**, with a toggle.
   *Why:* thinking is often verbose and secondary; collapsing keeps output focused.
5. **Smoother live updates** — batch reconciliation to microtask timing / rAF,
   so the tail stays stable while streaming.
   *Why:* follows naturally from current stable-key diffing and reduces jank on
   high-frequency deltas.
6. **Empty / inactive state** — a friendly placeholder ("No active session…")
   instead of a blank black box, plus a distinct "session ended" summary line.
   *Why:* sets expectations when nothing has run; confirms completion.
7. **Responsive embed** — the height already configurable; ensure the embedded
   (sidebar) variant hides the header/footer chrome that makes sense only in the dialog.
   *Why:* the same view is now used in two containers; the embedded one should be
   more minimal.
8. **Accessibility** — focus styles, ARIA live region for the log tail,
   keyboard-operable buttons, sufficient contrast.
   *Why:* correctness/inclusion and polish.

## 6. Scope / Phasing
- **Phase 1 (high-impact, low-risk):** sticky session info bar + live
  status/elapsed; "jump to next/prev error" + error counter; auto-collapse
  `thinking`; copy a block; empty/session-ended states; responsive embed polish;
  theme/scrollbar refinement.
- **Phase 2:** search/find, block-kind filter, collapsible tool blocks with
  expand-all, download, keyboard shortcuts, batched streaming.

## 7. Out of scope
- Backend changes, Pi session lifecycle, multi-session.

## 8. Testing
- Unit tests for search/filter/error-jump/copy/collapse and status/elapsed rendering.
- Full frontend suite + `tsc`.
