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

import { Task, TaskStatus } from '../../core/domain.ts';
import { BaseDialog } from './dialog_common.ts';
import { AppContext } from '../../core/AppContext.ts';
import { TaskItem } from './TaskItem.ts';
import { PaginationControl } from './PaginationControl.ts';

export class SearchDialog extends BaseDialog {
  private context: AppContext;
  private keywords: string = '';
  private selectedStatuses: Set<TaskStatus> = new Set();
  private results: Task[] = [];
  private totalCount: number = 0;
  private currentPage: number = 0;
  private pageSize: number = 10;
  private isSearching: boolean = false;
  private searchTimeout: any = null;

  constructor(context: AppContext) {
    super({
      title: 'Global Task Search',
      maxWidth: 'max-w-4xl',
      maxHeight: 'max-h-[85vh]',
      iconSvg: `<svg class="w-6 h-6 text-app-accent-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>`
    });
    this.context = context;
    
    // Re-render body now that properties are initialized
    const bodyContainer = this.dialog.querySelector('#dialog-body-container') as HTMLElement;
    if (bodyContainer) {
      // Remove overflow-y-auto from the parent container to allow internal scrolling
      bodyContainer.classList.remove('overflow-y-auto');
      bodyContainer.classList.add('flex', 'flex-col');
      
      bodyContainer.innerHTML = '';
      const bodyContent = this.renderBody();
      if (typeof bodyContent === 'string') {
        bodyContainer.innerHTML = bodyContent;
      } else {
        bodyContainer.appendChild(bodyContent);
      }
    }
  }

  protected renderBody(): string | HTMLElement {
    // Defensive check for constructor call from super()
    if (!this.selectedStatuses) return '';

    const container = document.createElement('div');
    container.className = 'flex flex-col h-full bg-app-surface';
    
    container.innerHTML = `
      <div class="p-6 border-b border-app-border bg-app-bg shrink-0">
        <div class="relative group">
          <input type="text" id="search-keywords" 
                 class="w-full bg-app-surface border border-app-border rounded-xl px-12 py-4 text-lg text-app-text outline-none focus:ring-2 focus:ring-app-accent-2 transition-all shadow-inner"
                 placeholder="Search by keywords in title, spec, or design doc..."
                 value="${this.keywords}">
          <div class="absolute left-4 top-1/2 -translate-y-1/2 text-app-muted group-focus-within:text-app-accent-2 transition-colors">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
          </div>
          <div id="search-spinner" class="absolute right-4 top-1/2 -translate-y-1/2 hidden">
             <svg class="animate-spin h-5 w-5 text-app-accent-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
             </svg>
          </div>
        </div>

        <div class="mt-4 flex flex-wrap gap-3 items-center">
          <span class="text-[10px] font-black uppercase tracking-widest text-app-muted mr-2">Filter by Status:</span>
          ${Object.values(TaskStatus).map(status => `
            <label class="flex items-center gap-2 cursor-pointer group">
              <input type="checkbox" class="status-filter w-4 h-4 rounded border-app-border bg-app-bg text-app-accent-2 focus:ring-app-accent-2" 
                     value="${status}" ${this.selectedStatuses.has(status) ? 'checked' : ''}>
              <span class="text-xs text-app-muted group-hover:text-app-text transition-colors capitalize">${status}</span>
            </label>
          `).join('')}
        </div>
      </div>

      <div id="search-results-container" class="flex-grow overflow-y-auto p-6 space-y-4 custom-scrollbar bg-app-surface/50">
        ${this.renderResults()}
      </div>

      <div id="search-pagination-container" class="px-6 py-4 bg-app-bg border-t border-app-border shrink-0">
        ${this.renderPagination()}
      </div>
    `;

    this.attachInternalListeners(container);
    return container;
  }

  private renderResults(): string {
    if (this.isSearching) {
      return `<div class="flex flex-col items-center justify-center py-20 gap-4">
        <div class="animate-pulse text-app-accent-2 font-black uppercase tracking-widest">Searching Knowledge Base...</div>
      </div>`;
    }

    if (this.results.length === 0) {
      if (!this.keywords && this.selectedStatuses.size === 0) {
        return `<div class="flex flex-col items-center justify-center py-20 text-app-muted italic">
          <svg class="w-12 h-12 mb-4 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
          Start typing to search for tasks...
        </div>`;
      }
      return `<div class="flex flex-col items-center justify-center py-20 text-app-muted italic">
        No tasks found matching your criteria.
      </div>`;
    }

    return this.results.map(task => `
      <div class="search-result-item" data-task-id="${task.id}">
        ${TaskItem.render(task, false, false, true)}
      </div>
    `).join('');
  }

  private renderPagination(): string {
    return PaginationControl.render({
      currentPage: this.currentPage,
      pageSize: this.pageSize,
      totalCount: this.totalCount,
      prevAction: 'prev_search_page',
      nextAction: 'next_search_page'
    });
  }

  private attachInternalListeners(container: HTMLElement) {
    const input = container.querySelector('#search-keywords') as HTMLInputElement;
    input?.addEventListener('input', () => {
      this.keywords = input.value.trim();
      this.debounceSearch();
    });

    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        this.performSearch(0);
      }
    });

    container.querySelectorAll('.status-filter').forEach(checkbox => {
      checkbox.addEventListener('change', (e) => {
        const target = e.target as HTMLInputElement;
        const status = target.value as TaskStatus;
        if (target.checked) {
          this.selectedStatuses.add(status);
        } else {
          this.selectedStatuses.delete(status);
        }
        this.performSearch(0);
      });
    });

    // Handle pagination clicks within the dialog
    container.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const actionElement = target.closest('[data-action-click]');
      if (!actionElement) return;

      const action = actionElement.getAttribute('data-action-click');
      if (action === 'prev_search_page') {
        this.performSearch(this.currentPage - 1);
      } else if (action === 'next_search_page') {
        this.performSearch(this.currentPage + 1);
      } else if (action === 'toggle_task_collapse' || action === 'edit_title' || action === 'view_design_doc' || action === 'edit_spec') {
        // Handle task item collapse toggle locally for better UX
        // In search results, we treat title/spec clicks also as toggle collapse
        const taskItem = actionElement.closest('[data-view-type="task"]');
        if (taskItem) {
           const body = taskItem.querySelector('.task-body');
           const icon = taskItem.querySelector('svg.transform');
           if (body && icon) {
             const isHidden = body.classList.toggle('hidden');
             icon.classList.toggle('rotate-90', !isHidden);
           }
        }
      }
    });
  }

  private debounceSearch() {
    if (this.searchTimeout) clearTimeout(this.searchTimeout);
    this.searchTimeout = setTimeout(() => this.performSearch(0), 400);
  }

  private async performSearch(page: number) {
    this.isSearching = true;
    this.currentPage = page;
    this.updateUI();

    try {
      const { tasks, total_count } = await this.context.taskClient.search({
        keywords: this.keywords,
        statuses: Array.from(this.selectedStatuses),
        page: this.currentPage,
        limit: this.pageSize
      });
      this.results = tasks;
      this.totalCount = total_count;
    } catch (e) {
      console.error('Search failed', e);
      this.results = [];
      this.totalCount = 0;
    } finally {
      this.isSearching = false;
      this.updateUI();
    }
  }

  private updateUI() {
    const resultsContainer = this.dialog.querySelector('#search-results-container');
    const paginationContainer = this.dialog.querySelector('#search-pagination-container');
    const spinner = this.dialog.querySelector('#search-spinner');

    if (resultsContainer) resultsContainer.innerHTML = this.renderResults();
    if (paginationContainer) paginationContainer.innerHTML = this.renderPagination();
    if (spinner) {
      if (this.isSearching) spinner.classList.remove('hidden');
      else spinner.classList.add('hidden');
    }
  }

  public async show(): Promise<void> {
    const showPromise = super.show();
    
    // Focus search input after a short delay to allow transition
    setTimeout(() => {
      const input = this.dialog.querySelector('#search-keywords') as HTMLInputElement;
      input?.focus();
    }, 400);

    await showPromise;
  }
}
