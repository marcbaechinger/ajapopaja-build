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
import DOMPurify from 'dompurify';
import { ConfirmationDialog } from './ConfirmationDialog.ts';
import { renderQuickPromptButton, type PromptConfig } from './QuickPromptButton.ts';
import { Icon } from './Icon.ts';

const PROMPT_CONFIGS: PromptConfig[] = [
  {
    id: 'create_tasks',
    label: 'Create Tasks',
    title: 'Copy prompt to create tasks from review',
    iconSvg: Icon.render('documentation', { size: 12, className: 'group-hover:scale-110 transition-transform' }),
    getPrompt: (taskId, pipelineId) => `Please analyze the technical review for Task ${taskId} in Pipeline ${pipelineId}. Break down the findings into up to 5 actionable new tasks, prioritized by impact or ease of implementation (low-hanging fruits).`
  },
  {
    id: 'explain_review',
    label: 'Explain',
    title: 'Copy prompt to explain review in detail',
    iconSvg: Icon.render('documentation', { size: 12, className: 'group-hover:scale-110 transition-transform' }),
    getPrompt: (taskId, pipelineId) => `Can you explain the technical review for Task ${taskId} in Pipeline ${pipelineId} in more detail? Focus on the architectural implications and any potential risks identified.`
  },
  {
    id: 'design_check',
    label: 'Design Check',
    title: 'Copy prompt to check design alignment',
    iconSvg: Icon.render('check', { size: 12, className: 'group-hover:scale-110 transition-transform' }),
    getPrompt: (taskId, pipelineId) => `Based on the technical review for Task ${taskId} in Pipeline ${pipelineId}, does the current implementation deviate from our established design patterns in the 'design/' folder? If so, what should be changed?`
  }
];

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
      iconSvg: Icon.render('documentation', { size: 20 })
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

    const rawHtml = marked.parse(this.props.task.review_md) as string;
    const cleanHtml = DOMPurify.sanitize(rawHtml);
    return `
      <div class="p-6 prose-theme">
        ${cleanHtml}
      </div>
    `;
  }

  protected renderFooter(): string {
    const promptButtons = PROMPT_CONFIGS.map(config => renderQuickPromptButton(config)).join('\n');

    return `
      <div class="flex flex-col gap-4 p-4 border-t border-app-border bg-app-surface/50 rounded-b-2xl">
        <div class="flex flex-wrap items-center gap-2 justify-center">
          <span class="text-[9px] font-black uppercase tracking-widest text-app-muted mr-1">Quick Prompts:</span>
          ${promptButtons}
        </div>

        <div class="flex justify-between items-center pt-2 border-t border-app-border/30">
          <button id="review-delete-btn" class="px-4 py-2 rounded text-xs font-bold uppercase tracking-widest text-red-500 hover:bg-red-500/10 transition-all cursor-pointer flex items-center gap-2">
            ${Icon.render('trash', { size: 16 })}
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
    const taskId = task.id || '';

    const config = PROMPT_CONFIGS.find(c => c.id === action);
    const prompt = config ? config.getPrompt(taskId, pipelineId) : '';

    if (prompt) {
      try {
        await navigator.clipboard.writeText(prompt);
        const originalHtml = btn.innerHTML;
        btn.innerHTML = `${Icon.render('check', { size: 12, className: 'text-green-500 animate-bounce' })} Copied!`;
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
    const confirmed = await new ConfirmationDialog(
      'Delete Review',
      'Are you sure you want to delete this review?',
      'Delete'
    ).show();
    if (!confirmed) return;

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
        ${Icon.render('trash', { size: 16 })}
        Delete Review
      `;
    }
  }
}
