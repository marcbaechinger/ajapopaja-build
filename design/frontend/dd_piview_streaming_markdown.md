# Design: PiView Rendering & On-the-Fly Markdown-to-HTML

## 1. Overview

`PiView` is the terminal-style activity log that renders the output of a Pi
agent. Agent output arrives over the application WebSocket as raw Pi RPC events,
is reduced into a stable list of typed `RenderBlock`s, and is diffed into the
DOM. Today the **actual assistant response** (`RenderBlock.kind === 'text'`) is
rendered as pre-formatted plain text; converting it to styled HTML is only
possible manually, one block at a time, via the per-block **"Format as markup"**
button.

This document:

1. explains how PiView turns WebSocket events into rendered blocks,
2. analyses the performance characteristics and anti-patterns of that pipeline,
3. evaluates options for rendering assistant Markdown to HTML,
4. proposes a concrete **Phase 1** implementation that renders a text block as
   soon as it is complete (no per-token parsing), and
5. sketches a **Phase 2** incremental renderer for progressive on-the-fly
   rendering with bounded per-frame cost.

Only `text` blocks (the assistant's visible answer) are affected. `thinking`,
`tool`, `bash`, `notice`, `error`, `divider` and `verification` blocks keep
their current rendering exactly.

## 2. Goals / Non-Goals

**Goals**

- Render the assistant's Markdown answer to sanitized HTML automatically.
- Preserve existing raw-text behaviour for every other block kind.
- Keep copy-to-clipboard returning the raw Markdown.
- Keep the existing manual "Format as markup" toggle working (and let `text`
  blocks toggle back to raw).
- Avoid per-token Markdown parsing/sanitization; do not regress streaming
  smoothness.
- Avoid blocking the main thread when a long session history is replayed
  (many completed `text` blocks arriving at once).

**Non-Goals**

- Changing the backend protocol or the Pi event stream.
- Rendering Markdown on the server.
- Changing block granularity (a `text` block stays the unit).
- Introducing a rich editor; this is read-only output.

## 3. Current Rendering Pipeline

### 3.1 Transport

- **Backend**: `CoderBotSession._handle_event`
  (`backend/api/src/api/coderbot/session.py`) persists each raw Pi RPC JSON
  event and forwards it verbatim as a `CODERBOT_RPC_EVENT` WebSocket message
  (`_broadcast_rpc`). The same event also drives `ASSISTANT_STREAM`, a legacy
  plain-text broadcast.
- **WebSocketClient** (`frontend/src/core/WebSocketClient.ts`) parses each
  message and dispatches it to registered type handlers.
- **CoderBotService** (`frontend/src/core/CoderBotService.ts`) subscribes to
  `CODERBOT_RPC_EVENT` and feeds `msg.payload.event` into a shared
  `PiLogReducer`. The `InteractiveCodingService` uses the exact same reducer for
  `INTERACTIVE_RPC_EVENT`, so both logs render identically.

`RenderBlock` / `BlockKind` are defined in `PiLogReducer.ts` and re-exported by
`CoderBotService.ts:22` (`export type { RenderBlock, BlockKind } from
'./PiLogReducer.ts'`). `PiView` imports `RenderBlock` from `CoderBotService`
(`PiView.ts:17`), so adding a field to the interface in `PiLogReducer.ts` is
sufficient — no import changes are needed.

### 3.2 Reduction: raw event → `RenderBlock`

`PiLogReducer` (`frontend/src/core/PiLogReducer.ts`) is a pure reducer:

- It maintains `blocks: RenderBlock[]` and `openBlocks: Map<string, OpenBlock>`
  for streaming buffers keyed by content part (`text:<contentIndex>`,
  `thinking:<contentIndex>`, `tool:<id>`, `bash:<id>`).
- `message_update` deltas mutate the open block's buffer via string
  concatenation (`appendStreaming`) and emit a **full snapshot**
  (`blocks.slice()`).
- `message_start` / `message_end` call `closeStreamingBlocks(['text',
  'thinking'])`, which deletes open buffers so the next message starts a fresh
  block. This is the natural **"response element completed"** boundary.
- Other events create discrete blocks (`notice`, `error`, `verification`, …).
- `suspendEmits()` batches the history replay into one snapshot to avoid an
  O(n²) replay.

`RenderBlock` kinds: `text | thinking | tool | bash | notice | error | divider |
verification`. Crucially, only `text` is the assistant's visible answer; all
other kinds are diagnostics/tooling output.

### 3.3 View: `RenderBlock[]` → DOM

`PiView` (`frontend/src/ui/components/PiView.ts`):

- `initLogDisplay` subscribes to `service.onBlocks`.
- `reconcile(blocks)` stores the snapshot in `pendingBlocks` and schedules a
  single `requestAnimationFrame`. This coalesces a burst of per-token snapshots
  into one DOM pass per frame (`scheduleRenderFrame` → `reconcileNow`).
- `reconcileNow` computes the id set, removes vanished blocks, and calls
  `applyBlock` for each block.
- `applyBlock` does stable-id keyed reconciliation: `createBlockEl` on first
  sight, `updateBlockEl` on subsequent snapshots. This avoids DOM churn/flicker.
- `createBlockEl` builds kind-specific DOM. For `text` it is a single
  `<div class="whitespace-pre-wrap break-all">` with `textContent`.
- `updateBlockEl` writes the full accumulated text via `el.textContent = txt`
  when it changes.

### 3.4 Existing Markdown support

- `frontend/src/ui/components/utils/markdown.ts` exposes the shared
  `renderMarkdown(md)` = `DOMPurify.sanitize(marked.parse(md))`. It is used by
  `SpecSection`, `ReviewDialog`, `PullRequestSection` and others — **not** by
  `PiView`.
- `PiView` has its **own private** `renderMarkdown(text)` which calls
  `marked.parse(text, { async: false })` and then `DOMPurify.sanitize(...)`
  (`PiView.ts:1352`). This design reuses that private method (see §12 for the
  consolidation follow-up).
- `PiView` has a **per-block** "Format as markup" button
  (`attachBlockActions`, `toggleFormatBlock`). `applyFormat` snapshots the raw
  content nodes into `formattedContent`, removes them, appends a
  `[data-role="formatted"]` div carrying `FORMATTED_MARKDOWN_CLASS`, and
  remembers the raw text in `formattedRawText` so copy still returns Markdown.
  `revertFormat` restores the snapshot from `formattedContent`.
- `refreshFormattedEl` re-renders the Markdown on **every** block update while a
  block is formatted (this is an existing anti-pattern; see §4.7).
- Styling lives in `frontend/src/style.css` under `.piview-formatted`
  (tightened `prose-theme` typography).

## 4. Performance Analysis

The pipeline is already well optimised in several places (stable-id diffing,
rAF coalescing, suspended history emits, shared reducer). The following issues
remain, ordered by impact.

### 4.1 Full snapshot per token (high impact)

Every `text_delta` calls `appendStreaming` → `emitBlocks`, which allocates a new
`blocks.slice()` and synchronously notifies **all** listeners. PiView then
throws the intermediate snapshots away (it only keeps `pendingBlocks`). Over a
session with `n` blocks and `t` tokens this is O(n · t) allocations/listener
calls, i.e. roughly O(n²) for a session. The DOM pass is already batched to one
per frame, but the snapshot/allocation churn is not.

*Fix (optional, independent of Markdown):* add a scheduled emit
(`queueMicrotask`/rAF) or a dirty flag so a burst of deltas produces one
snapshot, mirroring `suspendEmits()` for the live path. Must keep `getBlocks()`
synchronous and current for tests, and keep `CoderBotService.getHistory()`
(used by `PiView.findBlock`) current.

### 4.2 Full-block `textContent` rewrite per frame (high impact for large blocks)

`updateBlockEl` assigns the entire accumulated string to `el.textContent`. A
block streamed in `k` frames costs O(len²) character copying. For plain text it
is tolerable; once Markdown parsing is added to this path it becomes expensive.

*Fix:* render Markdown only on completion (Phase 1), or incrementally by
appending to a committed prefix (Phase 2).

### 4.3 O(n) work in every `reconcileNow` (medium)

Each frame rebuilds `new Set(blocks.map(...))`, walks `blockEls`,
`forEach(applyBlock)`, calls `updateEmptyState`, `scrollToBottom` (forced layout
via `scrollHeight`), `refreshSearchForNewContent` (only when searching) and
`refreshErrorList` (a `querySelectorAll('.piview-error')` over the DOM). Cost
grows with session length even when only the last block changed.

*Fix (optional):* track dirty block ids (the reducer already knows which block
mutated) and update only those; keep the O(n) pass as a periodic/initial
reconcile.

### 4.4 `updateBlock` linear scan (low)

`updateBlock` uses `this.blocks.find(b => b.id === id)` — O(n) per tool
start/update/end. `appendStreaming` already uses the `openBlocks` map. Fine for
typical block counts; could be an id→block map.

### 4.5 Search highlight rebuild (medium, only while searching)

`refreshSearchForNewContent` is called on every frame when a query is active and
re-walks all text nodes to rebuild `<mark>`s. With streaming this can thrash.
*Fix:* skip during active streaming, debounce, or highlight only appended nodes.

### 4.6 Redundant `ASSISTANT_STREAM` for CoderBot (low, bandwidth)

The backend emits both `CODERBOT_RPC_EVENT` (`session.py:647`) and
`ASSISTANT_STREAM` (`session.py:664`) for the same tokens, but `CoderBotService`
ignores `ASSISTANT_STREAM` when `bot_type === 'coderbot'`
(`CoderBotService.ts:96`). That is wasted serialization/broadcast per token.
*Fix:* only send `ASSISTANT_STREAM` for bots that consume it.

### 4.7 Manual formatted re-render on every update (medium, pre-existing)

`refreshFormattedEl` re-parses Markdown plus DOMPurify on every update while a
block is formatted. A user who formats a streaming block pays O(len²) parsing.
*Fix:* cache the rendered source and skip when unchanged; for `text` blocks,
auto-render only at completion.

### 4.8 History replay vs. live path asymmetry (informational)

History replay is correctly batched with `suspendEmits()`. The live path is not,
so the two have very different per-token costs. §4.1 closes this gap.

## 5. Options for Markdown-to-HTML

| # | Option | Live while streaming | Per-update cost | Complexity | New deps | Notes |
|---|--------|----------------------|-----------------|------------|----------|-------|
| 0 | Current: manual per-block button | Manual | Full parse on click + every update if formatted | Done | none | Not automatic; re-parses while streaming |
| 1 | **Render on completion** (recommended Phase 1) | No (raw until block closes) | One `marked.parse` + DOMPurify per text block | Low | none | Zero streaming cost; small visual flip at end |
| 2 | Throttled full re-render of the streaming block | Yes (~100–150 ms) | O(block length) per tick → O(n²) overall | Low | none | Simple interim; risky for huge code blocks |
| 3 | **Incremental stable-prefix rendering** (recommended Phase 2) | Yes (rAF/throttled) | ~O(uncommitted tail) per frame | Medium | none (`marked.lexer` + `marked.parser`) | Commits finished top-level tokens, re-renders only the tail |
| 4 | Dedicated streaming Markdown library | Yes | O(token) appends | Med–Low | new dependency | e.g. DOM-based incremental parser; sanitisation is per-node and less proven |
| 5 | Parse in a Web Worker | Yes | Off-main-thread parse; sanitise on main thread | High | none | DOMPurify needs the DOM, so only half the work moves; messaging overhead |
| 6 | Backend renders HTML | Yes | Server CPU + larger payloads | High | none | Duplicates rendering logic; must sanitise server-side; rejected |

**Recommendation**

- Implement **Option 1** now. It matches the requested "first step", has zero
  streaming cost, reuses PiView's existing `applyFormat` and private
  `renderMarkdown`, and is easy to test.
- If progressive formatting is wanted, add **Option 3** later behind the same
  `PiView` API. Option 2 can be a throwaway interim but is not recommended for
  large code-heavy answers.

## 6. Proposed Phase 1 Implementation

### 6.1 Reducer: mark streamed blocks complete

`frontend/src/core/PiLogReducer.ts`

- Extend `RenderBlock`:

  ```ts
  /** True once the reducer closed the streaming buffer for this block. */
  complete?: boolean;
  ```

- In `closeStreamingBlocks(kinds)`, set `open.block.complete = true` for every
  closed block and emit once if anything changed (today the method is silent).
  The emit goes through `emitBlocks()`, so it automatically respects
  `suspendEmits()` during history replay (the pending flag is flushed on
  release):

  ```ts
  private closeStreamingBlocks(kinds: BlockKind[]) {
    let changed = false;
    for (const [key, open] of this.openBlocks) {
      if (kinds.includes(open.block.kind)) {
        if (!open.block.complete) { open.block.complete = true; changed = true; }
        this.openBlocks.delete(key);
      }
    }
    if (changed) this.emitBlocks();
  }
  ```

  The change fires **once per close transition per block** (guarded by
  `complete`), not once per `message_start`/`message_end` event.

- *(Optional refinement)* If Pi emits `text_start`/`text_end`, close the matching
  text buffer on those events so a text part followed by a tool call is marked
  complete earlier than `message_end`. `message_end`/`message_start` remain the
  guaranteed fallback because they are always present in the persisted history.

This flag is derived state and survives history replay, because the replay
feeds the same `message_end` events through the reducer.

### 6.2 View: auto-format only completed `text` blocks

`frontend/src/ui/components/PiView.ts`

Add a small amount of state (reusing the existing formatting maps):

- `autoFormatText: boolean` (from `PiViewOptions`, default `true`).
- `rawTextOverride: Set<string>` — blocks the user manually switched back to
  raw, so a later snapshot does not silently re-format them.
- `formattedBlocks: Set<string>`, `formattedContent: Map<string, Node[]>` and
  `formattedRawText: Map<string, string>` — the **existing** formatting state
  (`PiView.ts:194–204`). `formattedContent` must be populated by the auto path
  so `revertFormat` can restore the raw nodes. There is no separate
  `renderedText` map; the source-changed guard compares against
  `formattedRawText`.
- `pendingAutoFormat: string[]` — a bounded queue used to avoid formatting a
  large history synchronously (see §6.7).

`createBlockEl`, `case 'text'`: build a wrapper that contains a raw child; if the
incoming block is already complete (e.g. history replay) enqueue it for
formatting (do not parse synchronously inside the reconcile pass):

```ts
case 'text': {
  const wrapper = document.createElement('div');
  wrapper.className = 'piview-text';
  const raw = document.createElement('div');
  raw.setAttribute('data-role', 'raw');
  raw.className = 'whitespace-pre-wrap break-all';
  raw.textContent = block.text ?? '';
  wrapper.appendChild(raw);
  if (this.shouldFormatText(block)) this.enqueueAutoFormat(block.id);
  el = wrapper;
  break;
}
```

with

```ts
private shouldFormatText(block: RenderBlock): boolean {
  return this.autoFormatText
    && block.kind === 'text'
    && !!block.complete
    && !!block.text
    && !this.rawTextOverride.has(block.id);
}
```

`updateBlockEl`: handle `text` before the generic path:

```ts
if (block.kind === 'text') {
  if (this.formattedBlocks.has(block.id)) {
    // Only re-parse if the source actually changed (normally never after completion).
    if (this.formattedRawText.get(block.id) !== this.blockToText(block)) {
      this.refreshFormattedEl(el, block.id, block);
    }
    return;
  }
  if (this.shouldFormatText(block)) {
    this.applyFormat(el, block.id, this.blockToText(block), { silent: true });
    return;
  }
  // Streaming (or opted-out): update the raw pre-wrap text cheaply.
  const raw = el.querySelector('[data-role="raw"]') as HTMLElement | null;
  const txt = block.text ?? '';
  if (raw) {
    if (raw.textContent !== txt) raw.textContent = txt;
  } else {
    // Wrapper unexpectedly missing its raw child: reuse the existing
    // button-preserving plain-text replacement used by the generic path.
    this.replaceTextPreservingActions(el, txt);
  }
  return;
}
```

`replaceTextPreservingActions(el, txt)` is the existing fallback currently
inlined in `updateBlockEl` (`PiView.ts:1277–1290`): it temporarily detaches
`.piview-copy`/`.piview-format`, sets `el.textContent = txt`, then re-appends
them. Extract it into a helper so both paths stay in sync.

`applyFormat` gains an options argument `{ silent?: boolean }` so auto-formatting
does not show the "Rendered Markdown" toast:

```ts
private applyFormat(wrapper: HTMLElement, id: string, text: string, opts: { silent?: boolean } = {}) {
  // ...existing snapshot + formatted-div logic...
  if (!opts.silent) this.showToast('Rendered Markdown');
  this.refreshFormatButton(wrapper, id); // label/icon now reflects formatted state
}
```

`revertFormat` records `rawTextOverride.add(id)` **only when the revert is user
initiated**, so it stays raw across later snapshots, and it also calls
`refreshFormatButton`. `toggleFormatBlock` on a raw-but-overridden block clears
the override when re-formatting.

**`rawTextOverride` lifecycle.** The override is set when the user clicks the
button on an auto-formatted `text` block, and cleared when the user re-formats
it or when the block is removed (§6.4). If the user reverts an **incomplete**
block (before `complete` is set), `shouldFormatText` is already false, so the
override is redundant but harmless; keep it so that the block does not
auto-format when it completes. This is the intended "stays raw" behaviour and is
covered by §10.

**Button label/icon.** `attachBlockActions` only runs at creation
(`PiView.ts:1193`) and sets a fixed title/aria-label/icon. Auto-formatting
happens later in `applyFormat`, so the label must be updated there and reset in
`revertFormat`. Add `refreshFormatButton(wrapper, id)` which sets
`title`/`aria-label` to "Show raw text" when `formattedBlocks.has(id)`, and
"Format as markup" otherwise (swapping the icon accordingly). The
`data-format-block` action id is unchanged. Label/icon logic must distinguish
the auto-formatted `text` case from other blocks only in wording; the toggle
behaviour is identical.

**Important DOM detail:** formatted HTML must go into the dedicated
`[data-role="formatted"]` child, never via `innerHTML` on the
`whitespace-pre-wrap` container — otherwise the newlines between marked's block
tags render as extra blank lines. The raw child is snapshotted into
`formattedContent` and removed, exactly as the manual path already does.

### 6.3 Copy / raw access

- `copyBlock` already prefers `formattedRawText` for formatted blocks
  (`PiView.ts:1781`), so copy returns raw Markdown. No change beyond populating
  that map in the auto path.
- Pass `this.blockToText(block)` (not `block.text`) to `applyFormat` in the auto
  path so the stored raw text matches the manual-toggle path exactly.
- The per-block button becomes "Show raw text" for auto-formatted `text` blocks
  (and "Format as markup" otherwise), updated via `refreshFormatButton`
  (§6.2).

### 6.4 Cleanup

`reconcileNow` already deletes `formattedBlocks`/`formattedContent`/
`formattedRawText` for removed blocks. Also delete `rawTextOverride` entries and
drop any queued `pendingAutoFormat` ids for the removed block.

### 6.5 Styling

`.piview-formatted` already exists and is reused. Optionally give `.piview-text`
the same base density as neighbouring blocks and keep raw text on
`whitespace-pre-wrap break-all`. Because formatted HTML replaces the raw child,
block height can change on completion; follow-mode scroll is corrected on the
next frame by `scrollToBottom`. If a one-frame jump is observed, capture
`scrollTop` before formatting and restore relative scroll on the same frame.

### 6.6 Non-`text` blocks

Untouched. Their manual "Format as markup" toggle continues to use the existing
`applyFormat` path. Adding the source-changed guard in `refreshFormattedEl`
(§4.7) is a safe, small improvement for those blocks too.

### 6.7 History replay: avoid a synchronous formatting burst

On initial load, `reconcileNow` walks every replayed block in one rAF pass. If
`createBlockEl` formatted each completed `text` block synchronously, a long
session would run `marked.parse` + DOMPurify for every block on the main thread,
causing jank.

Mitigation:

- `createBlockEl` **enqueues** the block id (`enqueueAutoFormat`) instead of
  formatting inline.
- `enqueueAutoFormat` pushes to `pendingAutoFormat` and schedules a drain via
  `requestIdleCallback` (falling back to `setTimeout(…, 0)` where unavailable).
- The drain formats at most a small budget (e.g. one block, or a time budget of
  ~5 ms) per idle callback, skipping ids that are no longer present/formattable,
  so the visible log becomes readable quickly without blocking input.
- Live completions (the common case: exactly one block closes at a time) also
  go through the queue but are drained on the next idle callback, which is
  effectively immediate.

Tests should be able to force a synchronous drain (e.g. expose a
`flushAutoFormat()` used by `PiView.test.ts`) so assertions do not depend on
idle timing.

## 7. Proposed Phase 2: Incremental On-the-Fly Rendering

If the small end-of-block flip is not acceptable, stream formatted HTML with
bounded cost using a **stable-prefix commit** renderer.

### 7.1 Idea

Keep a persistent Markdown renderer per streaming `text` block with two regions:

```
+-----------------------------------------------+
| committed   : sanitized HTML of finished        |  append-only
|               top-level Markdown tokens         |
+-----------------------------------------------+
| tail        : re-rendered Markdown for the      |  replaced per frame
|               one possibly-incomplete token     |
+-----------------------------------------------+
```

- On each render tick, lex only `source.slice(committedUpTo)` with
  `marked.lexer`. Every token except the last is complete by definition; render
  and sanitize them once and append to the committed region, advancing
  `committedUpTo` by their `raw` length.
- Re-render only the final token into the tail region. Inline constructs that
  span deltas (`**bo` + `ld**`) stay in the tail until the enclosing top-level
  token completes, so partial syntax is not committed.
- On `complete`, call `finalize(source)`: render the whole source once with the
  existing `renderMarkdown` and replace both regions. This guarantees the final
  output is identical to Phase 1.

**Correctness assumption.** Committing all-but-the-last token is safe only for
append-only source where a committed top-level token never changes. Greedy
constructs (fenced code, lists, blockquotes) can lex as a single token that
consumes to end-of-input; since such a token is the last token it always stays
in the tail and is never committed until a following top-level token appears.
No retroactive edit to an already-committed token is possible with append-only
input, which is the only way Pi streams a response. Document this assumption in
the helper.

### 7.2 Cost controls

- **Reuse rAF**: PiView already batches to one reconcile per frame; add a
  per-block minimum interval (~100–150 ms) with a trailing flush so a burst of
  frames does not re-render the tail repeatedly.
- **Open code-fence fast path**: an unfinished fenced code block is a single
  `code` token covering the rest of the source and would be re-parsed every
  tick. Detect it and render it as an escaped `<pre><code>` whose text is
  appended (O(delta)) instead of Markdown-parsed.
- **Only the last streaming text block** is rendered live; all others finalize
  via §6.
- Keep DOMPurify on the main thread (it needs the DOM). A worker could own
  `marked` only; not worth the messaging overhead for now.

### 7.3 API sketch

New helper `frontend/src/ui/components/utils/streamingMarkdown.ts`:

```ts
export interface StreamingMarkdownRenderer {
  /** Update with the current raw source. Cheap and safe to call every frame. */
  update(source: string, opts?: { force?: boolean }): void;
  /** Render the final, exact output once the block completes. */
  finalize(source: string): void;
  /** Release DOM references. */
  destroy(): void;
}

export function createStreamingMarkdownRenderer(
  container: HTMLElement,
  opts?: { throttleMs?: number }
): StreamingMarkdownRenderer;
```

`PiView` keeps one renderer per streaming `text` block in a
`Map<string, StreamingMarkdownRenderer>`, calls `update` from `updateBlockEl`,
`finalize` when `block.complete` becomes true, and `destroy` in
`reconcileNow`'s removal branch.

### 7.4 Phase 2 testability

- Feed a source in fragments and assert the rendered text never loses content
  and matches the final `renderMarkdown` output exactly.
- Assert an open code fence does not trigger `marked.parse` per fragment
  (spy/counter).
- Assert per-frame render count respects the throttle.

## 8. Security

- Always sanitize with `DOMPurify` before `innerHTML`, in both phases. Never
  inject raw `marked.parse` output.
- Committed/tail regions are sanitized independently; splitting happens only at
  complete top-level token boundaries, so sanitization sees well-formed
  fragments.
- Consolidate `marked` configuration: `AssistantPanel.ts:26` registers a global
  `marked.use({...})` table renderer, `utils/markdown.ts` uses a bare
  `marked.parse`, and `PiView` uses `marked.parse(text, { async: false })`. The
  `marked` instance is shared, so an extension registered by `AssistantPanel`
  can affect PiView's output. Centralise configuration in `utils/markdown.ts`
  (and have PiView use it) so links/tables behave consistently. E.g. add
  `target="_blank" rel="noopener noreferrer"` to links and wrap wide tables for
  horizontal scrolling. This consolidation is a small, recommended part of
  Phase 1 (it also makes the §10 spy possible); full behavioural parity can
  follow.

## 9. Accessibility / UX

- The formatted region replaces the raw `<div>` inside the same `text` block
  wrapper; keep the wrapper and its `data-block-id` so hover actions, search
  highlights and error navigation keep working.
- Search highlighting walks text nodes, so it works over rendered HTML text. A
  `<mark>` inserted into formatted HTML can be discarded by a later re-render of
  the tail; acceptable while streaming, and the final `finalize` is stable.
- Preserve the monospace log aesthetic: `.piview-formatted` already tightens
  typography. Do not set `white-space: pre-wrap` on the formatted container.
- Block height changes when a block completes and formats; if follow-mode
  scroll visibly jumps, restore scroll position on the same frame (§6.5).
- Announce completion? The log is already `aria-live` at the status bar level;
  no additional live region is needed. The format toggle updates
  `title`/`aria-label` so screen-reader users can tell the state (§6.2).

## 10. Testing Plan

Reducer (`PiLogReducer.test.ts`):

- `complete` is `false` while deltas arrive and `true` after
  `message_end`/`message_start`.
- Closing a stream emits a snapshot exactly once per close transition, and the
  emit is deferred while `suspendEmits()` is active.

View (`PiView.test.ts`):

- streaming `text` (`complete: false`) renders raw, with no `.piview-formatted`.
- on `complete: true`, a `text` block renders `.piview-formatted` with expected
  `<strong>`/`<em>`/`<h1>` (drain the auto-format queue synchronously via the
  test helper).
- only `text` kind auto-formats; `thinking`/`tool`/etc. stay raw unless the user
  clicks "Format as markup".
- unsafe HTML is sanitized (`<script>` removed).
- toggling an auto-formatted block to raw stays raw across later snapshots
  (`rawTextOverride`), including when the block was reverted before completion.
- `marked.parse` is called once per completed block and not on every streamed
  delta (spy on `marked.parse`; note PiView does not call `utils/markdown.ts`).
- copy returns the raw Markdown; removed blocks clear formatting state,
  `rawTextOverride`, and queued auto-format ids.
- a replayed history of many completed `text` blocks does not format them all
  synchronously in one reconcile pass (queue/idle drain), and `flushAutoFormat`
  produces the same result.
- the format button label/icon flips between "Format as markup" and
  "Show raw text" on format/revert.

Run the full frontend suite plus `tsc` (`npm run build` / `npm test`).

## 11. Files Touched (Phase 1)

| File | Change |
|------|--------|
| `frontend/src/core/PiLogReducer.ts` | Add `RenderBlock.complete`; set it in `closeStreamingBlocks`; emit once per close transition. |
| `frontend/src/ui/components/PiView.ts` | Add `autoFormatText` option + override/queue state; auto-format completed `text` blocks via a bounded idle queue; source-changed guard; button label/icon refresh; silent `applyFormat`; cleanup. |
| `frontend/src/ui/components/utils/markdown.ts` | Recommended: centralise `marked` configuration and have PiView use it (also enables the §10 spy). |
| `frontend/src/ui/components/PiView.test.ts` | New cases listed in §10. |
| `frontend/src/core/PiLogReducer.test.ts` | `complete` flag + emit-once coverage. |
| `frontend/src/style.css` | Only if a `.piview-text` helper class is added (optional). |
| `design/frontend/dd_piview_streaming_markdown.md` | Add this design document (the spec references it but it is not yet in the repo). |

Note: `PiView` imports `RenderBlock` from `CoderBotService` (which re-exports it
from `PiLogReducer`), so no import changes are required for the new field.

Phase 2 additionally adds
`frontend/src/ui/components/utils/streamingMarkdown.ts` and its tests.

## 12. Risks / Open Questions

- **Visual flip at completion**: text reformats when the block closes. Accepted
  for Phase 1; Phase 2 removes it. If undesirable in the interim, gate the
  feature behind a setting.
- **History replay formatting burst**: mitigated by the bounded idle queue
  (§6.7); verify on a long session that initial load stays responsive.
- **`message_end` timing**: completion depends on `message_end` being present in
  both live and replayed streams. It is persisted in the session event log and
  used by existing reducer tests; the optional `text_end` refinement can make it
  earlier.
- **Very large single blocks**: Phase 1 cost is one parse, fine. Phase 2 needs
  the open-fence fast path to stay linear.
- **`marked` configuration drift**: `AssistantPanel` calls `marked.use(...)` on
  the shared instance while `utils/markdown.ts` and PiView's private renderer do
  not. Centralising is recommended in Phase 1 (§8) to avoid cross-component
  surprises.
- **Button label semantics**: "Show raw text" is only strictly accurate for
  auto-formatted `text` blocks; confirm wording with design/product.
