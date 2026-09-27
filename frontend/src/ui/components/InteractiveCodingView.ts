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

import { PiView } from './PiView.ts';
import { Icon } from './Icon.ts';
import type { InteractiveCodingService } from '../../core/InteractiveCodingService.ts';

export interface InteractiveCodingViewOptions {
  pipelineId: string;
  /** Invoked by the "Stop Session" control (defaults to service.stopSession). */
  onStop?: () => void;
}

/**
 * Interactive coding chat view.
 *
 * Wraps (composes, does not extend) the reusable {@link PiView} so the agent's
 * streamed activity log is rendered exactly like the batch CoderBot log, and
 * adds a composer for sending messages plus a Stop Session control.
 */
export class InteractiveCodingView {
  private service: InteractiveCodingService;
  private root: HTMLElement;
  private pipelineId: string;
  private onStop?: () => void;
  private piView: PiView | null = null;
  private textarea: HTMLTextAreaElement | null = null;
  private sendBtn: HTMLButtonElement | null = null;
  private unsubs: (() => void)[] = [];

  constructor(
    service: InteractiveCodingService,
    root: HTMLElement,
    options: InteractiveCodingViewOptions
  ) {
    this.service = service;
    this.root = root;
    this.pipelineId = options.pipelineId;
    this.onStop = options.onStop;
  }

  render(): void {
    this.root.innerHTML = this.template();

    const mount = this.root.querySelector('#interactive-piview-mount') as HTMLElement | null;
    if (mount) {
      // showFooter: false — the view owns the session controls (Stop Session),
      // so the reused log's own footer Stop button would be a duplicate.
      this.piView = new PiView(this.service, mount, {
        showFooter: false,
        logHeightClass: 'h-[46vh]',
      });
      this.piView.render();
    }

    this.textarea = this.root.querySelector('#interactive-message-input') as HTMLTextAreaElement | null;
    this.sendBtn = this.root.querySelector('#interactive-send-btn') as HTMLButtonElement | null;

    this.sendBtn?.addEventListener('click', () => this.sendMessage());
    this.textarea?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });
    this.root.querySelector('#interactive-stop-btn')?.addEventListener('click', () => this.stopSession());

    // Re-render the composer state whenever the session or busy state changes.
    this.unsubs.push(this.service.onSessionChange(() => this.updateComposerState()));
    this.unsubs.push(this.service.onSessionStateChange(() => this.updateComposerState()));
    this.updateComposerState();

    this.textarea?.focus();
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
    if (this.piView) {
      this.piView.destroy();
      this.piView = null;
    }
    this.root.innerHTML = '';
    this.textarea = null;
    this.sendBtn = null;
  }

  /** Sends the current composer text to the session. */
  async sendMessage(): Promise<void> {
    const text = this.textarea?.value.trim();
    if (!text || this.service.isBusy()) return;

    try {
      await this.service.sendMessage(text);
      if (this.textarea) this.textarea.value = '';
    } catch (e) {
      console.error('Failed to send interactive message:', e);
      alert('Failed to send message to the interactive session.');
    } finally {
      this.updateComposerState();
    }
  }

  /** Stops the interactive session (or delegates to the host callback). */
  async stopSession(): Promise<void> {
    if (this.onStop) {
      this.onStop();
      return;
    }
    try {
      await this.service.stopSession(this.pipelineId);
    } catch (e) {
      console.error('Failed to stop interactive session:', e);
      alert('Failed to stop the interactive session.');
    }
  }

  private updateComposerState() {
    const busy = this.service.isBusy();
    const active = this.service.isActive();
    const disabled = busy || !active;

    if (this.textarea) {
      this.textarea.disabled = disabled;
      this.textarea.placeholder = busy
        ? 'The agent is working…'
        : active
          ? 'Describe the change the agent should make…'
          : 'Session stopped.';
    }
    if (this.sendBtn) {
      this.sendBtn.disabled = disabled;
      this.sendBtn.classList.toggle('opacity-50', disabled);
      this.sendBtn.classList.toggle('cursor-not-allowed', disabled);
    }

    const status = this.root.querySelector('#interactive-status') as HTMLElement | null;
    if (status) {
      status.textContent = busy ? 'Agent working…' : active ? 'Session active' : 'Session stopped';
      status.className = busy
        ? 'text-[10px] font-bold uppercase tracking-widest text-amber-400'
        : active
          ? 'text-[10px] font-bold uppercase tracking-widest text-green-400'
          : 'text-[10px] font-bold uppercase tracking-widest text-app-muted';
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
          <button id="interactive-stop-btn" type="button"
            class="px-3 py-1.5 rounded text-xs font-medium bg-red-600 text-white hover:bg-red-700 transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer">
            ${Icon.render('close', { size: 14 })} Stop Session
          </button>
        </div>
        <div id="interactive-piview-mount"></div>
        <div class="p-3 border-t border-app-border/40 flex items-end gap-2 bg-app-surface/50">
          <textarea id="interactive-message-input" rows="2"
            class="flex-1 resize-y px-3 py-2 rounded-lg text-xs bg-black/30 border border-app-border text-app-text placeholder:text-app-muted/60 focus:outline-none focus:border-app-accent-2/60"
            placeholder="Describe the change the agent should make…"></textarea>
          <button id="interactive-send-btn" type="button"
            class="px-3 py-2 rounded text-xs font-medium bg-app-accent-2 text-white hover:bg-app-accent-2/80 transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer">
            ${Icon.render('arrowRight', { size: 14 })} Send
          </button>
        </div>
      </div>
    `;
  }
}
