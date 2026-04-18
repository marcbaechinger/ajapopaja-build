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
import { Pipeline, Task } from '../../core/domain.ts';
import { ConfirmationDialog } from '../components/ConfirmationDialog.ts';
import { PipelineStatsView } from '../components/PipelineStatsView.ts';

export class DashboardView extends View {
  private container: HTMLElement | null = null;
  private context: AppContext;
  private unsubs: (() => void)[] = [];

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
    this.context.actionRegistry.register('create_pipeline', async (_e, el) => {
      const form = el as HTMLFormElement;
      const nameInput = form.querySelector('input[name="pipeline_name"]') as HTMLInputElement;
      const wsInput = form.querySelector('input[name="workspace_path"]') as HTMLInputElement;
      const name = nameInput.value.trim();
      const workspacePath = wsInput.value.trim() || undefined;
      
      if (!name) return;

      try {
        await this.context.pipelineClient.create(name, workspacePath);
        nameInput.value = '';
        wsInput.value = '';
        // List will be updated via WebSocket
      } catch (error) {
        alert('Failed to create pipeline');
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

  async refreshList() {
    if (!this.container) return;
    const listContainer = this.container.querySelector('#pipeline-list') as HTMLElement;
    if (!listContainer) return;

    try {
      const pipelines = await this.context.pipelineClient.list();
      
      if (pipelines.length === 0) {
        listContainer.innerHTML = '<p class="text-app-muted italic">No pipelines created yet.</p>';
        return;
      }

      // Fetch tasks for all pipelines concurrently
      const pipelinesWithTasks = await Promise.all(
        pipelines.map(async (pipeline) => {
          try {
            const tasks = pipeline.id ? await this.context.taskClient.listByPipeline(pipeline.id, true) : [];
            return { pipeline, tasks };
          } catch (e) {
            console.error(`Failed to load tasks for pipeline ${pipeline.id}:`, e);
            return { pipeline, tasks: [] };
          }
        })
      );

      listContainer.innerHTML = pipelinesWithTasks.map(({pipeline, tasks}) => this.renderPipelineItem(pipeline, tasks)).join('');
      
      PipelineStatsView.animateBars(listContainer);
    } catch (error) {
      console.error('Error in refreshList:', error);
      listContainer.innerHTML = `<p class="text-red-400">Error loading pipelines: ${error instanceof Error ? error.message : String(error)}</p>`;
    }
  }

  private renderPipelineItem(pipeline: Pipeline, tasks: Task[]) {
    const statusColors: Record<string, string> = {
      'active': 'bg-green-600/20 text-green-400 border-green-600/30',
      'paused': 'bg-amber-600/20 text-amber-400 border-amber-600/30',
      'completed': 'bg-blue-600/20 text-blue-400 border-blue-600/30'
    };

    return `
      <div class="bg-app-bg p-4 rounded-lg border border-app-border flex flex-col gap-3 transition-all hover:border-app-accent-1 cursor-pointer group mb-4" 
           data-view-type="pipeline" data-view-id="${pipeline.id}"
           data-action-click="view_pipeline">
        <div class="flex justify-between items-start">
          <div class="flex flex-col">
            <span class="font-bold text-app-text text-lg">${pipeline.name}</span>
            <span class="text-[10px] text-app-muted uppercase font-bold mt-1 tracking-wider">Version ${pipeline.version}</span>
          </div>
          <div class="flex items-center gap-3">
            <span class="text-[10px] px-2 py-0.5 rounded border font-bold uppercase ${statusColors[pipeline.status] || 'bg-slate-600/20 text-slate-400 border-slate-600/30'}">
              ${pipeline.status}
            </span>
            <button data-action-click="delete_pipeline" 
                    class="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-500/20 text-app-muted hover:text-red-400 rounded transition-all cursor-pointer" title="Delete Pipeline">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
            </button>
          </div>
        </div>
        
        <div class="pt-2">
          ${PipelineStatsView.render(tasks, undefined, true)}
        </div>
      </div>
    `;
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
          <button data-action-click="open_search" class="flex items-center gap-2 bg-app-bg hover:bg-app-surface px-4 py-2 rounded-xl border border-app-border text-app-muted hover:text-app-accent-2 transition-all cursor-pointer group" title="Global Search (Ctrl+K)">
            <svg class="w-4 h-4 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
            <span class="text-xs font-bold uppercase tracking-widest">Search</span>
            <span class="text-[10px] bg-app-surface px-1.5 py-0.5 rounded border border-app-border text-app-muted group-hover:text-app-accent-2 group-hover:border-app-accent-2/30 transition-colors ml-1">K</span>
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
          <button data-action-click="toggle_theme" class="p-2 hover:bg-app-bg rounded-lg transition-colors cursor-pointer text-app-muted hover:text-app-accent-2" title="Toggle Theme">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path></svg>
          </button>
        </div>
      </header>

      <main class="grid gap-8 md:grid-cols-2">
        <section class="bg-app-surface p-6 rounded-xl shadow-xl border border-app-border transition-all hover:border-app-accent-1/50 h-fit">
          <h2 class="text-2xl font-bold mb-4 text-app-accent-1">Create Pipeline</h2>
          <form data-action-submit="create_pipeline" class="space-y-4">
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="block text-[10px] font-bold uppercase tracking-wider text-app-muted mb-1">Pipeline Name</label>
                <input type="text" name="pipeline_name" placeholder="e.g. My Feature" class="w-full bg-app-bg border border-app-border rounded-lg px-4 py-2 focus:ring-2 focus:ring-app-accent-1 outline-none text-app-text transition-all text-sm">
              </div>
              <div>
                <label class="block text-[10px] font-bold uppercase tracking-wider text-app-muted mb-1">Workspace Path (Optional)</label>
                <input type="text" name="workspace_path" placeholder="e.g. ./my-project" class="w-full bg-app-bg border border-app-border rounded-lg px-4 py-2 focus:ring-2 focus:ring-app-accent-1 outline-none text-app-text transition-all text-sm">
              </div>
            </div>
            <button type="submit" class="w-full bg-app-accent-1 hover:brightness-110 text-white font-bold py-2 rounded-lg transition-all shadow-lg cursor-pointer">
              Create
            </button>
          </form>
        </section>

        <section class="bg-app-surface p-6 rounded-xl shadow-xl border border-app-border transition-all hover:border-app-accent-2/50">
          <h2 class="text-2xl font-bold mb-4 text-app-accent-2">Active Pipelines</h2>
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
  }
}
