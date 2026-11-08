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

import { View } from '../../core/Navigator.ts';
import { AppContext } from '../../core/AppContext.ts';
import { Pipeline, PipelineStatus, Task } from '../../core/domain.ts';
import { ConfirmationDialog } from '../components/dialogs/ConfirmationDialog.ts';
import { PipelineEditDialog } from '../components/dialogs/PipelineEditDialog.ts';
import { Icon } from '../components/common/Icon.ts';
import { PipelineItemView } from '../components/pipeline/PipelineItemView.ts';
import { SessionManagerButton } from '../components/session/SessionManagerButton.ts';
import { copyToClipboard } from '../utils/clipboard.ts';
import {
  GettingStartedDialog,
  renderGettingStartedGuide,
  renderGettingStartedLoading,
} from './GettingStartedGuide.ts';

// Sort weight per pipeline status. Lower weight renders first.
// Unknown/non-conforming statuses fall back to 3 (last).
const PIPELINE_STATUS_PRIORITY: Record<string, number> = {
  [PipelineStatus.ACTIVE]: 0,
  [PipelineStatus.PAUSED]: 1,
  [PipelineStatus.COMPLETED]: 2,
};

// Status group headers, in priority order. Mirrors PIPELINE_STATUS_PRIORITY.
const STATUS_GROUPS: { key: string; label: string; color: string }[] = [
  { key: PipelineStatus.ACTIVE, label: 'Active', color: 'text-green-400' },
  { key: PipelineStatus.PAUSED, label: 'Paused', color: 'text-amber-400' },
  { key: PipelineStatus.COMPLETED, label: 'Completed', color: 'text-blue-400' },
];

function statusPriority(status: PipelineStatus): number {
  return PIPELINE_STATUS_PRIORITY[status] ?? 3;
}

export class DashboardView extends View {
  private container: HTMLElement | null = null;
  private context: AppContext;
  private unsubs: (() => void)[] = [];
  /** The getting-started overlay, when open. Used to dismiss it before creating a pipeline. */
  private gettingStartedDialog: GettingStartedDialog | null = null;

  constructor(context: AppContext) {
    super();
    this.context = context;
    this.registerActions();
    this.setupWebSocket();
  }

  private setupWebSocket() {
    this.unsubs.push(this.context.wsClient.on('PIPELINE_CREATED', () => {
      this.refreshList();
    }));
    this.unsubs.push(this.context.wsClient.on('PIPELINE_DELETED', () => {
      this.refreshList();
    }));
    // We should also refresh if a task is created/updated/deleted
    // since we're displaying stats on the dashboard now.
    this.unsubs.push(this.context.wsClient.on('TASK_CREATED', () => this.refreshList()));
    this.unsubs.push(this.context.wsClient.on('TASK_UPDATED', () => this.refreshList()));
    this.unsubs.push(this.context.wsClient.on('TASK_STATUS_UPDATED', () => this.refreshList()));
    this.unsubs.push(this.context.wsClient.on('TASK_COMPLETED', () => this.refreshList()));
    this.unsubs.push(this.context.wsClient.on('TASK_DELETED', () => this.refreshList()));
  }

  private registerActions() {
    this.context.actionRegistry.register('create_pipeline', async () => {
      await this.openCreatePipelineDialog();
    });

    // The primary button inside the getting-started overlay: dismiss the guide
    // first so the (modal) create dialog can be shown.
    this.context.actionRegistry.register('create_pipeline_from_guide', async () => {
      this.gettingStartedDialog?.dismiss();
      this.gettingStartedDialog = null;
      await this.openCreatePipelineDialog();
    });

    // “Readme” access once pipelines exist: reopen the onboarding guide as an
    // overlay so it stays available for reference without cluttering the list.
    this.context.actionRegistry.register('open_getting_started', () => {
      if (this.gettingStartedDialog) return;
      const dialog = new GettingStartedDialog();
      this.gettingStartedDialog = dialog;
      void dialog.show().finally(() => {
        if (this.gettingStartedDialog === dialog) this.gettingStartedDialog = null;
      });
    });

    // Copies a project blueprint prompt to the clipboard and confirms inline.
    this.context.actionRegistry.register('copy_project_prompt', async (_e, el) => {
      const targetId = el.getAttribute('data-copy-target');
      const pre = targetId ? document.getElementById(targetId) : null;
      const text = pre?.textContent ?? '';
      if (!text) return;
      try {
        await copyToClipboard(text);
        const label = el.querySelector('.copy-label');
        if (label) {
          const original = label.textContent ?? 'Copy prompt';
          label.textContent = 'Copied!';
          window.setTimeout(() => {
            label.textContent = original;
          }, 1500);
        }
      } catch (error) {
        console.error('Failed to copy project prompt:', error);
      }
    });

    this.context.actionRegistry.register('delete_pipeline', async (e, el) => {
      e.stopPropagation(); // Prevent view_pipeline
      const pipelineId = el.closest('[data-view-id]')?.getAttribute('data-view-id');
      if (!pipelineId) return;

      const confirmed = await new ConfirmationDialog(
        'Delete Pipeline',
        'Are you sure you want to delete this pipeline and ALL its tasks? This action cannot be undone.',
        'Delete'
      ).show();

      if (!confirmed) return;

      try {
        await this.context.pipelineClient.delete(pipelineId);
        // List will be updated via WebSocket
      } catch (error) {
        alert('Failed to delete pipeline');
      }
    });

    this.context.actionRegistry.register('view_pipeline', async (e, el) => {
      // Don't navigate if clicking the delete button
      if ((e.target as HTMLElement).closest('[data-action-click="delete_pipeline"]')) {
        return;
      }
      const pipelineId = el.closest('[data-view-id]')?.getAttribute('data-view-id');
      if (pipelineId) {
        window.location.hash = `#/pipeline/${pipelineId}`;
      }
    });
  }

  /** Opens the “Create Pipeline” dialog. Shared by the header and the guide. */
  private async openCreatePipelineDialog() {
    const dialog = new PipelineEditDialog({
      mode: 'create',
      context: this.context
    });
    await dialog.show();
    // List will be updated via WebSocket
  }

  async refreshList() {
    if (!this.container) return;
    const listContainer = this.container.querySelector('#pipeline-list') as HTMLElement;
    if (!listContainer) return;

    try {
      const pipelines = await this.context.pipelineClient.list();

      // The onboarding guide takes over the empty dashboard: hide the regular
      // “Active Pipelines” header (and its create button) so the first page
      // reads as a single, focused getting-started experience.
      const header = this.container.querySelector('#pipelines-header') as HTMLElement | null;
      if (header) header.classList.toggle('hidden', pipelines.length === 0);

      if (pipelines.length === 0) {
        listContainer.innerHTML = renderGettingStartedLoading();
        try {
          listContainer.innerHTML = await renderGettingStartedGuide('inline');
        } catch (error) {
          console.error('Failed to load the getting started guide:', error);
          listContainer.innerHTML = `<p class="text-red-400">Failed to load the getting started guide.</p>`;
        }
        return;
      }

      // Sort by status priority (active → paused → completed → unknown),
      // then by created_at descending (newest first) within each group.
      const sortedPipelines = [...pipelines].sort((a, b) => {
        const priA = statusPriority(a.status);
        const priB = statusPriority(b.status);
        if (priA !== priB) return priA - priB;
        return (new Date(b.created_at || 0)).getTime() - (new Date(a.created_at || 0)).getTime();
      });

      // Fetch tasks for all pipelines concurrently
      const pipelinesWithTasks = await Promise.all(
        sortedPipelines.map(async (pipeline) => {
          try {
            const tasks = pipeline.id ? await this.context.taskClient.listByPipeline(pipeline.id, true) : [];
            return { pipeline, tasks };
          } catch (e) {
            console.error(`Failed to load tasks for pipeline ${pipeline.id}:`, e);
            return { pipeline, tasks: [] };
          }
        })
      );

      // Build a PipelineItemView for every pipeline. Rendering stays synchronous
      // (string-based) so grouping/sorting/assembly is unchanged; the recently-
      // implemented tasks are loaded asynchronously afterwards.
      const itemsByPipeline = new Map<string, { item: PipelineItemView; html: string }>();
      for (const entry of pipelinesWithTasks) {
        const item = new PipelineItemView({
          pipeline: entry.pipeline,
          statsTasks: entry.tasks,
          context: this.context,
        });
        itemsByPipeline.set(entry.pipeline.id!, { item, html: item.render() });
      }

      const grouped: Record<string, { pipeline: Pipeline; tasks: Task[] }[]> = {};
      for (const entry of pipelinesWithTasks) {
        const group = statusPriority(entry.pipeline.status);
        (grouped[group] = grouped[group] || []).push(entry);
      }

      const knownGroupKeys = new Set(STATUS_GROUPS.map(g => statusPriority(g.key as PipelineStatus)));
      const knownHtml = STATUS_GROUPS.map(({ key, label, color }) => {
        const entries = grouped[statusPriority(key as PipelineStatus)] || [];
        if (entries.length === 0) return '';
        return `
          <div class="mb-2">
            <h3 class="text-xs font-bold uppercase tracking-widest ${color} mb-2">${label}</h3>
            ${entries.map(({ pipeline }) => itemsByPipeline.get(pipeline.id!)!.html).join('')}
          </div>
        `;
      }).join('');

      // Render any unknown/non-conforming statuses after the known groups.
      const residualHtml = Object.entries(grouped)
        .filter(([key]) => !knownGroupKeys.has(Number(key)))
        .map(([, entries]) => entries.map(({ pipeline }) => itemsByPipeline.get(pipeline.id!)!.html).join(''))
        .join('');

      listContainer.innerHTML = knownHtml + residualHtml;

      // Asynchronously populate the recently-implemented sections for each item.
      for (const { item } of itemsByPipeline.values()) {
        item.bind(listContainer.querySelector<HTMLElement>(`#${item.placeholderId}`))
            .loadRecentTasks();
      }
    } catch (error) {
      console.error('Error in refreshList:', error);
      listContainer.innerHTML = `<p class="text-red-400">Error loading pipelines: ${error instanceof Error ? error.message : String(error)}</p>`;
    }
  }

  render() {
    const user = this.context.authService.getUser();
    return `
      <div class="max-w-7xl mx-auto p-8">
        <header class="flex justify-between items-center bg-app-surface p-6 rounded-xl shadow-lg border border-app-border mb-8">
        <div class="flex flex-col">
          <h1 class="text-3xl font-black text-app-accent-1 tracking-tight">Ajapopaja <span class="text-app-text/50">Build</span></h1>
          <div class="flex items-center gap-2 mt-1">
            <p class="text-xs text-app-muted uppercase font-bold tracking-widest">Unified Agent Workspace</p>
            <span id="app-version" class="text-[10px] text-app-accent-2/50 font-mono"></span>
          </div>
        </div>
        <div class="flex items-center gap-4">
          ${SessionManagerButton.render()}
          <button data-action-click="open_search" class="flex items-center gap-2 bg-app-bg hover:bg-app-surface px-4 py-2 rounded-xl border border-app-border text-app-muted hover:text-app-accent-2 transition-all cursor-pointer group" title="Global Search (Ctrl+K)">
            <svg class="w-4 h-4 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
            <span class="text-xs font-bold uppercase tracking-widest">Search</span>
            <span class="text-[10px] bg-app-surface px-1.5 py-0.5 rounded border border-app-border text-app-muted group-hover:text-app-accent-2 group-hover:border-app-accent-2/30 transition-colors ml-1">K</span>
          </button>
          <button data-action-click="toggle_assistant" class="flex items-center gap-2 bg-app-bg hover:bg-app-surface px-4 py-2 rounded-xl border border-app-border text-app-muted hover:text-app-accent-2 transition-all cursor-pointer group" title="AI Assistant (Ctrl+Alt+A)">
            <svg class="w-4 h-4 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
            <span class="text-xs font-bold uppercase tracking-widest">Assistant</span>
            <div class="flex gap-0.5 ml-1">
              <span class="text-[10px] bg-app-surface px-1.5 py-0.5 rounded border border-app-border text-app-muted group-hover:text-app-accent-2 group-hover:border-app-accent-2/30 transition-colors">Alt</span>
              <span class="text-[10px] bg-app-surface px-1.5 py-0.5 rounded border border-app-border text-app-muted group-hover:text-app-accent-2 group-hover:border-app-accent-2/30 transition-colors">A</span>
            </div>
          </button>
          <div class="w-px h-8 bg-app-border mx-2"></div>
          <div class="flex items-center gap-3 bg-app-bg px-4 py-2 rounded-xl border border-app-border">
            <div class="flex flex-col items-end">
              <span class="text-xs font-bold text-app-text">${user?.username || 'User'}</span>
              <span class="text-[9px] text-app-muted uppercase font-black tracking-widest">Logged In</span>
            </div>
            <div class="w-px h-6 bg-app-border mx-1"></div>
            <button data-action-click="perform_logout" class="p-1.5 hover:bg-red-500/10 text-app-muted hover:text-red-400 rounded-lg transition-all cursor-pointer group/logout" title="Logout">
              <svg class="w-4 h-4 group-hover/logout:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"></path></svg>
            </button>
          </div>
          <button data-action-click="open_health_check" class="p-2 hover:bg-app-bg rounded-lg transition-colors cursor-pointer text-app-muted hover:text-green-500" title="System Health">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
          </button>
          <button data-action-click="toggle_theme" class="p-2 hover:bg-app-bg rounded-lg transition-colors cursor-pointer text-app-muted hover:text-app-accent-2" title="Toggle Theme">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path></svg>
          </button>
        </div>
      </header>

      <main class="flex flex-col gap-8">
        <section class="bg-app-surface p-6 rounded-xl shadow-xl border border-app-border transition-all hover:border-app-accent-2/50">
          <div id="pipelines-header" class="flex justify-between items-center mb-6">
            <h2 class="text-2xl font-bold text-app-accent-2">Active Pipelines</h2>
            <div class="flex items-center gap-2">
              <button data-action-click="open_getting_started" class="flex items-center gap-2 bg-app-bg hover:bg-app-surface px-4 py-2 rounded-xl border border-app-border text-app-muted hover:text-app-accent-2 transition-all cursor-pointer group" title="Open the getting started guide">
                ${Icon.render('documentation', { size: 16, className: 'group-hover:scale-110 transition-transform' })}
                <span class="text-xs font-bold uppercase tracking-widest">Guide</span>
              </button>
              <button data-action-click="create_pipeline" class="flex items-center gap-2 bg-app-accent-1 hover:brightness-110 text-white text-xs font-bold uppercase tracking-widest px-4 py-2 rounded-lg transition-all shadow-lg cursor-pointer">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path></svg>
                Create Pipeline
              </button>
            </div>
          </div>
          <div id="pipeline-list" class="space-y-2">
            <p class="text-app-muted animate-pulse">Loading pipelines...</p>
          </div>
        </section>
      </main>
      </div>
    `;
  }

  mount(container: HTMLElement) {
    this.container = container;
    this.refreshList();
    this.updateVersion();
    this.checkOllama();
  }

  private async checkOllama() {
    if (!this.container) return;
    const isAvailable = await this.context.systemClient.isOllamaAvailable();
    if (!isAvailable) {
      // Hide every assistant entry point (header and getting-started guide)
      // so the UI never offers an action the backend cannot serve.
      this.container.querySelectorAll('[data-action-click="toggle_assistant"]')
        .forEach((el) => el.classList.add('hidden'));
    }
  }

  private async updateVersion() {
    if (!this.container) return;
    const versionEl = this.container.querySelector('#app-version');
    if (versionEl) {
      const version = await this.context.systemClient.getVersion();
      versionEl.textContent = `v${version}`;
    }
  }

  unmount() {
    this.unsubs.forEach(unsub => unsub());
    this.unsubs = [];
    this.gettingStartedDialog?.dismiss();
    this.gettingStartedDialog = null;
  }
}
