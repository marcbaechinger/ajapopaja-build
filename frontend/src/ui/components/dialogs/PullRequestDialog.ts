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
import { PullRequest, PullRequestStatus, pullRequestAcceptLabel } from '../../../core/domain.ts';
import type { AppContext } from '../../../core/AppContext.ts';
import { Icon } from '../common/Icon.ts';
import { DiffView } from '../common/DiffView.ts';
import { escapeHtml } from '../utils/html.ts';
import { showPullRequestSyncToast } from '../utils/prSync.ts';

export interface PullRequestDialogProps {
  taskId: string;
  pipelineId: string;
  prId?: string;
  context: AppContext;
  onAccept?: () => void;
  onReject?: () => void;
}

export class PullRequestDialog extends BaseDialog<void> {
  private props: PullRequestDialogProps;
  private pr: PullRequest | null = null;
  private loading: boolean = true;
  private diffView: DiffView | null = null;
  /**
   * Set after a 409 "older pull request is still open" accept response. It
   * swaps the footer for a choice between syncing the latest Gitea state and
   * accepting out of order (force).
   */
  private conflict: boolean = false;

  constructor(props: PullRequestDialogProps) {
    super({
      title: 'CoderBot Pull Request',
      maxWidth: 'max-w-5xl',
      maxHeight: 'max-h-[90vh]',
      iconSvg: Icon.render('git-pull-request', { size: 20 })
    });
    this.props = props;
    this.loadPr();
  }

  private async loadPr() {
    this.loading = true;
    this.reRender();
    try {
      if (this.props.prId) {
        this.pr = await this.props.context.pullRequestClient.getPullRequest(this.props.prId);
      } else {
        this.pr = await this.props.context.pullRequestClient.getPullRequestByTask(this.props.taskId);
      }
    } catch (error) {
      console.error('Load PR error:', error);
    } finally {
      this.loading = false;
      this.reRender();
    }
  }

  private reRender() {
    const bodyContainer = this.dialog.querySelector('#dialog-body-container') as HTMLElement;
    bodyContainer.innerHTML = this.renderBody();

    const footerContainer = this.dialog.querySelector('#dialog-footer-container') as HTMLElement;
    footerContainer.innerHTML = this.renderFooter();

    this.attachInternalEventListeners();
    this.renderDiffView();
  }

  private renderDiffView() {
    if (this.diffView) {
      this.diffView.destroy();
      this.diffView = null;
    }
    if (!this.pr) return;
    const mount = this.dialog.querySelector('#pr-diff-container') as HTMLElement | null;
    if (!mount) return;
    this.diffView = new DiffView(mount, {
      patch: this.pr.patch,
      metadata: {
        subject: this.pr.subject || this.pr.summary,
        author: this.pr.author,
        branch: this.pr.branch_name,
        createdAt: this.pr.created_at,
        updatedAt: this.pr.updated_at,
      },
      heightClass: 'max-h-[60vh]',
    });
    this.diffView.render();
  }

  protected renderBody(): string {
    if (this.loading) {
      return `
        <div class="p-20 flex flex-col items-center justify-center gap-4">
          <div class="animate-spin text-app-accent-2">
            ${Icon.render('refresh', { size: 32 })}
          </div>
          <p class="text-app-muted font-bold uppercase tracking-widest text-sm">Loading Pull Request...</p>
        </div>
      `;
    }

    if (!this.pr) {
      return `
        <div class="p-20 text-center">
          <p class="text-red-400 font-bold uppercase tracking-widest">Pull Request not found</p>
          <button id="pr-close-fallback-btn" class="mt-4 px-6 py-2 rounded bg-app-surface text-app-text border border-app-border text-xs font-bold uppercase tracking-widest">Close</button>
        </div>
      `;
    }

    return `
      <div class="flex flex-col h-full overflow-hidden">
        <div class="p-6 border-b border-app-border bg-app-accent-2/5">
          <div class="flex items-center justify-between gap-3 mb-2">
            <div class="flex items-center gap-3">
              <span class="text-[10px] font-black uppercase tracking-widest bg-app-accent-2/20 text-app-accent-2 px-2 py-0.5 rounded border border-app-accent-2/30">
                Branch: ${this.pr.branch_name}
              </span>
            </div>
            <div class="flex items-center gap-2">
              <label for="pr-failure-strategy" class="text-[10px] font-bold text-app-muted uppercase tracking-widest">Failure Handling:</label>
              <select id="pr-failure-strategy" class="bg-app-bg text-[10px] text-app-text border border-app-border rounded-lg px-2 py-1 focus:ring-0 focus:border-app-accent-2/50 cursor-pointer outline-none">
                <option value="revert" selected>Revert Changes (Safe)</option>
                <option value="keep">Keep Changes (Manual Fix)</option>
              </select>
            </div>
          </div>
          <div class="relative group">
            <textarea id="pr-summary-input" class="w-full bg-transparent text-xl font-bold text-app-text border-none focus:ring-0 resize-none p-0 overflow-hidden min-h-[1.5em]" rows="1">${this.pr.subject || this.pr.summary}</textarea>
            <div class="absolute -bottom-1 left-0 w-full h-px bg-app-accent-2/30 scale-x-0 group-focus-within:scale-x-100 transition-transform duration-300"></div>
          </div>
          <p class="text-[10px] font-bold text-app-muted uppercase tracking-widest mt-1">Commit Message</p>
        </div>
        ${this.renderExternalReviewBanner()}

        <div class="flex-grow overflow-auto p-0 bg-slate-950 custom-scrollbar">
          <div id="pr-diff-container"></div>
        </div>
      </div>
    `;
  }

  protected renderFooter(): string {
    if (this.loading || !this.pr) return '';

    if (this.isSubmitted()) {
      return `
      <div class="flex justify-between items-center p-4 border-t border-app-border bg-app-surface/50 rounded-b-2xl">
        <button id="pr-close-btn" class="px-6 py-2 rounded bg-app-bg text-app-text border border-app-border text-xs font-bold uppercase tracking-widest hover:bg-app-surface transition-all cursor-pointer">
          Close
        </button>
        <div class="flex gap-3">
          <a id="pr-open-gitea-link" href="${escapeHtml(this.pr.remote_pr_url || '#')}" target="_blank" rel="noopener noreferrer" class="px-8 py-2 rounded bg-app-accent-2 text-white text-xs font-black uppercase tracking-widest hover:bg-app-accent-2/80 transition-all cursor-pointer shadow-lg shadow-app-accent-2/20 inline-flex items-center gap-2">
            ${Icon.render('arrowRight', { size: 16 })}
            Open in Gitea
          </a>
        </div>
      </div>
    `;
    }

    if (this.conflict) {
      return `
      <div class="p-4 border-t border-amber-500/40 bg-amber-500/10 rounded-b-2xl">
        <div class="flex items-start gap-2 mb-3 text-amber-500">
          ${Icon.render('alert', { size: 18 })}
          <p class="text-xs text-app-text/80">An older pull request for this pipeline is still open. Sync the latest Gitea state to clear it, or accept this one out of order.</p>
        </div>
        <div class="flex justify-end gap-3">
          <button id="pr-accept-anyway-btn" class="px-4 py-2 rounded text-xs font-bold uppercase tracking-widest text-app-text border border-app-border hover:bg-app-surface transition-all cursor-pointer">
            Accept anyway
          </button>
          <button id="pr-sync-retry-btn" class="px-6 py-2 rounded bg-app-accent-2 text-white text-xs font-black uppercase tracking-widest hover:bg-app-accent-2/80 transition-all cursor-pointer shadow-lg shadow-app-accent-2/20 inline-flex items-center gap-2">
            ${Icon.render('refresh', { size: 16 })}
            Sync from Gitea & retry
          </button>
        </div>
      </div>
    `;
    }

    return `
      <div class="flex justify-between items-center p-4 border-t border-app-border bg-app-surface/50 rounded-b-2xl">
        <button id="pr-reject-btn" class="px-4 py-2 rounded text-xs font-bold uppercase tracking-widest text-red-500 hover:bg-red-500/10 transition-all cursor-pointer flex items-center gap-2">
          ${Icon.render('close', { size: 16 })}
          Reject
        </button>
        <div class="flex gap-3">
          <button id="pr-close-btn" class="px-6 py-2 rounded bg-app-bg text-app-text border border-app-border text-xs font-bold uppercase tracking-widest hover:bg-app-surface transition-all cursor-pointer">
            Close
          </button>
          <button id="pr-accept-btn" class="px-8 py-2 rounded bg-green-600 text-white text-xs font-black uppercase tracking-widest hover:bg-green-500 transition-all cursor-pointer shadow-lg shadow-green-900/20">
            ${pullRequestAcceptLabel(this.pr)}
          </button>
        </div>
      </div>
    `;
  }

  private isSubmitted(): boolean {
    return !!this.pr && (
      this.pr.status === PullRequestStatus.SUBMITTED || !!this.pr.remote_pr_url
    );
  }

  private renderExternalReviewBanner(): string {
    if (!this.isSubmitted()) return '';
    const url = this.pr!.remote_pr_url || '#';
    return `
      <div class="px-6 py-3 border-b border-app-border bg-app-accent-2/10 flex items-center justify-between gap-3">
        <div class="flex items-center gap-2 text-[10px] font-bold text-app-accent-2 uppercase tracking-widest">
          ${Icon.render('git-pull-request', { size: 16 })}
          Submitted for external review
        </div>
        <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" class="text-[10px] font-black text-app-accent-2 underline hover:opacity-80">View Pull Request</a>
      </div>
    `;
  }

  private attachInternalEventListeners() {
    this.dialog.querySelector('#pr-close-btn')?.addEventListener('click', () => this.close());
    this.dialog.querySelector('#pr-close-fallback-btn')?.addEventListener('click', () => this.close());
    this.dialog.querySelector('#pr-accept-btn')?.addEventListener('click', () => this.handleAccept());
    this.dialog.querySelector('#pr-reject-btn')?.addEventListener('click', () => this.handleReject());
    this.dialog.querySelector('#pr-accept-anyway-btn')?.addEventListener('click', () => this.handleAccept(true));
    this.dialog.querySelector('#pr-sync-retry-btn')?.addEventListener('click', () => this.handleSyncAndRetry());

    const summaryInput = this.dialog.querySelector('#pr-summary-input') as HTMLTextAreaElement;
    if (summaryInput) {
      summaryInput.addEventListener('input', () => {
        summaryInput.style.height = 'auto';
        summaryInput.style.height = summaryInput.scrollHeight + 'px';
      });
      // Trigger once to set initial height
      summaryInput.style.height = 'auto';
      summaryInput.style.height = summaryInput.scrollHeight + 'px';
    }
  }

  /**
   * Whether an accept failure is the 409 ordering conflict. Accepts both the
   * structured {@link ApiError} status and the raw detail text so it also works
   * with plain Errors (e.g. from tests or older clients).
   */
  private isOlderPrConflict(error: any): boolean {
    if (error && typeof error.status === 'number' && error.status === 409) {
      return true;
    }
    const message = typeof error?.message === 'string' ? error.message : '';
    return /older pull request[\s\S]*still open/i.test(message);
  }

  private async handleAccept(force: boolean = false) {
    if (!this.pr) return;
    const acceptBtn = this.dialog.querySelector(
      force ? '#pr-accept-anyway-btn' : '#pr-accept-btn'
    ) as HTMLButtonElement | null;
    const summaryInput = this.dialog.querySelector('#pr-summary-input') as HTMLTextAreaElement;
    const strategySelect = this.dialog.querySelector('#pr-failure-strategy') as HTMLSelectElement;
    const acceptLabel = pullRequestAcceptLabel(this.pr);
    
    const commitMessage =
      summaryInput?.value || this.pr.subject || this.pr.summary;
    const failureStrategy = strategySelect?.value || 'revert';

    if (acceptBtn) {
      acceptBtn.disabled = true;
      acceptBtn.textContent = 'Applying...';
    }

    try {
      await this.props.context.pullRequestClient.acceptPullRequest(
        this.pr.id!,
        commitMessage,
        failureStrategy,
        force,
      );
      if (this.props.onAccept) this.props.onAccept();
      this.close();
    } catch (error: any) {
      console.error('Accept PR error:', error);
      // The safe choice when an older PR is still open: offer to sync the
      // latest Gitea state (and retry) instead of the dead-end alert.
      if (!force && this.isOlderPrConflict(error)) {
        this.conflict = true;
        this.reRender();
        return;
      }
      alert(`Failed to accept Pull Request: ${error.message}`);
      if (acceptBtn) {
        acceptBtn.disabled = false;
        acceptBtn.textContent = force ? 'Accept anyway' : acceptLabel;
      }
    }
  }

  /**
   * Sync the pipeline's pull requests from Gitea, report the summary, then
   * retry the accept now that a stale local PR may have been reconciled.
   */
  private async handleSyncAndRetry() {
    if (!this.pr) return;
    const syncBtn = this.dialog.querySelector('#pr-sync-retry-btn') as HTMLButtonElement | null;
    if (syncBtn) {
      syncBtn.disabled = true;
      syncBtn.textContent = 'Syncing...';
    }
    try {
      const result = await this.props.context.pullRequestClient.syncPullRequests(
        this.props.pipelineId,
      );
      showPullRequestSyncToast(result);
    } catch (error: any) {
      console.error('Sync from Gitea error:', error);
      alert(`Failed to sync from Gitea: ${error.message}`);
    }
    // Retry the normal accept: a remotely closed older PR is now rejected, so
    // no force is needed. If it is still open the conflict choice reappears.
    this.conflict = false;
    this.reRender();
    await this.handleAccept(false);
  }

  private async handleReject() {
    if (!this.pr) return;
    const rejectBtn = this.dialog.querySelector('#pr-reject-btn') as HTMLButtonElement;
    rejectBtn.disabled = true;
    rejectBtn.textContent = 'Rejecting...';

    try {
      await this.props.context.pullRequestClient.rejectPullRequest(this.pr.id!);
      if (this.props.onReject) this.props.onReject();
      this.close();
    } catch (error: any) {
      console.error('Reject PR error:', error);
      alert(`Failed to reject Pull Request: ${error.message}`);
      rejectBtn.disabled = false;
      rejectBtn.textContent = 'Reject';
    }
  }
}
