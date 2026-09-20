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
import type { DesignDocClient } from '../../core/clients/DesignDocClient.ts';
import type { DesignDocInfo } from '../../core/domain.ts';
import { Icon } from './Icon.ts';
import { renderMarkdown } from './utils/markdown.ts';
import { escapeHtml } from './utils/html.ts';

interface DesignDocTab {
  path: string;
  title: string;
  content: string | null;
  loading: boolean;
  error: string | null;
}

/**
 * A wide, searchable library for a pipeline's Markdown design documents.
 *
 * The dialog is organised as a collapsible search panel on top and a tabbed
 * reading area below it:
 * - the search panel lists every document under the pipeline's ``doc_root``
 *   and filters them server-side by path/content as you type;
 * - selecting a result opens it as a tab whose Markdown is rendered with the
 *   shared ``prose-theme`` styling (the same approach used by ``TaskItem``);
 * - documents are fetched lazily and cached for the lifetime of the dialog, and
 *   tabs can be closed individually.
 */
export class DesignDocLibraryDialog extends BaseDialog<void> {
  private client: DesignDocClient;
  private pipelineId: string;
  private documents: DesignDocInfo[] = [];
  private listLoading = false;
  private listError: string | null = null;
  private query = '';
  private searchOpen = true;
  private tabs: DesignDocTab[] = [];
  private activePath: string | null = null;
  private fetching = new Set<string>();
  private searchTimeout: ReturnType<typeof setTimeout> | null = null;
  private requestSeq = 0;

  constructor(pipelineId: string, client: DesignDocClient) {
    super({
      title: 'Design Doc Library',
      maxWidth: 'max-w-[95vw]',
      maxHeight: 'max-h-[88vh]',
      iconSvg: Icon.render('documentation', { size: 22 }),
    });
    this.pipelineId = pipelineId;
    this.client = client;
    this.installBody();
  }

  /** Re-render the body now that the subclass fields are initialized. */
  private installBody() {
    const body = this.dialog.querySelector('#dialog-body-container') as HTMLElement | null;
    if (!body) return;
    // Let the dialog manage its own scroll regions instead of scrolling the
    // whole body (mirrors SearchDialog).
    body.classList.remove('overflow-y-auto');
    body.classList.add('flex', 'flex-col', 'overflow-hidden', 'min-h-0');
    body.innerHTML = '';
    const content = this.renderBody();
    if (typeof content === 'string') {
      body.innerHTML = content;
    } else {
      body.appendChild(content);
    }
  }

  protected renderBody(): string | HTMLElement {
    // The base constructor calls renderBody before the subclass fields exist.
    if (!this.client) return '';

    const container = document.createElement('div');
    container.className = 'flex flex-col grow min-h-0 bg-app-surface';
    container.innerHTML = `
      <section class="shrink-0 border-b border-app-border bg-app-bg">
        <button type="button" data-dd-action="toggle-search"
                class="w-full flex items-center gap-3 px-5 py-3 text-left cursor-pointer group">
          <span class="text-app-muted group-hover:text-app-text transition-colors">
            ${Icon.render('chevronRight', {
              size: 16,
              className: `transform transition-transform ${this.searchOpen ? 'rotate-90' : ''}`,
            })}
          </span>
          <span class="text-[10px] font-black uppercase tracking-widest text-app-muted">Search design docs</span>
          <span id="dd-search-count" class="text-[10px] font-mono text-app-muted/70"></span>
          <span id="dd-search-hint" class="ml-auto text-[10px] text-app-muted/50">
            ${this.searchOpen ? 'Click to collapse' : 'Click to expand'}
          </span>
        </button>
        <div id="dd-search-body" class="${this.searchOpen ? '' : 'hidden'} px-5 pb-4">
          <div class="relative group">
            <input id="dd-search-input" type="text" value="${escapeHtml(this.query)}"
                   placeholder="Search by file name or content…"
                   class="w-full bg-app-surface border border-app-border rounded-xl pl-10 pr-10 py-2.5 text-sm text-app-text outline-none focus:ring-2 focus:ring-app-accent-2 transition-all">
            <div class="absolute left-3 top-1/2 -translate-y-1/2 text-app-muted group-focus-within:text-app-accent-2 transition-colors">
              ${Icon.render('search', { size: 16 })}
            </div>
            <button type="button" data-dd-action="clear-search"
                    class="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 text-app-muted hover:text-app-text rounded ${this.query ? '' : 'hidden'}"
                    title="Clear search">
              ${Icon.render('close', { size: 14 })}
            </button>
          </div>
          <div id="dd-list"
               class="mt-3 max-h-56 overflow-y-auto custom-scrollbar rounded-xl border border-app-border bg-app-surface">
            ${this.renderList()}
          </div>
        </div>
      </section>

      <section class="grow min-h-0 flex flex-col">
        <div id="dd-tabs"
             class="shrink-0 flex items-stretch gap-1 overflow-x-auto custom-scrollbar border-b border-app-border bg-app-surface/60 px-2">
          ${this.renderTabs()}
        </div>
        <div id="dd-content" class="grow min-h-0 overflow-y-auto custom-scrollbar bg-app-bg">
          ${this.renderContent()}
        </div>
      </section>
    `;

    this.attachListeners(container);
    this.refreshListCount();
    return container;
  }

  private renderList(): string {
    if (this.listLoading) {
      return `<div class="p-6 text-center text-app-muted italic text-sm">Loading documents…</div>`;
    }
    if (this.listError) {
      return `<div class="p-4 text-xs text-red-400" role="alert">${escapeHtml(this.listError)}</div>`;
    }
    if (this.documents.length === 0) {
      const message = this.query
        ? `No documents match “${escapeHtml(this.query)}”.`
        : `No Markdown design documents found under this pipeline's doc folder.`;
      return `<div class="p-6 text-center text-app-muted italic text-sm">${message}</div>`;
    }
    return this.documents.map((doc) => this.renderListItem(doc)).join('');
  }

  private renderListItem(doc: DesignDocInfo): string {
    const isActive = doc.path === this.activePath;
    const snippet = doc.snippet
      ? `<p class="text-[11px] text-app-muted/80 line-clamp-2 mt-0.5">${escapeHtml(doc.snippet)}</p>`
      : '';
    return `
      <button type="button" data-dd-action="open-doc" data-path="${escapeHtml(doc.path)}"
              class="w-full text-left px-3 py-2 border-b border-app-border/40 last:border-b-0 hover:bg-app-bg transition-colors cursor-pointer ${isActive ? 'bg-app-accent-2/10' : ''}">
        <div class="flex items-center gap-2">
          ${Icon.render('documentation', { size: 14, className: 'text-app-accent-2 shrink-0' })}
          <span class="text-sm text-app-text font-medium truncate">${escapeHtml(doc.title)}</span>
          <span class="ml-auto text-[10px] font-mono text-app-muted/60 shrink-0 truncate max-w-[45%]">${escapeHtml(doc.path)}</span>
        </div>
        ${snippet}
      </button>
    `;
  }

  private renderTabs(): string {
    if (this.tabs.length === 0) {
      return `<div class="px-3 py-2 text-[10px] text-app-muted/60 italic">Open a document from the search results above to start reading.</div>`;
    }
    return this.tabs.map((tab) => this.renderTab(tab)).join('');
  }

  private renderTab(tab: DesignDocTab): string {
    const isActive = tab.path === this.activePath;
    return `
      <div class="flex items-center gap-0.5 border-b-2 ${isActive ? 'border-app-accent-2' : 'border-transparent'}">
        <button type="button" data-dd-action="select-tab" data-path="${escapeHtml(tab.path)}"
                class="flex items-center gap-2 px-3 py-2 text-xs max-w-[18rem] transition-colors cursor-pointer ${isActive ? 'text-app-text font-bold' : 'text-app-muted hover:text-app-text'}"
                title="${escapeHtml(tab.title)}">
          <span class="truncate">${escapeHtml(tab.title)}</span>
        </button>
        <button type="button" data-dd-action="close-tab" data-path="${escapeHtml(tab.path)}"
                class="p-1 mr-1 text-app-muted hover:text-red-400 hover:bg-app-bg rounded transition-colors cursor-pointer"
                title="Close tab">
          ${Icon.render('close', { size: 12 })}
        </button>
      </div>
    `;
  }

  private renderContent(): string {
    if (this.tabs.length === 0) {
      return `
        <div class="h-full flex flex-col items-center justify-center gap-3 p-8 text-center text-app-muted">
          ${Icon.render('documentation', { size: 48, className: 'opacity-20' })}
          <p class="text-sm italic">Select a design document to read it here.</p>
        </div>`;
    }

    const tab = this.activeTab();
    if (!tab) return '';

    if (tab.loading) {
      return `<div class="p-8 text-center text-app-muted italic text-sm">Loading ${escapeHtml(tab.title)}…</div>`;
    }
    if (tab.error) {
      return `<div class="p-6 m-4 rounded-xl border border-red-500/30 bg-red-500/10 text-sm text-red-400" role="alert">${escapeHtml(tab.error)}</div>`;
    }
    if (!tab.content) {
      return `<div class="p-8 text-center text-app-muted italic text-sm">This document is empty.</div>`;
    }

    return `
      <div class="max-w-4xl mx-auto p-6 lg:p-8">
        <div class="flex items-start justify-between gap-4 mb-4 border-b border-app-border/50 pb-4">
          <div class="min-w-0">
            <h2 class="text-xl font-black text-app-accent-1 truncate">${escapeHtml(tab.title)}</h2>
            <p class="text-[11px] font-mono text-app-muted truncate">${escapeHtml(tab.path)}</p>
          </div>
          <button type="button" data-dd-action="copy-doc"
                  class="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest bg-app-surface border border-app-border rounded-lg text-app-muted hover:text-app-accent-2 hover:border-app-accent-2/50 transition-all cursor-pointer">
            ${Icon.render('copy', { size: 12 })} Copy
          </button>
        </div>
        <article class="prose-theme prose-base max-w-none prose-headings:text-app-accent-2 prose-a:text-app-accent-1">
          ${renderMarkdown(tab.content)}
        </article>
      </div>
    `;
  }

  private attachListeners(container: HTMLElement) {
    const input = container.querySelector('#dd-search-input') as HTMLInputElement | null;
    input?.addEventListener('input', () => {
      this.query = input.value.trim();
      this.updateClearButton();
      this.scheduleSearch();
    });
    input?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void this.performSearch();
      }
    });

    container.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      const actionEl = target.closest('[data-dd-action]') as HTMLElement | null;
      if (!actionEl) return;
      const action = actionEl.getAttribute('data-dd-action');
      event.preventDefault();
      event.stopPropagation();

      switch (action) {
        case 'toggle-search':
          this.toggleSearch();
          break;
        case 'clear-search':
          this.clearSearch();
          break;
        case 'open-doc':
          void this.openDoc(actionEl.getAttribute('data-path') || '');
          break;
        case 'select-tab':
          this.activateTab(actionEl.getAttribute('data-path') || '');
          break;
        case 'close-tab':
          this.closeTab(actionEl.getAttribute('data-path') || '');
          break;
        case 'copy-doc':
          void this.copyActiveDoc(actionEl);
          break;
      }
    });
  }

  private activeTab(): DesignDocTab | undefined {
    if (this.activePath) {
      const match = this.tabs.find((tab) => tab.path === this.activePath);
      if (match) return match;
    }
    return this.tabs[0];
  }

  private toggleSearch() {
    this.searchOpen = !this.searchOpen;
    const body = this.dialog.querySelector('#dd-search-body');
    body?.classList.toggle('hidden', !this.searchOpen);
    const chevron = this.dialog.querySelector<SVGElement>(
      '[data-dd-action="toggle-search"] svg'
    );
    chevron?.classList.toggle('rotate-90', this.searchOpen);
    const hint = this.dialog.querySelector('#dd-search-hint');
    if (hint) hint.textContent = this.searchOpen ? 'Click to collapse' : 'Click to expand';
    if (this.searchOpen) {
      (this.dialog.querySelector('#dd-search-input') as HTMLInputElement | null)?.focus();
    }
  }

  private clearSearch() {
    this.query = '';
    const input = this.dialog.querySelector('#dd-search-input') as HTMLInputElement | null;
    if (input) input.value = '';
    this.updateClearButton();
    void this.performSearch();
  }

  private updateClearButton() {
    const button = this.dialog.querySelector('[data-dd-action="clear-search"]');
    button?.classList.toggle('hidden', !this.query);
  }

  private async openDoc(path: string) {
    if (!path) return;

    let tab = this.tabs.find((candidate) => candidate.path === path);
    if (!tab) {
      const info = this.documents.find((doc) => doc.path === path);
      tab = {
        path,
        title: info?.title || path,
        content: null,
        loading: true,
        error: null,
      };
      this.tabs.push(tab);
    }

    this.activePath = path;
    this.refreshTabs();
    this.refreshContent();

    // Already loaded (or already being fetched): nothing else to do.
    if (tab.content !== null || tab.error || this.fetching.has(path)) {
      return;
    }

    this.fetching.add(path);
    tab.loading = true;
    tab.error = null;
    this.refreshContent();

    try {
      const doc = await this.client.getContent(this.pipelineId, path);
      tab.content = doc.content ?? '';
      if (doc.title) tab.title = doc.title;
    } catch (error: any) {
      tab.error = error?.message || 'Failed to load the document.';
    } finally {
      tab.loading = false;
      this.fetching.delete(path);
      this.refreshTabs();
      this.refreshContent();
    }
  }

  private activateTab(path: string) {
    if (!path) return;
    this.activePath = path;
    this.refreshTabs();
    this.refreshContent();
  }

  private closeTab(path: string) {
    const index = this.tabs.findIndex((tab) => tab.path === path);
    if (index === -1) return;

    const wasActive = this.activePath === path;
    this.tabs.splice(index, 1);

    if (wasActive) {
      const next = this.tabs[index] || this.tabs[index - 1] || null;
      this.activePath = next ? next.path : null;
    }

    this.refreshTabs();
    this.refreshContent();
    this.refreshList();
  }

  private async copyActiveDoc(button: HTMLElement) {
    const tab = this.activeTab();
    if (!tab?.content) return;
    try {
      await navigator.clipboard.writeText(tab.content);
      const original = button.innerHTML;
      button.innerHTML = `${Icon.render('check', { size: 12 })} Copied`;
      setTimeout(() => {
        button.innerHTML = original;
      }, 1500);
    } catch (error) {
      console.error('Failed to copy design document:', error);
    }
  }

  private scheduleSearch() {
    if (this.searchTimeout) clearTimeout(this.searchTimeout);
    this.searchTimeout = setTimeout(() => {
      this.searchTimeout = null;
      void this.performSearch();
    }, 300);
  }

  private async performSearch() {
    if (this.searchTimeout) {
      clearTimeout(this.searchTimeout);
      this.searchTimeout = null;
    }

    const seq = ++this.requestSeq;
    this.listLoading = true;
    this.refreshList();

    try {
      const response = await this.client.list(this.pipelineId, this.query || undefined);
      if (seq !== this.requestSeq) return;
      this.documents = response?.documents || [];
      this.listError = null;
    } catch (error: any) {
      if (seq !== this.requestSeq) return;
      this.documents = [];
      this.listError = error?.message || 'Failed to load design documents.';
    } finally {
      if (seq === this.requestSeq) {
        this.listLoading = false;
        this.refreshList();
      }
    }
  }

  private refreshList() {
    const list = this.dialog.querySelector('#dd-list');
    if (list) list.innerHTML = this.renderList();
    this.refreshListCount();
  }

  private refreshListCount() {
    const count = this.dialog.querySelector('#dd-search-count');
    if (!count) return;
    if (this.listLoading) {
      count.textContent = 'Searching…';
    } else if (this.documents.length) {
      count.textContent = `${this.documents.length} doc${this.documents.length === 1 ? '' : 's'}`;
    } else {
      count.textContent = '';
    }
  }

  private refreshTabs() {
    const tabs = this.dialog.querySelector('#dd-tabs');
    if (tabs) tabs.innerHTML = this.renderTabs();
  }

  private refreshContent() {
    const content = this.dialog.querySelector('#dd-content');
    if (content) content.innerHTML = this.renderContent();
  }

  public async show(): Promise<void> {
    const showPromise = super.show();
    void this.performSearch();

    // Focus the search input once the open transition has settled.
    setTimeout(() => {
      if (this.searchOpen) {
        (this.dialog.querySelector('#dd-search-input') as HTMLInputElement | null)?.focus();
      }
    }, 400);

    await showPromise;
  }
}
