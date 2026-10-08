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

    const mount = bodyContainer.querySelector(
      '#dev-server-pioview-mount',
    ) as HTMLElement;
    if (mount) {
      this.processIoView = new ProcessIoView(mount, this.context, this.pipelineId);
      this.processIoView.render();
    }
  }

  protected renderBody(): string {
    return `
      <div id="dev-server-pioview-mount" class="flex flex-col h-full"></div>
    `;
  }

  protected renderFooter(): string {
    return `
      <div class="p-3 border-t border-app-border flex justify-end items-center bg-app-surface/50">
        <button id="dev-server-dialog-close-btn" class="px-4 py-1.5 rounded text-xs font-bold bg-app-bg border border-app-border text-app-text hover:bg-app-surface transition-colors cursor-pointer">
          Close
        </button>
      </div>
    `;
  }

  protected close(result: any = null) {
    if (this.processIoView) {
      this.processIoView.destroy();
      this.processIoView = null;
    }
    super.close(result);
  }
}
