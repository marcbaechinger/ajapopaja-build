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

import type { ActionHandler, ActionRegistry } from '../../../core/ActionRegistry.ts';
import type {
  DirectoryListing,
  FileContent,
} from '../../../core/domain.ts';
import { LocalStorageManager } from '../../../core/LocalStorageManager.ts';
import type { FileBrowserClient } from '../../../core/clients/FileBrowserClient.ts';
import { DirectoryView } from './DirectoryView.ts';
import { FileView } from './FileView.ts';
import { FileSearchInputView } from './FileSearchInputView.ts';
import { Icon } from '../common/Icon.ts';
import { escapeHtml } from '../utils/fileBrowser.ts';

export interface FileBrowseViewOptions {
  pipelineId: string;
  client: FileBrowserClient;
  actionRegistry: ActionRegistry;
  /**
   * When true, the main content area (the directory listing / file content)
   * can be resized vertically by dragging its bottom edge, so the user can
   * tune the height to fit. The initial height is `h-[70vh]`; width is never
   * resizable. The breadcrumb and bottom bar stay fixed. Default false, which
   * keeps the historic `flex-1` layout.
   */
  resizable?: boolean;
  /**
   * Explicit repo-relative path from the route (`''` = repository root).
   * `null`/omitted means "no explicit path": fall back to the persisted
   * `lastPath:`. A non-empty value takes precedence over the persisted path.
   */
  initialPath?: string | null;
  /**
   * Emitted for user-initiated navigation only (entry click, breadcrumb, file
   * open) — never for route-driven or initial-restore loads. `dir` is the
   * containing directory; `file` is the selected file, if any.
   */
  onNavigate?: (state: { dir: string; file: string | null }) => void;
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
  private resizable: boolean;
  private initialPath: string | null;
  private onNavigate?: (state: { dir: string; file: string | null }) => void;
  private storage = LocalStorageManager.getInstance('file-browser');

  private currentDir: string = '';
  private listing: DirectoryListing | null = null;
  private selectedFile: FileContent | null = null;
  private loading: boolean = false;
  private error: string | null = null;
  private requestId: number = 0;
  private destroyed: boolean = false;
  private searchInput: FileSearchInputView | null = null;

  constructor(root: HTMLElement, options: FileBrowseViewOptions) {
    this.root = root;
    this.pipelineId = options.pipelineId;
    this.client = options.client;
    this.registry = options.actionRegistry;
    this.resizable = options.resizable ?? false;
    this.initialPath =
      options.initialPath !== undefined && options.initialPath !== null
        ? options.initialPath
        : null;
    this.onNavigate = options.onNavigate;
  }

  render(): void {
    this.root.innerHTML = this.shell();
    this.mountSearchInput();
    this.registerActions();
    this.restoreState();
    this.renderBreadcrumb();
    if (this.initialPath) void this.navigateTo(this.initialPath, { silent: true });
    else void this.loadDirectory(this.currentDir, { silent: true });
  }

  destroy(): void {
    this.destroyed = true;
    this.searchInput?.destroy();
    this.searchInput = null;
    this.root.innerHTML = '';
  }

  // --- navigation ---------------------------------------------------------

  /**
   * Resolves a repo-relative path from the route: a single `getMeta()` call
   * decides whether it names a directory (list it) or a file (open it). A
   * failed meta lookup falls through to the directory path so the normal error
   * state is surfaced by `loadDirectory`.
   */
  async navigateTo(path: string, opts: { silent?: boolean } = {}): Promise<void> {
    if (!path) return this.loadDirectory('', opts);
    try {
      const meta = await this.client.getMeta(this.pipelineId, path);
      // Default to a directory when a test double / older backend omits the flag.
      if (meta?.isDir === false) return this.openFile(path, opts);
    } catch {
      /* fall through: treat as a directory and let loadDirectory surface the error */
    }
    return this.loadDirectory(path, opts);
  }

  async loadDirectory(path: string, opts: { silent?: boolean } = {}): Promise<void> {
    const requestId = ++this.requestId;
    this.loading = true;
    this.error = null;
    this.currentDir = path;
    this.selectedFile = null;
    this.storage.put(`lastPath:${this.pipelineId}`, path);
    if (!opts.silent) this.onNavigate?.({ dir: path, file: null });
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

  async openFile(path: string, opts: { silent?: boolean } = {}): Promise<void> {
    const requestId = ++this.requestId;
    this.loading = true;
    this.error = null;
    this.selectedFile = null;
    // A file can be opened from anywhere (directory listing, search result or
    // route deep link). Make its containing directory the current one so the
    // breadcrumb and the persisted `lastPath` point at where the file lives.
    this.setCurrentDirectory(this.parentDirectory(path));
    if (!opts.silent) this.onNavigate?.({ dir: this.currentDir, file: path });
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
    await this.loadDirectory(this.currentDir, { silent: true });
    if (this.error || !selected) return;
    const exists = this.listing?.entries.some((entry) => entry.path === selected);
    if (exists) {
      await this.openFile(selected, { silent: true });
    }
  }

  /** Current directory and selected file, for host-side idempotence checks. */
  getCurrentPath(): { dir: string; file: string | null } {
    return { dir: this.currentDir, file: this.selectedFile?.path ?? null };
  }

  // --- rendering ----------------------------------------------------------

  private shell(): string {
    // `resize-y` needs a non-visible overflow; `overflow-x-hidden` supplies it
    // while keeping the resize handle from ever changing the width. The fixed
    // `h-[70vh]` is the initial height the browser then lets the user adjust.
    const mainClass = this.resizable
      ? 'resize-y overflow-x-hidden h-[70vh]'
      : 'flex-1 min-w-0 flex flex-col overflow-hidden';
    return `
      <div class="flex flex-col bg-app-surface/30 rounded-3xl border border-app-border/30 overflow-hidden min-h-[70vh]">
        <div class="flex items-center gap-2 px-3 py-2 border-b border-app-border/40">
          <nav id="file-browser-breadcrumb" aria-label="Current path"
            class="flex items-center gap-1 min-w-0 flex-1 flex-wrap"></nav>
          <div class="flex items-center gap-1 shrink-0">
            <div id="file-browser-search-mount" class="shrink-0"></div>
            <span class="w-px h-4 bg-app-border" aria-hidden="true"></span>
            <button id="file-browser-refresh-btn" type="button"
              data-action-click="file_browser_refresh"
              class="p-1.5 rounded text-xs font-medium bg-app-surface border border-app-border text-app-text hover:bg-app-bg transition-colors flex items-center justify-center cursor-pointer"
              title="Refresh" aria-label="Refresh">
              ${Icon.render('refresh', { size: 14 })}
            </button>
          </div>
        </div>
        <main id="file-browser-main" class="${mainClass}"></main>
        <div class="flex items-center gap-2 px-3 py-2 border-t border-app-border/40">
          <nav id="file-browser-breadcrumb-bottom" aria-label="Current path"
            class="flex items-center gap-1 min-w-0 flex-1 flex-wrap"></nav>
          <div class="flex items-center gap-1 shrink-0">
            <button id="file-browser-to-top-btn" type="button"
              data-action-click="file_browser_to_top"
              class="p-1.5 rounded text-xs font-medium bg-app-surface border border-app-border text-app-text hover:bg-app-bg transition-colors flex items-center justify-center cursor-pointer"
              title="To top" aria-label="To top">
              ${Icon.render('arrowUp', { size: 14 })}
            </button>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Mounts the compact file search into the header. The client search is
   * bridged here so the reusable input only depends on a callback.
   */
  private mountSearchInput(): void {
    const mount = this.root.querySelector<HTMLElement>('#file-browser-search-mount');
    if (!mount) return;
    this.searchInput?.destroy();
    this.searchInput = new FileSearchInputView(mount, {
      search: (query, signal) =>
        this.client.searchFiles(this.pipelineId, query, signal),
      onSelect: (result) => {
        if (this.destroyed) return;
        void this.navigateTo(result.path);
      },
    });
    this.searchInput.render();
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
    register('open_file_raw', async (_event, element) => {
      if (this.destroyed) return;
      const path = element.getAttribute('data-path');
      if (!path) return;
      // The blank tab must be opened synchronously in the click handler or the
      // browser blocks the popup; it is navigated once the token arrives.
      const win = window.open('', '_blank');
      if (win) win.opener = null;
      try {
        const { token } = await this.client.createRawFileToken(
          this.pipelineId,
          path
        );
        const url = this.client.rawFileUrl(this.pipelineId, token);
        if (win) win.location.href = url;
        else window.location.href = url;
      } catch (error) {
        win?.close();
        console.error('Failed to open raw file:', error);
      }
    });
    register('file_browser_breadcrumb', (_event, element) => {
      if (this.destroyed) return;
      void this.loadDirectory(element.getAttribute('data-path') ?? '');
    });
    register('file_browser_refresh', () => {
      if (this.destroyed) return;
      void this.refresh();
    });
    register('file_browser_to_top', () => {
      if (this.destroyed) return;
      this.scrollToTop();
    });
  }

  private renderBreadcrumb(): void {
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

    const html = crumbs.join('');
    for (const selector of ['#file-browser-breadcrumb', '#file-browser-breadcrumb-bottom']) {
      const el = this.root.querySelector(selector);
      if (el) el.innerHTML = html;
    }
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

  /** Scroll the visible file/directory content back to the top. */
  private scrollToTop(): void {
    const main = this.root.querySelector('#file-browser-main') as HTMLElement | null;
    if (!main) return;
    main.scrollTop = 0;
    // The actual scroll container lives inside the rendered directory/file
    // fragment, so reset every potentially scrolled descendant as well.
    main.querySelectorAll<HTMLElement>('*').forEach((el) => {
      if (el.scrollTop !== 0) el.scrollTop = 0;
    });
  }

  // --- state --------------------------------------------------------------

  /**
   * Repository-relative path of the directory containing `path` (`''` for a
   * file at the repository root).
   */
  private parentDirectory(path: string): string {
    const index = path.lastIndexOf('/');
    return index === -1 ? '' : path.slice(0, index);
  }

  /**
   * Point the breadcrumb and the persisted `lastPath` at `dir` when it
   * changed. Keeps {@link openFile} from leaving the breadcrumb pointing at a
   * directory the opened file is not in (e.g. a file picked from search).
   */
  private setCurrentDirectory(dir: string): void {
    if (dir === this.currentDir) return;
    this.currentDir = dir;
    this.storage.put(`lastPath:${this.pipelineId}`, dir);
    this.renderBreadcrumb();
  }

  private restoreState(): void {
    if (this.initialPath !== null && this.initialPath !== undefined) {
      this.currentDir = this.initialPath;
      return;
    }
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
