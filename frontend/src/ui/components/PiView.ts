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

  constructor(service: PiSessionService, mount: HTMLElement, options: PiViewOptions = {}) {
    this.service = service;
    this.root = mount;
    this.showFooter = options.showFooter ?? true;
    this.isFollowMode = options.followInitially ?? true;
    this.logHeightClass = options.logHeightClass ?? 'h-[60vh]';
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
    }
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
  }

  // ---------------------------------------------------------------------------
  // DOM construction
  // ---------------------------------------------------------------------------

  private buildLogArea(): HTMLElement {
    const container = document.createElement('div');
    container.id = 'log-content-container';
    container.className =
      `bg-black text-green-400 p-4 font-mono text-[11px] leading-tight overflow-y-auto ${this.logHeightClass} custom-scrollbar selection:bg-app-accent-1/30`;
    const blocks = document.createElement('div');
    blocks.id = 'log-blocks';
    blocks.className = 'space-y-1';
    container.appendChild(blocks);
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

    footer.appendChild(actions);

    // Delegate action clicks on the root so the handler survives footer rebuilds
    // and only listens while this view is alive.
    this.root.addEventListener('click', this.handleClick);
    this.unsubs.push(() => this.root.removeEventListener('click', this.handleClick));

    this.updateThinkingBtn();

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
    }
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
        }
      })
    );
  }

  private initStateSync() {
    // Initial state
    this.updateStopButtonVisibility(this.service.isActive());

    // Subscribe to state changes
    this.unsubs.push(
      this.service.onSessionStateChange((active) => {
        this.updateStopButtonVisibility(active);
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
    this.scrollToBottom();
  }

  private applyBlock(block: RenderBlock) {
    let el = this.blockEls.get(block.id);
    if (!el) {
      el = this.createBlockEl(block);
      this.blockEls.set(block.id, el);
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
          'border border-app-border/60 rounded p-2 my-1 bg-app-surface/40';
        const header = document.createElement('div');
        header.setAttribute('data-role', 'header');
        header.className = 'text-app-accent-2 font-semibold whitespace-pre-wrap';
        header.textContent = block.header ?? '';
        wrapper.appendChild(header);
        const body = document.createElement('pre');
        body.setAttribute('data-role', 'body');
        body.className = 'whitespace-pre-wrap break-all text-green-300 mt-1 min-h-0';
        body.textContent = block.text ?? '';
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
        el.className = 'text-red-400 whitespace-pre-wrap break-all';
        el.textContent = block.text ?? '';
        break;
      }
      case 'verification': {
        const wrapper = document.createElement('div');
        const isError = block.error;
        wrapper.className =
          'border rounded p-2 my-1 ' +
          (isError
            ? 'border-red-500/60 bg-red-950/30'
            : 'border-green-500/60 bg-green-950/30');
        const header = document.createElement('div');
        header.setAttribute('data-role', 'header');
        header.className =
          'font-semibold whitespace-pre-wrap ' +
          (isError ? 'text-red-400' : 'text-green-400');
        header.textContent = block.text ?? '';
        wrapper.appendChild(header);
        const body = document.createElement('pre');
        body.setAttribute('data-role', 'body');
        body.className = 'whitespace-pre-wrap break-all text-green-300 mt-1 min-h-0';
        body.textContent = (block.sub ?? []).join('\n');
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
    return el;
  }

  private updateBlockEl(el: HTMLElement, block: RenderBlock) {
    const header = el.querySelector('[data-role="header"]') as HTMLElement | null;
    if (header && block.kind !== 'thinking') {
      header.textContent = block.kind === 'verification' ? (block.text ?? '') : (block.header ?? '');
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
      if (el.textContent !== txt) {
        el.textContent = txt;
      }
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
}
