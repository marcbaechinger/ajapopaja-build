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
import { Icon } from './Icon.ts';

/**
 * Dialog that prompts the user for the review comments CoderBot should address
 * when iterating on an existing pull request.
 *
 * Resolves with the trimmed comments string when the user confirms with
 * non-empty comments, or `null` when the dialog is cancelled or the comments
 * are empty.
 */
export class IteratePullRequestDialog extends BaseDialog<string> {
  constructor() {
    super({ title: 'Iterate Pull Request', canOpenAsChildDialog: true });

    // Re-render the body/footer to attach the button listeners.
    this.updateContent();
  }

  private updateContent() {
    const bodyContainer = this.dialog.querySelector('#dialog-body-container') as HTMLElement;
    bodyContainer.innerHTML = this.renderBody() as string;

    const footerContainer = this.dialog.querySelector('#dialog-footer-container') as HTMLElement;
    footerContainer.innerHTML = this.renderFooter() as string;

    this.dialog.querySelector('#iterate-pr-cancel')?.addEventListener('click', () => this.close(null));
    this.dialog.querySelector('#iterate-pr-confirm')?.addEventListener('click', () => {
      const input = this.dialog.querySelector('#iterate-pr-comments') as HTMLTextAreaElement;
      const comments = input?.value.trim() ?? '';
      this.close(comments ? comments : null);
    });
  }

  protected renderBody(): string {
    return `
      <div class="p-4 flex flex-col gap-3">
        <label for="iterate-pr-comments" class="text-sm text-app-text/80">
          Add the review comments CoderBot should address when iterating on this pull request.
        </label>
        <textarea id="iterate-pr-comments"
                  class="w-full bg-app-bg border border-app-border rounded p-2 text-app-text outline-none focus:ring-1 focus:ring-app-accent-2 min-h-[120px]"
                  placeholder="Describe what should be changed in this pull request..."></textarea>
      </div>
    `;
  }

  protected renderFooter(): string {
    return `
      <div class="p-4 pt-0 flex justify-between items-center gap-3">
        <button id="iterate-pr-cancel" class="px-4 py-2 text-app-muted hover:text-app-text transition-colors cursor-pointer font-medium">
          Cancel
        </button>
        <button id="iterate-pr-confirm" class="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-lg transition-all font-bold shadow-lg cursor-pointer">
          ${Icon.render('git-pull-request', { size: 16 })}
          Send Comments to CoderBot
        </button>
      </div>
    `;
  }
}
