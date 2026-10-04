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

import type { ActionHandler, ActionRegistry } from '../../core/ActionRegistry.ts';
import type {
  DirectoryListing,
  FileContent,
} from '../../core/domain.ts';
import { LocalStorageManager } from '../../core/LocalStorageManager.ts';
import type { FileBrowserClient } from '../../core/clients/FileBrowserClient.ts';
import { DirectoryView } from './DirectoryView.ts';
import { FileView } from './FileView.ts';
import { Icon } from './Icon.ts';
import { escapeHtml } from './utils/fileBrowser.ts';

export interface FileBrowseViewOptions {
  pipelineId: string;
  client: FileBrowserClient;
  actionRegistry: ActionRegistry;
}

/**
 * Coordinator for the read-only pipeline file browser.
 *
 * Owns a stable shell (breadcrumb, main panel) and re-renders only the
 * fragments that changed. All HTTP goes through {@link FileBrowserClient}. A
 * monotonically increasing request id discards stale responses so fast
 * clicking can never render an outdated directory.
 */
export class FileBrowseView {
  private root: HTMLElement;
  private pipelineId: string;
  private client: FileBrowserClient;
  private registry: ActionRegistry;
  private storage = LocalStorageManager.getInstance('file-browser');

  private currentDir: string = '';
  private listing: DirectoryListing | null = null;
  private selectedFile: FileContent | null = null;
  private loading: boolean = false;
  private error: string | null = null;
  private requestId: number = 0;
  private destroyed: boolean = false;

  constructor(root: HTMLElement, options: FileBrowseViewOptions) {
    this.root = root;
    this.pipelineId = options.pipelineId;
    this.client = options.client;
    this.registry = options.actionRegistry;
  }

  render(): void {
    this.root.innerHTML = this.shell();
    this.registerActions();
    this.restoreState();
    this.renderBreadcrumb();
    void this.loadDirectory(this.currentDir);
  }

  destroy(): void {
    this.destroyed = true;
    this.root.innerHTML = '';
  }

  // --- navigation ---------------------------------------------------------

  async loadDirectory(path: string): Promise<void> {
    const requestId = ++this.requestId;
    this.loading = true;
    this.error = null;
    this.currentDir = path;
    this.selectedFile = null;
    this.storage.put(`lastPath:${this.pipelineId}`, path);
    this.renderBreadcrumb();
    this.renderMain();

    try {
      const listing = await this.client.listDirectory(this.pipelineId, path);
      if (this.isStale(requestId)) return;
      this.listing = listing;
      this.loading = false;
      this.renderMain();
    } catch (e) {
      if (this.isStale(requestId)) return;
      this.loading = false;
      this.listing = null;
      this.error = this.errorMessage(e, 'Failed to open the directory.');
      this.renderMain();
    }
  }

  async openFile(path: string): Promise<void> {
    const requestId = ++this.requestId;
    this.loading = true;
    this.error = null;
    this.selectedFile = null;
    this.renderMain();

    try {
      const file = await this.client.readFile(this.pipelineId, path);
      if (this.isStale(requestId)) return;
      this.selectedFile = file;
      this.loading = false;
      this.renderMain();
    } catch (e) {
      if (this.isStale(requestId)) return;
      this.loading = false;
      this.error = this.errorMessage(e, 'Failed to open the file.');
      this.renderMain();
    }
  }

  async refresh(): Promise<void> {
    const selected = this.selectedFile?.path ?? null;
    await this.loadDirectory(this.currentDir);
    if (this.error || !selected) return;
    const exists = this.listing?.entries.some((entry) => entry.path === selected);
    if (exists) {
      await this.openFile(selected);
    }
  }

  // --- rendering ----------------------------------------------------------

  private shell(): string {
    return `
      <div class="flex flex-col bg-app-surface/30 rounded-3xl border border-app-border/30 overflow-hidden h-[70vh] min-h-[28rem]">
        <div class="flex items-center gap-2 px-3 py-2 border-b border-app-border/40">
          <nav id="file-browser-breadcrumb" aria-label="Current path"
            class="flex items-center gap-1 min-w-0 flex-1 flex-wrap"></nav>
          <div class="flex items-center gap-1 shrink-0">
            <button id="file-browser-refresh-btn" type="button"
              data-action-click="file_browser_refresh"
              class="p-1.5 rounded text-xs font-medium bg-app-surface border border-app-border text-app-text hover:bg-app-bg transition-colors flex items-center justify-center cursor-pointer"
              title="Refresh" aria-label="Refresh">
              ${Icon.render('refresh', { size: 14 })}
            </button>
          </div>
        </div>
        <main id="file-browser-main" class="flex-1 min-w-0 flex flex-col overflow-hidden"></main>
      </div>
    `;
  }

  private registerActions(): void {
    const register = (name: string, handler: ActionHandler) => {
      this.registry.register(name, handler);
    };

    // The file view owns its own header actions (e.g. copy path).
    FileView.registerActions(this.registry);

    register('file_browser_navigate', (_event, element) => {
      if (this.destroyed) return;
      void this.loadDirectory(element.getAttribute('data-path') ?? '');
    });
    register('file_browser_open_file', (_event, element) => {
      if (this.destroyed) return;
      const path = element.getAttribute('data-path');
      if (path) void this.openFile(path);
    });
    register('file_browser_breadcrumb', (_event, element) => {
      if (this.destroyed) return;
      void this.loadDirectory(element.getAttribute('data-path') ?? '');
    });
    register('file_browser_refresh', () => {
      if (this.destroyed) return;
      void this.refresh();
    });
  }

  private renderBreadcrumb(): void {
    const el = this.root.querySelector('#file-browser-breadcrumb');
    if (!el) return;

    const segments = this.currentDir ? this.currentDir.split('/') : [];
    const crumbs: string[] = [];

    const separator = `<span class="text-app-muted/40 select-none" aria-hidden="true">/</span>`;
    const rootPath = '';
    const isRootCurrent = segments.length === 0;
    // The current directory is always rendered as a link so that a displayed
    // file can never lock the user in: clicking the current crumb reloads its
    // directory listing.
    crumbs.push(
      `<button type="button" data-action-click="file_browser_breadcrumb" data-path="${rootPath}"
        class="text-xs ${isRootCurrent ? 'font-semibold text-app-text' : 'text-app-muted'} hover:text-app-accent-1 transition-colors truncate cursor-pointer"${
          isRootCurrent ? ' aria-current="page"' : ''
        }>repo</button>`
    );

    let cumulative = '';
    segments.forEach((segment, index) => {
      cumulative = cumulative ? `${cumulative}/${segment}` : segment;
      const isLast = index === segments.length - 1;
      crumbs.push(separator);
      crumbs.push(
        `<button type="button" data-action-click="file_browser_breadcrumb" data-path="${escapeHtml(cumulative)}"
          class="text-xs ${isLast ? 'font-semibold text-app-text' : 'text-app-muted'} hover:text-app-accent-1 transition-colors truncate cursor-pointer"${
            isLast ? ' aria-current="page"' : ''
          }>${escapeHtml(segment)}</button>`
      );
    });

    el.innerHTML = crumbs.join('');
  }

  private renderMain(): void {
    const el = this.root.querySelector('#file-browser-main');
    if (!el) return;

    if (this.loading) {
      el.innerHTML = `<div class="flex flex-1 items-center justify-center py-10">
        <span class="text-xs text-app-muted animate-pulse">Loading…</span>
      </div>`;
      return;
    }

    if (this.error) {
      el.innerHTML = `<div class="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center py-10">
        <span class="text-app-muted/60">${Icon.render('alert', { size: 24 })}</span>
        <p class="text-xs text-red-400">${escapeHtml(this.error)}</p>
        <button type="button" data-action-click="file_browser_refresh"
          class="px-3 py-1.5 rounded text-xs font-medium bg-app-surface border border-app-border text-app-text hover:bg-app-bg transition-colors cursor-pointer">
          Try again
        </button>
      </div>`;
      return;
    }

    if (this.selectedFile) {
      el.innerHTML = FileView.render(this.selectedFile);
      return;
    }

    if (this.listing) {
      el.innerHTML = DirectoryView.render(this.listing);
      return;
    }

    el.innerHTML = '';
  }

  // --- state --------------------------------------------------------------

  private restoreState(): void {
    const lastPath = this.storage.get<string>(`lastPath:${this.pipelineId}`, '');
    this.currentDir = typeof lastPath === 'string' ? lastPath : '';
  }

  private isStale(requestId: number): boolean {
    return this.destroyed || requestId !== this.requestId;
  }

  private errorMessage(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) return error.message;
    return fallback;
  }
}
