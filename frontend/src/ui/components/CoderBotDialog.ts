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
import { Icon } from './Icon.ts';

export class CoderBotDialog extends BaseDialog {
  private coderBotService: CoderBotService;
  private logContainer: HTMLElement | null = null;
  private isFollowMode = true;
  private unsubscribe: (() => void) | null = null;

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
        }
      }
      
      if (target.id === 'dialog-footer-close-btn' || target.closest('#dialog-footer-close-btn')) {
        this.close();
      }
    });

    this.initLogDisplay();
  }

  protected renderBody(): string {
    return `
      <div class="bg-black text-green-400 p-4 font-mono text-[11px] leading-tight overflow-y-auto h-[60vh] custom-scrollbar selection:bg-app-accent-1/30" id="log-content-container">
        <div id="log-lines" class="whitespace-pre-wrap break-all"></div>
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
        </div>
        <button id="dialog-footer-close-btn" class="px-4 py-1.5 rounded text-xs font-bold bg-app-bg border border-app-border text-app-text hover:bg-app-surface transition-colors cursor-pointer">
          Close
        </button>
      </div>
    `;
  }

  private initLogDisplay() {
    this.logContainer = this.dialog.querySelector('#log-content-container');
    const logLines = this.dialog.querySelector('#log-lines');
    if (!logLines || !this.logContainer) return;

    // Load initial history
    const history = this.coderBotService.getHistory();
    if (history) {
      logLines.textContent = history;
      if (this.isFollowMode) {
        this.logContainer.scrollTop = this.logContainer.scrollHeight;
      }
    }

    // Subscribe to new messages
    this.unsubscribe = this.coderBotService.onMessage((content) => {
      if (content === '') {
        logLines.textContent = '';
      } else {
        logLines.appendChild(document.createTextNode(content));
        if (this.isFollowMode && this.logContainer) {
          this.logContainer.scrollTop = this.logContainer.scrollHeight;
        }
      }
    });
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
    super.close(result);
  }
}
