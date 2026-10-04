/**
 * Copyright 2026 Marc Baechinger
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import type { RenderBlock } from '../../core/CoderBotService.ts';
import { Icon } from './Icon.ts';
import { KeybindingManager } from './KeybindingManager.ts';
import { renderMarkdown } from './utils/markdown.ts';
import './Keybinding.css';

/**
 * Classes for the Markdown-rendered ("Format as markup") view of a block.
 * `prose-theme` supplies the base typography; `font-sans` overrides the
 * monospace font inherited from the terminal-style log container so the
 * agent's rendered answer reads as prose; inline/block code keeps its
 * monospace font via the typography plugin's `code`/`pre` rules. The readable
 * measure for rendered prose (and the wider code-block / unconstrained table
 * exceptions) is owned solely by the `.piview-formatted` rules in
 * `src/style.css` (tunable via `--piview-max-width` / `--piview-pre-max-width`).
 * Do not reintroduce a container `max-w-*` here: a `max-width` on this element
 * would clamp code blocks and tables too.
 *
 * The block-level vertical rhythm (the spacing between paragraphs, list items,
 * headings, `pre` blocks and rules) is owned *solely* by the `.piview-formatted`
 * rules in `src/style.css` (tunable via the `--piview-gap-*` custom properties).
 * Do not re-introduce `prose-*:my-*` utilities here: those layered utilities are
 * inert against the unlayered `style.css` rules and would only create a second,
 * silently disagreeing source of truth.
 */
const FORMATTED_MARKDOWN_CLASS = 'piview-formatted prose-theme font-sans';

/**
 * Vertical spacing between the top-level log blocks (thinking / tool use /
 * response text / …). The log body is rendered at `text-[11px] leading-tight`
 * (~14px line box), so `space-y-3.5` (0.875rem = 14px) separates adjacent
 * sections by roughly one line height, making their boundaries legible in the
 * dense terminal-style log.
 *
 * External vertical spacing is owned here rather than by the individual block
 * classes: Tailwind's `space-y-*` rule is emitted inside a zero-specificity
 * `:where(...)`, so a `my-*` utility on a block would override it. Blocks must
 * therefore not set their own top/bottom margins for inter-block spacing.
 */
const LOG_BLOCK_SPACING_CLASS = 'space-y-3.5';

/**
 * Minimal interface describing the Pi-session capabilities a standalone Pi
 * activity-log view needs. `CoderBotService` satisfies this structurally, but
 * `PiView` never depends on the concrete type so it can be reused for any
 * Pi-driven agent.
 */
export interface PiSessionService {
  getHistory(): RenderBlock[];
  getCurrentTaskId(): string | null;
  isActive(): boolean;
  /** Wall-clock start (epoch ms) of the session, when known. */
  getSessionStartTime(): number | null;
  /** Subscribe to session start-time updates (e.g. post-history-load). */
  onSessionStartTimeChange(listener: (startTime: number | null) => void): () => void;
  clearHistory(): void;
  stopSession(taskId: string): Promise<unknown>;
  onBlocks(listener: (blocks: RenderBlock[]) => void): () => void;
  onMessage(listener: (content: string) => void): () => void;
  onSessionStateChange(listener: (active: boolean) => void): () => void;
}

export interface PiViewOptions {
  /** Render the follow/clear/stop action bar. Default true. */
  showFooter?: boolean;
  /** Start with follow-mode auto-scroll enabled. Default true. */
  followInitially?: boolean;
  /**
   * Start with `tool`/`verification` blocks collapsed, showing only their
   * headers. Newly rendered blocks follow this state. Default false (expanded).
   */
  blocksCollapsedInitially?: boolean;
  /**
   * Tailwind height class for the log area, so embedded use (e.g. a sidebar)
   * can be more compact than the modal default. Default 'h-[60vh]'.
   */
  logHeightClass?: string;
  /**
   * When true, the log area can be resized vertically by dragging its bottom
   * edge, so an embedding host can let the user tune the height to fit. The
   * initial {@link logHeightClass} still applies until the first resize; width
   * is never resizable. Default false.
   */
  resizable?: boolean;
  /**
   * Optional action button rendered in the empty-state placeholder that shows
   * when the log has no content and no session is running.
   */
  emptyStateAction?: EmptyStateAction;
  /**
   * Configurable keyboard shortcuts mapping a logical action name to a key
   * string (e.g. 'f', 'ctrl+c', 'shift+N', '/'). These are merged over the
   * defaults, so you only need to provide the bindings you want to change.
   * Supported action names:
   * 'toggle-follow' | 'copy-all-log' | 'focus-search' | 'next-error' |
   * 'prev-error' | 'clear-logs' | 'stop-bot' | 'toggle-thinking' |
   * 'toggle-block-collapse' | 'toggle-error-visibility' | 'toggle-search' |
   * 'open-dialog'.
   */
  keyboardBindings?: Record<string, string>;
  /**
   * When true, the initial (potentially large) session history is rendered into
   * the DOM on the next animation frame instead of synchronously during
   * `render()`. This lets an embedding page (e.g. a pipeline detail view whose
   * sidebar already has a completed session loaded in memory) paint its layout
   * with the placeholder immediately, then fill in the log on the following
   * frame. Default false (renders synchronously, as before).
   */
  deferInitialRender?: boolean;

  /**
   * Automatically render completed `text` blocks (the assistant's visible
   * answer) as sanitized styled Markdown HTML. Streaming/`thinking`/`tool`/…
   * blocks are never auto-formatted; they keep their raw rendering unless the
   * user clicks "Format as markup". Default true.
   */
  autoFormatText?: boolean;

  /**
   * Optional callback invoked when the user activates the "Open in Dialog"
   * action (via its toolbar button or its keyboard shortcut). An embedding host
   * uses this to open the full-size dialog around this log (e.g. the
   * `CoderBotDialog`). When omitted, the "Open in Dialog" button is not
   * rendered and the shortcut is a no-op.
   */
  onOpenDialog?: () => void;
}

/** A button shown inside the empty-state placeholder. */
export interface EmptyStateAction {
  label: string;
  onClick: () => void;
}

/**
 * A self-contained, reusable DOM view that renders a live Pi activity log
 * (the terminal-style black/green log area, plus the footer action row).
 *
 * It owns all block reconciliation, block-type DOM creation/updating,
 * follow-mode auto-scroll, and stop/clear actions. Dialog framing (header,
 * backdrop, close button) is intentionally NOT part of this view so it can be
 * embedded anywhere a Pi activity log is needed.
 */
export class PiView {
  private service: PiSessionService;
  private root: HTMLElement;
  private logContainer: HTMLElement | null = null;
  private blocksContainer: HTMLElement | null = null;
  private blockEls: Map<string, HTMLElement> = new Map();
  private isFollowMode: boolean;
  private showFooter: boolean;
  private logHeightClass: string;
  private resizable: boolean;
  private deferInitialRender: boolean;
  private onOpenDialog?: () => void;
  private unsubs: (() => void)[] = [];

  /**
   * Pending `requestAnimationFrame` handle for a deferred initial render. While
   * non-null, the initial history has not been flushed to the DOM yet and live
   * block snapshots are coalesced into `pendingBlocks` to avoid a synchronous
   * re-render that would defeat the deferral.
   */
  private renderFrameHandle: number | null = null;
  /** Latest block snapshot received while an initial render was still pending. */
  private pendingBlocks: RenderBlock[] | null = null;

  /** Whether `thinking` blocks are expanded (default: expanded). */
  private thinkingExpanded: boolean = true;

  /** Whether `tool`/`verification` blocks are collapsed (default: expanded). */
  private blocksCollapsed: boolean = false;

  /** Whether `error` blocks are visible (default: visible). */
  private errorVisible: boolean = true;

  /** Live-session status/timer state. */
  private sessionActive: boolean = false;
  private startTime: number | null = null;
  private elapsedMs: number = 0;
  private timerHandle: number | null = null;
  private hasRunSession: boolean = false;

  /** Empty-state placeholder and the "Session ended" completion line. */
  private emptyStateEl: HTMLElement | null = null;
  private sessionEndedEl: HTMLElement | null = null;
  private emptyStateAction?: EmptyStateAction;

  /** Timestamp (ms) recorded when each block was first rendered. */
  private blockTimestamps: Map<string, number> = new Map();
  private copyToastTimer: number | null = null;

  /** Whether the in-log search bar is hidden (collapsed). Default: collapsed. */
  private searchCollapsed: boolean = true;

  /** Configurable keyboard shortcut map (merged over defaults). */
  private keyboardBindings: Record<string, string>;

  /** Resolved `action -> key` mapping used to annotate toolbar tooltips. */
  private actionToKey: Record<string, string> = {};

  /** Current human-readable label per action, kept in sync with button state. */
  private buttonLabels: Record<string, string> = {};

  /** In-log search state. */
  private searchQuery: string = '';
  private debounceTimer: number | null = null;
  /** Ordered list of highlighted match elements currently in the DOM. */
  private searchMatches: HTMLElement[] = [];
  /** Index of the currently-selected match (-1 when no matches exist). */
  private currentMatch: number = -1;

  /** Index of the currently-selected error block (-1 when none selected). */
  private currentErrorIndex: number = -1;

  /** Ordered list of error block elements currently in the DOM. */
  private errorEls: HTMLElement[] = [];

  /**
   * IDs of blocks that have been converted to styled Markdown HTML via the
   * per-block "Format as markup" button.
   */
  private formattedBlocks: Set<string> = new Set();

  /**
   * Snapshot of a formatted block's original content nodes (header/body/etc.,
   * excluding the action buttons) so they can be restored when the user toggles
   * the Markdown rendering back off.
   */
  private formattedContent: Map<string, Node[]> = new Map();

  /** Raw (unrendered) text captured per formatted block, used for re-rendering. */
  private formattedRawText: Map<string, string> = new Map();

  /** Whether completed `text` blocks are auto-rendered as Markdown. */
  private autoFormatText: boolean;

  /**
   * IDs of `text` blocks the user explicitly switched back to raw. Prevents a
   * later snapshot (or completion) from silently re-formatting them. Cleared
   * when the user re-enables formatting or the block is removed.
   */
  private rawTextOverride: Set<string> = new Set();

  /**
   * Completed `text` blocks waiting to be auto-formatted. Drained on an idle
   * callback (with a small per-callback budget) so replaying a long session
   * does not run `marked.parse` + DOMPurify for every block in a single frame.
   */
  private pendingAutoFormat: string[] = [];
  private autoFormatHandle: number | null = null;
  private autoFormatScheduled: boolean = false;

  /**
   * Latest block snapshot per id, kept in sync by {@link applyBlock}. Lets the
   * deferred auto-format drain look up a block without re-reading the whole
   * history and without depending on the service exposing the same objects.
   */
  private blockById: Map<string, RenderBlock> = new Map();

  constructor(service: PiSessionService, mount: HTMLElement, options: PiViewOptions = {}) {
    this.service = service;
    this.root = mount;
    this.showFooter = options.showFooter ?? true;
    this.isFollowMode = options.followInitially ?? true;
    this.blocksCollapsed = options.blocksCollapsedInitially ?? false;
    this.logHeightClass = options.logHeightClass ?? 'h-[60vh]';
    this.resizable = options.resizable ?? false;
    this.deferInitialRender = options.deferInitialRender ?? false;
    this.autoFormatText = options.autoFormatText ?? true;
    this.emptyStateAction = options.emptyStateAction;
    this.onOpenDialog = options.onOpenDialog;
    this.keyboardBindings = options.keyboardBindings ?? {};
    // Build the action->key lookup once, after overrides are merged over defaults.
    this.actionToKey = this.buildBindings();
  }

  /** The element the PiView was mounted into. */
  getRoot(): HTMLElement {
    return this.root;
  }

  /**
   * Renders the log area + footer into `mount` and starts subscriptions.
   */
  render(): void {
    this.root.appendChild(this.buildLogArea());
    // Delegate action clicks on the root so the handler is always attached,
    // regardless of whether the footer is rendered (per-block and toolbar
    // buttons all live under the root).
    this.root.addEventListener('click', this.handleClick);
    this.unsubs.push(() => this.root.removeEventListener('click', this.handleClick));
    if (this.showFooter) {
      this.root.appendChild(this.buildFooter());
      this.updateThinkingBtn();
      this.updateCollapseBtn();
      this.updateErrorBtn();
    }
    this.initKeyBindings();
    this.updateButtonTooltips();
    this.initLogDisplay();
    this.initStateSync();
  }

  /**
   * Unsubscribes from the service and detaches listeners.
   */
  destroy(): void {
    // Cancel a deferred initial render that hasn't fired yet so we never render
    // into DOM that is being torn down.
    if (this.renderFrameHandle !== null) {
      cancelAnimationFrame(this.renderFrameHandle);
      this.renderFrameHandle = null;
    }
    this.pendingBlocks = null;
    if (this.autoFormatHandle !== null) {
      this.cancelScheduledAutoFormat();
    }
    this.pendingAutoFormat = [];
    this.unsubs.forEach((unsub) => {
      try {
        unsub();
      } catch (e) {
        console.error('PiView: error tearing down subscription', e);
      }
    });
    this.unsubs = [];
    this.stopStatusTimer();
    if (this.copyToastTimer !== null) {
      window.clearTimeout(this.copyToastTimer);
      this.copyToastTimer = null;
    }
    if (this.debounceTimer !== null) {
      window.clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // DOM construction
  // ---------------------------------------------------------------------------

  private buildLogArea(): HTMLElement {
    const container = document.createElement('div');
    container.id = 'log-content-container';
    // `resize-y` needs overflow other than `visible`; the log already scrolls
    // vertically, and `overflow-x-hidden` keeps the resize handle reliable in
    // browsers that require both axes to be non-visible (the log wraps text, so
    // no horizontal scrollbar is lost).
    const resizeClass = this.resizable ? 'resize-y overflow-x-hidden' : '';
    container.className =
      `piview-log relative bg-black text-green-400 px-4 pb-4 font-mono text-[11px] leading-tight overflow-y-auto ${resizeClass} ${this.logHeightClass} custom-scrollbar selection:bg-app-accent-1/30`;
    const statusBar = document.createElement('div');
    statusBar.id = 'piview-status-bar';
    statusBar.className = 'sticky top-0 z-10 bg-black/95 border-b border-app-border/40 px-1 pb-1 mb-1 flex items-center gap-2';
    statusBar.setAttribute('aria-live', 'polite');
    const dot = document.createElement('span');
    dot.id = 'piview-status-dot';
    dot.setAttribute('aria-hidden', 'true');
    dot.className = 'inline-block w-2 h-2 rounded-full bg-app-text/40';
    statusBar.appendChild(dot);
    const text = document.createElement('span');
    text.id = 'piview-status-text';
    text.className = 'text-green-300';
    text.textContent = 'Session idle';
    statusBar.appendChild(text);
    container.appendChild(statusBar);
    const toast = document.createElement('div');
    toast.id = 'piview-toast';
    toast.className =
      'absolute top-1 right-1 z-20 px-2 py-1 rounded text-[10px] pointer-events-none bg-app-accent-1 text-white opacity-0 transition-opacity';
    container.appendChild(toast);
    const blocks = document.createElement('div');
    blocks.id = 'log-blocks';
    blocks.className = LOG_BLOCK_SPACING_CLASS;
    container.appendChild(blocks);

    // Empty-state placeholder shown when there are no logs and no active session.
    const emptyState = document.createElement('div');
    emptyState.id = 'piview-empty-state';
    emptyState.setAttribute('role', 'status');
    emptyState.setAttribute('aria-live', 'polite');
    emptyState.className =
      'flex flex-col items-center justify-center text-center gap-1.5 py-10 px-4 text-app-text/50';
    const emptyIcon = document.createElement('span');
    emptyIcon.setAttribute('aria-hidden', 'true');
    emptyIcon.className = 'text-app-text/40 mb-1';
    emptyIcon.innerHTML = this.cleanIcon(Icon.render('clock', { size: 32 }));
    emptyState.appendChild(emptyIcon);
    const emptyTitle = document.createElement('p');
    emptyTitle.id = 'piview-empty-title';
    emptyTitle.className = 'text-sm font-medium text-app-text/70';
    emptyTitle.textContent = 'No active session…';
    emptyState.appendChild(emptyTitle);
    const emptySub = document.createElement('p');
    emptySub.className = 'text-xs';
    emptySub.textContent = 'When a bot starts, its activity log will appear here.';
    emptyState.appendChild(emptySub);
    if (this.emptyStateAction) {
      const action = document.createElement('button');
      action.id = 'piview-empty-state-action';
      action.type = 'button';
      action.className =
        'mt-2 px-3 py-1.5 rounded text-xs font-medium bg-app-accent-1 text-white hover:bg-app-accent-1/80 transition-colors flex items-center gap-1.5 cursor-pointer';
      action.innerHTML = `${this.cleanIcon(Icon.render('lightning', { size: 14 }))}
            ${this.emptyStateAction.label}`;
      action.addEventListener('click', () => this.emptyStateAction?.onClick());
      emptyState.appendChild(action);
    }
    this.emptyStateEl = emptyState;
    container.appendChild(emptyState);

    // Distinct "Session ended" completion line shown after a session finishes.
    const sessionEnded = document.createElement('div');
    sessionEnded.id = 'piview-session-ended';
    sessionEnded.setAttribute('role', 'status');
    sessionEnded.setAttribute('aria-live', 'polite');
    sessionEnded.className =
      'flex items-center gap-2 text-green-400 font-semibold text-xs py-1.5';
    const endedIcon = document.createElement('span');
    endedIcon.innerHTML = this.cleanIcon(Icon.render('check', { size: 14, label: 'Session ended' }));
    sessionEnded.appendChild(endedIcon);
    const endedText = document.createElement('span');
    endedText.id = 'piview-session-ended-text';
    endedText.textContent = 'Session ended';
    sessionEnded.appendChild(endedText);
    this.sessionEndedEl = sessionEnded;
    container.appendChild(sessionEnded);

    return container;
  }

  private buildFooter(): HTMLElement {
    const footer = document.createElement('div');
    footer.className =
      'p-3 border-t border-app-border flex flex-col gap-2 bg-app-surface/50';
    footer.appendChild(this.buildSearchBar());

    const actionsRow = document.createElement('div');
    actionsRow.className = 'flex justify-between items-center';
    const actions = document.createElement('div');
    actions.className = 'flex gap-2';

    const followBtn = this.createButton(
      'toggle-follow',
      'Follow Mode: ON',
      `${Icon.render('refresh', { size: 14 })}\n            Follow Mode: ON`,
      'px-3 py-1.5 rounded text-xs font-medium bg-app-accent-1 text-white hover:bg-app-accent-1/80 transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer',
      { id: 'follow-btn' }
    );
    actions.appendChild(followBtn);

    const clearBtn = this.createButton(
      'clear-logs',
      'Clear',
      `${Icon.render('trash', { size: 14 })}\n            Clear`,
      'px-3 py-1.5 rounded text-xs font-medium bg-app-surface border border-app-border text-app-text hover:bg-app-bg transition-colors flex items-center gap-1.5 cursor-pointer'
    );
    actions.appendChild(clearBtn);

    const stopBtn = this.createButton(
      'stop-bot',
      'Stop Bot',
      `${Icon.render('close', { size: 14 })}\n            Stop Bot`,
      'px-3 py-1.5 rounded text-xs font-medium bg-red-600 text-white hover:bg-red-700 transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer hidden',
      { id: 'stop-bot-btn' }
    );
    actions.appendChild(stopBtn);

    const thinkingBtn = this.createButton(
      'toggle-thinking',
      'Expand all thinking blocks',
      Icon.render('chevronRight', { size: 14 }),
      'px-2 py-1.5 rounded text-xs font-medium bg-app-surface border border-app-border text-app-text hover:bg-app-bg transition-colors flex items-center gap-1.5 cursor-pointer',
      { id: 'thinking-toggle-btn', ariaPressed: false }
    );
    actions.appendChild(thinkingBtn);

    const collapseBtn = this.createButton(
      'toggle-block-collapse',
      'Collapse all blocks',
      Icon.render('minus', { size: 14 }),
      'px-2 py-1.5 rounded text-xs font-medium bg-app-surface border border-app-border text-app-text hover:bg-app-bg transition-colors flex items-center gap-1.5 cursor-pointer',
      { id: 'collapse-blocks-btn', ariaPressed: false }
    );
    actions.appendChild(collapseBtn);

    const errorToggleBtn = this.createButton(
      'toggle-error-visibility',
      'Hide error blocks',
      Icon.render('eye', { size: 14 }),
      'px-2 py-1.5 rounded text-xs font-medium bg-app-surface border border-app-border text-app-text hover:bg-app-bg transition-colors flex items-center gap-1.5 cursor-pointer',
      { id: 'error-toggle-btn', ariaPressed: true }
    );
    actions.appendChild(errorToggleBtn);

    const prevErrorBtn = this.createButton(
      'prev-error',
      'Previous error',
      `<span class="flex items-center">${this.cleanIcon(
        Icon.render('alert', { size: 14, className: 'rotate-180' })
      )}</span>`,
      'px-2 py-1.5 rounded text-xs font-medium bg-app-surface border border-app-border text-app-text hover:bg-app-bg transition-colors flex items-center cursor-pointer disabled:opacity-40 disabled:cursor-default',
      { id: 'prev-error-btn', disabled: true }
    );
    actions.appendChild(prevErrorBtn);

    const nextErrorBtn = this.createButton(
      'next-error',
      'Next error',
      `<span class="flex items-center">${this.cleanIcon(Icon.render('alert', { size: 14 }))}</span>`,
      'px-2 py-1.5 rounded text-xs font-medium bg-app-surface border border-app-border text-app-text hover:bg-app-bg transition-colors flex items-center cursor-pointer disabled:opacity-40 disabled:cursor-default',
      { id: 'next-error-btn', disabled: true }
    );
    actions.appendChild(nextErrorBtn);

    // Right-aligned group of footer buttons, ordered left-to-right: the
    // "Open in Dialog" button, the "Copy entire log" button, and the search
    // toggle. Move them out of the left-side action group so the frequently used
    // actions are grouped together on the right edge of the action bar.
    const rightActions = document.createElement('div');
    rightActions.className = 'flex gap-2';

    // "Open in Dialog" action: lets an embedding host pop this compact log out
    // into a full-size dialog (e.g. the CoderBotDialog). Only rendered when the
    // host supplies an `onOpenDialog` callback. The button shows only an icon;
    // the "Open in Dialog" label is conveyed via its tooltip/aria-label.
    if (this.onOpenDialog) {
      const openDialogBtn = this.createButton(
        'open-dialog',
        'Open in Dialog',
        this.cleanIcon(Icon.render('documentation', { size: 14, label: 'Open in Dialog' })),
        'px-2 py-1.5 rounded text-xs font-medium bg-app-surface border border-app-border text-app-text hover:bg-app-bg transition-colors flex items-center justify-center cursor-pointer',
        { id: 'open-dialog-btn' }
      );
      rightActions.appendChild(openDialogBtn);
    }

    const copyAllBtn = this.createButton(
      'copy-all-log',
      'Copy entire log',
      Icon.render('copyRects', { size: 14, label: 'Copy entire log' }),
      'px-2 py-1.5 rounded text-xs font-medium bg-app-surface border border-app-border text-app-text hover:bg-app-bg transition-colors flex items-center gap-1.5 cursor-pointer',
      { id: 'copy-all-btn' }
    );
    rightActions.appendChild(copyAllBtn);

    const searchToggleBtn = this.createButton(
      'toggle-search',
      'Show search bar',
      this.cleanIcon(Icon.render('search', { size: 14 })),
      'px-2 py-1.5 rounded text-xs font-medium bg-app-surface border border-app-border text-app-text hover:bg-app-bg transition-colors flex items-center gap-1.5 cursor-pointer',
      { id: 'search-toggle-btn', ariaPressed: false }
    );
    rightActions.appendChild(searchToggleBtn);

    // Main action buttons on the left, the (open-dialog / copy / search)
    // group right-aligned.
    actionsRow.appendChild(actions);
    actionsRow.appendChild(rightActions);

    footer.appendChild(actionsRow);

    return footer;
  }

  /**
   * Toolbar button factory used by `buildFooter`. Generates a `<button>` with a
   * `data-action` attribute and a hover tooltip (and `aria-label`) in the form
   * `Label (Shortcut)` when a key is bound to the action.
   */
  private createButton(
    action: string,
    label: string,
    icon: string,
    className: string,
    opts: { id?: string; ariaPressed?: boolean; disabled?: boolean } = {}
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('data-action', action);
    if (opts.id) btn.id = opts.id;
    btn.className = className;
    if (opts.disabled) btn.disabled = true;
    if (opts.ariaPressed !== undefined) btn.setAttribute('aria-pressed', String(opts.ariaPressed));
    this.buttonLabels[action] = label;
    this.applyTooltip(btn, action, label);
    btn.innerHTML = icon;
    return btn;
  }

  /** Sets `title` and `aria-label` to `Label (Shortcut)` when a key exists. */
  private applyTooltip(btn: HTMLElement, action: string, label: string) {
    const key = this.getKeyForAction(action);
    const text = key ? `${label} (${key})` : label;
    btn.title = text;
    btn.setAttribute('aria-label', text);
  }

  /** Re-applies the tooltip for a single action's toolbar button. */
  private updateButtonTooltip(action: string) {
    const btn = this.root.querySelector(`[data-action="${action}"]`);
    const label = this.buttonLabels[action];
    if (!btn || !label) return;
    this.applyTooltip(btn as HTMLElement, action, label);
  }

  /** Re-applies tooltips for every tracked toolbar button. */
  private updateButtonTooltips() {
    for (const action of Object.keys(this.buttonLabels)) {
      this.updateButtonTooltip(action);
    }
  }

  /**
   * Rebuilds the action->key mapping (honoring any updated `keyboardBindings`)
   * and refreshes the toolbar tooltip/`aria-label` annotations. Useful when the
   * shortcut map may be reconfigured at runtime.
   */
  refreshTooltips() {
    this.actionToKey = this.buildBindings();
    this.updateButtonTooltips();
  }

  private buildSearchBar(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.id = 'piview-search-bar';
    wrap.setAttribute('role', 'search');
    // Collapsed by default; toggled via the search icon in the action bar.
    wrap.className = this.searchCollapsed
      ? 'hidden flex items-center gap-1.5 flex-wrap'
      : 'flex items-center gap-1.5 flex-wrap';

    const label = document.createElement('label');
    label.setAttribute('for', 'piview-search-input');
    label.className = 'flex items-center text-app-text/50';
    label.innerHTML = this.cleanIcon(Icon.render('search', { size: 12 }));
    wrap.appendChild(label);

    const input = document.createElement('input');
    input.id = 'piview-search-input';
    input.type = 'search';
    input.placeholder = 'Search log…';
    input.setAttribute('aria-label', 'Search log');
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.className =
      'w-full sm:w-52 px-2 py-1 rounded text-xs bg-black/40 border border-app-border text-green-300 placeholder:text-app-text/40 focus:outline-none focus:border-app-accent-1/60';
    input.addEventListener('input', this.handleSearchInput);
    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) this.previousMatch();
        else this.nextMatch();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        input.value = '';
        if (this.debounceTimer !== null) {
          window.clearTimeout(this.debounceTimer);
          this.debounceTimer = null;
        }
        this.setSearchQuery('');
        input.blur();
      }
    });
    wrap.appendChild(input);

    const prevBtn = document.createElement('button');
    prevBtn.type = 'button';
    prevBtn.id = 'piview-search-prev';
    prevBtn.title = 'Previous match';
    prevBtn.setAttribute('aria-label', 'Previous match');
    prevBtn.className =
      'px-2 py-1 rounded text-xs font-medium bg-app-surface border border-app-border text-app-text hover:bg-app-bg transition-colors flex items-center cursor-pointer disabled:opacity-40 disabled:cursor-default';
    prevBtn.innerHTML = this.cleanIcon(
      Icon.render('chevronDown', { size: 14, className: 'rotate-180' })
    );
    prevBtn.addEventListener('click', () => this.previousMatch());
    wrap.appendChild(prevBtn);

    const nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.id = 'piview-search-next';
    nextBtn.title = 'Next match';
    nextBtn.setAttribute('aria-label', 'Next match');
    nextBtn.className =
      'px-2 py-1 rounded text-xs font-medium bg-app-surface border border-app-border text-app-text hover:bg-app-bg transition-colors flex items-center cursor-pointer disabled:opacity-40 disabled:cursor-default';
    nextBtn.innerHTML = this.cleanIcon(Icon.render('chevronDown', { size: 14 }));
    nextBtn.addEventListener('click', () => this.nextMatch());
    wrap.appendChild(nextBtn);

    const counter = document.createElement('span');
    counter.id = 'piview-search-count';
    counter.className = 'text-xs text-app-text/50 tabular-nums';
    counter.setAttribute('role', 'status');
    counter.setAttribute('aria-live', 'polite');
    counter.textContent = '0 / 0';
    wrap.appendChild(counter);

    return wrap;
  }

  private handleClick = (e: Event): void => {
    const target = e.target as HTMLElement;
    // Individual collapsible block header toggles its own body.
    const header = target.closest('[data-role="header"][data-toggle]');
    if (header) {
      const collapsible = (header as HTMLElement).parentElement;
      if (collapsible) {
        this.toggleBlockCollapse(collapsible);
      }
      return;
    }
    // Per-block copy button.
    const copyBlockBtn = target.closest('[data-copy-block]');
    if (copyBlockBtn) {
      const id = (copyBlockBtn as HTMLElement).getAttribute('data-copy-block') ?? '';
      this.copyBlock(id);
      return;
    }
    // Per-block "Format as markup" button.
    const formatBlockBtn = target.closest('[data-format-block]');
    if (formatBlockBtn) {
      const id = (formatBlockBtn as HTMLElement).getAttribute('data-format-block') ?? '';
      this.toggleFormatBlock(id);
      return;
    }
    const actionBtn = target.closest('[data-action]');
    if (!actionBtn) return;
    const action = actionBtn.getAttribute('data-action');
    if (action === 'clear-logs') {
      this.service.clearHistory();
    } else if (action === 'toggle-follow') {
      this.toggleFollow();
    } else if (action === 'stop-bot') {
      this.stopBot();
    } else if (action === 'toggle-thinking') {
      this.toggleThinking();
    } else if (action === 'toggle-block-collapse') {
      this.toggleBlocksCollapse();
    } else if (action === 'toggle-error-visibility') {
      this.toggleErrorVisibility();
    } else if (action === 'prev-error') {
      this.prevError();
    } else if (action === 'next-error') {
      this.nextError();
    } else if (action === 'toggle-search') {
      this.toggleSearchBar();
    } else if (action === 'copy-all-log') {
      this.copyAllLog();
    } else if (action === 'open-dialog') {
      this.onOpenDialog?.();
    }
  };

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------------

  /** Merges default shortcut map with user-provided overrides. */
  private buildBindings(): Record<string, string> {
    const defaults: Record<string, string> = {
      'toggle-follow': 'f',
      'copy-all-log': 'c',
      'focus-search': '/',
      'next-error': 'n',
      'prev-error': 'N',
      'clear-logs': 'x',
      'stop-bot': 's',
      'toggle-thinking': 't',
      'toggle-block-collapse': 'b',
      'toggle-error-visibility': 'e',
      'toggle-search': 'k',
      'open-dialog': 'o',
    };
    return { ...defaults, ...this.keyboardBindings };
  }

  /** Returns the resolved key string for a logical action, if one is bound. */
  private getKeyForAction(action: string): string | undefined {
    return this.actionToKey[action];
  }

  /**
   * Registers the configurable keyboard shortcut map (defaults merged with
   * user overrides) against a scoped `KeybindingManager` and schedules its
   * teardown when the view is destroyed.
   */
  private initKeyBindings() {
    const kb = new KeybindingManager(this.root);
    const bindings = this.actionToKey;
    Object.entries(bindings).forEach(([action, key]) => {
      kb.register({ key, action, handler: () => this.invokeBinding(action) });
    });
    this.unsubs.push(() => kb.destroy());
  }

  /** Dispatches a logical action and flashes the corresponding button. */
  private invokeBinding(action: string) {
    switch (action) {
      case 'toggle-follow':
        this.toggleFollow();
        break;
      case 'copy-all-log':
        this.copyAllLog();
        break;
      case 'focus-search':
        this.focusSearch();
        break;
      case 'next-error':
        this.nextError();
        break;
      case 'prev-error':
        this.prevError();
        break;
      case 'clear-logs':
        this.service.clearHistory();
        break;
      case 'stop-bot':
        this.stopBot();
        break;
      case 'toggle-thinking':
        this.toggleThinking();
        break;
      case 'toggle-block-collapse':
        this.toggleBlocksCollapse();
        break;
      case 'toggle-error-visibility':
        this.toggleErrorVisibility();
        break;
      case 'toggle-search':
        this.toggleSearchBar();
        break;
      case 'open-dialog':
        this.onOpenDialog?.();
        break;
      default:
        return;
    }
    this.flashButton(action);
  }

  /** Temporarily flashes a toolbar button to indicate the shortcut fired. */
  private flashButton(action: string) {
    const btn = this.root.querySelector(`[data-action="${action}"]`);
    if (!btn) return;
    btn.classList.add('shortcut-active');
    window.setTimeout(() => btn.classList.remove('shortcut-active'), 200);
  }

  /** Expands (if needed) and focuses the in-log search input. */
  private focusSearch() {
    if (this.searchCollapsed) this.toggleSearchBar();
    const input = this.root.querySelector('#piview-search-input') as HTMLInputElement | null;
    input?.focus();
  }

  // ---------------------------------------------------------------------------
  // In-log search / find
  // ---------------------------------------------------------------------------

  private handleSearchInput = (e: Event): void => {
    const input = e.target as HTMLInputElement;
    const query = input.value;
    if (this.debounceTimer !== null) window.clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => {
      this.debounceTimer = null;
      this.setSearchQuery(query);
    }, 200);
  };

  private setSearchQuery(query: string) {
    this.searchQuery = query;
    this.renderSearchHighlights();
    this.currentMatch = this.searchMatches.length > 0 ? 0 : -1;
    this.styleCurrentMatch();
    this.updateSearchCounter();
  }

  /**
   * Clears existing highlights and re-applies them based on the current query.
   * Rebuilt from scratch so it always stays in sync with the current DOM
   * (incl. newly added log entries or updated blocks).
   */
  private renderSearchHighlights() {
    this.clearSearchHighlights();
    this.searchMatches = [];
    if (!this.blocksContainer || !this.searchQuery) return;
    this.applyHighlights(this.blocksContainer, this.searchQuery);
  }

  /** Unwraps existing `<mark>` highlights, preserving the original text. */
  private clearSearchHighlights() {
    if (!this.blocksContainer) return;
    this.blocksContainer.querySelectorAll('mark.piview-search-match').forEach((m) => {
      const parent = m.parentNode;
      const text = m.textContent ?? '';
      parent?.insertBefore(document.createTextNode(text), m);
      parent?.removeChild(m);
      parent?.normalize();
    });
  }

  /** Walks the tree and wraps every query occurrence in a highlight <mark>. */
  private applyHighlights(root: HTMLElement, query: string) {
    const lq = query.toLowerCase();
    const textNodes: Text[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node: Node | null = walker.nextNode();
    while (node) {
      // Skip pure-whitespace nodes to avoid wrapping separators awkwardly.
      const c = (node.textContent ?? '').trim();
      if (c !== '') textNodes.push(node as Text);
      node = walker.nextNode();
    }
    for (const textNode of textNodes) {
      const content = textNode.textContent ?? '';
      const lower = content.toLowerCase();
      let idx = lower.indexOf(lq);
      if (idx === -1) continue;
      const parent = textNode.parentNode;
      if (!parent) continue;
      let start = 0;
      while (idx !== -1) {
        const before = content.slice(start, idx);
        const match = content.slice(idx, idx + query.length);
        const tail = idx + query.length;
        if (before) parent.insertBefore(document.createTextNode(before), textNode);
        const mark = document.createElement('mark');
        mark.className = 'piview-search-match';
        mark.textContent = match;
        parent.insertBefore(mark, textNode);
        this.searchMatches.push(mark);
        start = tail;
        idx = lower.indexOf(lq, start);
      }
      const remaining = content.slice(start);
      if (remaining) parent.insertBefore(document.createTextNode(remaining), textNode);
      parent.removeChild(textNode);
    }
  }

  /** Re-applies highlights after content changes (e.g. new log entries added). */
  private refreshSearchForNewContent() {
    if (!this.searchQuery) return;
    this.renderSearchHighlights();
    const total = this.searchMatches.length;
    if (this.currentMatch >= total) {
      this.currentMatch = total > 0 ? total - 1 : -1;
    }
    this.styleCurrentMatch();
    this.updateSearchCounter();
  }

  private nextMatch() {
    const total = this.searchMatches.length;
    if (total === 0) return;
    this.goToMatch((this.currentMatch + 1 + total) % total);
  }

  private previousMatch() {
    const total = this.searchMatches.length;
    if (total === 0) return;
    this.goToMatch((this.currentMatch - 1 + total) % total);
  }

  private goToMatch(index: number) {
    const el = this.searchMatches[index];
    if (!el) return;
    this.currentMatch = index;
    this.styleCurrentMatch();
    this.updateSearchCounter();
    this.ensureVisible(el);
  }

  private styleCurrentMatch() {
    this.searchMatches.forEach((m, i) => {
      m.classList.toggle('piview-search-current', i === this.currentMatch);
    });
  }

  private updateSearchCounter() {
    const counter = this.root.querySelector('#piview-search-count');
    if (!counter) return;
    const total = this.searchMatches.length;
    const current = total > 0 ? this.currentMatch + 1 : 0;
    counter.textContent = `${current} / ${total}`;
  }

  /** Scrolls the given element into the log container's visible area. */
  private ensureVisible(el: HTMLElement) {
    const container = this.logContainer;
    if (!container || !el) return;
    const containerRect = container.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const relTop = elRect.top - containerRect.top;
    const relBottom = elRect.bottom - containerRect.top;
    const viewH = Math.max(1, container.clientHeight || elRect.height);
    const padding = 8;
    const currentScroll = container.scrollTop;
    let nextScroll = currentScroll;
    if (relTop < padding) {
      nextScroll = currentScroll + (relTop - padding);
    } else if (relBottom > viewH - padding) {
      nextScroll = currentScroll + (relBottom - (viewH - padding));
    }
    container.scrollTop = nextScroll;
  }

  // ---------------------------------------------------------------------------
  // Log display / reconciliation
  // ---------------------------------------------------------------------------

  private initLogDisplay() {
    this.logContainer = this.root.querySelector('#log-content-container');
    this.blocksContainer = this.root.querySelector('#log-blocks');
    if (!this.blocksContainer || !this.logContainer) return;

    if (this.deferInitialRender) {
      // When embedding a PiView into a page (e.g. the pipeline detail sidebar)
      // whose session history is already loaded in memory, rendering every block
      // synchronously here blocks the surrounding page layout. Defer the initial
      // (potentially expensive) render so the enclosing view paints its layout
      // with the placeholder first, then fills in the log on the next animation
      // frame. Live snapshots arriving before that flush are coalesced.
      this.scheduleRenderFrame();
    } else {
      // Non-embedded usages (e.g. the CoderBotDialog) render synchronously so the
      // dialog shows the log immediately on open.
      this.renderCurrentState();
    }

    this.unsubs.push(
      this.service.onBlocks((blocks) => {
        this.reconcile(blocks);
      })
    );
  }

  /**
   * Schedules a single reconciliation on the next animation frame, coalescing
   * every block snapshot that arrives before then into one pass. This keeps a
   * burst of streamed token updates from triggering one full reconciliation of
   * the whole (growing) log per token - i.e. O(events x blocks) - and also lets
   * the browser paint between bursts. While a deferred initial render is pending
   * no extra frame is scheduled; the pending snapshot is folded into it.
   */
  private scheduleRenderFrame() {
    if (this.renderFrameHandle !== null) return;
    this.renderFrameHandle = requestAnimationFrame(() => {
      this.renderFrameHandle = null;
      if (this.pendingBlocks) {
        const blocks = this.pendingBlocks;
        this.pendingBlocks = null;
        this.reconcileNow(blocks);
        return;
      }
      // No snapshot arrived while waiting: this is the deferred initial render.
      this.renderCurrentState();
    });
  }

  /**
   * Renders whatever blocks are currently known into an empty log. Used only for
   * the initial render (synchronous for dialogs, or on the deferred frame for
   * embedded use). Subsequent updates flow through {@link reconcile}.
   */
  private renderCurrentState() {
    const history = this.service.getHistory();
    history.forEach((block) => this.applyBlock(block));
    this.updateEmptyState();
    this.refreshErrorList();
    this.scrollToBottom();
  }

  private initStateSync() {
    // Initial state
    const active = this.service.isActive();
    this.updateStopButtonVisibility(active);
    this.syncSessionState(active);

    // Resume the "Running since" timer from the session's actual start time
    // (captured server-side) rather than from the moment this PiView was created,
    // so re-attaching to a running session keeps the real elapsed time.
    const start = this.service.getSessionStartTime();
    if (start !== null && active) {
      this.setStartTimeReference(start);
    }

    // Subscribe to state changes
    this.unsubs.push(
      this.service.onSessionStateChange((active) => {
        this.updateStopButtonVisibility(active);
        this.syncSessionState(active);
      })
    );

    // When the server-reported start time is loaded asynchronously (e.g. history
    // fetched on mount), adopt it so the displayed elapsed time resumes correctly.
    this.unsubs.push(
      this.service.onSessionStartTimeChange((start) => {
        if (start !== null && this.sessionActive) {
          this.setStartTimeReference(start);
        }
      })
    );
  }

  private reconcile(blocks: RenderBlock[]) {
    // Always coalesce into the next animation frame. Snapshots arrive once per
    // streamed token; diffing the full log on every one of them is O(n^2) over a
    // session. Batching them means at most one reconciliation pass per frame,
    // regardless of how many updates landed in between.
    this.pendingBlocks = blocks;
    this.scheduleRenderFrame();
  }

  private reconcileNow(blocks: RenderBlock[]) {
    // Remove blocks that have been dropped (e.g. after clearHistory).
    const seen = new Set(blocks.map((b) => b.id));
    for (const [id, el] of this.blockEls) {
      if (!seen.has(id)) {
        el.remove();
        this.blockEls.delete(id);
        this.blockTimestamps.delete(id);
        this.blockById.delete(id);
        // Drop any Markdown-formatting state for the removed block.
        this.formattedBlocks.delete(id);
        this.formattedContent.delete(id);
        this.formattedRawText.delete(id);
        this.rawTextOverride.delete(id);
        this.pendingAutoFormat = this.pendingAutoFormat.filter((pendingId) => pendingId !== id);
      }
    }
    blocks.forEach((block) => this.applyBlock(block));
    this.updateEmptyState();
    this.scrollToBottom();
    // Keep highlights/count in sync when new log entries arrive while searching.
    this.refreshSearchForNewContent();
    // Keep the error navigation list + button states in sync.
    this.refreshErrorList();
  }

  private applyBlock(block: RenderBlock) {
    this.blockById.set(block.id, block);
    let el = this.blockEls.get(block.id);
    if (!el) {
      el = this.createBlockEl(block);
      this.blockEls.set(block.id, el);
      this.blockTimestamps.set(block.id, Date.now());
      this.blocksContainer!.appendChild(el);
    } else {
      this.updateBlockEl(el, block);
    }
  }

  private createBlockEl(block: RenderBlock): HTMLElement {
    let el: HTMLElement;
    switch (block.kind) {
      case 'tool': {
        const wrapper = document.createElement('div');
        wrapper.className =
          'piview-collapsible piview-toolverify border border-app-border/60 rounded p-2 bg-app-surface/40';
        const { header, label } = this.buildCollapsibleHeader(!this.blocksCollapsed);
        label.className = 'text-app-accent-2 font-semibold whitespace-pre-wrap break-all';
        label.textContent = block.header ?? '';
        wrapper.appendChild(header);
        const body = document.createElement('pre');
        body.setAttribute('data-role', 'body');
        body.className = 'whitespace-pre-wrap break-all text-green-300 mt-1 min-h-0';
        body.textContent = this.toolBodyText(block);
        if (this.blocksCollapsed) body.classList.add('hidden');
        wrapper.appendChild(body);
        el = wrapper;
        break;
      }
      case 'bash': {
        const pre = document.createElement('pre');
        pre.className =
          'whitespace-pre-wrap break-all bg-black/40 border-l-2 border-app-accent-2/40 pl-2';
        pre.textContent = block.text ?? '';
        el = pre;
        break;
      }
      case 'thinking': {
        el = document.createElement('div');
        el.className = 'piview-collapsible piview-thinking border-l-2 border-app-text/20 pl-2';
        const header = document.createElement('div');
        header.setAttribute('data-role', 'header');
        header.setAttribute('data-toggle', '');
        header.className = 'flex items-center gap-1 text-app-text/50 font-medium cursor-pointer select-none';
        const glyph = document.createElement('span');
        glyph.setAttribute('data-glyph', '');
        glyph.innerHTML = Icon.render(this.thinkingExpanded ? 'chevronDown' : 'chevronRight', {
          size: 12,
        });
        const headerLabel = document.createElement('span');
        headerLabel.textContent = 'Thinking';
        header.appendChild(glyph);
        header.appendChild(headerLabel);
        el.appendChild(header);
        const body = document.createElement('pre');
        body.setAttribute('data-role', 'body');
        body.className = 'whitespace-pre-wrap break-all italic opacity-70 mt-0.5 overflow-hidden';
        body.textContent = block.text ?? '';
        if (!this.thinkingExpanded) body.classList.add('hidden');
        el.appendChild(body);
        break;
      }
      case 'notice': {
        el = document.createElement('div');
        el.className = 'text-app-accent-2 whitespace-pre-wrap break-all';
        el.textContent = block.text ?? '';
        break;
      }
      case 'error': {
        el = document.createElement('div');
        el.className = 'piview-error text-red-400 whitespace-pre-wrap break-all';
        el.textContent = block.text ?? '';
        if (!this.errorVisible) el.classList.add('hidden');
        break;
      }
      case 'verification': {
        const wrapper = document.createElement('div');
        const isError = block.error;
        wrapper.className =
          'piview-collapsible piview-toolverify border rounded p-2 ' +
          (isError
            ? 'border-red-500/60 bg-red-950/30'
            : 'border-green-500/60 bg-green-950/30');
        const { header, label } = this.buildCollapsibleHeader(!this.blocksCollapsed);
        label.className =
          'font-semibold whitespace-pre-wrap break-all ' +
          (isError ? 'text-red-400' : 'text-green-400');
        label.textContent = block.text ?? '';
        wrapper.appendChild(header);
        const body = document.createElement('pre');
        body.setAttribute('data-role', 'body');
        body.className = 'whitespace-pre-wrap break-all text-green-300 mt-1 min-h-0';
        body.textContent = (block.sub ?? []).join('\n');
        if (this.blocksCollapsed) body.classList.add('hidden');
        wrapper.appendChild(body);
        el = wrapper;
        break;
      }
      case 'divider': {
        el = document.createElement('div');
        el.className =
          'text-app-text/40 border-t border-app-border/40 pt-1 whitespace-pre-wrap break-all';
        el.textContent = block.text ?? '';
        break;
      }
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
      default: {
        el = document.createElement('div');
        el.className = 'whitespace-pre-wrap break-all';
        el.textContent = block.text ?? '';
        break;
      }
    }
    // Shared per-block chrome: positioning context + copy button (on hover).
    el.classList.add('relative', 'group');
    el.setAttribute('data-block-id', block.id);
    this.attachBlockActions(el, block);
    return el;
  }

  private attachBlockActions(el: HTMLElement, block: RenderBlock) {
    // Copy button (top-right).
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className =
      'piview-copy absolute top-1 right-1 z-10 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 hover:bg-black/80 text-green-300 hover:text-white cursor-pointer';
    copyBtn.title = 'Copy block';
    copyBtn.setAttribute('aria-label', 'Copy block');
    copyBtn.setAttribute('data-copy-block', block.id);
    copyBtn.innerHTML = this.cleanIcon(Icon.render('copy', { size: 12, label: 'Copy block' }));
    el.appendChild(copyBtn);

    // "Format as markup" button, to the left of the copy button. Converts the
    // block's Markdown content into styled HTML (and back again on re-click).
    const formatBtn = document.createElement('button');
    formatBtn.type = 'button';
    formatBtn.className =
      'piview-format absolute top-1 right-8 z-10 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 hover:bg-black/80 text-cyan-300 hover:text-white cursor-pointer';
    formatBtn.title = 'Format as markup';
    formatBtn.setAttribute('aria-label', 'Format as markup');
    formatBtn.setAttribute('data-format-block', block.id);
    formatBtn.innerHTML = this.cleanIcon(
      Icon.render('documentation', { size: 12, label: 'Format as markup' })
    );
    el.appendChild(formatBtn);
  }

  /** Removes inter-tag whitespace so an SVG icon never leaks text nodes (e.g. into <pre>). */
  private cleanIcon(icon: string): string {
    return icon.trim().replace(/>\s+</g, '><');
  }

  private buildCollapsibleHeader(expanded: boolean): { header: HTMLElement; label: HTMLElement } {
    const header = document.createElement('div');
    header.setAttribute('data-role', 'header');
    header.setAttribute('data-toggle', '');
    header.className = 'flex items-center gap-1 cursor-pointer select-none';
    const glyph = document.createElement('span');
    glyph.setAttribute('data-glyph', '');
    glyph.innerHTML = this.cleanIcon(
      Icon.render(expanded ? 'chevronDown' : 'chevronRight', { size: 12 })
    );
    const label = document.createElement('span');
    label.setAttribute('data-label', '');
    header.appendChild(glyph);
    header.appendChild(label);
    return { header, label };
  }

  private updateBlockEl(el: HTMLElement, block: RenderBlock) {
    // The assistant's visible answer is auto-rendered on completion. While it is
    // still streaming (or if the user opted it back to raw) keep the cheap,
    // pre-formatted plain-text update.
    if (block.kind === 'text') {
      if (this.formattedBlocks.has(block.id)) {
        // Only re-parse if the source actually changed (normally never after
        // completion).
        if (this.formattedRawText.get(block.id) !== this.blockToText(block)) {
          this.refreshFormattedEl(el, block.id, block);
        }
        return;
      }
      if (this.shouldFormatText(block)) {
        this.applyFormat(el, block.id, this.blockToText(block), { silent: true });
        return;
      }
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
    // While a block is rendered as styled Markdown, keep that rendering in sync
    // with any newly streamed content instead of touching the raw nodes.
    if (this.formattedBlocks.has(block.id)) {
      this.refreshFormattedEl(el, block.id, block);
      return;
    }
    const header = el.querySelector('[data-role="header"]') as HTMLElement | null;
    if (header && block.kind !== 'thinking') {
      const value = block.kind === 'verification' ? (block.text ?? '') : (block.header ?? '');
      const label = header.querySelector('[data-label]') as HTMLElement | null;
      if (label) {
        if (label.textContent !== value) label.textContent = value;
      } else if (header.textContent !== value) {
        header.textContent = value;
      }
    }
    const body = el.querySelector('[data-role="body"]') as HTMLElement | null;
    if (body) {
      if (block.kind === 'verification') {
        const txt = (block.sub ?? []).join('\n');
        if (body.textContent !== txt) body.textContent = txt;
      } else {
        const txt = block.kind === 'tool' ? this.toolBodyText(block) : (block.text ?? '');
        if (body.textContent !== txt) body.textContent = txt;
      }
    } else {
      const txt = block.text ?? block.header ?? '';
      this.replaceTextPreservingActions(el, txt);
    }
    // Apply error tinting to error blocks.
    if (block.kind === 'error' && !el.classList.contains('text-red-400')) {
      el.classList.add('text-red-400');
    }
  }

  /**
   * Replaces a block's inline text while preserving its per-block action
   * buttons (copy / format). Shared by the generic update path and the `text`
   * fallback when a wrapper is missing its raw child.
   */
  private replaceTextPreservingActions(el: HTMLElement, txt: string) {
    const actionBtns = Array.from(
      el.querySelectorAll('.piview-copy, .piview-format')
    ) as HTMLElement[];
    actionBtns.forEach((btn) => btn.remove());
    if (el.textContent !== txt) {
      el.textContent = txt;
    }
    actionBtns.forEach((btn) => el.appendChild(btn));
  }

  // ---------------------------------------------------------------------------
  // Per-block "Format as markup" (Markdown -> styled HTML toggle)
  // ---------------------------------------------------------------------------

  /**
   * Toggles a single block between its raw text and a Markdown-rendered, styled
   * HTML representation (using the shared `renderMarkdown`). A second click
   * restores the original content nodes exactly as they were.
   */
  private toggleFormatBlock(id: string) {
    const wrapper = this.blockEls.get(id);
    if (!wrapper) return;
    if (this.formattedBlocks.has(id)) {
      this.revertFormat(wrapper, id);
    } else {
      const block = this.findBlock(id);
      const text = block ? this.blockToText(block) : this.extractText(wrapper);
      if (!text) return;
      // Re-formatting explicitly clears any "stay raw" opt-out.
      this.rawTextOverride.delete(id);
      this.applyFormat(wrapper, id, text);
    }
  }

  private findBlock(id: string): RenderBlock | undefined {
    const cached = this.blockById.get(id);
    if (cached) return cached;
    return this.service.getHistory().find((b) => b.id === id);
  }

  /** Returns the Markdown-renderable text for a block (header omitted for thinking). */
  private blockToText(block: RenderBlock): string {
    if (block.kind === 'verification') {
      return [block.text ?? '', ...(block.sub ?? [])].join('\n');
    }
    if (block.kind === 'thinking') {
      return block.text ?? '';
    }
    if (block.kind === 'tool') {
      return [block.header ?? '', this.toolBodyText(block)].filter(Boolean).join('\n');
    }
    return [block.header ?? '', block.text ?? ''].filter(Boolean).join('\n');
  }

  /**
   * Body text for a `tool` block with the executed command prepended before the
   * result/output, so the user still sees what was run once the tab text becomes
   * "✓ bash finished" (or similar). When the body already leads with the command
   * (e.g. the running initial state) it is returned unchanged to avoid duplicate.
   */
  private toolBodyText(block: RenderBlock): string {
    const text = block.text ?? '';
    const command = block.command;
    if (!command) return text;
    if (text.startsWith(command)) return text;
    return command + (text ? `\n\n${text}` : '');
  }

  /** Extracts block text directly from the rendered DOM (excluding action buttons). */
  private extractText(wrapper: HTMLElement): string {
    const clone = wrapper.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('.piview-copy, .piview-format').forEach((b) => b.remove());
    return (clone.textContent ?? '').trim();
  }

  private applyFormat(wrapper: HTMLElement, id: string, text: string, opts: { silent?: boolean } = {}) {
    // Snapshot the original content nodes (excluding action buttons) so we can
    // restore the block exactly when the rendering is toggled back off.
    const contentNodes = Array.from(wrapper.childNodes).filter((n) => {
      if (n.nodeType !== Node.ELEMENT_NODE) return true;
      const cls = (n as HTMLElement).className || '';
      return !cls.includes('piview-copy') && !cls.includes('piview-format');
    });
    this.formattedContent.set(id, contentNodes);
    this.formattedRawText.set(id, text);
    contentNodes.forEach((n) => n.remove());

    const formatted = document.createElement('div');
    formatted.className = FORMATTED_MARKDOWN_CLASS;
    formatted.setAttribute('data-role', 'formatted');
    formatted.innerHTML = renderMarkdown(text);
    wrapper.appendChild(formatted);
    wrapper.classList.add('piview-formatted-active');
    this.formattedBlocks.add(id);
    this.refreshFormatButton(wrapper, id);
    if (!opts.silent) this.showToast('Rendered Markdown');
  }

  private revertFormat(wrapper: HTMLElement, id: string) {
    this.formattedBlocks.delete(id);
    const formatted = wrapper.querySelector('[data-role="formatted"]');
    formatted?.remove();
    wrapper.classList.remove('piview-formatted-active');
    (this.formattedContent.get(id) ?? []).forEach((n) => wrapper.appendChild(n));
    this.formattedContent.delete(id);
    this.formattedRawText.delete(id);
    // Remember that the user explicitly wants the raw view for this block so a
    // later snapshot/completion does not silently re-format it.
    this.rawTextOverride.add(id);
    this.refreshFormatButton(wrapper, id);
    this.showToast('Showing raw text');
  }

  /**
   * Updates the per-block format button's label/icon to reflect whether the
   * block is currently rendered as Markdown. Called after the auto-format path
   * (which runs after the button was created) as well as on manual toggles.
   */
  private refreshFormatButton(wrapper: HTMLElement, id: string) {
    const btn = wrapper.querySelector('.piview-format') as HTMLElement | null;
    if (!btn) return;
    const formatted = this.formattedBlocks.has(id);
    const label = formatted ? 'Show raw text' : 'Format as markup';
    btn.setAttribute('title', label);
    btn.setAttribute('aria-label', label);
    btn.innerHTML = this.cleanIcon(
      Icon.render(formatted ? 'eyeOff' : 'documentation', { size: 12, label })
    );
  }

  /** Re-renders a formatted block when new content is streamed into it. */
  private refreshFormattedEl(wrapper: HTMLElement, id: string, block: RenderBlock) {
    const text = this.blockToText(block);
    // Nothing to do when the rendered source is unchanged (e.g. a non-text
    // block whose snapshot did not affect it). Avoids re-parsing on every update.
    if (this.formattedRawText.get(id) === text) return;
    this.formattedRawText.set(id, text);
    let formatted = wrapper.querySelector('[data-role="formatted"]') as HTMLElement | null;
    if (!formatted) {
      formatted = document.createElement('div');
      formatted.className = FORMATTED_MARKDOWN_CLASS;
      formatted.setAttribute('data-role', 'formatted');
      wrapper.appendChild(formatted);
    }
    formatted.innerHTML = renderMarkdown(text);
  }

  // ---------------------------------------------------------------------------
  // Automatic Markdown rendering of completed `text` blocks
  // ---------------------------------------------------------------------------

  /** Whether a block should be auto-formatted as Markdown. */
  private shouldFormatText(block: RenderBlock): boolean {
    return (
      this.autoFormatText &&
      block.kind === 'text' &&
      !!block.complete &&
      !!block.text &&
      !this.rawTextOverride.has(block.id)
    );
  }

  /**
   * Queues a completed `text` block for auto-formatting. Completion is rare
   * (once per response element) but a history replay can enqueue many blocks at
   * once, so the actual parse is deferred to an idle callback with a small
   * budget rather than blocking the reconcile frame.
   */
  private enqueueAutoFormat(id: string) {
    if (this.pendingAutoFormat.includes(id)) return;
    this.pendingAutoFormat.push(id);
    this.scheduleAutoFormatDrain();
  }

  private scheduleAutoFormatDrain() {
    if (this.autoFormatScheduled) return;
    this.autoFormatScheduled = true;
    const run = () => {
      this.autoFormatHandle = null;
      this.autoFormatScheduled = false;
      this.drainAutoFormat();
    };
    const ric = (globalThis as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
      .requestIdleCallback;
    if (typeof ric === 'function') {
      this.autoFormatHandle = ric(run, { timeout: 200 });
    } else {
      this.autoFormatHandle = globalThis.setTimeout(run, 0) as unknown as number;
    }
  }

  private cancelScheduledAutoFormat() {
    if (this.autoFormatHandle === null) {
      this.autoFormatScheduled = false;
      return;
    }
    const cic = (globalThis as unknown as { cancelIdleCallback?: (handle: number) => void })
      .cancelIdleCallback;
    if (typeof cic === 'function') {
      cic(this.autoFormatHandle);
    } else {
      globalThis.clearTimeout(this.autoFormatHandle as unknown as number);
    }
    this.autoFormatHandle = null;
    this.autoFormatScheduled = false;
  }

  /**
   * Formats a bounded number of queued blocks, then reschedules itself if more
   * remain. Each block is parsed at most once because `applyFormat` records it
   * in `formattedBlocks`.
   */
  private drainAutoFormat(budgetMs: number = 5) {
    const start = Date.now();
    while (this.pendingAutoFormat.length > 0) {
      const id = this.pendingAutoFormat.shift()!;
      const el = this.blockEls.get(id);
      const block = this.blockById.get(id);
      if (!el || !block) continue;
      if (this.formattedBlocks.has(id)) continue;
      if (!this.shouldFormatText(block)) continue;
      this.applyFormat(el, id, this.blockToText(block), { silent: true });
      if (Date.now() - start >= budgetMs) break;
    }
    if (this.pendingAutoFormat.length > 0 && this.autoFormatHandle === null) {
      this.autoFormatScheduled = false;
      this.scheduleAutoFormatDrain();
    }
  }

  /**
   * Synchronously drains the auto-format queue. Exposed for tests so they do
   * not depend on idle-callback timing, and safe to call at any time.
   */
  public flushAutoFormat(): void {
    this.cancelScheduledAutoFormat();
    // Ignore the time budget when explicitly flushing.
    this.drainAutoFormat(Number.POSITIVE_INFINITY);
  }

  // ---------------------------------------------------------------------------
  // Follow mode / actions
  // ---------------------------------------------------------------------------

  private scrollToBottom() {
    if (this.isFollowMode && this.logContainer) {
      this.logContainer.scrollTop = this.logContainer.scrollHeight;
    }
  }

  /** Whether follow-mode auto-scroll is currently enabled (for embedding hosts). */
  isFollowing(): boolean {
    return this.isFollowMode;
  }

  /**
   * Toggles follow-mode auto-scroll. While enabled, newly rendered blocks keep
   * the log scrolled to the bottom. Exposed so an embedding host (e.g.
   * {@link InteractiveCodingView}) can drive the shared log from its own
   * header controls.
   */
  toggleFollow() {
    this.isFollowMode = !this.isFollowMode;
    const btn = this.root.querySelector('#follow-btn');
    if (btn) {
      btn.innerHTML = this.isFollowMode
        ? `${Icon.render('refresh', { size: 14 })} Follow Mode: ON`
        : `${Icon.render('clock', { size: 14 })} Follow Mode: OFF`;

      btn.className = this.isFollowMode
        ? 'px-3 py-1.5 rounded text-xs font-medium bg-app-accent-1 text-white hover:bg-app-accent-1/80 transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer'
        : 'px-3 py-1.5 rounded text-xs font-medium bg-app-surface border border-app-border text-app-text hover:bg-app-bg transition-colors flex items-center gap-1.5 cursor-pointer';

      const label = this.isFollowMode ? 'Follow Mode: ON' : 'Follow Mode: OFF';
      this.buttonLabels['toggle-follow'] = label;
      this.updateButtonTooltip('toggle-follow');
    }
  }

  /** Whether `thinking` blocks are currently expanded (for embedding hosts). */
  isThinkingExpanded(): boolean {
    return this.thinkingExpanded;
  }

  /** Whether `tool`/`verification` blocks are currently collapsed (for embedding hosts). */
  areBlocksCollapsed(): boolean {
    return this.blocksCollapsed;
  }

  /** Whether `error` blocks are currently visible (for embedding hosts). */
  isErrorVisible(): boolean {
    return this.errorVisible;
  }

  /**
   * Toggles the global expanded/collapsed state of all `thinking` blocks.
   * Newly rendered thinking blocks follow the current state.
   */
  toggleThinking() {
    this.thinkingExpanded = !this.thinkingExpanded;
    const log = this.logContainer;
    const prev = log ? log.scrollTop : 0;
    const container = this.blocksContainer;
    if (container) {
      container.querySelectorAll('.piview-thinking').forEach((w) => {
        const body = w.querySelector('[data-role="body"]') as HTMLElement | null;
        if (body) body.classList.toggle('hidden', !this.thinkingExpanded);
        const glyph = w.querySelector('[data-glyph]') as HTMLElement | null;
        if (glyph) {
          glyph.innerHTML = Icon.render(this.thinkingExpanded ? 'chevronDown' : 'chevronRight', {
            size: 12,
          });
        }
      });
    }
    this.updateThinkingBtn();
    if (log) log.scrollTop = prev;
  }

  /**
   * Toggles a single collapsible block's body (used by header clicks).
   */
  private toggleBlockCollapse(el: HTMLElement) {
    const body = el.querySelector('[data-role="body"]') as HTMLElement | null;
    if (!body) return;
    // Currently collapsed -> expand, and vice versa.
    const nowExpanded = body.classList.contains('hidden');
    body.classList.toggle('hidden', !nowExpanded);
    const glyph = el.querySelector('[data-glyph]') as HTMLElement | null;
    if (glyph) {
      glyph.innerHTML = `${Icon.render(nowExpanded ? 'chevronDown' : 'chevronRight', { size: 12 })}`;
    }
  }

  /**
   * Toggles global collapsed state of all `tool`/`verification` blocks.
   * Newly rendered blocks follow the current state.
   */
  toggleBlocksCollapse() {
    this.blocksCollapsed = !this.blocksCollapsed;
    const log = this.logContainer;
    const prev = log ? log.scrollTop : 0;
    const container = this.blocksContainer;
    if (container) {
      container.querySelectorAll('.piview-toolverify').forEach((w) => {
        const body = w.querySelector('[data-role="body"]') as HTMLElement | null;
        if (body) body.classList.toggle('hidden', this.blocksCollapsed);
        const glyph = w.querySelector('[data-glyph]') as HTMLElement | null;
        if (glyph) {
          glyph.innerHTML = this.cleanIcon(
            Icon.render(this.blocksCollapsed ? 'chevronRight' : 'chevronDown', { size: 12 })
          );
        }
      });
    }
    this.updateCollapseBtn();
    if (log) log.scrollTop = prev;
  }

  private updateCollapseBtn() {
    const btn = this.root.querySelector('#collapse-blocks-btn') as HTMLElement | null;
    if (!btn) return;
    const collapsed = this.blocksCollapsed;
    // Plus (expand all) when collapsed, minus (collapse all) when expanded.
    btn.innerHTML = this.cleanIcon(Icon.render(collapsed ? 'plus' : 'minus', { size: 14 }));
    btn.setAttribute('aria-pressed', String(collapsed));
    const label = collapsed ? 'Expand all blocks' : 'Collapse all blocks';
    this.buttonLabels['toggle-block-collapse'] = label;
    this.updateButtonTooltip('toggle-block-collapse');
  }

  /**
   * Toggles the visibility of all `error` blocks. New error blocks follow
   * the current state.
   */
  toggleErrorVisibility() {
    this.errorVisible = !this.errorVisible;
    const log = this.logContainer;
    const prev = log ? log.scrollTop : 0;
    const container = this.blocksContainer;
    if (container) {
      container.querySelectorAll('.piview-error').forEach((w) => {
        w.classList.toggle('hidden', !this.errorVisible);
      });
    }
    this.updateErrorBtn();
    if (log) log.scrollTop = prev;
  }

  private updateErrorBtn() {
    const btn = this.root.querySelector('#error-toggle-btn') as HTMLElement | null;
    if (!btn) return;
    const visible = this.errorVisible;
    btn.innerHTML = this.cleanIcon(Icon.render(visible ? 'eye' : 'eyeOff', { size: 14 }));
    btn.setAttribute('aria-pressed', String(visible));
    const label = visible ? 'Hide error blocks' : 'Show error blocks';
    this.buttonLabels['toggle-error-visibility'] = label;
    this.updateButtonTooltip('toggle-error-visibility');
  }

  // ---------------------------------------------------------------------------
  // Next/Prev error navigation
  // ---------------------------------------------------------------------------

  /**
   * Rebuilds the ordered list of error blocks from the current DOM and keeps
   * the selected index + button states in sync (e.g. after new log entries are
   * appended or blocks are dropped).
   */
  private refreshErrorList() {
    const container = this.blocksContainer;
    this.errorEls = container ? Array.from(container.querySelectorAll('.piview-error')) : [];
    if (this.currentErrorIndex >= this.errorEls.length) {
      this.currentErrorIndex = this.errorEls.length > 0 ? this.errorEls.length - 1 : -1;
    }
    this.updateErrorNavBtns();
  }

  /** Scrolls to and selects the next error block (no-op when at the end). */
  private nextError() {
    if (this.errorEls.length === 0) return;
    const next = this.currentErrorIndex + 1;
    if (next >= this.errorEls.length) return;
    this.goToError(next);
  }

  /** Scrolls to and selects the previous error block (no-op when at the start). */
  private prevError() {
    if (this.errorEls.length === 0) return;
    const prev = this.currentErrorIndex - 1;
    if (prev < 0) return;
    this.goToError(prev);
  }

  /** Selects the error at `index` and scrolls it into the visible area. */
  private goToError(index: number) {
    const el = this.errorEls[index];
    if (!el) return;
    this.currentErrorIndex = index;
    this.ensureVisible(el);
    this.updateErrorNavBtns();
  }

  private updateErrorNavBtns() {
    const next = this.root.querySelector('#next-error-btn') as HTMLButtonElement | null;
    const prev = this.root.querySelector('#prev-error-btn') as HTMLButtonElement | null;
    const total = this.errorEls.length;
    if (prev) prev.disabled = total === 0 || this.currentErrorIndex <= 0;
    if (next) next.disabled = total === 0 || this.currentErrorIndex >= total - 1;
  }

  /**
   * Toggles the visibility of the in-log search bar.
   */
  private toggleSearchBar() {
    this.searchCollapsed = !this.searchCollapsed;
    const bar = this.root.querySelector('#piview-search-bar');
    if (bar) bar.classList.toggle('hidden', this.searchCollapsed);
    this.updateSearchToggleBtn();
  }

  private updateSearchToggleBtn() {
    const btn = this.root.querySelector('#search-toggle-btn') as HTMLElement | null;
    if (!btn) return;
    const collapsed = this.searchCollapsed;
    btn.innerHTML = this.cleanIcon(Icon.render(collapsed ? 'search' : 'close', { size: 14 }));
    btn.setAttribute('aria-pressed', String(!collapsed));
    const label = collapsed ? 'Show search bar' : 'Hide search bar';
    this.buttonLabels['toggle-search'] = label;
    this.updateButtonTooltip('toggle-search');
  }

  private updateThinkingBtn() {
    const btn = this.root.querySelector('#thinking-toggle-btn') as HTMLElement | null;
    if (!btn) return;
    const expanded = this.thinkingExpanded;
    btn.innerHTML = Icon.render(expanded ? 'chevronDown' : 'chevronRight', { size: 14 });
    btn.setAttribute('aria-pressed', String(expanded));
    const label = expanded ? 'Collapse all thinking blocks' : 'Expand all thinking blocks';
    this.buttonLabels['toggle-thinking'] = label;
    this.updateButtonTooltip('toggle-thinking');
  }

  private updateStopButtonVisibility(active: boolean) {
    const btn = this.root.querySelector('#stop-bot-btn');
    if (btn) {
      if (active) {
        btn.classList.remove('hidden');
      } else {
        btn.classList.add('hidden');
      }
    }
  }

  private async stopBot() {
    const taskId = this.service.getCurrentTaskId();
    if (!taskId) return;

    const btn = this.root.querySelector('#stop-bot-btn') as HTMLButtonElement;
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `${Icon.render('refresh', { size: 14, className: 'animate-spin' })} Stopping...`;
    }

    try {
      await this.service.stopSession(taskId);
    } catch (e) {
      console.error('Failed to stop CoderBot session:', e);
      alert('Failed to stop CoderBot session. See console for details.');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `${Icon.render('close', { size: 14 })} Stop Bot`;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Live session status / timer
  // ---------------------------------------------------------------------------

  private syncSessionState(active: boolean) {
    this.sessionActive = active;
    if (active) {
      this.hasRunSession = true;
      if (this.startTime === null) {
        // Prefer the server-reported session start time; fall back to now.
        this.startTime = this.service.getSessionStartTime() ?? Date.now();
      }
      this.updateStatusDot();
      this.startStatusTimer();
    } else {
      if (this.startTime !== null) {
        this.elapsedMs += Date.now() - this.startTime;
        this.startTime = null;
      }
      this.stopStatusTimer();
      this.updateStatusDot();
    }
    this.updateEmptyState();
    this.updateStatusText();
  }

  /**
   * (Re)anchors the running-timer to an authoritative session start time. Only
   * meaningful while a session is active; updates the displayed elapsed time.
   */
  private setStartTimeReference(ts: number) {
    if (!this.sessionActive) return;
    this.startTime = ts;
    this.startStatusTimer();
    this.updateStatusText();
  }

  /**
   * Toggles the empty-state placeholder and the "Session ended" completion line
   * based on whether any logs are present and whether a session is running.
   *
   * - No logs + no active session  -> show "No active session…" placeholder.
   * - Logs present + session ended  -> show the distinct "Session ended" line.
   */
  private updateEmptyState() {
    const hasLogs = this.blockEls.size > 0;
    if (this.emptyStateEl) {
      this.emptyStateEl.style.display = !this.sessionActive && !hasLogs ? '' : 'none';
    }
    if (this.sessionEndedEl) {
      this.sessionEndedEl.style.display =
        this.hasRunSession && !this.sessionActive && hasLogs ? '' : 'none';
    }
  }

  private startStatusTimer() {
    if (this.timerHandle !== null) return;
    this.updateStatusText();
    this.timerHandle = window.setInterval(() => this.updateStatusText(), 1000);
  }

  private stopStatusTimer() {
    if (this.timerHandle !== null) {
      window.clearInterval(this.timerHandle);
      this.timerHandle = null;
    }
  }

  private updateStatusDot() {
    const dot = this.root.querySelector('#piview-status-dot') as HTMLElement | null;
    if (!dot) return;
    if (this.sessionActive) {
      dot.className = 'inline-block w-2 h-2 rounded-full bg-green-400 animate-pulse';
    } else {
      dot.className = 'inline-block w-2 h-2 rounded-full bg-app-text/40';
    }
  }

  private updateStatusText() {
    const text = this.root.querySelector('#piview-status-text') as HTMLElement | null;
    if (!text) return;
    if (this.sessionActive && this.startTime !== null) {
      const running = this.elapsedMs + (Date.now() - this.startTime);
      text.textContent = `Running since ${this.formatElapsed(running)}`;
    } else if (this.hasRunSession) {
      text.textContent = `Session ended · ${this.formatElapsed(this.elapsedMs)}`;
    } else {
      text.textContent = 'Session idle';
    }
  }

  /** Formats a millisecond duration as HH:MM:SS. */
  private formatElapsed(ms: number): string {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(h)}:${pad(m)}:${pad(s)}`;
  }

  // ---------------------------------------------------------------------------
  // Copy-to-clipboard
  // ---------------------------------------------------------------------------

  private copyBlock(id: string) {
    const text = this.formatBlock(id);
    if (!text) return;
    this.copyToClipboard(text, 'Block copied');
  }

  private copyAllLog() {
    const parts: string[] = [];
    this.blockEls.forEach((_wrapper, id) => {
      const t = this.formatBlock(id);
      if (t) parts.push(t);
    });
    this.copyToClipboard(parts.join('\n\n'), 'Log copied');
  }

  /** Reconstructs a block's text (with timestamp) from the rendered DOM. */
  private formatBlock(id: string): string {
    const wrapper = this.blockEls.get(id);
    if (!wrapper) return '';
    const time = this.blockTimestamps.get(id);
    const timeStr = time !== undefined ? this.formatCopyTime(time) : '';
    // Prefer the original raw text when the block is rendered as Markdown.
    if (this.formattedBlocks.has(id)) {
      return [timeStr, this.formattedRawText.get(id) ?? ''].filter(Boolean).join('\n');
    }
    const structured = wrapper.querySelector('[data-role="body"]');
    let headerText = '';
    let bodyText = '';
    if (structured) {
      const isThinking = wrapper.classList.contains('piview-thinking');
      if (!isThinking) {
        headerText = wrapper.querySelector('[data-role="header"]')?.textContent?.trim() ?? '';
      }
      bodyText = structured.textContent?.trim() ?? '';
    } else {
      bodyText = (wrapper.textContent ?? '').trim();
    }
    return [timeStr, headerText, bodyText].filter(Boolean).join('\n');
  }

  private formatCopyTime(ts: number): string {
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
      d.getHours()
    )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  private async copyToClipboard(text: string, message: string) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        this.fallbackCopy(text);
      }
      this.showToast(message);
    } catch {
      this.fallbackCopy(text);
      this.showToast(message);
    }
  }

  private fallbackCopy(text: string) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand('copy');
    } catch {
      /* ignore */
    }
    document.body.removeChild(ta);
  }

  private showToast(msg: string) {
    const toast = this.root.querySelector('#piview-toast') as HTMLElement | null;
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.remove('opacity-0');
    toast.classList.add('opacity-100');
    if (this.copyToastTimer !== null) window.clearTimeout(this.copyToastTimer);
    this.copyToastTimer = window.setTimeout(() => {
      toast.classList.remove('opacity-100');
      toast.classList.add('opacity-0');
    }, 1800);
  }
}
