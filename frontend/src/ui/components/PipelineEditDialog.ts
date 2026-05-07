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
import { Pipeline, PipelineStatus } from '../../core/domain.ts';
import type { AppContext } from '../../core/AppContext.ts';
import { Icon } from './Icon.ts';

export interface PipelineEditDialogProps {
  pipeline: Pipeline;
  pipelineId: string;
  context: AppContext;
}

export class PipelineEditDialog extends BaseDialog<void> {
  private props: PipelineEditDialogProps;

  constructor(props: PipelineEditDialogProps) {
    // We need to set props BEFORE super() if renderBody uses them,
    // but JS doesn't allow this.props before super().
    // However, BaseDialog calls renderBody in its constructor.
    // To fix this, we'll make props available by passing them through if possible, 
    // or we'll have to change how BaseDialog works.
    // Alternatively, we can use a temporary global or a static property, but that's ugly.
    // The best way is to make renderBody resilient or move the rendering out of the constructor.
    super({
      title: 'Edit Pipeline',
      maxWidth: 'max-w-lg',
      iconSvg: Icon.render('edit', { size: 20 })
    });
    this.props = props;
    // After props are set, we MUST re-render because the first render in super() had no props.
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
    if (!this.props) return '';
    const { pipeline, pipelineId } = this.props;
    return `
      <div class="flex flex-col gap-4 p-4">
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="block text-[10px] font-bold uppercase tracking-wider text-app-muted mb-1">Pipeline Name</label>
            <input type="text" name="pipeline_name" value="${pipeline.name}" class="w-full bg-app-bg border border-app-border rounded px-3 py-1.5 text-sm text-app-text outline-none focus:ring-1 focus:ring-app-accent-1">
          </div>
          <div>
            <label class="block text-[10px] font-bold uppercase tracking-wider text-app-muted mb-1">Status</label>
            <select name="pipeline_status" class="w-full bg-app-bg border border-app-border rounded px-3 py-1.5 text-sm text-app-text outline-none focus:ring-1 focus:ring-app-accent-1 cursor-pointer">
              <option value="active" ${pipeline.status === 'active' ? 'selected' : ''}>Active</option>
              <option value="paused" ${pipeline.status === 'paused' ? 'selected' : ''}>Paused</option>
              <option value="completed" ${pipeline.status === 'completed' ? 'selected' : ''}>Completed</option>
            </select>
          </div>
        </div>
        <div>
          <label class="block text-[10px] font-bold uppercase tracking-wider text-app-muted mb-1">Workspace Path (Optional)</label>
          <input type="text" name="workspace_path" value="${pipeline.workspace_path || ''}" placeholder="Default Project Root" class="w-full bg-app-bg border border-app-border rounded px-3 py-1.5 text-sm text-app-text outline-none focus:ring-1 focus:ring-app-accent-1">
        </div><div class="flex col-span-2"><div class="ml-auto text-[10px] font-bold uppercase tracking-widest text-app-muted">ID: ${pipelineId}</div>
        </div>
      </div>
    `;
  }

  protected renderFooter(): string {
    return `
      <div class="flex gap-2 justify-end p-4 border-t border-app-border bg-app-surface/50 rounded-b-2xl">
        <button id="pipeline-edit-cancel" class="px-4 py-2 rounded text-xs font-bold uppercase tracking-widest text-app-muted hover:bg-app-bg transition-all cursor-pointer">Cancel</button>
        <button id="pipeline-edit-save" class="px-6 py-2 rounded bg-app-accent-1 text-white text-xs font-bold uppercase tracking-widest hover:brightness-110 transition-all shadow-md cursor-pointer">Save Changes</button>
      </div>
    `;
  }

  private attachInternalEventListeners() {
    this.dialog.querySelector('#pipeline-edit-cancel')?.addEventListener('click', () => this.close());
    this.dialog.querySelector('#pipeline-edit-save')?.addEventListener('click', () => this.handleSave());
  }

  private async handleSave() {
    const { pipeline, pipelineId, context } = this.props;
    const saveBtn = this.dialog.querySelector('#pipeline-edit-save') as HTMLButtonElement;

    const nameInput = this.dialog.querySelector('input[name="pipeline_name"]') as HTMLInputElement;
    const statusSelect = this.dialog.querySelector('select[name="pipeline_status"]') as HTMLSelectElement;
    const workspaceInput = this.dialog.querySelector('input[name="workspace_path"]') as HTMLInputElement;

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
      await context.pipelineClient.update(pipelineId, pipeline.version, {
        name: nameInput.value.trim(),
        status: statusSelect.value as PipelineStatus,
        workspace_path: workspaceInput.value.trim() || undefined,
      });
      this.close();
    } catch (error) {
      console.error('Failed to update pipeline:', error);
      alert('Failed to update pipeline. Please check the console.');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Changes';
    }
  }
}
