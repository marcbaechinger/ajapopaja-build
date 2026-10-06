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
import type { CommitDiff, GitLogEntry, GitStatusDetails } from '../../core/domain.ts';
import type { PipelineClient } from '../../core/clients/PipelineClient.ts';
import { DiffView } from './DiffView.ts';
import { Icon } from './Icon.ts';
import { PaginationControl } from './PaginationControl.ts';
import { escapeHtml } from './utils/html.ts';

/** Number of commits shown per page in the History tab. */
export const HISTORY_PAGE_SIZE = 25;

export interface HistoryViewOptions {
  pipelineId: string;
  client: PipelineClient;
  actionRegistry: ActionRegistry;
}

/**
 * Repository-history view for a pipeline, embedded as a tab in
 * `PipelineDetailView` (it replaces the former `HistoryDialog` modal).
 *
 * Owns a stable shell (header strip, commit table, pagination footer) and
 * repaints only the fragments that change. The compact table lists the last
 * {@link HISTORY_PAGE_SIZE} commits; expanding a row lazily loads the full
 * commit detail (message + unified diff) through {@link PipelineClient.getCommitDiff}
 * and caches it, so a re-expansion never re-fetches. A monotonic request id
 * discards stale responses, mirroring `FileBrowseView`.
 */
export class HistoryView {
  private root: HTMLElement;
  private pipelineId: string;
  private client: PipelineClient;
  private registry: ActionRegistry;

  private page = 0;
  private readonly pageSize = HISTORY_PAGE_SIZE;
  private commits: GitLogEntry[] = [];
  private total = 0;
  private status: GitStatusDetails | null = null;
  private statusError: string | null = null;
  private logError: string | null = null;
  private pullError: string | null = null;
  private pulling = false;
  private loading = true;

  private expanded: Set<string> = new Set();
  private diffCache: Map<string, CommitDiff> = new Map();
  private diffViews: Map<string, DiffView> = new Map();
  private loadingDiffs: Set<string> = new Set();
  private diffErrors: Map<string, string> = new Map();

  private requestId = 0;
  private destroyed = false;

  constructor(root: HTMLElement, options: HistoryViewOptions) {
    this.root = root;
    this.pipelineId = options.pipelineId;
    this.client = options.client;
    this.registry = options.actionRegistry;
  }

  render(): void {
    this.root.innerHTML = this.shell();
    this.registerActions();
    this.renderStatusStrip();
    this.renderBody();
    this.renderPagination();
    void this.load();
  }

  destroy(): void {
    this.destroyed = true;
    this.destroyDiffViews();
    this.root.innerHTML = '';
  }

  // --- data loading -------------------------------------------------------

  /** Reload the current page and the repository status. */
  private async load(): Promise<void> {
    const requestId = ++this.requestId;
    this.loading = true;
    this.logError = null;
    this.renderBody();
    this.renderPagination();

    try {
      const status = await this.client.getGitStatus(this.pipelineId);
      if (this.isStale(requestId)) return;
      this.status = status;
      this.statusError = status?.error || null;
    } catch (e: any) {
      if (this.isStale(requestId)) return;
      this.status = null;
      this.statusError = e?.message || 'Failed to load repository status.';
    }
    this.renderStatusStrip();

    try {
      const log = await this.client.getGitLog(
        this.pipelineId,
        this.pageSize,
        this.page * this.pageSize
      );
      if (this.isStale(requestId)) return;
      this.commits = log?.commits || [];
      this.total =
        typeof log?.total === 'number' ? log.total : this.commits.length;
      this.logError = log?.error || null;
    } catch (e: any) {
      if (this.isStale(requestId)) return;
      this.commits = [];
      this.total = 0;
      this.logError = e?.message || 'Failed to load repository history.';
    }

    this.loading = false;
    this.renderBody();
    this.renderPagination();
  }

  /** Lazily load (and cache) the full detail of a single commit. */
  private async loadCommitDetail(hash: string): Promise<void> {
    this.loadingDiffs.add(hash);
    this.diffErrors.delete(hash);
    this.renderBody();

    try {
      const diff = await this.client.getCommitDiff(this.pipelineId, hash);
      if (this.destroyed) return;
      this.diffCache.set(hash, diff);
    } catch (e: any) {
      if (this.destroyed) return;
      this.diffErrors.set(hash, e?.message || 'Failed to load commit details.');
    } finally {
      this.loadingDiffs.delete(hash);
    }

    if (this.destroyed) return;
    if (this.expanded.has(hash)) this.renderBody();
  }

  private async handlePull(): Promise<void> {
    if (this.pulling) return;
    this.pulling = true;
    this.pullError = null;
    this.setPullButtonState();
    this.renderStatusStrip();

    try {
      const result = await this.client.pull(this.pipelineId);
      const message = result?.message || '';
      if (/^error/i.test(message)) {
        this.pullError = message;
      }
    } catch (e: any) {
      this.pullError = e?.message || 'Failed to pull from origin.';
    } finally {
      this.pulling = false;
      this.setPullButtonState();
      await this.load();
      this.renderStatusStrip();
    }
  }

  // --- actions ------------------------------------------------------------

  private registerActions(): void {
    const register = (name: string, handler: ActionHandler) =>
      this.registry.register(name, handler);

    register('history_git_load', () => {
      if (this.destroyed) return;
      void this.load();
    });
    register('history_git_pull', () => {
      if (this.destroyed) return;
      void this.handlePull();
    });
    register('history_git_prev_page', () => {
      if (this.destroyed) return;
      this.setPage(this.page - 1);
    });
    register('history_git_next_page', () => {
      if (this.destroyed) return;
      this.setPage(this.page + 1);
    });
    register('history_toggle_commit', (_event, element) => {
      if (this.destroyed) return;
      this.toggleCommit(element.getAttribute('data-commit-hash') ?? '');
    });
  }

  private setPage(page: number): void {
    if (page < 0) return;
    const totalPages = Math.max(1, Math.ceil(this.total / this.pageSize));
    if (page >= totalPages) return;
    this.page = page;
    this.expanded.clear();
    this.destroyDiffViews();
    void this.load();
  }

  private toggleCommit(hash: string): void {
    if (!hash) return;
    if (this.expanded.has(hash)) {
      this.expanded.delete(hash);
      this.renderBody();
      return;
    }
    this.expanded.add(hash);
    this.renderBody();
    if (!this.diffCache.has(hash) && !this.loadingDiffs.has(hash)) {
      void this.loadCommitDetail(hash);
    }
  }

  // --- rendering ----------------------------------------------------------

  private shell(): string {
    return `
      <div class="flex flex-col bg-app-surface/30 rounded-3xl border border-app-border/30 overflow-hidden">
        <div class="flex items-center gap-2 px-3 py-2 border-b border-app-border/40">
          <span class="text-xs font-bold uppercase tracking-widest text-app-muted shrink-0">History</span>
          <div id="history-status-strip" class="grow min-w-0 flex flex-wrap items-center gap-2 text-[11px] font-mono"></div>
          <div class="flex items-center gap-1 shrink-0">
            <button id="history-refresh-btn" type="button"
              data-action-click="history_git_load"
              class="p-1.5 rounded text-xs font-medium bg-app-surface border border-app-border text-app-text hover:bg-app-bg transition-colors flex items-center justify-center cursor-pointer"
              title="Refresh" aria-label="Refresh">
              ${Icon.render('refresh', { size: 14 })}
            </button>
            <button id="history-pull-btn" type="button"
              data-action-click="history_git_pull"
              class="inline-flex items-center gap-1.5 rounded-md border border-app-border bg-app-surface px-2.5 py-1 text-xs font-semibold text-app-text hover:bg-app-bg hover:border-app-accent-1 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              title="Pull latest changes from origin">
              ${Icon.render('refresh', { size: 14 })}
              <span>Pull</span>
            </button>
          </div>
        </div>
        <div id="history-table-container" class="overflow-x-auto"></div>
        <div id="history-pagination" class="px-3 py-2"></div>
      </div>
    `;
  }

  private renderBody(): void {
    const el = this.root.querySelector('#history-table-container');
    if (!el) return;
    // Full repaint discards any mounted DiffView's DOM, so tear the views down
    // first to detach their collapse listeners before rebuilding.
    this.destroyDiffViews();
    el.innerHTML = this.renderTable();
    this.mountExpandedDiffs();
  }

  private renderTable(): string {
    if (this.loading) {
      return `
        <div class="p-8 text-center text-app-muted italic text-sm" data-role="history-loading">
          Loading repository history…
        </div>
      `;
    }

    if (this.logError) {
      return `
        <div class="p-6 text-center text-xs text-red-400" role="alert" data-role="history-error">
          ${escapeHtml(this.logError)}
        </div>
      `;
    }

    if (this.commits.length === 0) {
      return `
        <div class="p-8 text-center text-app-muted italic text-sm" data-role="history-empty">
          No commits available.
        </div>
      `;
    }

    return `
      <table class="w-full text-xs border-collapse" data-role="history-table">
        <tbody>
          ${this.commits.map((commit) => this.renderCommitRows(commit)).join('')}
        </tbody>
      </table>
    `;
  }

  private renderCommitRows(commit: GitLogEntry): string {
    const hash = commit.hash || '';
    const isExpanded = this.expanded.has(hash);
    const shortHash = commit.short_hash || (hash ? hash.substring(0, 7) : '');
    const author = commit.author ? escapeHtml(commit.author) : 'unknown';
    const subject = commit.subject ? escapeHtml(commit.subject) : '(no subject)';
    const date = this.formatDate(commit.date);
    const chevron = Icon.render('chevronRight', {
      size: 12,
      className: `transition-transform${isExpanded ? ' rotate-90' : ''}`,
    });

    const row = `
      <tr class="history-commit-row border-b border-app-border/20 hover:bg-app-bg/60 transition-colors cursor-pointer"
        data-action-click="history_toggle_commit" data-commit-hash="${escapeHtml(hash)}"
        aria-expanded="${isExpanded}">
        <td class="py-1 pl-2 pr-1 w-5 align-middle text-app-muted">${chevron}</td>
        <td class="py-1 pr-2 font-mono text-[10px] text-app-accent-1 whitespace-nowrap align-middle" title="${escapeHtml(hash)}">${escapeHtml(shortHash)}</td>
        <td class="py-1 pr-2 text-app-text truncate align-middle" title="${subject}" data-role="history-subject">${subject}</td>
        <td class="py-1 pr-2 text-app-muted whitespace-nowrap align-middle" data-role="history-author">${author}</td>
        <td class="py-1 pr-2 text-app-muted whitespace-nowrap align-middle text-right" data-role="history-date">${escapeHtml(date)}</td>
      </tr>
    `;

    if (!isExpanded) return row;
    return row + `
      <tr class="history-commit-detail">
        <td colspan="5" class="p-0">${this.renderDetail(hash)}</td>
      </tr>
    `;
  }

  private renderDetail(hash: string): string {
    const error = this.diffErrors.get(hash);
    if (error) {
      return `
        <div class="px-4 py-3 text-xs text-red-400" role="alert" data-role="history-detail-error">
          ${escapeHtml(error)}
        </div>
      `;
    }
    if (this.loadingDiffs.has(hash)) {
      return `
        <div class="px-4 py-3 text-xs text-app-muted italic" data-role="history-detail-loading">
          Loading commit details…
        </div>
      `;
    }
    const diff = this.diffCache.get(hash);
    if (!diff) {
      return `
        <div class="px-4 py-3 text-xs text-app-muted italic" data-role="history-detail-pending">
          Expanding…
        </div>
      `;
    }

    const message = diff.message || diff.subject || '';
    return `
      <div class="history-detail-body px-3 py-2 bg-app-bg/40 border-t border-app-border/20">
        <pre class="history-commit-message whitespace-pre-wrap break-words font-sans text-[11px] text-app-text/90 m-0" data-role="history-message">${escapeHtml(message)}</pre>
        <div id="history-detail-${escapeHtml(hash)}" class="mt-2" data-role="history-diff-mount"></div>
      </div>
    `;
  }

  private mountExpandedDiffs(): void {
    for (const hash of this.expanded) {
      const diff = this.diffCache.get(hash);
      if (!diff) continue;
      const mount = this.root.querySelector(
        `#history-detail-${cssEscape(hash)}`
      ) as HTMLElement | null;
      if (!mount) continue;
      const view = new DiffView(mount, {
        patch: diff.patch,
        metadata: {
          label: 'Commit',
          subject: diff.subject ?? undefined,
          author: diff.author ?? undefined,
          createdAt: diff.created_at ?? undefined,
        },
        heightClass: 'max-h-[50vh]',
      });
      view.render();
      this.diffViews.set(hash, view);
    }
  }

  private renderStatusStrip(): void {
    const el = this.root.querySelector('#history-status-strip');
    if (!el) return;
    el.innerHTML = `${this.renderPullError()}${this.renderStatus()}`;
  }

  private renderPullError(): string {
    if (!this.pullError) return '';
    return `
      <span class="inline-flex items-center gap-1 rounded border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-red-400" role="alert" data-role="history-pull-error">
        ${escapeHtml(this.pullError)}
      </span>
    `;
  }

  private renderStatus(): string {
    if (this.statusError) {
      return `
        <span class="inline-flex items-center gap-1 rounded border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-red-400" role="alert" data-role="history-status-error">
          ${escapeHtml(this.statusError)}
        </span>
      `;
    }
    if (!this.status) return '';

    return `
      <span class="text-app-muted">Repository status:</span>
      ${this.renderStatusPill('Staged', this.status.staged, 'text-green-400')}
      ${this.renderStatusPill('Unstaged', this.status.unstaged, 'text-amber-400')}
      ${this.renderStatusPill('Untracked', this.status.untracked, 'text-app-text')}
      ${this.renderRemoteSync()}
    `;
  }

  private renderStatusPill(label: string, count: number, activeColor: string): string {
    const hasChanges = count > 0;
    const color = hasChanges ? activeColor : 'text-app-muted';
    return `
      <span class="inline-flex items-center gap-1 rounded border border-app-border/60 px-2 py-0.5">
        <span class="text-app-muted">${label}</span>
        <span class="${color} font-bold">${count}</span>
      </span>
    `;
  }

  private renderRemoteSync(): string {
    if (!this.status?.has_origin) {
      return `
        <span class="inline-flex items-center gap-1 rounded border border-app-border/60 px-2 py-0.5 text-app-muted" title="No origin remote configured">
          No origin remote
        </span>
      `;
    }

    const branchLabel = this.status.branch ? ` (${escapeHtml(this.status.branch)})` : '';
    if (this.status.in_sync === true) {
      return `
        <span class="inline-flex items-center gap-1 rounded border border-green-500/40 bg-green-500/10 px-2 py-0.5 text-green-400" title="Local branch is in sync with origin">
          In sync with origin${branchLabel}
        </span>
      `;
    }
    if (this.status.in_sync === false) {
      const ahead = this.status.ahead || 0;
      const behind = this.status.behind || 0;
      return `
        <span class="inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-amber-400" title="Local branch diverged from origin">
          Out of sync with origin${branchLabel} · ↑${ahead} ↓${behind}
        </span>
      `;
    }
    return `
      <span class="inline-flex items-center gap-1 rounded border border-app-border/60 px-2 py-0.5 text-app-muted" title="Origin sync cannot be determined">
        Origin sync unavailable
      </span>
    `;
  }

  private renderPagination(): void {
    const el = this.root.querySelector('#history-pagination');
    if (!el) return;
    el.innerHTML = PaginationControl.render({
      currentPage: this.page,
      pageSize: this.pageSize,
      totalCount: this.total,
      prevAction: 'history_git_prev_page',
      nextAction: 'history_git_next_page',
    });
  }

  private setPullButtonState(): void {
    const button = this.root.querySelector('#history-pull-btn') as HTMLButtonElement | null;
    if (!button) return;
    button.disabled = this.pulling;
    const label = button.querySelector('span');
    if (label) label.textContent = this.pulling ? 'Pulling…' : 'Pull';
  }

  // --- helpers ------------------------------------------------------------

  private isStale(requestId: number): boolean {
    return this.destroyed || requestId !== this.requestId;
  }

  private destroyDiffViews(): void {
    for (const view of this.diffViews.values()) view.destroy();
    this.diffViews.clear();
  }

  private formatDate(date?: string | null): string {
    if (!date) return '';
    const parsed = new Date(date);
    if (isNaN(parsed.getTime())) return '';
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
  }
}

/**
 * Minimal `CSS.escape` fallback for use inside a querySelector. Commit hashes
 * are hex, so escaping is effectively a no-op, but this keeps the selector safe
 * for any future id source.
 */
function cssEscape(value: string): string {
  if (typeof (globalThis as any).CSS?.escape === 'function') {
    return (globalThis as any).CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}
