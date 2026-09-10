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

type RepoTab = 'local' | 'remote';

const READONLY_CLASS = ' opacity-60 cursor-not-allowed';

export class PipelineEditDialog extends BaseDialog<void> {
  private props: PipelineEditDialogProps;
  private activeTab: RepoTab;

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
    // Lock the dialog to the pipeline's type: local (no repo_uri) or remote.
    this.activeTab = this.isRemote() ? 'remote' : 'local';
    // After props are set, we MUST re-render because the first render in super() had no props.
    this.reRender();
  }

  private isRemote(): boolean {
    return !!this.props?.pipeline?.repo_uri;
  }

  private reRender() {
    const bodyContainer = this.dialog.querySelector('#dialog-body-container') as HTMLElement;
    bodyContainer.innerHTML = this.renderBody();

    const footerContainer = this.dialog.querySelector('#dialog-footer-container') as HTMLElement;
    footerContainer.innerHTML = this.renderFooter();

    this.attachInternalEventListeners();
  }

  private tabClass(tab: RepoTab): string {
    const base = 'px-4 py-2 text-xs font-bold uppercase tracking-widest transition-all cursor-pointer border-b-2';
    return tab === this.activeTab
      ? `${base} border-app-accent-1 text-app-accent-1`
      : `${base} border-transparent text-app-muted hover:text-app-text`;
  }

  private renderLocalTab(readonly: boolean): string {
    const { pipeline } = this.props;
    const ro = readonly ? 'readonly' : '';
    const dis = readonly ? 'disabled' : '';
    const roClass = readonly ? READONLY_CLASS : '';
    return `
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-[10px] font-bold uppercase tracking-wider text-app-muted mb-1">Pipeline Name</label>
          <input type="text" name="pipeline_name" value="${pipeline.name}" ${ro} class="w-full bg-app-bg border border-app-border rounded px-3 py-1.5 text-sm text-app-text outline-none focus:ring-1 focus:ring-app-accent-1${roClass}">
        </div>
        <div>
          <label class="block text-[10px] font-bold uppercase tracking-wider text-app-muted mb-1">Status</label>
          <select name="pipeline_status" ${dis} class="w-full bg-app-bg border border-app-border rounded px-3 py-1.5 text-sm text-app-text outline-none focus:ring-1 focus:ring-app-accent-1 cursor-pointer${roClass}">
            <option value="active" ${pipeline.status === 'active' ? 'selected' : ''}>Active</option>
            <option value="paused" ${pipeline.status === 'paused' ? 'selected' : ''}>Paused</option>
            <option value="completed" ${pipeline.status === 'completed' ? 'selected' : ''}>Completed</option>
          </select>
        </div>
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-[10px] font-bold uppercase tracking-wider text-app-muted mb-1">Workspace Path (Optional)</label>
          <input type="text" name="workspace_path" value="${pipeline.workspace_path || ''}" placeholder="Default Project Root" readonly class="w-full bg-app-bg border border-app-border rounded px-3 py-1.5 text-sm text-app-text outline-none focus:ring-1 focus:ring-app-accent-1 opacity-60 cursor-not-allowed">
        </div>
        <div>
          <label class="block text-[10px] font-bold uppercase tracking-wider text-app-muted mb-1">Documentation Root</label>
          <input type="text" name="doc_root" value="${pipeline.doc_root}" placeholder="design" ${ro} class="w-full bg-app-bg border border-app-border rounded px-3 py-1.5 text-sm text-app-text outline-none focus:ring-1 focus:ring-app-accent-1${roClass}">
        </div>
      </div>
    `;
  }

  private renderRemoteTab(readonly: boolean): string {
    const { pipeline } = this.props;
    const ro = readonly ? 'readonly' : '';
    const roClass = readonly ? READONLY_CLASS : '';
    const tokenStored = !!pipeline.has_repo_token;
    const tokenPlaceholder = tokenStored ? '•••••••• (stored)' : 'personal access token';
    const tokenBadge = tokenStored
      ? '<span class="mt-1 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-app-accent-1/10 text-app-accent-1">Token stored</span>'
      : '';
    return `
      <div>
        <label class="block text-[10px] font-bold uppercase tracking-wider text-app-muted mb-1">Repo URI (Optional)</label>
        <input type="text" name="repo_uri" value="${pipeline.repo_uri || ''}" placeholder="https://host/org/my-app.git" ${ro} class="w-full bg-app-bg border border-app-border rounded px-3 py-1.5 text-sm text-app-text outline-none focus:ring-1 focus:ring-app-accent-1${roClass}">
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-[10px] font-bold uppercase tracking-wider text-app-muted mb-1">Repo Username (Optional)</label>
          <input type="text" name="repo_username" value="${pipeline.repo_username || ''}" placeholder="git user" ${ro} class="w-full bg-app-bg border border-app-border rounded px-3 py-1.5 text-sm text-app-text outline-none focus:ring-1 focus:ring-app-accent-1${roClass}">
        </div>
        <div>
          <label class="block text-[10px] font-bold uppercase tracking-wider text-app-muted mb-1">Repo Token (Optional)</label>
          <input type="password" name="repo_token" value="" placeholder="${tokenPlaceholder}" autocomplete="new-password" ${ro} class="w-full bg-app-bg border border-app-border rounded px-3 py-1.5 text-sm text-app-text outline-none focus:ring-1 focus:ring-app-accent-1${roClass}">
          ${tokenBadge}
        </div>
      </div>
      <p class="text-[10px] text-app-muted">The token is stored only on the server and is never displayed or sent back to the browser. Leave it empty to keep the existing token.</p>
    `;
  }

  protected renderBody(): string {
    if (!this.props) return '';
    const { pipelineId } = this.props;
    const remote = this.isRemote();
    // The tab matching the pipeline type is editable; the other is read-only.
    const localReadonly = remote;
    const remoteReadonly = !remote;
    return `
      <div class="flex flex-col gap-4 p-4">
        <div class="flex gap-1 border-b border-app-border">
          <button type="button" data-tab="local" class="${this.tabClass('local')}">Local Repository</button>
          <button type="button" data-tab="remote" class="${this.tabClass('remote')}">Remote Repository</button>
        </div>
        ${this.activeTab === 'local' ? this.renderLocalTab(localReadonly) : this.renderRemoteTab(remoteReadonly)}
        <div class="flex col-span-2">
          <div class="ml-auto text-[10px] font-bold uppercase tracking-widest text-app-muted">ID: ${pipelineId}</div>
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

    this.dialog.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab as RepoTab;
        if (tab && tab !== this.activeTab) {
          this.activeTab = tab;
          this.reRender();
        }
      });
    });
  }

  private async handleSave() {
    const { pipeline, pipelineId, context } = this.props;
    const saveBtn = this.dialog.querySelector('#pipeline-edit-save') as HTMLButtonElement;

    const nameInput = this.dialog.querySelector('input[name="pipeline_name"]') as HTMLInputElement;
    const statusSelect = this.dialog.querySelector('select[name="pipeline_status"]') as HTMLSelectElement;
    const workspaceInput = this.dialog.querySelector('input[name="workspace_path"]') as HTMLInputElement;
    const docRootInput = this.dialog.querySelector('input[name="doc_root"]') as HTMLInputElement;
    const repoUriInput = this.dialog.querySelector('input[name="repo_uri"]') as HTMLInputElement;
    const repoUsernameInput = this.dialog.querySelector('input[name="repo_username"]') as HTMLInputElement;
    const repoTokenInput = this.dialog.querySelector('input[name="repo_token"]') as HTMLInputElement;

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
      const remote = this.isRemote();
      const payload: {
        name?: string;
        status?: PipelineStatus;
        workspace_path?: string | null;
        repo_uri?: string | null;
        repo_username?: string | null;
        repo_token?: string;
        doc_root?: string;
      } = {};

      if (remote) {
        // Remote tab is editable; local config is read-only (keep current values).
        payload.repo_uri = repoUriInput?.value.trim() || undefined;
        payload.repo_username = repoUsernameInput?.value.trim() || undefined;
        const tokenValue = repoTokenInput?.value.trim();
        if (tokenValue) payload.repo_token = tokenValue;
        payload.name = pipeline.name;
        payload.status = pipeline.status;
        payload.workspace_path = pipeline.workspace_path || undefined;
        payload.doc_root = pipeline.doc_root;
      } else {
        // Local tab is editable; remote config is read-only (keep current values).
        payload.name = nameInput?.value.trim();
        payload.status = statusSelect?.value as PipelineStatus;
        payload.workspace_path = workspaceInput?.value.trim() || undefined;
        payload.doc_root = docRootInput?.value.trim() || 'design';
        payload.repo_uri = pipeline.repo_uri || undefined;
        payload.repo_username = pipeline.repo_username || undefined;
      }

      await context.pipelineClient.update(pipelineId, pipeline.version, payload);
      this.close();
    } catch (error) {
      console.error('Failed to update pipeline:', error);
      alert('Failed to update pipeline. Please check the console.');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Changes';
    }
  }
}
