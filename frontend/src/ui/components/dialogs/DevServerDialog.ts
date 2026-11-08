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
import { ProcessIoView } from '../session/ProcessIoView.ts';
import type { AppContext } from '../../../core/AppContext.ts';
import type { DevServerStatus } from '../../../core/clients/PipelineClient.ts';
import { Icon } from '../common/Icon.ts';

/**
 * Dialog wrapper that embeds a {@link ProcessIoView} for a pipeline's dev
 * process. Closing the dialog tears the view (and its stream subscription)
 * down.
 */
export class DevServerDialog extends BaseDialog<void> {
  private context: AppContext;
  private pipelineId: string;
  private processIoView: ProcessIoView | null = null;
  private resetButton: HTMLButtonElement | null = null;
  private rebuildButton: HTMLButtonElement | null = null;
  private errorSlot: HTMLElement | null = null;

  constructor(context: AppContext, pipelineId: string) {
    super({
      title: 'Dev Server Logs',
      maxWidth: 'max-w-4xl',
      maxHeight: 'max-h-[85vh]',
      iconSvg: Icon.render('documentation', { size: 20 }),
    });
    this.context = context;
    this.pipelineId = pipelineId;

    // Render the body/footer explicitly now that instance state is available.
    const bodyContainer = this.dialog.querySelector(
      '#dialog-body-container',
    ) as HTMLElement;
    bodyContainer.innerHTML = this.renderBody() as string;

    const footerContainer = this.dialog.querySelector(
      '#dialog-footer-container',
    ) as HTMLElement;
    footerContainer.innerHTML = this.renderFooter() as string;

    footerContainer
      .querySelector('#dev-server-dialog-close-btn')
      ?.addEventListener('click', () => {
        this.close();
      });

    this.resetButton = footerContainer.querySelector(
      '#dev-server-dialog-default-branch-btn',
    ) as HTMLButtonElement | null;
    this.rebuildButton = footerContainer.querySelector(
      '#dev-server-dialog-rebuild-btn',
    ) as HTMLButtonElement | null;
    this.errorSlot = footerContainer.querySelector(
      '#dev-server-dialog-error',
    ) as HTMLElement | null;

    this.resetButton?.addEventListener('click', () => {
      void this.resetToDefaultBranch();
    });
    this.rebuildButton?.addEventListener('click', () => {
      void this.rebuildServer();
    });
    void this.refreshActionButtons();

    const mount = bodyContainer.querySelector(
      '#dev-server-pioview-mount',
    ) as HTMLElement;
    if (mount) {
      this.mountProcessIoView(mount);
    }
  }

  protected renderBody(): string {
    return `
      <div id="dev-server-pioview-mount" class="flex flex-col h-full"></div>
    `;
  }

  protected renderFooter(): string {
    return `
      <div class="p-3 border-t border-app-border bg-app-surface/50">
        <div id="dev-server-dialog-error" class="hidden mb-2 text-xs text-red-400" aria-live="polite"></div>
        <div class="flex justify-between items-center">
          <div class="flex items-center gap-2">
            <button id="dev-server-dialog-default-branch-btn" type="button" class="hidden px-4 py-1.5 rounded text-xs font-bold bg-app-accent-2 text-app-accent-fg hover:brightness-105 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
              Back to default branch
            </button>
            <button id="dev-server-dialog-rebuild-btn" type="button" class="hidden px-4 py-1.5 rounded text-xs font-bold bg-app-accent-1 text-app-accent-fg hover:brightness-105 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
              Rebuild
            </button>
          </div>
          <button id="dev-server-dialog-close-btn" class="px-4 py-1.5 rounded text-xs font-bold bg-app-bg border border-app-border text-app-text hover:bg-app-surface transition-colors cursor-pointer">
            Close
          </button>
        </div>
      </div>
    `;
  }

  /** Reads the current status once and updates both footer actions. */
  private async refreshActionButtons(): Promise<void> {
    try {
      const status = await this.context.pipelineClient.getDevServerStatus(
        this.pipelineId,
      );
      this.applyStatusToActions(status);
    } catch (error) {
      console.error('DevServerDialog: failed to read dev server status', error);
      this.resetButton?.classList.add('hidden');
      this.rebuildButton?.classList.add('hidden');
    }
  }

  private applyStatusToActions(status: DevServerStatus): void {
    const onAnotherBranch = Boolean(status.task_id || status.target);
    this.resetButton?.classList.toggle('hidden', !onAnotherBranch);

    const rebuildAvailable =
      Boolean(status.run_id) && status.build_commands_configured !== false;
    this.rebuildButton?.classList.toggle('hidden', !rebuildAvailable);
    if (!rebuildAvailable || !this.rebuildButton) return;

    const building = status.phase === 'building';
    this.rebuildButton.disabled = building;
    this.rebuildButton.textContent = building ? 'Rebuilding…' : 'Rebuild';
  }

  /** Keeps the rebuild action in sync with live process phase changes. */
  private handleProcessStatus(status: string): void {
    if (!this.rebuildButton) return;
    if (status === 'building') {
      this.rebuildButton.disabled = true;
      this.rebuildButton.textContent = 'Rebuilding…';
      return;
    }
    if (
      status === 'running' ||
      status === 'exited' ||
      status === 'failed' ||
      status === 'build_failed' ||
      status === 'stopped'
    ) {
      this.rebuildButton.disabled = false;
      this.rebuildButton.textContent = 'Rebuild';
    }
  }

  private mountProcessIoView(mount: HTMLElement): void {
    this.processIoView = new ProcessIoView(mount, this.context, this.pipelineId, {
      onStatus: (status) => this.handleProcessStatus(status),
    });
    this.processIoView.render();
  }

  /** Rebuilds and restarts the dev server in its current workspace. */
  private async rebuildServer(): Promise<void> {
    const button = this.rebuildButton;
    if (!button || button.disabled) return;

    button.disabled = true;
    button.textContent = 'Rebuilding…';
    this.clearError();
    try {
      await this.context.pipelineClient.rebuildDevServer(this.pipelineId);
      // The old run has ended; subscribe to the new rebuild run so the dialog
      // tails build output and then the restarted server.
      this.recreateProcessIoView();
    } catch (error: any) {
      button.disabled = false;
      button.textContent = 'Rebuild';
      this.showError(error?.message ?? 'Rebuild failed');
    }
  }

  /** Transitions the dev server back onto the pipeline's default branch. */
  private async resetToDefaultBranch(): Promise<void> {
    const button = this.resetButton;
    if (!button) return;

    const original = button.textContent ?? '';
    button.disabled = true;
    button.textContent = 'Switching…';
    this.clearError();
    try {
      await this.context.pipelineClient.resetDevServerToDefaultBranch(
        this.pipelineId,
      );
      button.classList.add('hidden');
      // The old process stream has ended; re-mount the view so it tails the
      // freshly started default-branch process.
      this.recreateProcessIoView();
    } catch (error: any) {
      console.error('DevServerDialog: failed to reset dev server branch', error);
      button.disabled = false;
      button.textContent = original;
      this.showError(error?.message ?? 'Could not switch to the default branch');
    }
  }

  private showError(message: string): void {
    if (!this.errorSlot) return;
    this.errorSlot.textContent = message;
    this.errorSlot.classList.remove('hidden');
  }

  private clearError(): void {
    if (!this.errorSlot) return;
    this.errorSlot.textContent = '';
    this.errorSlot.classList.add('hidden');
  }

  private recreateProcessIoView(): void {
    if (this.processIoView) {
      this.processIoView.destroy();
      this.processIoView = null;
    }
    const mount = this.dialog.querySelector(
      '#dev-server-pioview-mount',
    ) as HTMLElement | null;
    if (mount) {
      this.mountProcessIoView(mount);
    }
  }

  protected close(result: any = null) {
    if (this.processIoView) {
      this.processIoView.destroy();
      this.processIoView = null;
    }
    super.close(result);
  }
}
