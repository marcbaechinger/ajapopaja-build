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
   * Tailwind height class for the log area, so embedded use (e.g. a sidebar)
   * can be more compact than the modal default. Default 'h-[60vh]'.
   */
  logHeightClass?: string;
  /**
   * Optional action button rendered in the empty-state placeholder that shows
   * when the log has no content and no session is running.
   */
  emptyStateAction?: EmptyStateAction;
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
  private unsubs: (() => void)[] = [];

  /** Whether `thinking` blocks are expanded (default: collapsed). */
  private thinkingExpanded: boolean = false;

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

  constructor(service: PiSessionService, mount: HTMLElement, options: PiViewOptions = {}) {
    this.service = service;
    this.root = mount;
    this.showFooter = options.showFooter ?? true;
    this.isFollowMode = options.followInitially ?? true;
    this.logHeightClass = options.logHeightClass ?? 'h-[60vh]';
    this.emptyStateAction = options.emptyStateAction;
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
    if (this.showFooter) {
      this.root.appendChild(this.buildFooter());
      this.updateThinkingBtn();
      this.updateCollapseBtn();
      this.updateErrorBtn();
    }
    document.addEventListener('keydown', this.handleKeydown);
    this.unsubs.push(() => document.removeEventListener('keydown', this.handleKeydown));
    this.initLogDisplay();
    this.initStateSync();
  }

  /**
   * Unsubscribes from the service and detaches listeners.
   */
  destroy(): void {
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
  }

  // ---------------------------------------------------------------------------
  // DOM construction
  // ---------------------------------------------------------------------------

  private buildLogArea(): HTMLElement {
    const container = document.createElement('div');
    container.id = 'log-content-container';
    container.className =
      `relative bg-black text-green-400 px-4 pb-4 font-mono text-[11px] leading-tight overflow-y-auto ${this.logHeightClass} custom-scrollbar selection:bg-app-accent-1/30`;
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
    blocks.className = 'space-y-1';
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
    footer.className = 'p-3 border-t border-app-border flex justify-between items-center bg-app-surface/50';
    const actions = document.createElement('div');
    actions.className = 'flex gap-2';

    const followBtn = document.createElement('button');
    followBtn.setAttribute('data-action', 'toggle-follow');
    followBtn.id = 'follow-btn';
    followBtn.className = 'px-3 py-1.5 rounded text-xs font-medium bg-app-accent-1 text-white hover:bg-app-accent-1/80 transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer';
    followBtn.innerHTML = `${Icon.render('refresh', { size: 14 })}\n            Follow Mode: ON`;
    actions.appendChild(followBtn);

    const clearBtn = document.createElement('button');
    clearBtn.setAttribute('data-action', 'clear-logs');
    clearBtn.className = 'px-3 py-1.5 rounded text-xs font-medium bg-app-surface border border-app-border text-app-text hover:bg-app-bg transition-colors flex items-center gap-1.5 cursor-pointer';
    clearBtn.innerHTML = `${Icon.render('trash', { size: 14 })}\n            Clear`;
    actions.appendChild(clearBtn);

    const stopBtn = document.createElement('button');
    stopBtn.setAttribute('data-action', 'stop-bot');
    stopBtn.id = 'stop-bot-btn';
    stopBtn.className = 'px-3 py-1.5 rounded text-xs font-medium bg-red-600 text-white hover:bg-red-700 transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer hidden';
    stopBtn.innerHTML = `${Icon.render('close', { size: 14 })}\n            Stop Bot`;
    actions.appendChild(stopBtn);

    const thinkingBtn = document.createElement('button');
    thinkingBtn.setAttribute('data-action', 'toggle-thinking');
    thinkingBtn.id = 'thinking-toggle-btn';
    thinkingBtn.className =
      'px-2 py-1.5 rounded text-xs font-medium bg-app-surface border border-app-border text-app-text hover:bg-app-bg transition-colors flex items-center gap-1.5 cursor-pointer';
    thinkingBtn.setAttribute('aria-label', 'Expand all thinking blocks');
    thinkingBtn.title = 'Expand all thinking blocks';
    thinkingBtn.setAttribute('aria-pressed', 'false');
    actions.appendChild(thinkingBtn);

    const collapseBtn = document.createElement('button');
    collapseBtn.setAttribute('data-action', 'toggle-block-collapse');
    collapseBtn.id = 'collapse-blocks-btn';
    collapseBtn.className =
      'px-2 py-1.5 rounded text-xs font-medium bg-app-surface border border-app-border text-app-text hover:bg-app-bg transition-colors flex items-center gap-1.5 cursor-pointer';
    collapseBtn.setAttribute('aria-label', 'Collapse all blocks');
    collapseBtn.title = 'Collapse all blocks';
    collapseBtn.setAttribute('aria-pressed', 'false');
    actions.appendChild(collapseBtn);

    const errorToggleBtn = document.createElement('button');
    errorToggleBtn.setAttribute('data-action', 'toggle-error-visibility');
    errorToggleBtn.id = 'error-toggle-btn';
    errorToggleBtn.className =
      'px-2 py-1.5 rounded text-xs font-medium bg-app-surface border border-app-border text-app-text hover:bg-app-bg transition-colors flex items-center gap-1.5 cursor-pointer';
    errorToggleBtn.setAttribute('aria-label', 'Hide error blocks');
    errorToggleBtn.title = 'Hide error blocks';
    errorToggleBtn.setAttribute('aria-pressed', 'false');
    actions.appendChild(errorToggleBtn);

    const copyAllBtn = document.createElement('button');
    copyAllBtn.setAttribute('data-action', 'copy-all-log');
    copyAllBtn.id = 'copy-all-btn';
    copyAllBtn.className =
      'px-2 py-1.5 rounded text-xs font-medium bg-app-surface border border-app-border text-app-text hover:bg-app-bg transition-colors flex items-center gap-1.5 cursor-pointer';
    copyAllBtn.title = 'Copy entire log (c)';
    copyAllBtn.setAttribute('aria-label', 'Copy entire log');
    copyAllBtn.innerHTML = Icon.render('copyRects', { size: 14, label: 'Copy entire log' });
    actions.appendChild(copyAllBtn);

    footer.appendChild(actions);

    // Delegate action clicks on the root so the handler survives footer rebuilds
    // and only listens while this view is alive.
    this.root.addEventListener('click', this.handleClick);
    this.unsubs.push(() => this.root.removeEventListener('click', this.handleClick));

    return footer;
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
    } else if (action === 'copy-all-log') {
      this.copyAllLog();
    }
  };

  private handleKeydown = (e: KeyboardEvent): void => {
    if (e.key !== 'c' && e.key !== 'C') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (!target || !this.root.contains(target)) return;
    e.preventDefault();
    this.copyAllLog();
  };

  // ---------------------------------------------------------------------------
  // Log display / reconciliation
  // ---------------------------------------------------------------------------

  private initLogDisplay() {
    this.logContainer = this.root.querySelector('#log-content-container');
    this.blocksContainer = this.root.querySelector('#log-blocks');
    if (!this.blocksContainer || !this.logContainer) return;

    // Load initial history
    const history = this.service.getHistory();
    history.forEach((block) => this.applyBlock(block));
    this.scrollToBottom();

    // Subscribe to block changes
    this.unsubs.push(
      this.service.onBlocks((blocks) => {
        this.reconcile(blocks);
      })
    );

    // Keep legacy onMessage subscription for non-CoderBot streams (harmless if unused).
    this.unsubs.push(
      this.service.onMessage((content) => {
        if (content === '') {
          this.blocksContainer!.replaceChildren();
          this.blockEls.clear();
          this.updateEmptyState();
        }
      })
    );
  }

  private initStateSync() {
    // Initial state
    const active = this.service.isActive();
    this.updateStopButtonVisibility(active);
    this.syncSessionState(active);

    // Subscribe to state changes
    this.unsubs.push(
      this.service.onSessionStateChange((active) => {
        this.updateStopButtonVisibility(active);
        this.syncSessionState(active);
      })
    );
  }

  private reconcile(blocks: RenderBlock[]) {
    // Remove blocks that have been dropped (e.g. after clearHistory).
    const seen = new Set(blocks.map((b) => b.id));
    for (const [id, el] of this.blockEls) {
      if (!seen.has(id)) {
        el.remove();
        this.blockEls.delete(id);
      }
    }
    blocks.forEach((block) => this.applyBlock(block));
    this.updateEmptyState();
    this.scrollToBottom();
  }

  private applyBlock(block: RenderBlock) {
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
          'piview-collapsible piview-toolverify border border-app-border/60 rounded p-2 my-1 bg-app-surface/40';
        const { header, label } = this.buildCollapsibleHeader(!this.blocksCollapsed);
        label.className = 'text-app-accent-2 font-semibold whitespace-pre-wrap break-all';
        label.textContent = block.header ?? '';
        wrapper.appendChild(header);
        const body = document.createElement('pre');
        body.setAttribute('data-role', 'body');
        body.className = 'whitespace-pre-wrap break-all text-green-300 mt-1 min-h-0';
        body.textContent = block.text ?? '';
        if (this.blocksCollapsed) body.classList.add('hidden');
        wrapper.appendChild(body);
        el = wrapper;
        break;
      }
      case 'bash': {
        const pre = document.createElement('pre');
        pre.className =
          'whitespace-pre-wrap break-all bg-black/40 border-l-2 border-app-accent-2/40 pl-2 my-0.5';
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
          'piview-collapsible piview-toolverify border rounded p-2 my-1 ' +
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
          'text-app-text/40 border-t border-app-border/40 pt-1 my-1 whitespace-pre-wrap break-all';
        el.textContent = block.text ?? '';
        break;
      }
      case 'text':
      default: {
        el = document.createElement('div');
        el.className = 'whitespace-pre-wrap break-all';
        el.textContent = block.text ?? '';
        break;
      }
    }
    // Shared per-block chrome: positioning context + copy button (on hover).
    el.classList.add('relative', 'group');
    this.attachCopyButton(el, block);
    return el;
  }

  private attachCopyButton(el: HTMLElement, block: RenderBlock) {
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className =
      'piview-copy absolute top-1 right-1 z-10 p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity bg-black/50 hover:bg-black/80 text-green-300 hover:text-white cursor-pointer';
    copyBtn.title = 'Copy block';
    copyBtn.setAttribute('aria-label', 'Copy block');
    copyBtn.setAttribute('data-copy-block', block.id);
    copyBtn.innerHTML = this.cleanIcon(Icon.render('copy', { size: 12, label: 'Copy block' }));
    el.appendChild(copyBtn);
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
        const txt = block.text ?? '';
        if (body.textContent !== txt) body.textContent = txt;
      }
    } else {
      const txt = block.text ?? block.header ?? '';
      // Preserve the per-block copy button while replacing text content.
      const copyBtn = el.querySelector('.piview-copy') as HTMLElement | null;
      if (copyBtn) copyBtn.remove();
      if (el.textContent !== txt) {
        el.textContent = txt;
      }
      if (copyBtn) el.appendChild(copyBtn);
    }
    // Apply error tinting to error blocks.
    if (block.kind === 'error' && !el.classList.contains('text-red-400')) {
      el.classList.add('text-red-400');
    }
  }

  // ---------------------------------------------------------------------------
  // Follow mode / actions
  // ---------------------------------------------------------------------------

  private scrollToBottom() {
    if (this.isFollowMode && this.logContainer) {
      this.logContainer.scrollTop = this.logContainer.scrollHeight;
    }
  }

  private toggleFollow() {
    this.isFollowMode = !this.isFollowMode;
    const btn = this.root.querySelector('#follow-btn');
    if (btn) {
      btn.innerHTML = this.isFollowMode
        ? `${Icon.render('refresh', { size: 14 })} Follow Mode: ON`
        : `${Icon.render('clock', { size: 14 })} Follow Mode: OFF`;

      btn.className = this.isFollowMode
        ? 'px-3 py-1.5 rounded text-xs font-medium bg-app-accent-1 text-white hover:bg-app-accent-1/80 transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer'
        : 'px-3 py-1.5 rounded text-xs font-medium bg-app-surface border border-app-border text-app-text hover:bg-app-bg transition-colors flex items-center gap-1.5 cursor-pointer';
    }
  }

  /**
   * Toggles the global expanded/collapsed state of all `thinking` blocks.
   * Newly rendered thinking blocks follow the current state.
   */
  private toggleThinking() {
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
  private toggleBlocksCollapse() {
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
    btn.setAttribute('aria-label', label);
    btn.title = label;
  }

  /**
   * Toggles the visibility of all `error` blocks. New error blocks follow
   * the current state.
   */
  private toggleErrorVisibility() {
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
    btn.setAttribute('aria-label', label);
    btn.title = label;
  }

  private updateThinkingBtn() {
    const btn = this.root.querySelector('#thinking-toggle-btn') as HTMLElement | null;
    if (!btn) return;
    const expanded = this.thinkingExpanded;
    btn.innerHTML = Icon.render(expanded ? 'chevronDown' : 'chevronRight', { size: 14 });
    btn.setAttribute('aria-pressed', String(expanded));
    const label = expanded ? 'Collapse all thinking blocks' : 'Expand all thinking blocks';
    btn.setAttribute('aria-label', label);
    btn.title = label;
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
      if (this.startTime === null) this.startTime = Date.now();
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
