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
import { AuthService } from '../../core/AuthService.ts';

export class LogViewerDialog extends BaseDialog {
  private streamUrl: string;
  private authService: AuthService;
  private logContainer: HTMLElement | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private isFollowMode = true;
  private abortController: AbortController | null = null;

  constructor(streamUrl: string, authService: AuthService) {
    super({
      title: 'Gemini Engine Logs',
      maxWidth: 'max-w-4xl',
      maxHeight: 'max-h-[85vh]',
      iconSvg: `<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>`
    });
    this.streamUrl = streamUrl;
    this.authService = authService;
    
    // Refresh body and footer (BaseDialog constructor calls renderBody/Footer but we might need explicit initialization)
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
          this.clearLogs();
        } else if (action === 'toggle-follow') {
          this.toggleFollow();
        }
      }
      
      if (target.id === 'dialog-footer-close-btn' || target.closest('#dialog-footer-close-btn')) {
        this.close();
      }
    });

    this.startStreaming();
  }

  protected renderBody(): string {
    return `
      <div class="bg-black text-green-400 p-4 font-mono text-[10px] leading-tight overflow-y-auto h-[60vh] custom-scrollbar selection:bg-app-accent-1/30" id="log-content-container">
        <div id="log-lines" class="whitespace-pre-wrap break-all"></div>
      </div>
    `;
  }

  protected renderFooter(): string {
    return `
      <div class="p-3 border-t border-app-border flex justify-between items-center bg-app-surface/50">
        <div class="flex gap-2">
          <button data-action="toggle-follow" id="follow-btn" class="px-3 py-1.5 rounded text-xs font-medium bg-app-accent-1 text-white hover:bg-app-accent-1/80 transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 13l-7 7-7-7m14-8l-7 7-7-7"></path></svg>
            Follow Mode: ON
          </button>
          <button data-action="clear-logs" class="px-3 py-1.5 rounded text-xs font-medium bg-app-surface border border-app-border text-app-text hover:bg-app-bg transition-colors flex items-center gap-1.5 cursor-pointer">
            <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
            Clear
          </button>
        </div>
        <button id="dialog-footer-close-btn" class="px-4 py-1.5 rounded text-xs font-bold bg-app-bg border border-app-border text-app-text hover:bg-app-surface transition-colors cursor-pointer">
          Close
        </button>
      </div>
    `;
  }

  private async startStreaming() {
    this.logContainer = this.dialog.querySelector('#log-content-container');
    const logLines = this.dialog.querySelector('#log-lines');
    if (!logLines || !this.logContainer) return;

    this.abortController = new AbortController();
    const token = this.authService.getAccessToken();

    try {
      const response = await fetch(this.streamUrl, {
        headers: {
          'Authorization': `Bearer ${token}`
        },
        signal: this.abortController.signal
      });

      if (!response.ok) {
        logLines.innerHTML = `<span class="text-red-500">Failed to connect to log stream: ${response.statusText}</span>\n`;
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        logLines.innerHTML = `<span class="text-red-500">Response body is not readable</span>\n`;
        return;
      }
      this.reader = reader;

      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const span = document.createElement('span');
        span.textContent = chunk;
        logLines.appendChild(span);

        if (this.isFollowMode && this.logContainer) {
          this.logContainer.scrollTop = this.logContainer.scrollHeight;
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      console.error('Log stream error:', err);
      logLines.innerHTML += `<span class="text-red-500">\nStream disconnected: ${err.message}</span>\n`;
    }
  }

  private clearLogs() {
    const logLines = this.dialog.querySelector('#log-lines');
    if (logLines) logLines.innerHTML = '';
  }

  private toggleFollow() {
    this.isFollowMode = !this.isFollowMode;
    const btn = this.dialog.querySelector('#follow-btn');
    if (btn) {
      btn.innerHTML = this.isFollowMode 
        ? `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 13l-7 7-7-7m14-8l-7 7-7-7"></path></svg> Follow Mode: ON`
        : `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg> Follow Mode: OFF`;
      
      btn.className = this.isFollowMode
        ? 'px-3 py-1.5 rounded text-xs font-medium bg-app-accent-1 text-white hover:bg-app-accent-1/80 transition-colors flex items-center gap-1.5 shadow-sm cursor-pointer'
        : 'px-3 py-1.5 rounded text-xs font-medium bg-app-surface border border-app-border text-app-text hover:bg-app-bg transition-colors flex items-center gap-1.5 cursor-pointer';
    }
  }

  protected close(result: any = null) {
    if (this.abortController) {
      this.abortController.abort();
    }
    if (this.reader) {
      this.reader.cancel();
    }
    super.close(result);
  }
}
