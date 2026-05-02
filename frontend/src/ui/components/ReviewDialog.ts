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
import { Task } from '../../core/domain.ts';
import type { AppContext } from '../../core/AppContext.ts';
import { marked } from 'marked';

export interface ReviewDialogProps {
  task: Task;
  pipelineId: string;
  context: AppContext;
  onDelete?: () => void;
}

export class ReviewDialog extends BaseDialog<void> {
  private props: ReviewDialogProps;

  constructor(props: ReviewDialogProps) {
    super({
      title: 'Technical Review',
      maxWidth: 'max-w-4xl',
      maxHeight: 'max-h-[85vh]',
      iconSvg: '<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>'
    });
    this.props = props;
    this.reRender();
  }

  private reRender() {
    const bodyContainer = this.dialog.querySelector('#dialog-body-container') as HTMLElement;
    bodyContainer.innerHTML = this.renderBody();

    const footerContainer = this.dialog.querySelector('#dialog-footer-container') as HTMLElement;
    footerContainer.innerHTML = this.renderFooter();

    this.attachInternalEventListeners();
  }

  protected renderBody(): string {
    if (!this.props || !this.props.task.review_md) return '<div class="p-8 text-center text-app-muted font-bold uppercase tracking-widest">No review available</div>';
    
    const html = marked.parse(this.props.task.review_md);
    return `
      <div class="p-6 prose prose-invert max-w-none prose-pre:bg-app-bg prose-pre:border prose-pre:border-app-border prose-headings:text-app-accent-2 prose-headings:tracking-tight prose-a:text-app-accent-1 hover:prose-a:text-app-accent-1/80 transition-colors">
        ${html}
      </div>
    `;
  }

  protected renderFooter(): string {
    return `
      <div class="flex flex-col gap-4 p-4 border-t border-app-border bg-app-surface/50 rounded-b-2xl">
        <div class="flex flex-wrap items-center gap-2 justify-center">
          <span class="text-[9px] font-black uppercase tracking-widest text-app-muted mr-1">Quick Prompts:</span>
          <button data-action-copy="create_tasks" class="px-3 py-1.5 rounded bg-app-bg border border-app-border text-[10px] font-bold uppercase tracking-wider text-app-accent-2 hover:bg-app-accent-2/10 transition-all cursor-pointer flex items-center gap-1.5 group" title="Copy prompt to create tasks from review">
            <svg class="w-3 h-3 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
            Create Tasks
          </button>
          <button data-action-copy="explain_review" class="px-3 py-1.5 rounded bg-app-bg border border-app-border text-[10px] font-bold uppercase tracking-wider text-app-accent-2 hover:bg-app-accent-2/10 transition-all cursor-pointer flex items-center gap-1.5 group" title="Copy prompt to explain review in detail">
            <svg class="w-3 h-3 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
            Explain
          </button>
          <button data-action-copy="design_check" class="px-3 py-1.5 rounded bg-app-bg border border-app-border text-[10px] font-bold uppercase tracking-wider text-app-accent-2 hover:bg-app-accent-2/10 transition-all cursor-pointer flex items-center gap-1.5 group" title="Copy prompt to check design alignment">
            <svg class="w-3 h-3 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"></path></svg>
            Design Check
          </button>
        </div>

        <div class="flex justify-between items-center pt-2 border-t border-app-border/30">
          <button id="review-delete-btn" class="px-4 py-2 rounded text-xs font-bold uppercase tracking-widest text-red-500 hover:bg-red-500/10 transition-all cursor-pointer flex items-center gap-2">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
            Delete Review
          </button>
          <button id="review-close-btn" class="px-6 py-2 rounded bg-app-bg text-app-text border border-app-border text-xs font-bold uppercase tracking-widest hover:bg-app-surface transition-all cursor-pointer">
            Close
          </button>
        </div>
      </div>
    `;
  }

  private attachInternalEventListeners() {
    this.dialog.querySelector('#review-close-btn')?.addEventListener('click', () => this.close());
    this.dialog.querySelector('#review-delete-btn')?.addEventListener('click', () => this.handleDelete());
    
    this.dialog.querySelectorAll('[data-action-copy]').forEach(btn => {
      btn.addEventListener('click', (e) => this.handleCopyPrompt(e));
    });
  }

  private async handleCopyPrompt(e: Event) {
    const btn = e.currentTarget as HTMLButtonElement;
    const action = btn.getAttribute('data-action-copy');
    const { task, pipelineId } = this.props;
    const taskId = task.id;

    let prompt = '';
    switch (action) {
      case 'create_tasks':
        prompt = `Please analyze the technical review for Task ${taskId} in Pipeline ${pipelineId}. Break down the findings into up to 5 actionable new tasks, prioritized by impact or ease of implementation (low-hanging fruits).`;
        break;
      case 'explain_review':
        prompt = `Can you explain the technical review for Task ${taskId} in Pipeline ${pipelineId} in more detail? Focus on the architectural implications and any potential risks identified.`;
        break;
      case 'design_check':
        prompt = `Based on the technical review for Task ${taskId} in Pipeline ${pipelineId}, does the current implementation deviate from our established design patterns in the 'design/' folder? If so, what should be changed?`;
        break;
    }

    if (prompt) {
      try {
        await navigator.clipboard.writeText(prompt);
        const originalHtml = btn.innerHTML;
        btn.innerHTML = `<svg class="w-3 h-3 text-green-500 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg> Copied!`;
        btn.classList.add('bg-green-500/10', 'border-green-500/30');
        setTimeout(() => {
          btn.innerHTML = originalHtml;
          btn.classList.remove('bg-green-500/10', 'border-green-500/30');
        }, 2000);
      } catch (err) {
        console.error('Failed to copy prompt:', err);
      }
    }
  }

  private async handleDelete() {
    if (!confirm('Are you sure you want to delete this review?')) return;

    const deleteBtn = this.dialog.querySelector('#review-delete-btn') as HTMLButtonElement;
    deleteBtn.disabled = true;
    deleteBtn.textContent = 'Deleting...';

    try {
      await this.props.context.reviewBotClient.deleteReview(this.props.pipelineId, this.props.task.id!);

      if (this.props.onDelete) {
        this.props.onDelete();
      }
      this.close();
    } catch (error) {
      console.error('Delete review error:', error);
      alert('Failed to delete review. Please check the console.');
      deleteBtn.disabled = false;
      deleteBtn.innerHTML = `
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
        Delete Review
      `;
    }
  }
}
