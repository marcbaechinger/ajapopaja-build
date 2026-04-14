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

export class ConfirmationDialog extends BaseDialog<boolean> {
  private message: string;
  private confirmLabel: string;
  private cancelLabel: string;

  constructor(
    title: string,
    message: string,
    confirmLabel: string = 'Confirm',
    cancelLabel: string = 'Cancel'
  ) {
    super({ title });
    this.message = message;
    this.confirmLabel = confirmLabel;
    this.cancelLabel = cancelLabel;
    
    // Re-render layout because we need labels
    this.updateContent();
  }

  private updateContent() {
    const bodyContainer = this.dialog.querySelector('#dialog-body-container') as HTMLElement;
    bodyContainer.innerHTML = this.renderBody() as string;
    
    const footerContainer = this.dialog.querySelector('#dialog-footer-container') as HTMLElement;
    footerContainer.innerHTML = this.renderFooter() as string;

    this.dialog.querySelector('#dialog-cancel')?.addEventListener('click', () => this.close(false));
    this.dialog.querySelector('#dialog-confirm')?.addEventListener('click', () => this.close(true));
  }

  protected renderBody(): string {
    return `
      <div class="p-6">
        <p class="text-app-text/80">${this.message}</p>
      </div>
    `;
  }

  protected renderFooter(): string {
    return `
      <div class="p-6 pt-0 flex justify-end gap-3">
        <button id="dialog-cancel" class="px-4 py-2 text-app-muted hover:text-app-text transition-colors cursor-pointer font-medium">
          ${this.cancelLabel}
        </button>
        <button id="dialog-confirm" class="px-6 py-2 bg-app-accent-1 hover:brightness-110 text-white rounded-lg transition-all font-bold shadow-lg cursor-pointer">
          ${this.confirmLabel}
        </button>
      </div>
    `;
  }

  public async show(): Promise<boolean> {
    const result = await super.show();
    return result ?? false;
  }
}
