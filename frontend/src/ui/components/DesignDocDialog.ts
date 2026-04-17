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
import { marked } from 'marked';
import DOMPurify from 'dompurify';

export class DesignDocDialog extends BaseDialog<void> {
  private content: string;

  constructor(title: string, content: string) {
    // Set content BEFORE super call if possible? No, 'this' is not available.
    // So we must handle it in renderBody.
    super({ 
      title, 
      maxWidth: 'max-w-3xl',
      maxHeight: 'max-h-[90vh]'
    });
    this.content = content;
    
    // Re-render body now that content is set
    const bodyContainer = this.dialog.querySelector('#dialog-body-container') as HTMLElement;
    if (bodyContainer) {
      bodyContainer.innerHTML = this.renderBody();
    }
  }

  protected renderBody(): string {
    // Handle the case where renderBody is called by the base constructor before content is assigned
    if (!this.content) {
      return '<div class="p-8"><p class="text-app-muted italic">Loading content...</p></div>';
    }

    const html = DOMPurify.sanitize(marked.parse(this.content) as string);
    return `
      <div class="p-8">
        <article class="prose prose-invert prose-base max-w-none prose-headings:text-app-accent-2 prose-a:text-app-accent-1">
          ${html}
        </article>
      </div>
    `;
  }

  protected renderFooter(): string {
    return `
      <div class="p-4 border-t border-app-border flex justify-end bg-app-surface/30">
        <button id="dialog-close-action" class="px-6 py-2 bg-app-surface border border-app-border hover:border-app-accent-1 text-app-text rounded-xl transition-all font-bold cursor-pointer">
          Close
        </button>
      </div>
    `;
  }

  public async show(): Promise<void> {
    const showPromise = super.show();
    this.dialog.querySelector('#dialog-close-action')?.addEventListener('click', () => this.close());
    await showPromise;
  }
}
