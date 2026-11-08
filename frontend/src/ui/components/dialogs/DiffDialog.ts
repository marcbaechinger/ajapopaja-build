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
import { CommitDiff } from '../../../core/domain.ts';
import type { AppContext } from '../../../core/AppContext.ts';
import { Icon } from '../common/Icon.ts';
import { DiffView } from '../common/DiffView.ts';
import { escapeHtml } from '../utils/html.ts';

export interface DiffDialogProps {
  context: AppContext;
  pipelineId: string;
  commitHash: string;
  /** Optional title (e.g. the task title) shown as a fallback subject. */
  title?: string;
  /**
   * Optional already-loaded commit diff. When supplied the dialog renders it
   * immediately instead of fetching the same commit again (the History view
   * already loads it to render the commit header).
   */
  diff?: CommitDiff | null;
  /** Alias for {@link diff}, kept for callers that prefer an explicit name. */
  initialDiff?: CommitDiff | null;
  /** Additional aliases for the already-loaded commit diff. */
  commitDiff?: CommitDiff | null;
  /** Additional alias for the already-loaded commit diff. */
  preloadedDiff?: CommitDiff | null;
}

/**
 * A dialog that loads a single commit's patch from the backend and renders it
 * through the reusable {@link DiffView}. It owns only the loading/error framing
 * and delegates all patch parsing/rendering to `DiffView`.
 */
export class DiffDialog extends BaseDialog<void> {
  private props: DiffDialogProps;
  private diff: CommitDiff | null = null;
  private loading: boolean = true;
  private error: string | null = null;
  private diffView: DiffView | null = null;

  constructor(props: DiffDialogProps) {
    super({
      title: 'Commit Diff',
      maxWidth: 'max-w-[96rem]',
      maxHeight: 'max-h-[90vh]',
      iconSvg: Icon.render('quickfix', { size: 20 }),
    });
    this.props = props;
    const initialDiff =
      props.diff ??
      props.initialDiff ??
      props.commitDiff ??
      props.preloadedDiff ??
      null;
    if (initialDiff) {
      this.diff = initialDiff;
      this.loading = false;
      this.reRender();
    } else {
      this.load();
    }
  }

  private async load() {
    this.loading = true;
    this.error = null;
    this.reRender();
    try {
      this.diff = await this.props.context.pipelineClient.getCommitDiff(
        this.props.pipelineId,
        this.props.commitHash
      );
    } catch (e) {
      this.error = (e as Error).message;
    } finally {
      this.loading = false;
      this.reRender();
    }
  }

  private reRender() {
    const body = this.dialog.querySelector('#dialog-body-container') as HTMLElement | null;
    if (body) body.innerHTML = this.renderBody();

    const footer = this.dialog.querySelector('#dialog-footer-container') as HTMLElement | null;
    if (footer) footer.innerHTML = this.renderFooter();

    this.attachInternalEventListeners();
    this.renderDiffView();
  }

  private attachInternalEventListeners() {
    this.dialog
      .querySelector('#diff-close-btn')
      ?.addEventListener('click', () => this.close());
  }

  private renderDiffView() {
    // Detach any previous DiffView so repeated loads do not leak collapse listeners.
    if (this.diffView) {
      this.diffView.destroy();
      this.diffView = null;
    }
    if (!this.diff) return;
    const mount = this.dialog.querySelector('#diff-dialog-container') as HTMLElement | null;
    if (!mount) return;
    this.diffView = new DiffView(mount, {
      patch: this.diff.patch,
      metadata: {
        label: 'Commit',
        subject: this.diff.subject ?? this.props.title,
        author: this.diff.author ?? undefined,
        createdAt: this.diff.created_at ?? undefined,
      },
      heightClass: 'max-h-[70vh]',
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
          <p class="text-app-muted font-bold uppercase tracking-widest text-sm">Loading Commit Diff...</p>
        </div>
      `;
    }

    if (this.error) {
      return `
        <div class="p-20 text-center">
          <p class="text-red-400 font-bold uppercase tracking-widest" data-role="diff-error">${escapeHtml(
            this.error
          )}</p>
        </div>
      `;
    }

    return `
      <div class="overflow-auto custom-scrollbar">
        <div id="diff-dialog-container"></div>
      </div>
    `;
  }

  protected renderFooter(): string {
    return `
      <div class="flex justify-end items-center p-4 border-t border-app-border bg-app-surface/50 rounded-b-2xl">
        <button id="diff-close-btn" class="px-6 py-2 rounded bg-app-bg text-app-text border border-app-border text-xs font-bold uppercase tracking-widest hover:bg-app-surface transition-all cursor-pointer">
          Close
        </button>
      </div>
    `;
  }
}
