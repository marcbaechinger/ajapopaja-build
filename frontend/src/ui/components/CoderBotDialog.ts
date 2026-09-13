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
import { CoderBotService } from '../../core/CoderBotService.ts';
import { PiView } from './PiView.ts';
import { Icon } from './Icon.ts';

export class CoderBotDialog extends BaseDialog {
  private coderBotService: CoderBotService;
  private piView: PiView | null = null;

  constructor(coderBotService: CoderBotService) {
    super({
      title: 'CoderBot Activity Log',
      maxWidth: 'max-w-4xl',
      maxHeight: 'max-h-[85vh]',
      iconSvg: Icon.render('documentation', { size: 20 })
    });
    this.coderBotService = coderBotService;

    // Render the body container, which is the mount point for the PiView.
    const bodyContainer = this.dialog.querySelector('#dialog-body-container') as HTMLElement;
    bodyContainer.innerHTML = this.renderBody() as string;

    const footerContainer = this.dialog.querySelector('#dialog-footer-container') as HTMLElement;
    footerContainer.innerHTML = this.renderFooter() as string;

    // Register dialog-only actions (the Pi actions live in PiView).
    footerContainer.querySelector('#dialog-footer-close-btn')?.addEventListener('click', () => {
      this.close();
    });

    // Compose the reusable Pi activity-log view into the body container.
    const mount = bodyContainer.querySelector('#coderbot-piview-mount') as HTMLElement;
    if (mount) {
      this.piView = new PiView(this.coderBotService, mount);
      this.piView.render();
    }
  }

  protected renderBody(): string {
    return `
      <div id="coderbot-piview-mount" class="flex flex-col h-full"></div>
    `;
  }

  protected renderFooter(): string {
    return `
      <div class="p-3 border-t border-app-border flex justify-end items-center bg-app-surface/50">
        <button id="dialog-footer-close-btn" class="px-4 py-1.5 rounded text-xs font-bold bg-app-bg border border-app-border text-app-text hover:bg-app-surface transition-colors cursor-pointer">
          Close
        </button>
      </div>
    `;
  }

  protected close(result: any = null) {
    if (this.piView) {
      this.piView.destroy();
      this.piView = null;
    }
    super.close(result);
  }
}
