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
import { Icon } from '../common/Icon.ts';
import { escapeHtml } from '../utils/html.ts';

export interface DevServerStartErrorDialogProps {
  /** Pipeline the failed dev-server start was attempted on. */
  pipelineId: string;
  /** Id of the pull request the server was started on. */
  prId?: string | null;
  /** Subject/title of the pull request. */
  prSubject?: string | null;
  /** Branch the pull request was built from. */
  branch?: string | null;
  /** Id of the task the pull request belongs to. */
  taskId?: string | null;
  /** Title of the task the pull request belongs to. */
  taskTitle?: string | null;
  /** The error message returned by the backend (e.g. build output). */
  error: string;
}

/**
 * A dedicated, non-blocking error dialog for a failed dev-server start on a
 * pull request's branch. It surfaces the context of the attempted process start
 * (branch, task, pull request, pipeline) together with the full error message,
 * which can be copied to the clipboard for debugging. It replaces the previous
 * `alert()` call that blocked browser rendering.
 */
export class DevServerStartErrorDialog extends BaseDialog<void> {
  private props: DevServerStartErrorDialogProps;

  constructor(props: DevServerStartErrorDialogProps) {
    super({
      title: 'Dev Server Start Failed',
      maxWidth: 'max-w-2xl',
      maxHeight: 'max-h-[85vh]',
      iconSvg: Icon.render('alert', { size: 20 }),
    });
    this.props = props;

    const bodyContainer = this.dialog.querySelector(
      '#dialog-body-container',
    ) as HTMLElement;
    bodyContainer.innerHTML = this.renderBody();

    const footerContainer = this.dialog.querySelector(
      '#dialog-footer-container',
    ) as HTMLElement;
    footerContainer.innerHTML = this.renderFooter();

    this.attachCopyListeners();
  }

  protected renderBody(): string {
    if (!this.props) return '';
    const { pipelineId, prId, prSubject, branch, taskId, taskTitle, error } =
      this.props;

    const rows: Array<[string, string | undefined | null]> = [
      ['Branch', branch],
      ['Task', taskTitle ? `${taskTitle} (${taskId ?? 'no id'})` : taskId],
      ['Pull Request', prSubject ? `${prSubject} (${prId ?? 'no id'})` : prId],
      ['Pipeline', pipelineId],
    ];

    const detailRows = rows
      .filter(([, value]) => value != null && value !== '')
      .map(
        ([label, value]) => `
          <div class="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 py-2 border-b border-app-border/40 last:border-b-0">
            <dt class="shrink-0 text-[10px] font-black uppercase tracking-widest text-app-muted sm:w-32">${escapeHtml(label)}</dt>
            <dd class="text-sm text-app-text break-all font-mono">${escapeHtml(value as string)}</dd>
          </div>
        `,
      )
      .join('');

    return `
      <div class="p-6 space-y-5">
        <div class="rounded-2xl border border-app-border bg-app-bg overflow-hidden">
          <div class="px-4 py-2 border-b border-app-border bg-app-surface/40">
            <p class="text-[10px] font-black uppercase tracking-widest text-app-muted">Attempted process start</p>
          </div>
          <dl class="px-4 py-2">${detailRows}</dl>
        </div>

        <div class="rounded-2xl border border-red-500/30 bg-red-500/5 overflow-hidden">
          <div class="px-4 py-2 border-b border-red-500/30 bg-red-500/10 flex items-center justify-between gap-2">
            <p class="text-[10px] font-black uppercase tracking-widest text-red-400">Error message</p>
            <button
              id="dev-server-error-copy-btn"
              data-action-copy="error"
              class="px-3 py-1 rounded-md text-[10px] font-black uppercase tracking-widest bg-app-bg border border-app-border text-app-text hover:bg-app-surface hover:border-app-accent-2/40 transition-all cursor-pointer flex items-center gap-1.5"
            >
              ${Icon.render('copy', { size: 12 })}
              <span class="copy-label">Copy error</span>
            </button>
          </div>
          <pre class="p-4 text-xs font-mono text-red-300 whitespace-pre-wrap break-all max-h-64 overflow-y-auto custom-scrollbar" data-role="dev-server-error">${escapeHtml(error)}</pre>
        </div>
      </div>
    `;
  }

  protected renderFooter(): string {
    return `
      <div class="p-3 border-t border-app-border flex items-center justify-between gap-3 bg-app-surface/50">
        <button
          id="dev-server-error-copy-all-btn"
          data-action-copy="all"
          class="px-4 py-1.5 rounded text-xs font-bold bg-app-bg border border-app-border text-app-text hover:bg-app-surface transition-colors cursor-pointer flex items-center gap-2"
        >
          ${Icon.render('copy', { size: 14 })}
          <span class="copy-label">Copy all details</span>
        </button>
        <button id="dev-server-error-close-btn" class="px-4 py-1.5 rounded text-xs font-bold bg-app-bg border border-app-border text-app-text hover:bg-app-surface transition-colors cursor-pointer">
          Close
        </button>
      </div>
    `;
  }

  private attachCopyListeners() {
    this.dialog
      .querySelector('#dev-server-error-close-btn')
      ?.addEventListener('click', () => this.close());

    this.dialog
      .querySelectorAll('[data-action-copy]')
      .forEach((btn) => btn.addEventListener('click', (e) => this.handleCopy(e)));
  }

  private buildErrorText(): string {
    return this.props.error;
  }

  private buildAllText(): string {
    const { pipelineId, prId, prSubject, branch, taskId, taskTitle, error } =
      this.props;
    return [
      'Dev server start failed',
      '',
      `Pipeline: ${pipelineId}`,
      `Branch: ${branch ?? 'unknown'}`,
      `Task: ${taskTitle ?? 'unknown'}${taskId ? ` (${taskId})` : ''}`,
      `Pull Request: ${prSubject ?? 'unknown'}${prId ? ` (${prId})` : ''}`,
      '',
      'Error message:',
      error,
    ].join('\n');
  }

  private async handleCopy(e: Event) {
    const btn = e.currentTarget as HTMLButtonElement;
    const target = btn.getAttribute('data-action-copy');
    const text = target === 'all' ? this.buildAllText() : this.buildErrorText();
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      const label = btn.querySelector('.copy-label');
      if (label) {
        const original = label.textContent ?? 'Copy';
        label.textContent = 'Copied!';
        window.setTimeout(() => {
          label.textContent = original;
        }, 1500);
      }
    } catch (error) {
      console.error('Failed to copy dev-server error:', error);
    }
  }
}
