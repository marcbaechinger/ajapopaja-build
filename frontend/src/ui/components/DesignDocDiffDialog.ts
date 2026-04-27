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
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { diffLines } from 'diff';
import { DesignDocHistory, Task } from '../../core/domain.ts';
import { AppContext } from '../../core/AppContext.ts';

type ViewMode = 'side-by-side' | 'unified';

export class DesignDocDiffDialog extends BaseDialog<void> {
  private task: Task;
  private history: DesignDocHistory[] = [];
  private selectedHistoryIndex: number = -1;
  private context: AppContext;
  private viewMode: ViewMode = 'side-by-side';

  constructor(context: AppContext, task: Task) {
    super({ 
      title: 'Design Document History', 
      maxWidth: 'max-w-6xl',
      maxHeight: 'max-h-[90vh]'
    });
    this.context = context;
    this.task = task;
    this.loadHistory();
  }

  private async loadHistory() {
    try {
      this.history = await this.context.taskClient.getHistory(this.task.id!);
      if (this.history.length > 0) {
        this.selectedHistoryIndex = 0;
      }
      this.refresh();
    } catch (error) {
      console.error('Failed to load history:', error);
      const bodyContainer = this.dialog.querySelector('#dialog-body-container') as HTMLElement;
      if (bodyContainer) {
        bodyContainer.innerHTML = '<div class="p-8 text-red-500">Failed to load history.</div>';
      }
    }
  }

  private refresh() {
    const bodyContainer = this.dialog.querySelector('#dialog-body-container') as HTMLElement;
    if (bodyContainer) {
      bodyContainer.innerHTML = this.renderBody();
      this.attachInternalEvents();
    }
  }

  private attachInternalEvents() {
    const selector = this.dialog.querySelector('#version-selector') as HTMLSelectElement;
    if (selector) {
      selector.addEventListener('change', (e) => {
        this.selectedHistoryIndex = parseInt((e.target as HTMLSelectElement).value);
        this.refresh();
      });
    }

    const modeToggle = this.dialog.querySelectorAll('input[name="view-mode"]');
    modeToggle.forEach(input => {
      input.addEventListener('change', (e) => {
        this.viewMode = (e.target as HTMLInputElement).value as ViewMode;
        this.refresh();
      });
    });

    const restoreBtn = this.dialog.querySelector('#restore-version-btn');
    if (restoreBtn) {
      restoreBtn.addEventListener('click', async () => {
        if (this.selectedHistoryIndex === -1) return;
        const selected = this.history[this.selectedHistoryIndex];
        if (confirm(`Are you sure you want to restore version ${selected.version}?`)) {
          try {
            await this.context.taskClient.updateDetails(this.task.id!, this.task.version, { design_doc: selected.design_doc });
            this.close();
          } catch (error) {
            alert('Failed to restore version: ' + error);
          }
        }
      });
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  private renderUnifiedDiff(oldText: string, newText: string): string {
    const changes = diffLines(oldText, newText);
    const diffHtml = changes.map(part => {
      const tag = part.added ? 'ins' : part.removed ? 'del' : 'span';
      // Use classes for block-level diffing if it contains newlines
      const className = part.added ? 'bg-green-500/10 block' : part.removed ? 'bg-red-500/10 block' : '';
      return `<${tag} class="${className}">${this.escapeHtml(part.value)}</${tag}>`;
    }).join('');
    
    return `<pre class="whitespace-pre-wrap font-mono text-sm p-4 bg-black/20 rounded-xl border border-app-border/30">${diffHtml}</pre>`;
  }

  protected renderBody(): string {
    if (!this.history || (this.history.length === 0 && this.selectedHistoryIndex === -1)) {
      return '<div class="p-8 text-app-muted italic">No historical versions found.</div>';
    }

    const currentDoc = (this.task && this.task.design_doc) || '';
    const historicalDoc = this.selectedHistoryIndex !== -1 ? this.history[this.selectedHistoryIndex].design_doc : '';
    const historicalVersion = this.selectedHistoryIndex !== -1 ? this.history[this.selectedHistoryIndex].version : 'N/A';
    const historicalTime = this.selectedHistoryIndex !== -1 ? new Date(this.history[this.selectedHistoryIndex].timestamp).toLocaleString() : '';

    return `
      <div class="flex flex-col h-full">
        <div class="p-4 border-b border-app-border flex flex-wrap items-center justify-between gap-4 bg-app-surface/30">
          <div class="flex items-center gap-6">
            <div class="flex items-center gap-3">
              <label for="version-selector" class="text-[10px] font-black text-app-muted uppercase tracking-widest">Compare with:</label>
              <select id="version-selector" class="bg-app-bg border border-app-border rounded-lg px-3 py-1.5 text-xs text-app-text outline-none focus:ring-2 focus:ring-app-accent-1/50 transition-all">
                ${this.history.map((h, i) => `
                  <option value="${i}" ${this.selectedHistoryIndex === i ? 'selected' : ''}>
                    v${h.version} (${new Date(h.timestamp).toLocaleString()})
                  </option>
                `).join('')}
              </select>
            </div>

            <div class="flex items-center bg-app-bg border border-app-border rounded-lg p-1">
              <label class="flex items-center gap-2 px-3 py-1 rounded-md cursor-pointer transition-all ${this.viewMode === 'side-by-side' ? 'bg-app-surface text-app-accent-1 shadow-sm' : 'text-app-muted hover:text-app-text'}">
                <input type="radio" name="view-mode" value="side-by-side" class="hidden" ${this.viewMode === 'side-by-side' ? 'checked' : ''}>
                <span class="text-[10px] font-bold uppercase tracking-wider">Side-by-Side</span>
              </label>
              <label class="flex items-center gap-2 px-3 py-1 rounded-md cursor-pointer transition-all ${this.viewMode === 'unified' ? 'bg-app-surface text-app-accent-1 shadow-sm' : 'text-app-muted hover:text-app-text'}">
                <input type="radio" name="view-mode" value="unified" class="hidden" ${this.viewMode === 'unified' ? 'checked' : ''}>
                <span class="text-[10px] font-bold uppercase tracking-wider">Unified Diff</span>
              </label>
            </div>
          </div>

          ${this.selectedHistoryIndex !== -1 ? `
            <button id="restore-version-btn" class="px-4 py-2 bg-app-accent-2/10 hover:bg-app-accent-2/20 text-app-accent-2 border border-app-accent-2/30 rounded-xl transition-all text-[10px] font-black uppercase tracking-widest cursor-pointer active:scale-95">
              Restore v${historicalVersion}
            </button>
          ` : ''}
        </div>
        
        <div class="flex-grow overflow-hidden bg-app-bg/50">
          ${this.viewMode === 'side-by-side' ? `
            <div class="grid grid-cols-2 gap-0 h-full">
              <!-- Historical Version -->
              <div class="flex flex-col border-r border-app-border h-full">
                <div class="px-4 py-2 bg-app-surface/50 border-b border-app-border flex justify-between items-center">
                  <span class="text-[10px] font-black uppercase tracking-widest text-app-muted">Historical v${historicalVersion}</span>
                  <span class="text-[10px] text-app-muted/60 font-medium">${historicalTime}</span>
                </div>
                <div class="p-8 overflow-y-auto prose-theme prose-sm max-w-none custom-scrollbar">
                  ${DOMPurify.sanitize(marked.parse(historicalDoc) as string)}
                </div>
              </div>
              
              <!-- Current Version -->
              <div class="flex flex-col h-full">
                <div class="px-4 py-2 bg-app-surface/50 border-b border-app-border flex justify-between items-center">
                  <span class="text-[10px] font-black uppercase tracking-widest text-app-accent-1">Current v${this.task.version}</span>
                </div>
                <div class="p-8 overflow-y-auto prose-theme prose-sm max-w-none custom-scrollbar">
                  ${DOMPurify.sanitize(marked.parse(currentDoc) as string)}
                </div>
              </div>
            </div>
          ` : `
            <div class="h-full flex flex-col">
              <div class="px-4 py-2 bg-app-surface/50 border-b border-app-border">
                <span class="text-[10px] font-black uppercase tracking-widest text-app-accent-1">Unified Diff: v${historicalVersion} → v${this.task.version}</span>
              </div>
              <div class="p-8 overflow-y-auto custom-scrollbar">
                ${this.renderUnifiedDiff(historicalDoc, currentDoc)}
              </div>
            </div>
          `}
        </div>
      </div>
    `;
  }

  protected renderFooter(): string {
    return `
      <div class="p-4 border-t border-app-border flex justify-end bg-app-surface/30">
        <button id="dialog-close-action" class="px-8 py-2.5 bg-app-surface border border-app-border hover:border-app-accent-1 text-app-text rounded-xl transition-all font-bold text-sm cursor-pointer active:scale-95 shadow-lg">
          Close
        </button>
      </div>
    `;
  }

  public async show(): Promise<void> {
    const showPromise = super.show();
    this.dialog.querySelector('#dialog-close-action')?.addEventListener('click', () => this.close());
    await showPromise;
  }
}
