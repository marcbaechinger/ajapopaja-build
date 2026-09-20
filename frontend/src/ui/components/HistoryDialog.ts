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

import type { GitStatusDetails, GitLogEntry } from '../../core/domain.ts';
import type { PipelineClient } from '../../core/clients/PipelineClient.ts';
import { BaseDialog } from './dialog_common.ts';
import { Icon } from './Icon.ts';
import { escapeHtml } from './utils/html.ts';

/**
 * History dialog backed by the pipeline's Git repository rather than the
 * database Task records. It renders a compact working-tree status (staged,
 * unstaged, untracked), the remote-origin sync state and the repository's
 * Git log.
 */
export class HistoryDialog extends BaseDialog {
  private pipelineId: string;
  private pipelineClient: PipelineClient;
  private status: GitStatusDetails | null = null;
  private commits: GitLogEntry[] = [];
  private statusError: string | null = null;
  private logError: string | null = null;
  private loading = true;

  constructor(pipelineId: string, pipelineClient: PipelineClient) {
    super({
      title: 'History (--oneline)',
      maxWidth: 'max-w-3xl',
      maxHeight: 'max-h-[85vh]',
      iconSvg: Icon.render('clock', { size: 20 })
    });
    this.pipelineId = pipelineId;
    this.pipelineClient = pipelineClient;
    this.refreshBody();
  }

  private refreshBody() {
    const bodyContainer = this.dialog.querySelector('#dialog-body-container') as HTMLElement;
    if (bodyContainer) {
      bodyContainer.innerHTML = this.renderBody();
      bodyContainer.classList.add('p-3', 'bg-app-surface');
    }
  }

  protected renderBody(): string {
    // During construction the base dialog calls renderBody before the subclass
    // field initializers have run, so `loading` may be undefined here.
    if (this.loading !== false) {
      return `
        <div class="p-8 text-center text-app-muted italic text-sm">
          Loading repository history…
        </div>
      `;
    }

    return `
      <div class="flex flex-col gap-3">
        ${this.renderStatus()}
        ${this.renderLog()}
      </div>
    `;
  }

  private renderStatus(): string {
    if (this.statusError) {
      return `
        <section class="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400" role="alert">
          ${escapeHtml(this.statusError)}
        </section>
      `;
    }
    if (!this.status) return '';

    return `
      <section class="rounded-lg border border-app-border bg-app-bg p-3" aria-label="Repository status">
        <h4 class="text-[10px] font-black uppercase tracking-widest text-app-muted mb-2">Repository status</h4>
        <div class="flex flex-wrap items-center gap-2 text-[11px] font-mono">
          ${this.renderStatusPill('Staged', this.status.staged, 'text-green-400')}
          ${this.renderStatusPill('Unstaged', this.status.unstaged, 'text-amber-400')}
          ${this.renderStatusPill('Untracked', this.status.untracked, 'text-app-text')}
          ${this.renderRemoteSync()}
        </div>
      </section>
    `;
  }

  private renderStatusPill(label: string, count: number, activeColor: string): string {
    const hasChanges = count > 0;
    const color = hasChanges ? activeColor : 'text-app-muted';
    return `
      <span class="inline-flex items-center gap-1.5 rounded border border-app-border/60 px-2 py-1">
        <span class="text-app-muted">${label}</span>
        <span class="${color} font-bold">${count}</span>
      </span>
    `;
  }

  private renderRemoteSync(): string {
    if (!this.status?.has_origin) {
      return `
        <span class="inline-flex items-center gap-1.5 rounded border border-app-border/60 px-2 py-1 text-app-muted" title="No origin remote configured">
          No origin remote
        </span>
      `;
    }

    const branchLabel = this.status.branch ? ` (${escapeHtml(this.status.branch)})` : '';
    if (this.status.in_sync === true) {
      return `
        <span class="inline-flex items-center gap-1.5 rounded border border-green-500/40 bg-green-500/10 px-2 py-1 text-green-400" title="Local branch is in sync with origin">
          In sync with origin${branchLabel}
        </span>
      `;
    }
    if (this.status.in_sync === false) {
      const ahead = this.status.ahead || 0;
      const behind = this.status.behind || 0;
      return `
        <span class="inline-flex items-center gap-1.5 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-amber-400" title="Local branch diverged from origin">
          Out of sync with origin${branchLabel} · ↑${ahead} ↓${behind}
        </span>
      `;
    }
    return `
      <span class="inline-flex items-center gap-1.5 rounded border border-app-border/60 px-2 py-1 text-app-muted" title="Origin sync cannot be determined">
        Origin sync unavailable
      </span>
    `;
  }

  private renderLog(): string {
    if (this.logError) {
      return `
        <section class="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400" role="alert">
          ${escapeHtml(this.logError)}
        </section>
      `;
    }

    const commits = this.commits || [];
    if (commits.length === 0) {
      return `
        <div class="p-8 text-center text-app-muted italic text-sm">
          No commits available.
        </div>
      `;
    }

    return `
      <section aria-label="Git log">
        <h4 class="text-[10px] font-black uppercase tracking-widest text-app-muted mb-2 px-1">
          Git log <span class="text-app-muted/70">(${commits.length})</span>
        </h4>
        <ul class="flex flex-col divide-y divide-app-border/30">
          ${commits.map(commit => this.renderCommit(commit)).join('')}
        </ul>
      </section>
    `;
  }

  private renderCommit(commit: GitLogEntry): string {
    const shortHash = commit.short_hash || (commit.hash ? commit.hash.substring(0, 7) : '');
    const author = commit.author ? escapeHtml(commit.author) : 'unknown';
    const subject = commit.subject ? escapeHtml(commit.subject) : '(no subject)';
    const date = this.formatDate(commit.date);

    return `
      <li class="flex items-start gap-3 py-1.5 px-1 hover:bg-app-bg transition-colors">
        <span class="text-[10px] font-mono text-app-accent-1 opacity-80 shrink-0 pt-0.5 w-14" title="${escapeHtml(commit.hash)}">
          ${escapeHtml(shortHash)}
        </span>
        <div class="flex flex-col min-w-0 grow">
          <span class="text-xs text-app-text truncate" title="${subject}">${subject}</span>
          <span class="text-[10px] text-app-muted truncate">${author}${date ? ` · ${date}` : ''}</span>
        </div>
      </li>
    `;
  }

  private formatDate(date?: string | null): string {
    if (!date) return '';
    const parsed = new Date(date);
    if (isNaN(parsed.getTime())) return '';
    return parsed.toLocaleString();
  }

  public async show(): Promise<void> {
    const showPromise = super.show();
    await this.load();
    await showPromise;
  }

  private async load(): Promise<void> {
    this.loading = true;
    this.refreshBody();

    try {
      this.status = await this.pipelineClient.getGitStatus(this.pipelineId);
      this.statusError = this.status?.error || null;
    } catch (e: any) {
      this.status = null;
      this.statusError = e?.message || 'Failed to load repository status.';
    }

    try {
      const log = await this.pipelineClient.getGitLog(this.pipelineId);
      this.commits = log?.commits || [];
      this.logError = log?.error || null;
    } catch (e: any) {
      this.commits = [];
      this.logError = e?.message || 'Failed to load repository history.';
    }

    this.loading = false;
    this.refreshBody();
  }
}
