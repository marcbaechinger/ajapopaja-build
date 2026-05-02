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
      <div class="flex justify-between items-center p-4 border-t border-app-border bg-app-surface/50 rounded-b-2xl">
        <button id="review-delete-btn" class="px-4 py-2 rounded text-xs font-bold uppercase tracking-widest text-red-500 hover:bg-red-500/10 transition-all cursor-pointer flex items-center gap-2">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
          Delete Review
        </button>
        <button id="review-close-btn" class="px-6 py-2 rounded bg-app-bg text-app-text border border-app-border text-xs font-bold uppercase tracking-widest hover:bg-app-surface transition-all cursor-pointer">
          Close
        </button>
      </div>
    `;
  }

  private attachInternalEventListeners() {
    this.dialog.querySelector('#review-close-btn')?.addEventListener('click', () => this.close());
    this.dialog.querySelector('#review-delete-btn')?.addEventListener('click', () => this.handleDelete());
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
