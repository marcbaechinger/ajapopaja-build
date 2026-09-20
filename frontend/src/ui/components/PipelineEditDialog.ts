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

export type PipelineDialogMode = 'create' | 'edit';

export interface PipelineEditDialogProps {
  mode: PipelineDialogMode;
  context: AppContext;
  pipeline?: Pipeline; // required when mode === 'edit'
  pipelineId?: string; // required when mode === 'edit'
}

type RepoTab = 'local' | 'remote';

type CommandsTab = 'test' | 'lint' | 'serve';

const READONLY_CLASS = ' opacity-60 cursor-not-allowed';

/**
 * Converts a stored argv list (e.g. `["sh", "-c", "cd backend && pytest"]`)
 * back into a single editable command line for the dialog textarea. The common
 * `["sh", "-c", cmd]` wrapping produced by the dialog is unwrapped so the user
 * edits the raw shell command; anything else is space-joined for display.
 */
function argsToCommand(args: string[]): string {
  if (args && args.length === 3 && args[0] === 'sh' && args[1] === '-c' && args[2]) {
    return args[2];
  }
  return (args || []).join(' ');
}

/**
 * Parses the textarea content (one shell command per line) into the stored
 * argv-list format. Empty/blank lines are ignored. Returns `[]` when there are
 * no commands (meaning “use the global/test-command fallback”).
 */
function parseTestCommands(value: string): string[][] {
  const lines = (value || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return lines.map((line) => ['sh', '-c', line]);
}

export class PipelineEditDialog extends BaseDialog<void> {
  private props: PipelineEditDialogProps;
  private pipeline: Pipeline;
  private pipelineId?: string;
  private activeTab: RepoTab;
  private activeCmdTab: CommandsTab = 'test';

  constructor(props: PipelineEditDialogProps) {
    // We need to set props BEFORE super() if renderBody uses them,
    // but JS doesn't allow this.props before super().
    // However, BaseDialog calls renderBody in its constructor.
    // To fix this, we'll make props available by passing them through if possible,
    // or we'll have to change how BaseDialog works.
    // The best way is to make renderBody resilient or move the rendering out of the constructor.
    const create = props.mode === 'create';
    super({
      title: create ? 'Create Pipeline' : 'Edit Pipeline',
      maxWidth: 'max-w-lg',
      iconSvg: Icon.render('edit', { size: 20 })
    });
    this.props = props;
    // In create mode no pipeline exists yet, so render against a fresh one.
    this.pipeline = props.pipeline ?? new Pipeline({});
    this.pipelineId = props.pipelineId;
    // In create mode both tabs are editable and we default to the local tab;
    // in edit mode the dialog is locked to the pipeline's type.
    this.activeTab = create ? 'local' : this.isRemote() ? 'remote' : 'local';
    // After props are set, we MUST re-render because the first render in super() had no props.
    this.reRender();
  }

  private isEditMode(): boolean {
    return this.props?.mode === 'edit';
  }

  private isRemote(): boolean {
    return !!this.pipeline.repo_uri;
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

  private renderLocalTab(readonly: boolean, create: boolean): string {
    const pipeline = this.pipeline;
    const ro = readonly ? 'readonly' : '';
    const dis = readonly ? 'disabled' : '';
    const roClass = readonly ? READONLY_CLASS : '';
    // In create mode there is no status field yet (new pipelines default to active).
    const statusField = create
      ? ''
      : `
        <div>
          <label class="block text-[10px] font-bold uppercase tracking-wider text-app-muted mb-1">Status</label>
          <select name="pipeline_status" ${dis} class="w-full bg-app-bg border border-app-border rounded px-3 py-1.5 text-sm text-app-text outline-none focus:ring-1 focus:ring-app-accent-1 cursor-pointer${roClass}">
            <option value="active" ${pipeline.status === 'active' ? 'selected' : ''}>Active</option>
            <option value="paused" ${pipeline.status === 'paused' ? 'selected' : ''}>Paused</option>
            <option value="completed" ${pipeline.status === 'completed' ? 'selected' : ''}>Completed</option>
          </select>
        </div>`;
    return `
      <div class="${create ? '' : 'grid grid-cols-2 gap-4'}">
        <div class="${create ? 'mb-4' : ''}">
          <label class="block text-[10px] font-bold uppercase tracking-wider text-app-muted mb-1">Pipeline Name</label>
          <input type="text" name="pipeline_name" value="${pipeline.name}" ${ro} class="w-full bg-app-bg border border-app-border rounded px-3 py-1.5 text-sm text-app-text outline-none focus:ring-1 focus:ring-app-accent-1${roClass}">
        </div>
        ${statusField}
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-[10px] font-bold uppercase tracking-wider text-app-muted mb-1">Workspace Path (Optional)</label>
          <input type="text" name="workspace_path" value="${pipeline.workspace_path || ''}" placeholder="Default Project Root" ${create ? ro : 'readonly'} class="w-full bg-app-bg border border-app-border rounded px-3 py-1.5 text-sm text-app-text outline-none focus:ring-1 focus:ring-app-accent-1${create ? roClass : READONLY_CLASS}">
        </div>
        <div>
          <label class="block text-[10px] font-bold uppercase tracking-wider text-app-muted mb-1">Documentation Root</label>
          <input type="text" name="doc_root" value="${pipeline.doc_root}" placeholder="design" ${ro} class="w-full bg-app-bg border border-app-border rounded px-3 py-1.5 text-sm text-app-text outline-none focus:ring-1 focus:ring-app-accent-1${roClass}">
        </div>
      </div>
    `;
  }

  private renderRemoteTab(readonly: boolean, create: boolean): string {
    const pipeline = this.pipeline;
    const ro = readonly ? 'readonly' : '';
    const roClass = readonly ? READONLY_CLASS : '';
    const tokenStored = !!pipeline.has_repo_token;
    const tokenPlaceholder = tokenStored ? '•••••••• (stored)' : 'personal access token';
    const tokenBadge = tokenStored && !create
      ? '<span class="mt-1 inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-app-accent-1/10 text-app-accent-1">Token stored</span>'
      : '';
    const nameBlock = create ? `
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-[10px] font-bold uppercase tracking-wider text-app-muted mb-1">Pipeline Name</label>
          <input type="text" name="pipeline_name" value="${pipeline.name}" ${ro} class="w-full bg-app-bg border border-app-border rounded px-3 py-1.5 text-sm text-app-text outline-none focus:ring-1 focus:ring-app-accent-1${roClass}">
        </div>
        <div>
          <label class="block text-[10px] font-bold uppercase tracking-wider text-app-muted mb-1">Documentation Root</label>
          <input type="text" name="doc_root" value="${pipeline.doc_root}" placeholder="design" ${ro} class="w-full bg-app-bg border border-app-border rounded px-3 py-1.5 text-sm text-app-text outline-none focus:ring-1 focus:ring-app-accent-1${roClass}">
        </div>
      </div>
    ` : '';
    return `
      ${nameBlock}
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
      <p class="text-[10px] text-app-muted">The token is stored only on the server and is never displayed or sent back to the browser.${create ? '' : ' Leave it empty to keep the existing token.'}</p>
    `;
  }

  private cmdTabClass(tab: CommandsTab): string {
    const base = 'px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer border-b-2';
    return tab === this.activeCmdTab
      ? `${base} border-app-accent-1 text-app-accent-1`
      : `${base} border-transparent text-app-muted hover:text-app-text`;
  }

  private renderCommandTextarea(
    name: string,
    label: string,
    commands: string[][],
    placeholder: string,
    hint: string
  ): string {
    const existing = (commands || []).map(argsToCommand);
    const value = existing.length > 0 ? existing.join('\n') : '';
    return `
      <div>
        <label class="block text-[10px] font-bold uppercase tracking-wider text-app-muted mb-1">${label} (Optional)</label>
        <textarea name="${name}" rows="3" placeholder="${placeholder}" class="w-full bg-app-bg border border-app-border rounded px-3 py-1.5 text-sm text-app-text outline-none focus:ring-1 focus:ring-app-accent-1 font-mono">${value}</textarea>
        <p class="text-[10px] text-app-muted">${hint}</p>
      </div>
    `;
  }

  private renderTestCommands(): string {
    return this.renderCommandTextarea(
      'test_commands',
      'Test Commands',
      this.pipeline.test_commands || [],
      'One command per line, e.g.&#10;cd backend &amp;&amp; uv run pytest&#10;cd frontend &amp;&amp; CI=true npm run test',
      'Commands run to verify a change. One per line. Leave empty to use the global default commands.'
    );
  }

  private renderLintCommands(): string {
    return this.renderCommandTextarea(
      'lint_commands',
      'Lint Commands',
      this.pipeline.lint_commands || [],
      'One command per line, e.g.&#10;cd backend &amp;&amp; uv run ruff check&#10;cd frontend &amp;&amp; npm run lint',
      'Commands run to lint the project. One per line. Leave empty to skip linting.'
    );
  }

  private renderServeCommands(): string {
    return this.renderCommandTextarea(
      'serve_commands',
      'Serve Commands',
      this.pipeline.serve_commands || [],
      'One command per line, e.g.&#10;cd backend &amp;&amp; uv run uvicorn api.main:app --reload&#10;cd frontend &amp;&amp; npm run dev',
      'Commands launched as a long-running background dev server. One per line. Leave empty to disable the dev server. The port is available as $DEV_SERVER_PORT (also exported as $PORT).'
    );
  }

  private renderCommandsTabs(): string {
    const activeContent =
      this.activeCmdTab === 'test'
        ? this.renderTestCommands()
        : this.activeCmdTab === 'lint'
          ? this.renderLintCommands()
          : this.renderServeCommands();
    return `
      <div class="flex flex-col gap-3">
        <div class="flex gap-1 border-b border-app-border">
          <button type="button" data-cmd-tab="test" class="${this.cmdTabClass('test')}">Test</button>
          <button type="button" data-cmd-tab="lint" class="${this.cmdTabClass('lint')}">Lint</button>
          <button type="button" data-cmd-tab="serve" class="${this.cmdTabClass('serve')}">Serve</button>
        </div>
        ${activeContent}
      </div>
    `;
  }

  protected renderBody(): string {
    if (!this.props) return '';
    const create = !this.isEditMode();
    const remote = this.isRemote();
    // In create mode both tabs are editable; only the active tab (the user's
    // selection) determines which fields are sent. In edit mode only the tab
    // matching the pipeline's type is editable, the other is read-only.
    const localReadonly = create ? false : remote;
    const remoteReadonly = create ? false : !remote;
    return `
      <div class="flex flex-col gap-4 p-4">
        <div class="flex gap-1 border-b border-app-border">
          <button type="button" data-tab="local" class="${this.tabClass('local')}">Local Repository</button>
          <button type="button" data-tab="remote" class="${this.tabClass('remote')}">Remote Repository</button>
        </div>
        ${this.activeTab === 'local' ? this.renderLocalTab(localReadonly, create) : this.renderRemoteTab(remoteReadonly, create)}
        ${this.renderCommandsTabs()}
        <div id="pipeline-edit-error" class="hidden text-xs text-red-400 font-bold"></div>
        ${create ? '' : `
        <div class="flex col-span-2">
          <div class="ml-auto text-[10px] font-bold uppercase tracking-widest text-app-muted">ID: ${this.pipelineId}</div>
        </div>`}
      </div>
    `;
  }

  protected renderFooter(): string {
    const create = !this.isEditMode();
    return `
      <div class="flex gap-2 justify-end p-4 border-t border-app-border bg-app-surface/50 rounded-b-2xl">
        <button id="pipeline-edit-cancel" class="px-4 py-2 rounded text-xs font-bold uppercase tracking-widest text-app-muted hover:bg-app-bg transition-all cursor-pointer">Cancel</button>
        <button id="pipeline-edit-save" class="px-6 py-2 rounded bg-app-accent-1 text-white text-xs font-bold uppercase tracking-widest hover:brightness-110 transition-all shadow-md cursor-pointer">${create ? 'Create Pipeline' : 'Save Changes'}</button>
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

    this.dialog.querySelectorAll<HTMLButtonElement>('[data-cmd-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.cmdTab as CommandsTab;
        if (tab && tab !== this.activeCmdTab) {
          this.activeCmdTab = tab;
          this.reRender();
        }
      });
    });
  }

  private showError(message: string) {
    const errorEl = this.dialog.querySelector('#pipeline-edit-error') as HTMLElement;
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.classList.remove('hidden');
    }
  }

  private async handleSave() {
    const { context } = this.props;
    const create = !this.isEditMode();
    const saveBtn = this.dialog.querySelector('#pipeline-edit-save') as HTMLButtonElement;

    const nameInput = this.dialog.querySelector('input[name="pipeline_name"]') as HTMLInputElement;
    const statusSelect = this.dialog.querySelector('select[name="pipeline_status"]') as HTMLSelectElement;
    const workspaceInput = this.dialog.querySelector('input[name="workspace_path"]') as HTMLInputElement;
    const docRootInput = this.dialog.querySelector('input[name="doc_root"]') as HTMLInputElement;
    const repoUriInput = this.dialog.querySelector('input[name="repo_uri"]') as HTMLInputElement;
    const repoUsernameInput = this.dialog.querySelector('input[name="repo_username"]') as HTMLInputElement;
    const repoTokenInput = this.dialog.querySelector('input[name="repo_token"]') as HTMLInputElement;
    const testCommandsInput = this.dialog.querySelector('textarea[name="test_commands"]') as HTMLTextAreaElement;
    const lintCommandsInput = this.dialog.querySelector('textarea[name="lint_commands"]') as HTMLTextAreaElement;
    const serveCommandsInput = this.dialog.querySelector('textarea[name="serve_commands"]') as HTMLTextAreaElement;

    // When saving from the other command tab the hidden textarea is not
    // rendered, so fall back to the stored pipeline value to avoid silently
    // dropping the commands the user configured earlier.
    const testText =
      testCommandsInput?.value ??
      (this.pipeline.test_commands || []).map(argsToCommand).join('\n');
    const lintText =
      lintCommandsInput?.value ??
      (this.pipeline.lint_commands || []).map(argsToCommand).join('\n');
    const serveText =
      serveCommandsInput?.value ??
      (this.pipeline.serve_commands || []).map(argsToCommand).join('\n');

    const testCommands = parseTestCommands(testText);
    const lintCommands = parseTestCommands(lintText);
    const serveCommands = parseTestCommands(serveText);

    const btnLabel = create ? 'Create Pipeline' : 'Save Changes';
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
      if (create) {
        const payload: {
          name: string;
          workspace_path?: string | null;
          repo_uri?: string | null;
          repo_username?: string | null;
          repo_token?: string;
          doc_root?: string;
          test_commands?: string[][] | null;
          lint_commands?: string[][] | null;
          serve_commands?: string[][] | null;
        } = {
          name: nameInput?.value.trim() || '',
          doc_root: docRootInput?.value.trim() || 'design',
          test_commands: testCommands.length > 0 ? testCommands : null,
          lint_commands: lintCommands.length > 0 ? lintCommands : null,
          serve_commands: serveCommands.length > 0 ? serveCommands : null,
        };

        if (this.activeTab === 'remote') {
          // Remote tab -> send repo credentials, never a workspace_path.
          payload.repo_uri = repoUriInput?.value.trim() || undefined;
          payload.repo_username = repoUsernameInput?.value.trim() || undefined;
          const tokenValue = repoTokenInput?.value.trim();
          if (tokenValue) payload.repo_token = tokenValue;
        } else {
          // Local tab -> send only the local workspace path, no repo fields.
          payload.workspace_path = workspaceInput?.value.trim() || undefined;
        }

        if (!payload.name) {
          this.showError('Pipeline name is required.');
          saveBtn.disabled = false;
          saveBtn.textContent = btnLabel;
          return;
        }

        await context.pipelineClient.create(payload);
      } else {
        const pipeline = this.pipeline;
        const pipelineId = this.pipelineId;
        const remote = this.isRemote();
        const payload: {
          name?: string;
          status?: PipelineStatus;
          workspace_path?: string | null;
          repo_uri?: string | null;
          repo_username?: string | null;
          repo_token?: string;
          doc_root?: string;
          test_commands?: string[][] | null;
          lint_commands?: string[][] | null;
          serve_commands?: string[][] | null;
        } = {
          test_commands: testCommands,
          lint_commands: lintCommands,
          serve_commands: serveCommands,
        };

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

        await context.pipelineClient.update(pipelineId as string, pipeline.version, payload);
      }
      this.close();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(create ? 'Failed to create pipeline:' : 'Failed to update pipeline:', error);
      // Surface backend validation / error messages inline (directing the user
      // to correct their input) instead of a generic alert.
      this.showError(message);
      saveBtn.disabled = false;
      saveBtn.textContent = btnLabel;
    }
  }
}
