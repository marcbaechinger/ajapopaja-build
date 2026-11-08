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

import { PiView, type EmptyStateAction, type PiSessionService } from './PiView.ts';
import { Icon } from '../common/Icon.ts';
import { InteractivePromptView } from './InteractivePromptView.ts';
import type { RenderBlock } from '../../../core/PiLogReducer.ts';
import type { InteractiveCodingService } from '../../../core/InteractiveCodingService.ts';

export interface InteractiveCodingViewOptions {
  pipelineId: string;
  /** Invoked by the "Pause" control (defaults to service.pauseSession). */
  onPause?: () => void;
  /** Optional action button rendered by the embedded PiView's empty state. */
  emptyStateAction?: EmptyStateAction;
  /** Invoked after the agent finishes its turn (the composer is re-enabled). */
  onAgentFinished?: () => void;
}

/**
 * Adapts the singleton {@link InteractiveCodingService} to a single pipeline.
 *
 * The service tracks one active session at a time, so a `PiView` connected
 * directly to it would render whichever pipeline currently owns the session.
 * This decorator exposes only the history/state belonging to `pipelineId`:
 *
 * - while another pipeline owns the session (or no session exists) the view
 *   sees an empty, inactive session, so `PiView` renders its
 *   "No active session…" empty state (including any host-provided action);
 * - when the session is attached to this pipeline the calls pass through
 *   unchanged;
 * - when the scope is left (the singleton attaches to another pipeline) the
 *   decorator emits an empty snapshot and an inactive state so `PiView` drops
 *   the now-stale log.
 *
 * "Attached" means a *live* session for this pipeline: pipeline identity AND
 * `active`. A paused session (active === false) is deliberately treated as
 * detached so the composed `PiView` resets to its "No active session…" empty
 * state; resuming flips `active` back on and re-attaches the session.
 *
 * Exported for testing; production code should treat it as an implementation
 * detail of {@link InteractiveCodingView}.
 */
export class PipelineScopedPiSession implements PiSessionService {
  private service: InteractiveCodingService;
  private pipelineId: string;
  private blockListeners = new Set<(blocks: RenderBlock[]) => void>();
  private messageListeners = new Set<(content: string) => void>();
  private stateListeners = new Set<(active: boolean) => void>();
  private startTimeListeners = new Set<(startTime: number | null) => void>();
  private mine: boolean;
  private unsubscribe: () => void;
  private unsubscribeState: () => void;

  constructor(service: InteractiveCodingService, pipelineId: string) {
    this.service = service;
    this.pipelineId = pipelineId;
    this.mine = this.computeMine();
    // Identity/busy changes AND active-state changes both recompute attachment.
    // `handleSessionChange` is idempotent, so duplicate events are harmless.
    this.unsubscribe = service.onSessionChange(() => this.handleSessionChange());
    this.unsubscribeState = service.onSessionStateChange(() => this.handleSessionChange());
  }

  /** Whether the singleton currently owns a session for this pipeline. */
  isMine(): boolean {
    return this.computeMine();
  }

  /**
   * Whether the singleton currently owns a *live* session for this pipeline.
   * A paused session (active === false) is deliberately treated as detached so
   * the composed PiView resets to its "No active session…" empty state; resuming
   * flips `active` back on and re-attaches the session.
   */
  private computeMine(): boolean {
    const session = this.service.getCurrentSession?.();
    return (
      !!session &&
      session.pipelineId === this.pipelineId &&
      session.active &&
      // Defence in depth: a batch (`coderbot`) session must never attach to
      // the interactive PiView, even if it somehow became the current session.
      session.kind !== 'coderbot'
    );
  }

  private handleSessionChange(): void {
    const mine = this.computeMine();
    if (mine === this.mine) return;
    this.mine = mine;
    if (mine) {
      // Attached to this pipeline: surface the session that already exists.
      const history = this.service.getHistory();
      this.blockListeners.forEach((listener) => listener(history));
      this.stateListeners.forEach((listener) => listener(this.service.isActive()));
    } else {
      // The singleton moved to another pipeline (or detached): clear the
      // embedded log and return to the empty state.
      this.blockListeners.forEach((listener) => listener([]));
      this.stateListeners.forEach((listener) => listener(false));
    }
  }

  /** Releases the subscription to the wrapped singleton. */
  destroy(): void {
    try {
      this.unsubscribe();
      this.unsubscribeState();
    } catch (e) {
      console.error('PipelineScopedPiSession: error tearing down subscription', e);
    }
    this.blockListeners.clear();
    this.messageListeners.clear();
    this.stateListeners.clear();
    this.startTimeListeners.clear();
  }

  getHistory(): RenderBlock[] {
    return this.mine ? this.service.getHistory() : [];
  }

  getCurrentTaskId(): string | null {
    return this.mine ? this.service.getCurrentTaskId() : null;
  }

  isActive(): boolean {
    return this.mine && this.service.isActive();
  }

  getSessionStartTime(): number | null {
    return this.mine ? this.service.getSessionStartTime() : null;
  }

  getCurrentModel(): string | null {
    return this.mine ? (this.service.getCurrentModel?.() ?? null) : null;
  }

  onSessionStartTimeChange(listener: (startTime: number | null) => void): () => void {
    this.startTimeListeners.add(listener);
    const unsub = this.service.onSessionStartTimeChange((startTime) => {
      if (this.mine) listener(startTime);
    });
    return () => {
      this.startTimeListeners.delete(listener);
      unsub();
    };
  }

  clearHistory(): void {
    if (this.mine) this.service.clearHistory();
  }

  stopSession(taskId: string): Promise<unknown> {
    if (!this.mine) return Promise.resolve(undefined);
    return this.service.stopSession(taskId);
  }

  onBlocks(listener: (blocks: RenderBlock[]) => void): () => void {
    this.blockListeners.add(listener);
    const unsub = this.service.onBlocks((blocks) => {
      if (this.mine) listener(blocks);
    });
    return () => {
      this.blockListeners.delete(listener);
      unsub();
    };
  }

  onMessage(listener: (content: string) => void): () => void {
    this.messageListeners.add(listener);
    const unsub = this.service.onMessage((content) => {
      if (this.mine) listener(content);
    });
    return () => {
      this.messageListeners.delete(listener);
      unsub();
    };
  }

  onSessionStateChange(listener: (active: boolean) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }
}

/**
 * Interactive coding chat view.
 *
 * Wraps (composes, does not extend) the reusable {@link PiView} so the agent's
 * streamed activity log is rendered exactly like the batch CoderBot log, and
 * composes an {@link InteractivePromptView} for sending messages plus a Pause
 * control.
 */
export class InteractiveCodingView {
  private service: InteractiveCodingService;
  private root: HTMLElement;
  private pipelineId: string;
  private onPause?: () => void;
  private emptyStateAction?: EmptyStateAction;
  private onAgentFinished?: () => void;
  private piView: PiView | null = null;
  private promptView: InteractivePromptView | null = null;
  private scopedSession: PipelineScopedPiSession | null = null;
  private unsubs: (() => void)[] = [];

  constructor(
    service: InteractiveCodingService,
    root: HTMLElement,
    options: InteractiveCodingViewOptions
  ) {
    this.service = service;
    this.root = root;
    this.pipelineId = options.pipelineId;
    this.onPause = options.onPause;
    this.emptyStateAction = options.emptyStateAction;
    this.onAgentFinished = options.onAgentFinished;
  }

  render(): void {
    this.root.innerHTML = this.template();

    const mount = this.root.querySelector('#interactive-piview-mount') as HTMLElement | null;
    if (mount) {
      // showFooter: false — the view owns the session control (Pause), so the
      // reused log's own footer Stop button would be a duplicate.
      // blocksCollapsedInitially: true — interactive sessions are tool-heavy,
      // so tool output starts collapsed to keep the streaming log scannable.
      // The header toggle expands it on demand.
      // The session is wrapped in a pipeline-scoped adapter so another
      // pipeline's running session never leaks into this view's log.
      this.scopedSession = new PipelineScopedPiSession(this.service, this.pipelineId);
      this.piView = new PiView(this.scopedSession, mount, {
        variant: 'interactive',
        showFooter: false,
        // Roughly 150% of the previous h-[46vh]: a taller log without making the
        // whole tab area grow to its content. The user can drag the log's bottom
        // edge to tune the height themselves.
        logHeightClass: 'h-[69vh]',
        resizable: true,
        blocksCollapsedInitially: true,
        emptyStateAction: this.emptyStateAction,
      });
      this.piView.render();
      // Stay robust if a PiView build predates the option: force the collapsed
      // state so the embedded log always starts with tool bodies hidden.
      if (!this.piView.areBlocksCollapsed()) {
        this.piView.toggleBlocksCollapse();
      }
    }

    // Header controls that drive the reused PiView's rendering toggles. The
    // PiView's own footer is hidden (showFooter: false), so these buttons are
    // the only affordance for the display options.
    this.root
      .querySelector('#interactive-follow-toggle-btn')
      ?.addEventListener('click', () => this.handleDisplayToggle('follow'));
    this.root
      .querySelector('#interactive-thinking-toggle-btn')
      ?.addEventListener('click', () => this.handleDisplayToggle('thinking'));
    this.root
      .querySelector('#interactive-collapse-blocks-btn')
      ?.addEventListener('click', () => this.handleDisplayToggle('collapse'));
    this.root
      .querySelector('#interactive-error-toggle-btn')
      ?.addEventListener('click', () => this.handleDisplayToggle('error'));
    this.updateDisplayButtons();

    const promptMount = this.root.querySelector('#interactive-prompt-mount') as HTMLElement | null;
    if (promptMount) {
      this.promptView = new InteractivePromptView(promptMount, {
        onSubmit: (text) => this.service.sendMessage(text),
        getPipelineId: () => this.pipelineId,
        actionHandlers: { '/clear': () => this.service.clearHistory() },
        onEnabled: this.onAgentFinished,
      });
      this.promptView.render();
    }

    this.root.querySelector('#interactive-pause-btn')?.addEventListener('click', () => this.pauseSession());

    // Re-render the composer state whenever the session or busy state changes.
    this.unsubs.push(this.service.onSessionChange(() => this.updateComposerState()));
    this.unsubs.push(this.service.onSessionStateChange(() => this.updateComposerState()));
    this.updateComposerState();

    this.promptView?.focus();
  }

  destroy(): void {
    this.unsubs.forEach((unsub) => {
      try {
        unsub();
      } catch (e) {
        console.error('InteractiveCodingView: error tearing down subscription', e);
      }
    });
    this.unsubs = [];
    if (this.scopedSession) {
      this.scopedSession.destroy();
      this.scopedSession = null;
    }
    if (this.promptView) {
      this.promptView.destroy();
      this.promptView = null;
    }
    if (this.piView) {
      this.piView.destroy();
      this.piView = null;
    }
    this.root.innerHTML = '';
  }

  /** Convenience hook: submits the current composer text (delegates to the prompt view). */
  async sendMessage(): Promise<void> {
    await this.promptView?.submit();
  }

  /**
   * Pauses the interactive session, keeping it resumable on the backend. Or
   * delegates to the host callback through
   * {@link InteractiveCodingViewOptions.onPause}.
   */
  async pauseSession(): Promise<void> {
    if (this.onPause) {
      this.onPause();
      return;
    }
    try {
      await this.service.pauseSession();
    } catch (e) {
      console.error('Failed to pause interactive session:', e);
      alert('Failed to pause the interactive session.');
    }
  }

  /** Whether the singleton currently owns an interactive session for this pipeline. */
  private isMine(): boolean {
    const session = this.service.getCurrentSession?.();
    return (
      !!session &&
      session.pipelineId === this.pipelineId &&
      // A batch (`coderbot`) session is never an interactive session, so the
      // composer and Pause controls stay disabled for it.
      session.kind !== 'coderbot'
    );
  }

  private updateComposerState() {
    // No session is attached to this pipeline (either none exists or another
    // pipeline owns it): the embedded PiView shows its empty state with the
    // host-provided Start action, so the composer/Pause are inert.
    if (!this.isMine()) {
      this.promptView?.setDisabled(true);
      this.promptView?.setPlaceholder(
        'Start an interactive session to chat with the coding agent.'
      );

      const status = this.root.querySelector('#interactive-status') as HTMLElement | null;
      if (status) {
        status.textContent = 'No active session';
        status.className = 'text-[10px] font-bold uppercase tracking-widest text-app-muted';
      }

      const pauseBtn = this.root.querySelector('#interactive-pause-btn') as HTMLButtonElement | null;
      if (pauseBtn) {
        pauseBtn.disabled = true;
        pauseBtn.className =
          'px-3 py-1.5 rounded text-xs font-medium bg-app-surface/60 text-app-muted border border-app-border opacity-60 transition-colors flex items-center gap-1.5 cursor-not-allowed';
      }
      return;
    }

    const busy = this.service.isBusy();
    const active = this.service.isActive();
    const disabled = busy || !active;

    this.promptView?.setDisabled(disabled);
    this.promptView?.setPlaceholder(
      busy
        ? 'The agent is working…'
        : active
          ? 'Describe the change the agent should make…'
          : 'Session paused — resume it from the session manager.'
    );

    const status = this.root.querySelector('#interactive-status') as HTMLElement | null;
    if (status) {
      status.textContent = busy ? 'Agent working…' : active ? 'Session active' : 'Paused';
      status.className = busy
        ? 'text-[10px] font-bold uppercase tracking-widest text-amber-400'
        : active
          ? 'text-[10px] font-bold uppercase tracking-widest text-green-400'
          : 'text-[10px] font-bold uppercase tracking-widest text-app-muted';
    }

    // The Pause control is only legal while the session is active.
    const pauseBtn = this.root.querySelector('#interactive-pause-btn') as HTMLButtonElement | null;
    if (pauseBtn) {
      pauseBtn.disabled = !active;
      pauseBtn.className = active
        ? 'px-3 py-1.5 rounded text-xs font-medium bg-amber-600 text-white hover:bg-amber-700 transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer'
        : 'px-3 py-1.5 rounded text-xs font-medium bg-app-surface/60 text-app-muted border border-app-border opacity-60 transition-colors flex items-center gap-1.5 cursor-not-allowed';
    }
  }

  /**
   * Applies a header display-toggle click to the reused PiView and refreshes
   * the associated header button state.
   */
  private handleDisplayToggle(action: 'thinking' | 'collapse' | 'error' | 'follow'): void {
    if (!this.piView) return;
    if (action === 'thinking') {
      this.piView.toggleThinking();
    } else if (action === 'collapse') {
      this.piView.toggleBlocksCollapse();
    } else if (action === 'follow') {
      this.piView.toggleFollow();
    } else {
      this.piView.toggleErrorVisibility();
    }
    this.updateDisplayButtons();
  }

  /**
   * Refreshes the header rendering-control buttons so their icons, pressed
   * state and accessible labels mirror the PiView's current display state.
   */
  private updateDisplayButtons(): void {
    const follow = this.root.querySelector(
      '#interactive-follow-toggle-btn'
    ) as HTMLButtonElement | null;
    if (follow) {
      const following = this.piView?.isFollowing() ?? true;
      follow.innerHTML = Icon.render(following ? 'refresh' : 'clock', { size: 14 });
      follow.setAttribute('aria-pressed', String(following));
      const label = following ? 'Disable follow mode' : 'Enable follow mode';
      follow.title = label;
      follow.setAttribute('aria-label', label);
    }

    const thinking = this.root.querySelector(
      '#interactive-thinking-toggle-btn'
    ) as HTMLButtonElement | null;
    if (thinking) {
      const expanded = this.piView?.isThinkingExpanded() ?? true;
      thinking.innerHTML = Icon.render(expanded ? 'chevronDown' : 'chevronRight', { size: 14 });
      thinking.setAttribute('aria-pressed', String(expanded));
      const label = expanded ? 'Collapse all thinking blocks' : 'Expand all thinking blocks';
      thinking.title = label;
      thinking.setAttribute('aria-label', label);
    }

    const collapse = this.root.querySelector(
      '#interactive-collapse-blocks-btn'
    ) as HTMLButtonElement | null;
    if (collapse) {
      const collapsed = this.piView?.areBlocksCollapsed() ?? false;
      collapse.innerHTML = Icon.render(collapsed ? 'plus' : 'minus', { size: 14 });
      collapse.setAttribute('aria-pressed', String(collapsed));
      const label = collapsed ? 'Expand all blocks' : 'Collapse all blocks';
      collapse.title = label;
      collapse.setAttribute('aria-label', label);
    }

    const error = this.root.querySelector(
      '#interactive-error-toggle-btn'
    ) as HTMLButtonElement | null;
    if (error) {
      const visible = this.piView?.isErrorVisible() ?? true;
      error.innerHTML = Icon.render(visible ? 'eye' : 'eyeOff', { size: 14 });
      error.setAttribute('aria-pressed', String(visible));
      const label = visible ? 'Hide error blocks' : 'Show error blocks';
      error.title = label;
      error.setAttribute('aria-label', label);
    }
  }

  private template(): string {
    return `
      <div class="flex flex-col bg-app-surface/30 rounded-3xl border border-app-border/30 overflow-hidden">
        <div class="flex items-center justify-between gap-3 px-4 py-3 border-b border-app-border/40">
          <div class="flex items-center gap-2 min-w-0">
            <span class="text-app-accent-2" aria-hidden="true">${Icon.render('lightning', { size: 16 })}</span>
            <h3 class="text-sm font-bold text-app-text truncate">Interactive Coding Session</h3>
            <span id="interactive-status" class="text-[10px] font-bold uppercase tracking-widest text-app-muted">Session active</span>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <div id="interactive-display-controls" class="flex items-center gap-1" role="group" aria-label="Log display options">
              <button id="interactive-follow-toggle-btn" type="button"
                class="p-1.5 rounded text-xs font-medium bg-app-surface border border-app-border text-app-text hover:bg-app-bg transition-colors flex items-center justify-center cursor-pointer"
                aria-pressed="true" title="Disable follow mode"
                aria-label="Disable follow mode">
                ${Icon.render('refresh', { size: 14 })}
              </button>
              <button id="interactive-thinking-toggle-btn" type="button"
                class="p-1.5 rounded text-xs font-medium bg-app-surface border border-app-border text-app-text hover:bg-app-bg transition-colors flex items-center justify-center cursor-pointer"
                aria-pressed="true" title="Collapse all thinking blocks"
                aria-label="Collapse all thinking blocks">
                ${Icon.render('chevronDown', { size: 14 })}
              </button>
              <button id="interactive-collapse-blocks-btn" type="button"
                class="p-1.5 rounded text-xs font-medium bg-app-surface border border-app-border text-app-text hover:bg-app-bg transition-colors flex items-center justify-center cursor-pointer"
                aria-pressed="false" title="Collapse all blocks"
                aria-label="Collapse all blocks">
                ${Icon.render('minus', { size: 14 })}
              </button>
              <button id="interactive-error-toggle-btn" type="button"
                class="p-1.5 rounded text-xs font-medium bg-app-surface border border-app-border text-app-text hover:bg-app-bg transition-colors flex items-center justify-center cursor-pointer"
                aria-pressed="true" title="Hide error blocks"
                aria-label="Hide error blocks">
                ${Icon.render('eye', { size: 14 })}
              </button>
            </div>
            <button id="interactive-pause-btn" type="button"
              class="px-3 py-1.5 rounded text-xs font-medium bg-amber-600 text-white hover:bg-amber-700 transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer"
              title="Stop the agent now; the session stays resumable">
              ${Icon.render('clock', { size: 14 })} Pause
            </button>
          </div>
        </div>
        <div id="interactive-piview-mount"></div>
        <div class="p-3 border-t border-app-border/40 bg-app-surface/50">
          <div id="interactive-prompt-mount"></div>
        </div>
      </div>
    `;
  }
}
