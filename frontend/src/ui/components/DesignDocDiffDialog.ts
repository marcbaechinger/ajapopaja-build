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
import { DesignDocHistory, Task } from '../../core/domain.ts';
import { AppContext } from '../../core/AppContext.ts';

export class DesignDocDiffDialog extends BaseDialog<void> {
  private task: Task;
  private history: DesignDocHistory[] = [];
  private selectedHistoryIndex: number = -1;
  private context: AppContext;

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

  protected renderBody(): string {
    if (this.history.length === 0 && this.selectedHistoryIndex === -1) {
      return '<div class="p-8 text-app-muted italic">No historical versions found.</div>';
    }

    const currentDoc = this.task.design_doc || '';
    const historicalDoc = this.selectedHistoryIndex !== -1 ? this.history[this.selectedHistoryIndex].design_doc : '';
    const historicalVersion = this.selectedHistoryIndex !== -1 ? this.history[this.selectedHistoryIndex].version : 'N/A';
    const historicalTime = this.selectedHistoryIndex !== -1 ? new Date(this.history[this.selectedHistoryIndex].timestamp).toLocaleString() : '';

    return `
      <div class="flex flex-col h-full">
        <div class="p-4 border-b border-app-border flex items-center justify-between bg-app-surface/30">
          <div class="flex items-center gap-4">
            <label for="version-selector" class="text-xs font-bold text-app-muted uppercase tracking-wider">Compare with Version:</label>
            <select id="version-selector" class="bg-app-bg border border-app-border rounded px-2 py-1 text-sm text-app-text outline-none focus:ring-1 focus:ring-app-accent-1">
              ${this.history.map((h, i) => `
                <option value="${i}" ${this.selectedHistoryIndex === i ? 'selected' : ''}>
                  Version ${h.version} (${new Date(h.timestamp).toLocaleString()})
                </option>
              `).join('')}
            </select>
          </div>
          ${this.selectedHistoryIndex !== -1 ? `
            <button id="restore-version-btn" class="px-4 py-1.5 bg-app-accent-2 text-white rounded-lg hover:brightness-110 transition-all text-xs font-bold shadow-md cursor-pointer">
              Restore this version
            </button>
          ` : ''}
        </div>
        
        <div class="grid grid-cols-2 gap-0 flex-grow overflow-hidden">
          <!-- Historical Version -->
          <div class="flex flex-col border-r border-app-border">
            <div class="p-2 bg-app-surface border-b border-app-border flex justify-between items-center">
              <span class="text-[10px] font-black uppercase tracking-widest text-app-muted">Historical Version ${historicalVersion}</span>
              <span class="text-[10px] text-app-muted">${historicalTime}</span>
            </div>
            <div class="p-6 overflow-y-auto prose-theme prose-sm max-w-none">
              ${DOMPurify.sanitize(marked.parse(historicalDoc) as string)}
            </div>
          </div>
          
          <!-- Current Version -->
          <div class="flex flex-col">
            <div class="p-2 bg-app-surface border-b border-app-border flex justify-between items-center">
              <span class="text-[10px] font-black uppercase tracking-widest text-app-accent-1">Current Version ${this.task.version}</span>
            </div>
            <div class="p-6 overflow-y-auto prose-theme prose-sm max-w-none">
              ${DOMPurify.sanitize(marked.parse(currentDoc) as string)}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  protected renderFooter(): string {
    return `
      <div class="p-4 border-t border-app-border flex justify-end bg-app-surface/30">
        <button id="dialog-close-action" class="px-6 py-2 bg-app-surface border border-app-border hover:border-app-accent-1 text-app-text rounded-xl transition-all font-bold cursor-pointer">
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
