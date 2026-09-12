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

import { BaseDialog } from './dialog_common.ts';
import { CoderBotService } from '../../core/CoderBotService.ts';
import type { RenderBlock } from '../../core/CoderBotService.ts';
import { Icon } from './Icon.ts';

export class CoderBotDialog extends BaseDialog {
  private coderBotService: CoderBotService;
  private logContainer: HTMLElement | null = null;
  private blocksContainer: HTMLElement | null = null;
  private blockEls: Map<string, HTMLElement> = new Map();
  private isFollowMode = true;
  private unsubscribe: (() => void) | null = null;
  private blockUnsubscribe: (() => void) | null = null;
  private stateUnsubscribe: (() => void) | null = null;

  constructor(coderBotService: CoderBotService) {
    super({
      title: 'CoderBot Activity Log',
      maxWidth: 'max-w-4xl',
      maxHeight: 'max-h-[85vh]',
      iconSvg: Icon.render('documentation', { size: 20 })
    });
    this.coderBotService = coderBotService;
    
    // Refresh body and footer
    const bodyContainer = this.dialog.querySelector('#dialog-body-container') as HTMLElement;
    bodyContainer.innerHTML = this.renderBody() as string;
    
    const footerContainer = this.dialog.querySelector('#dialog-footer-container') as HTMLElement;
    footerContainer.innerHTML = this.renderFooter() as string;

    // Register actions
    this.dialog.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const actionBtn = target.closest('[data-action]');
      if (actionBtn) {
        const action = actionBtn.getAttribute('data-action');
        if (action === 'clear-logs') {
          this.coderBotService.clearHistory();
        } else if (action === 'toggle-follow') {
          this.toggleFollow();
        } else if (action === 'stop-bot') {
          this.stopBot();
        }
      }
      
      if (target.id === 'dialog-footer-close-btn' || target.closest('#dialog-footer-close-btn')) {
        this.close();
      }
    });

    this.initLogDisplay();
    this.initStateSync();
  }

  protected renderBody(): string {
    return `
      <div class="bg-black text-green-400 p-4 font-mono text-[11px] leading-tight overflow-y-auto h-[60vh] custom-scrollbar selection:bg-app-accent-1/30" id="log-content-container">
        <div id="log-blocks" class="space-y-1"></div>
      </div>
    `;
  }

  protected renderFooter(): string {
    return `
      <div class="p-3 border-t border-app-border flex justify-between items-center bg-app-surface/50">
        <div class="flex gap-2">
          <button data-action="toggle-follow" id="follow-btn" class="px-3 py-1.5 rounded text-xs font-medium bg-app-accent-1 text-white hover:bg-app-accent-1/80 transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer">
            ${Icon.render('refresh', { size: 14 })}
            Follow Mode: ON
          </button>
          <button data-action="clear-logs" class="px-3 py-1.5 rounded text-xs font-medium bg-app-surface border border-app-border text-app-text hover:bg-app-bg transition-colors flex items-center gap-1.5 cursor-pointer">
            ${Icon.render('trash', { size: 14 })}
            Clear
          </button>
          <button data-action="stop-bot" id="stop-bot-btn" class="px-3 py-1.5 rounded text-xs font-medium bg-red-600 text-white hover:bg-red-700 transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer hidden">
            ${Icon.render('close', { size: 14 })}
            Stop Bot
          </button>
        </div>
        <button id="dialog-footer-close-btn" class="px-4 py-1.5 rounded text-xs font-bold bg-app-bg border border-app-border text-app-text hover:bg-app-surface transition-colors cursor-pointer">
          Close
        </button>
      </div>
    `;
  }

  private initLogDisplay() {
    this.logContainer = this.dialog.querySelector('#log-content-container');
    this.blocksContainer = this.dialog.querySelector('#log-blocks');
    if (!this.blocksContainer || !this.logContainer) return;

    // Load initial history
    const history = this.coderBotService.getHistory();
    history.forEach((block) => this.applyBlock(block));
    this.scrollToBottom();

    // Subscribe to block changes
    this.blockUnsubscribe = this.coderBotService.onBlocks((blocks) => {
      this.reconcile(blocks);
    });

    // Keep legacy onMessage subscription for non-CoderBot streams (harmless if unused).
    this.unsubscribe = this.coderBotService.onMessage((content) => {
      if (content === '') {
        this.blocksContainer!.replaceChildren();
        this.blockEls.clear();
      }
    });
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
        el.className = 'italic opacity-70 whitespace-pre-wrap break-all';
        el.textContent = block.text ?? '';
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
    if (header) {
      header.textContent = block.header ?? '';
    }
    const body = el.querySelector('[data-role="body"]') as HTMLElement | null;
    if (body) {
      const txt = block.text ?? '';
      if (body.textContent !== txt) {
        body.textContent = txt;
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

  private scrollToBottom() {
    if (this.isFollowMode && this.logContainer) {
      this.logContainer.scrollTop = this.logContainer.scrollHeight;
    }
  }

  private initStateSync() {
    // Initial state
    this.updateStopButtonVisibility(this.coderBotService.isActive());

    // Subscribe to state changes
    this.stateUnsubscribe = this.coderBotService.onSessionStateChange((active) => {
      this.updateStopButtonVisibility(active);
    });
  }

  private updateStopButtonVisibility(active: boolean) {
    const btn = this.dialog.querySelector('#stop-bot-btn');
    if (btn) {
      if (active) {
        btn.classList.remove('hidden');
      } else {
        btn.classList.add('hidden');
      }
    }
  }

  private async stopBot() {
    const taskId = this.coderBotService.getCurrentTaskId();
    if (!taskId) return;

    const btn = this.dialog.querySelector('#stop-bot-btn') as HTMLButtonElement;
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `${Icon.render('refresh', { size: 14, className: 'animate-spin' })} Stopping...`;
    }

    try {
      await this.coderBotService.stopSession(taskId);
    } catch (e) {
      console.error('Failed to stop CoderBot session:', e);
      alert('Failed to stop CoderBot session. See console for details.');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `${Icon.render('close', { size: 14 })} Stop Bot`;
      }
    }
  }

  private toggleFollow() {
    this.isFollowMode = !this.isFollowMode;
    const btn = this.dialog.querySelector('#follow-btn');
    if (btn) {
      btn.innerHTML = this.isFollowMode 
        ? `${Icon.render('refresh', { size: 14 })} Follow Mode: ON`
        : `${Icon.render('clock', { size: 14 })} Follow Mode: OFF`;
      
      btn.className = this.isFollowMode
        ? 'px-3 py-1.5 rounded text-xs font-medium bg-app-accent-1 text-white hover:bg-app-accent-1/80 transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer'
        : 'px-3 py-1.5 rounded text-xs font-medium bg-app-surface border border-app-border text-app-text hover:bg-app-bg transition-colors flex items-center gap-1.5 cursor-pointer';
    }
  }

  protected close(result: any = null) {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
    if (this.blockUnsubscribe) {
      this.blockUnsubscribe();
    }
    if (this.stateUnsubscribe) {
      this.stateUnsubscribe();
    }
    super.close(result);
  }
}
