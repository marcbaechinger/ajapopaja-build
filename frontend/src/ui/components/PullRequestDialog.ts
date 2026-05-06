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
import { PullRequest } from '../../core/domain.ts';
import type { AppContext } from '../../core/AppContext.ts';
import { Icon } from './Icon.ts';

export interface PullRequestDialogProps {
  taskId: string;
  pipelineId: string;
  context: AppContext;
  onAccept?: () => void;
  onReject?: () => void;
}

export class PullRequestDialog extends BaseDialog<void> {
  private props: PullRequestDialogProps;
  private pr: PullRequest | null = null;
  private loading: boolean = true;

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
      this.pr = await this.props.context.pullRequestClient.getPullRequestByTask(this.props.taskId);
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
          <div class="flex items-center gap-3 mb-2">
            <span class="text-[10px] font-black uppercase tracking-widest bg-app-accent-2/20 text-app-accent-2 px-2 py-0.5 rounded border border-app-accent-2/30">
              Branch: ${this.pr.branch_name}
            </span>
          </div>
          <h3 class="text-xl font-bold text-app-text">${this.pr.summary}</h3>
        </div>
        
        <div class="flex-grow overflow-auto p-0 bg-slate-950">
          <pre class="text-[11px] leading-relaxed p-6 text-slate-300 font-mono whitespace-pre overflow-visible"><code>${this.escapeHtml(this.pr.patch)}</code></pre>
        </div>
      </div>
    `;
  }

  protected renderFooter(): string {
    if (this.loading || !this.pr) return '';

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
            Accept & Apply
          </button>
        </div>
      </div>
    `;
  }

  private attachInternalEventListeners() {
    this.dialog.querySelector('#pr-close-btn')?.addEventListener('click', () => this.close());
    this.dialog.querySelector('#pr-close-fallback-btn')?.addEventListener('click', () => this.close());
    this.dialog.querySelector('#pr-accept-btn')?.addEventListener('click', () => this.handleAccept());
    this.dialog.querySelector('#pr-reject-btn')?.addEventListener('click', () => this.handleReject());
  }

  private async handleAccept() {
    if (!this.pr) return;
    const acceptBtn = this.dialog.querySelector('#pr-accept-btn') as HTMLButtonElement;
    acceptBtn.disabled = true;
    acceptBtn.textContent = 'Applying...';

    try {
      await this.props.context.pullRequestClient.acceptPullRequest(this.pr.id!);
      if (this.props.onAccept) this.props.onAccept();
      this.close();
    } catch (error: any) {
      console.error('Accept PR error:', error);
      alert(`Failed to accept Pull Request: ${error.message}`);
      acceptBtn.disabled = false;
      acceptBtn.textContent = 'Accept & Apply';
    }
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

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
