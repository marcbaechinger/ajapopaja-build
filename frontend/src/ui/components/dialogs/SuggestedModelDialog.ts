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
import type { AppContext } from '../../../core/AppContext.ts';

/**
 * Popup that lets the user pin (or clear) the CoderBot model for a single task.
 *
 * Reuses the same pi-agent model catalog as {@link PipelineEditDialog}: the
 * ``coderbot`` ids from the pipeline's ``model-options`` endpoint. Selecting
 * "Use default (unset)" resolves to an empty string (cleared), while a concrete
 * model id resolves to that id. A cancelled dialog resolves to ``null``.
 */
export class SuggestedModelDialog extends BaseDialog<string> {
  private readonly context: AppContext;
  private readonly pipelineId: string;
  private readonly current: string | null;
  private models: string[] = [];
  private loaded = false;

  constructor(context: AppContext, pipelineId: string, current: string | null) {
    super({
      title: 'Task Model',
      maxWidth: 'max-w-md',
      iconSvg: Icon.render('edit', { size: 20 })
    });
    this.context = context;
    this.pipelineId = pipelineId;
    this.current = current || null;
    this.updateContent();
    void this.loadModels();
  }

  /** Re-renders the select and wires the footer buttons. */
  private updateContent() {
    const bodyContainer = this.dialog.querySelector('#dialog-body-container') as HTMLElement;
    bodyContainer.innerHTML = this.renderBody();

    const footerContainer = this.dialog.querySelector('#dialog-footer-container') as HTMLElement;
    footerContainer.innerHTML = this.renderFooter();

    this.dialog.querySelector('#suggested-model-cancel')?.addEventListener('click', () => this.close(null));
    this.dialog.querySelector('#suggested-model-save')?.addEventListener('click', () => {
      const select = this.dialog.querySelector('#suggested-model-select') as HTMLSelectElement | null;
      // '' means "use default / unset"; any other value is the selected model.
      this.close(select ? select.value : '');
    });
  }

  /** Replaces only the select options after the catalog loads. */
  private reRenderSelect() {
    const select = this.dialog.querySelector('#suggested-model-select') as HTMLSelectElement | null;
    if (!select) return;
    select.innerHTML = this.renderOptions();
  }

  private renderOptions(): string {
    const current = this.current || '';
    // BaseDialog calls renderBody() from within super(), i.e. before this
    // subclass's field initializers run, so `this.models` is still undefined on
    // the very first render. Treat it as an empty catalog instead of crashing.
    const values = [...(this.models ?? [])];
    if (current && !values.includes(current)) {
      values.unshift(current);
    }
    const modelOptions = values
      .map((value) => {
        const selected = value === current ? ' selected' : '';
        return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(value)}</option>`;
      })
      .join('');
    return `
      <option value=""${current ? '' : ' selected'}>Use default (unset)</option>
      ${modelOptions}
    `;
  }

  /** Fetches the available CoderBot models; failures degrade to an empty list. */
  private async loadModels(): Promise<void> {
    try {
      const options = await this.context.pipelineClient.getModelOptions(this.pipelineId);
      if (Array.isArray(options?.coderbot)) {
        this.models = options.coderbot;
      }
    } catch (error) {
      console.error('Failed to load CoderBot models:', error);
    } finally {
      this.loaded = true;
      this.reRenderSelect();
    }
  }

  protected renderBody(): string {
    const loadingHint = this.loaded
      ? ''
      : '<span class="text-[10px] text-app-muted">Loading models…</span>';
    return `
      <div class="p-4 flex flex-col gap-3">
        <p class="text-sm text-app-text/80">
          Pin the CoderBot model used when this task is executed. The chosen model
          overrides the pipeline and server defaults for this task only.
        </p>
        <label for="suggested-model-select" class="text-[10px] font-bold uppercase tracking-wider text-app-muted">
          CoderBot Model
        </label>
        <select id="suggested-model-select"
                class="w-full bg-app-bg border border-app-border rounded px-3 py-2 text-sm text-app-text outline-none focus:ring-1 focus:ring-app-accent-2 cursor-pointer">
          ${this.renderOptions()}
        </select>
        ${loadingHint}
      </div>
    `;
  }

  protected renderFooter(): string {
    return `
      <div class="p-4 pt-0 flex justify-between items-center gap-3">
        <button id="suggested-model-cancel" class="px-4 py-2 text-app-muted hover:text-app-text transition-colors cursor-pointer font-medium">
          Cancel
        </button>
        <button id="suggested-model-save" class="flex items-center gap-2 px-4 py-2 bg-app-accent-1 hover:brightness-110 text-app-accent-fg rounded-lg transition-all font-bold shadow-lg cursor-pointer">
          ${Icon.render('check', { size: 16 })}
          Save
        </button>
      </div>
    `;
  }
}
