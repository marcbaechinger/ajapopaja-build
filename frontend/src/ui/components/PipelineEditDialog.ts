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
import { escapeHtml } from './utils/html.ts';

export type PipelineDialogMode = 'create' | 'edit';

export interface PipelineEditDialogProps {
  mode: PipelineDialogMode;
  context: AppContext;
  pipeline?: Pipeline; // required when mode === 'edit'
  pipelineId?: string; // required when mode === 'edit'
}

type RepoTab = 'local' | 'remote';

type CommandsTab = 'build' | 'lint' | 'test' | 'serve' | 'models';

/** A per-use-case model override rendered in the Models section. */
type ModelField =
  | 'ollama_model'
  | 'one_prompt_model'
  | 'assistant_model'
  | 'archbot_model'
  | 'reviewbot_model'
  | 'docbot_model'
  | 'coderbot_model';

interface ModelFieldSpec {
  field: ModelField;
  label: string;
  hint: string;
  /** Which catalog supplies the options. */
  source: 'ollama' | 'coderbot';
}

const MODEL_FIELDS: ModelFieldSpec[] = [
  {
    field: 'ollama_model',
    label: 'General Ollama Model',
    hint: 'Fallback for every Ollama use case below.',
    source: 'ollama',
  },
  {
    field: 'one_prompt_model',
    label: 'One-Shot Prompt Model',
    hint: 'Used by the one-shot AI prompt framework.',
    source: 'ollama',
  },
  {
    field: 'assistant_model',
    label: 'Assistant Model',
    hint: 'Used by the AI assistant chat.',
    source: 'ollama',
  },
  {
    field: 'archbot_model',
    label: 'ArchBot Model',
    hint: 'Used to draft design documents.',
    source: 'ollama',
  },
  {
    field: 'reviewbot_model',
    label: 'ReviewBot Model',
    hint: 'Used to review implemented tasks.',
    source: 'ollama',
  },
  {
    field: 'docbot_model',
    label: 'DocBot Model',
    hint: 'Used to create documentation.',
    source: 'ollama',
  },
  {
    field: 'coderbot_model',
    label: 'CoderBot Model',
    hint: 'Pi-agent model id configured in models.json.',
    source: 'coderbot',
  },
];

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

  // Dev-server control state (edit mode only). Tracks whether the pipeline's
  // long-running dev process is running so the button can start or stop it.
  private devServerRunning = false;
  private devServerPort: number | null = null;
  private devServerLoading = false;
  private devServerError: string | null = null;

  // Model catalog state. The options are fetched asynchronously after render
  // so the dialog opens instantly even when Ollama is slow/unavailable.
  private modelOptions: { ollama: string[]; coderbot: string[] } = {
    ollama: [],
    coderbot: [],
  };
  private modelOptionsLoaded = false;

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
    // Show the current dev-server state without blocking the dialog render.
    void this.loadDevServerStatus();
    // Populate the model selects asynchronously (same rationale).
    void this.loadModelOptions();
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

  /**
   * Replaces only the repository tab area (tab bar + active form). Called when
   * the repository tab changes so the command textareas keep their content.
   */
  private reRenderRepoTabArea() {
    const area = this.dialog.querySelector('#repo-tab-area');
    if (!area) return;
    area.innerHTML = this.renderRepoTabArea();
    this.attachRepoTabListeners();
  }

  /**
   * Replaces only the commands tab area (tab bar + active textarea). Called
   * when a command tab changes so the repository form keeps its content.
   */
  private reRenderCommandsTabArea() {
    const area = this.dialog.querySelector('#commands-tab-area');
    if (!area) return;
    area.innerHTML = this.renderCommandsTabArea();
    this.attachCommandsTabListeners();
  }

  /**
   * Replaces only the dev-server control so status refreshes do not wipe the
   * fields the user is editing.
   */
  private reRenderDevServerControl() {
    const area = this.dialog.querySelector('#dev-server-area');
    if (!area) return;
    area.innerHTML = this.renderDevServerControl();
    this.attachDevServerListeners();
  }

  /**
   * Copies the values currently rendered in the repository form back onto the
   * in-memory pipeline. This keeps shared fields (e.g. the pipeline name) and
   * the active tab's fields intact when switching between repository tabs.
   */
  private captureRepoInputs() {
    const read = (name: string): string | null => {
      const el = this.dialog.querySelector(`[name="${name}"]`) as HTMLInputElement | HTMLSelectElement | null;
      return el ? el.value : null;
    };

    const name = read('pipeline_name');
    if (name !== null) this.pipeline.name = name;
    const status = read('pipeline_status');
    if (status !== null) this.pipeline.status = status as PipelineStatus;
    const workspace = read('workspace_path');
    if (workspace !== null) this.pipeline.workspace_path = workspace;
    const docRoot = read('doc_root');
    if (docRoot !== null) this.pipeline.doc_root = docRoot;
    const repoUri = read('repo_uri');
    if (repoUri !== null) this.pipeline.repo_uri = repoUri;
    const repoUsername = read('repo_username');
    if (repoUsername !== null) this.pipeline.repo_username = repoUsername;
  }

  /**
   * Copies the values currently rendered in the active command tab back onto the
   * in-memory pipeline so switching between command tabs does not discard the
   * commands the user has typed.
   */
  private captureCommandInputs() {
    const fields: Array<'test_commands' | 'lint_commands' | 'build_commands' | 'serve_commands'> = [
      'test_commands',
      'lint_commands',
      'build_commands',
      'serve_commands',
    ];
    for (const field of fields) {
      const el = this.dialog.querySelector(`textarea[name="${field}"]`) as HTMLTextAreaElement | null;
      if (el) {
        this.pipeline[field] = parseTestCommands(el.value);
      }
    }
  }

  /**
   * Copies the current model select values back onto the in-memory pipeline.
   * An empty selection means "use the global default" and is stored as `null`.
   */
  private captureModelInputs() {
    for (const spec of MODEL_FIELDS) {
      const el = this.dialog.querySelector(`select[name="${spec.field}"]`) as HTMLSelectElement | null;
      if (el) {
        this.pipeline[spec.field] = el.value ? el.value : null;
      }
    }
  }

  /**
   * Builds the model override part of a create/update payload. Empty selects are
   * sent as `null` so the backend clears the override.
   */
  private modelPayload(): Record<ModelField, string | null> {
    return {
      ollama_model: this.pipeline.ollama_model ?? null,
      one_prompt_model: this.pipeline.one_prompt_model ?? null,
      assistant_model: this.pipeline.assistant_model ?? null,
      archbot_model: this.pipeline.archbot_model ?? null,
      reviewbot_model: this.pipeline.reviewbot_model ?? null,
      docbot_model: this.pipeline.docbot_model ?? null,
      coderbot_model: this.pipeline.coderbot_model ?? null,
    };
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

  private renderBuildCommands(): string {
    return this.renderCommandTextarea(
      'build_commands',
      'Build Commands',
      this.pipeline.build_commands || [],
      'One command per line, e.g.&#10;cd frontend &amp;&amp; npm run build&#10;cd backend &amp;&amp; uv build',
      'Commands run to build the project. One per line. Leave empty to skip building.'
    );
  }

  /** Returns the markup for the currently selected command tab. */
  private renderActiveCommandTab(): string {
    switch (this.activeCmdTab) {
      case 'build':
        return this.renderBuildCommands();
      case 'lint':
        return this.renderLintCommands();
      case 'test':
        return this.renderTestCommands();
      case 'serve':
        return this.renderServeCommands();
      case 'models':
        // The wrapper keeps a stable hook for the async model-options refresh.
        return `<div id="models-area" class="flex flex-col gap-3">${this.renderModelsArea()}</div>`;
    }
  }

  private renderCommandsTabArea(): string {
    return `
      <div class="flex gap-1 border-b border-app-border">
        <button type="button" data-cmd-tab="build" class="${this.cmdTabClass('build')}">Build</button>
        <button type="button" data-cmd-tab="lint" class="${this.cmdTabClass('lint')}">Lint</button>
        <button type="button" data-cmd-tab="test" class="${this.cmdTabClass('test')}">Test</button>
        <button type="button" data-cmd-tab="serve" class="${this.cmdTabClass('serve')}">Serve</button>
        <button type="button" data-cmd-tab="models" class="${this.cmdTabClass('models')}">Models</button>
      </div>
      <div id="commands-tab-content">
        ${this.renderActiveCommandTab()}
      </div>
    `;
  }

  /**
   * Renders the repository tab bar and the active tab's form fields. This is
   * the only markup replaced when the repository tab changes, so the command
   * textareas (and their unsaved input) stay untouched.
   */
  private renderRepoTabArea(): string {
    const create = !this.isEditMode();
    const remote = this.isRemote();
    // In create mode both tabs are editable; only the active tab (the user's
    // selection) determines which fields are sent. In edit mode only the tab
    // matching the pipeline's type is editable, the other is read-only.
    const localReadonly = create ? false : remote;
    const remoteReadonly = create ? false : !remote;
    return `
      <div class="flex gap-1 border-b border-app-border">
        <button type="button" data-tab="local" class="${this.tabClass('local')}">Local Repository</button>
        <button type="button" data-tab="remote" class="${this.tabClass('remote')}">Remote Repository</button>
      </div>
      <div id="repo-tab-content" class="flex flex-col gap-4">
        ${this.activeTab === 'local' ? this.renderLocalTab(localReadonly, create) : this.renderRemoteTab(remoteReadonly, create)}
      </div>
    `;
  }

  /**
   * Renders a single model override select. A leading "Use global default"
   * option (value "") clears the override. A stored value that is not present
   * in the catalog is still rendered so an existing override is never silently
   * dropped.
   */
  private renderModelSelect(spec: ModelFieldSpec): string {
    const current = (this.pipeline[spec.field] as string | null | undefined) || '';
    const options = spec.source === 'coderbot' ? this.modelOptions.coderbot : this.modelOptions.ollama;
    const values = [...options];
    if (current && !values.includes(current)) {
      values.unshift(current);
    }
    const optionHtml = values
      .map((value) => {
        const selected = value === current ? ' selected' : '';
        return `<option value="${escapeHtml(value)}"${selected}>${escapeHtml(value)}</option>`;
      })
      .join('');
    const globalSelected = current ? '' : ' selected';
    return `
      <div>
        <label class="block text-[10px] font-bold uppercase tracking-wider text-app-muted mb-1">${escapeHtml(spec.label)}</label>
        <select name="${spec.field}" class="w-full bg-app-bg border border-app-border rounded px-3 py-1.5 text-sm text-app-text outline-none focus:ring-1 focus:ring-app-accent-1 cursor-pointer">
          <option value=""${globalSelected}>Use global default</option>
          ${optionHtml}
        </select>
        <p class="text-[10px] text-app-muted">${escapeHtml(spec.hint)}</p>
      </div>
    `;
  }

  /** Renders the Models tab content with one select per use case. */
  private renderModelsArea(): string {
    return `
      ${this.modelOptions.ollama.length === 0 && !this.modelOptionsLoaded
        ? '<span class="text-[10px] text-app-muted">Loading…</span>'
        : ''}
      <div class="grid grid-cols-1 gap-3">
        ${MODEL_FIELDS.map((spec) => this.renderModelSelect(spec)).join('')}
      </div>
      <p class="text-[10px] text-app-muted">Leave a select on “Use global default” to fall back to the server configuration for that use case.</p>
    `;
  }

  /** Replaces only the Models section so an options refresh keeps other fields. */
  private reRenderModelsArea() {
    const area = this.dialog.querySelector('#models-area');
    if (!area) return;
    area.innerHTML = this.renderModelsArea();
  }

  /**
   * Fetches the available Ollama tags and CoderBot models. Failures are silent:
   * the selects simply keep only the "Use global default" option.
   */
  private async loadModelOptions(): Promise<void> {
    const pipelineId = this.pipelineId;
    if (!pipelineId) {
      // Create mode has no pipeline id yet; keep the global-default options.
      this.modelOptionsLoaded = true;
      this.reRenderModelsArea();
      return;
    }
    try {
      const options = await this.props.context.pipelineClient.getModelOptions(pipelineId);
      // Preserve any selection the user already made before re-rendering.
      this.captureModelInputs();
      this.modelOptions = {
        ollama: Array.isArray(options?.ollama) ? options.ollama : [],
        coderbot: Array.isArray(options?.coderbot) ? options.coderbot : [],
      };
    } catch (error) {
      console.error('Failed to load model options:', error);
    } finally {
      this.modelOptionsLoaded = true;
      this.reRenderModelsArea();
    }
  }

  /** True when the pipeline has serve commands persisted on the server. */
  private hasServeCommands(): boolean {
    return Array.isArray(this.pipeline.serve_commands) && this.pipeline.serve_commands.length > 0;
  }

  /**
   * Renders the dev-server start/stop control. Only shown in edit mode for
   * pipelines that already have serve commands stored, because the backend
   * ``dev/start`` endpoint reads those stored commands.
   */
  private renderDevServerControl(): string {
    if (!this.isEditMode() || !this.hasServeCommands()) return '';

    const running = this.devServerRunning;
    const busy = this.devServerLoading;
    const statusText = this.devServerError
      ? this.devServerError
      : running
        ? `Running${this.devServerPort != null ? ` on port ${this.devServerPort}` : ''}`
        : 'Stopped';
    const statusClass = this.devServerError
      ? 'text-red-400'
      : running
        ? 'text-green-500'
        : 'text-app-muted';
    const buttonClass = running
      ? 'bg-red-500/80 hover:bg-red-500'
      : 'bg-app-accent-1 hover:brightness-110';
    const disabledClass = busy ? ' opacity-60 cursor-not-allowed' : '';
    const label = busy
      ? running
        ? 'Stopping...'
        : 'Starting...'
      : running
        ? 'Stop Dev Server'
        : 'Start Dev Server';

    return `
      <div id="dev-server-control" class="flex items-center justify-between gap-3 p-3 rounded border border-app-border bg-app-bg">
        <div class="flex flex-col gap-0.5 min-w-0">
          <span class="text-[10px] font-bold uppercase tracking-wider text-app-muted">Dev Server</span>
          <span id="dev-server-status" class="text-xs font-medium ${statusClass} truncate">${statusText}</span>
        </div>
        <button type="button" id="pipeline-dev-toggle" ${busy ? 'disabled' : ''} class="shrink-0 px-3 py-1.5 rounded text-white text-[10px] font-bold uppercase tracking-widest transition-all shadow-md cursor-pointer ${buttonClass}${disabledClass}">
          ${label}
        </button>
      </div>
    `;
  }

  protected renderBody(): string {
    if (!this.props) return '';
    const create = !this.isEditMode();
    const devServerControl = this.renderDevServerControl();
    return `
      <div class="flex flex-col gap-4 p-4">
        <div id="repo-tab-area" class="flex flex-col gap-4">
          ${this.renderRepoTabArea()}
        </div>
        <div id="commands-tab-area" class="flex flex-col gap-3">
          ${this.renderCommandsTabArea()}
        </div>
        ${devServerControl ? `<div id="dev-server-area">${devServerControl}</div>` : ''}
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

    this.attachRepoTabListeners();
    this.attachCommandsTabListeners();
    this.attachDevServerListeners();
  }

  private attachRepoTabListeners() {
    this.dialog.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab as RepoTab;
        if (tab && tab !== this.activeTab) {
          this.captureRepoInputs();
          this.activeTab = tab;
          this.reRenderRepoTabArea();
        }
      });
    });
  }

  private attachCommandsTabListeners() {
    this.dialog.querySelectorAll<HTMLButtonElement>('[data-cmd-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.cmdTab as CommandsTab;
        if (tab && tab !== this.activeCmdTab) {
          // Capture both the command textareas and the model selects so a tab
          // switch never discards the values the user has edited.
          this.captureCommandInputs();
          this.captureModelInputs();
          this.activeCmdTab = tab;
          this.reRenderCommandsTabArea();
        }
      });
    });
  }

  private attachDevServerListeners() {
    this.dialog.querySelector('#pipeline-dev-toggle')?.addEventListener('click', () => {
      void this.toggleDevServer();
    });
  }

  /**
   * Issues a dev-server request (status/start/stop).
   *
   * Prefers a dedicated method on the context's clients so callers stay
   * authenticated through the shared :class:`BaseClient`. A few common method
   * names are accepted to remain tolerant of naming differences, and a direct
   * REST call is used as a last resort.
   */
  private async requestDevServer(
    action: 'status' | 'start' | 'stop',
    pipelineId: string
  ): Promise<any> {
    const context = this.props.context as any;
    const candidates = [context?.devServerClient, context?.pipelineClient].filter(Boolean);
    const methodNames: Record<string, string[]> = {
      status: ['getDevServerStatus', 'getDevStatus', 'getStatus', 'status'],
      start: ['startDevServer', 'startDev', 'start'],
      stop: ['stopDevServer', 'stopDev', 'stop'],
    };
    for (const candidate of candidates) {
      for (const name of methodNames[action]) {
        if (typeof candidate?.[name] === 'function') {
          return await candidate[name](pipelineId);
        }
      }
    }

    const token = context?.authService?.getAccessToken?.();
    const response = await fetch(`/api/pipelines/${pipelineId}/dev/${action}`, {
      method: action === 'status' ? 'GET' : 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(error.detail || `HTTP error! status: ${response.status}`);
    }
    return await response.json();
  }

  private isRunning(status: any): boolean {
    if (!status) return false;
    if (status.running === true) return true;
    return status.status === 'running' || status.status === 'started';
  }

  /**
   * Fetches the dev-server status for the pipeline and updates the control.
   * Failures are silent (the control simply stays "Stopped") because status is
   * only informational; the start/stop action reports its own errors.
   */
  private async loadDevServerStatus(): Promise<void> {
    if (!this.isEditMode() || !this.hasServeCommands()) return;
    const pipelineId = this.pipelineId;
    if (!pipelineId) return;
    try {
      const status = await this.requestDevServer('status', pipelineId);
      this.devServerRunning = this.isRunning(status);
      this.devServerPort = typeof status?.port === 'number' ? status.port : null;
      this.devServerError = null;
      this.reRenderDevServerControl();
    } catch (error) {
      console.error('Failed to load dev server status:', error);
    }
  }

  /** Starts or stops the pipeline's dev server based on the current state. */
  private async toggleDevServer(): Promise<void> {
    const pipelineId = this.pipelineId;
    if (!pipelineId || this.devServerLoading) return;

    const wasRunning = this.devServerRunning;
    this.devServerLoading = true;
    this.devServerError = null;
    this.reRenderDevServerControl();

    try {
      if (wasRunning) {
        await this.requestDevServer('stop', pipelineId);
        this.devServerRunning = false;
        this.devServerPort = null;
      } else {
        const status = await this.requestDevServer('start', pipelineId);
        // A successful start means the process is running, even if the
        // response shape varies between backends.
        this.devServerRunning = true;
        this.devServerPort = typeof status?.port === 'number' ? status.port : null;
      }
    } catch (error) {
      this.devServerError = error instanceof Error ? error.message : String(error);
    } finally {
      this.devServerLoading = false;
      this.reRenderDevServerControl();
    }
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

    // Make sure the latest model selections are reflected in the pipeline.
    this.captureModelInputs();

    const nameInput = this.dialog.querySelector('input[name="pipeline_name"]') as HTMLInputElement;
    const statusSelect = this.dialog.querySelector('select[name="pipeline_status"]') as HTMLSelectElement;
    const workspaceInput = this.dialog.querySelector('input[name="workspace_path"]') as HTMLInputElement;
    const docRootInput = this.dialog.querySelector('input[name="doc_root"]') as HTMLInputElement;
    const repoUriInput = this.dialog.querySelector('input[name="repo_uri"]') as HTMLInputElement;
    const repoUsernameInput = this.dialog.querySelector('input[name="repo_username"]') as HTMLInputElement;
    const repoTokenInput = this.dialog.querySelector('input[name="repo_token"]') as HTMLInputElement;
    const testCommandsInput = this.dialog.querySelector('textarea[name="test_commands"]') as HTMLTextAreaElement;
    const lintCommandsInput = this.dialog.querySelector('textarea[name="lint_commands"]') as HTMLTextAreaElement;
    const buildCommandsInput = this.dialog.querySelector('textarea[name="build_commands"]') as HTMLTextAreaElement;
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
    const buildText =
      buildCommandsInput?.value ??
      (this.pipeline.build_commands || []).map(argsToCommand).join('\n');
    const serveText =
      serveCommandsInput?.value ??
      (this.pipeline.serve_commands || []).map(argsToCommand).join('\n');

    const testCommands = parseTestCommands(testText);
    const lintCommands = parseTestCommands(lintText);
    const buildCommands = parseTestCommands(buildText);
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
          build_commands?: string[][] | null;
          serve_commands?: string[][] | null;
          ollama_model?: string | null;
          one_prompt_model?: string | null;
          assistant_model?: string | null;
          archbot_model?: string | null;
          reviewbot_model?: string | null;
          docbot_model?: string | null;
          coderbot_model?: string | null;
        } = {
          name: nameInput?.value.trim() || '',
          doc_root: docRootInput?.value.trim() || 'design',
          test_commands: testCommands.length > 0 ? testCommands : null,
          lint_commands: lintCommands.length > 0 ? lintCommands : null,
          build_commands: buildCommands.length > 0 ? buildCommands : null,
          serve_commands: serveCommands.length > 0 ? serveCommands : null,
          ...this.modelPayload(),
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
          build_commands?: string[][] | null;
          serve_commands?: string[][] | null;
          ollama_model?: string | null;
          one_prompt_model?: string | null;
          assistant_model?: string | null;
          archbot_model?: string | null;
          reviewbot_model?: string | null;
          docbot_model?: string | null;
          coderbot_model?: string | null;
        } = {
          test_commands: testCommands,
          lint_commands: lintCommands,
          build_commands: buildCommands,
          serve_commands: serveCommands,
          ...this.modelPayload(),
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
