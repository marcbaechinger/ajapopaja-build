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

import { AppContext } from '../../../core/AppContext.ts';
import { Pipeline, Task, TaskStatus } from '../../../core/domain.ts';
import { PipelineStatsView } from './PipelineStatsView.ts';
import { parseTimestamp } from '../utils/relativeTime.ts';

export interface PipelineItemOptions {
  pipeline: Pipeline;
  statsTasks: Task[];   // full task set already fetched by DashboardView for compact stats
  context: AppContext;  // kept for interface compatibility; not needed to derive recent tasks
}

/**
 * Renders a single Pipeline card for the dashboard list.
 *
 * The card is laid out as a single row with two cells: the left cell shows the
 * pipeline name/version/status, state badge, delete button and a compact stats
 * row; the right cell shows the "Recently Implemented" list populated from
 * {@link statsTasks}. Both cells sit on the same row to save vertical space.
 *
 * The recent list is derived locally from the full task set provided by
 * {@link DashboardView}. This intentionally avoids the backend
 * `/tasks/completed` endpoint, which drops the single most recent completed task
 * so that `PipelineDetailView` can render it as a separate "latest completed"
 * hero. Reusing that endpoint here would silently omit the newest task.
 *
 * Navigation (`data-action-click="view_pipeline"`) and delete
 * (`data-action-click="delete_pipeline"`) data-attributes are preserved so the
 * existing `DashboardView` action handlers work unchanged.
 */
export class PipelineItemView {
  readonly pipeline: Pipeline;
  readonly statsTasks: Task[];
  readonly context: AppContext;
  readonly placeholderId: string;

  private boundEl: HTMLElement | null = null;

  constructor(options: PipelineItemOptions) {
    this.pipeline = options.pipeline;
    this.statsTasks = options.statsTasks || [];
    this.context = options.context;
    this.placeholderId = `recent-tasks-${this.pipeline.id || 'unknown'}`;
  }

  /**
   * Bind this item to its live placeholder container so that
   * {@link loadRecentTasks} can inject content after render.
   */
  bind(el: HTMLElement | null): this {
    this.boundEl = el;
    return this;
  }

  /** Returns the header + status pill + delete controls block (shared by render). */
  private renderHeader(): string {
    const statusColors: Record<string, string> = {
      'active': 'bg-green-600/20 text-green-400 border-green-600/30',
      'paused': 'bg-amber-600/20 text-amber-400 border-amber-600/30',
      'completed': 'bg-blue-600/20 text-blue-400 border-blue-600/30'
    };

    return `
      <div class="flex justify-between items-start gap-3">
        <div class="flex flex-col min-w-0">
          <span class="font-bold text-app-text text-base truncate">${this.pipeline.name}</span>
          <span class="text-[10px] text-app-muted uppercase font-bold mt-0.5 tracking-wider">Version ${this.pipeline.version}</span>
        </div>
        <div class="flex items-center gap-3 shrink-0">
          <span class="text-[10px] px-2 py-0.5 rounded border font-bold uppercase ${statusColors[this.pipeline.status] || 'bg-slate-600/20 text-slate-400 border-slate-600/30'}">
            ${this.pipeline.status}
          </span>
          <button data-action-click="delete_pipeline"
                  class="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-500/20 text-app-muted hover:text-red-400 rounded transition-all cursor-pointer" title="Delete Pipeline">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
          </button>
        </div>
      </div>
    `;
  }

  render(): string {
    return `
      <div class="bg-app-bg p-4 rounded-lg border border-app-border transition-all hover:border-app-accent-1 cursor-pointer group mb-4"
           data-view-type="pipeline" data-view-id="${this.pipeline.id}"
           data-action-click="view_pipeline">
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-3">
          <div class="flex flex-col gap-2.5 min-w-0">
            ${this.renderHeader()}
            <div class="pt-0.5">
              ${PipelineStatsView.renderCompact(this.statsTasks)}
            </div>
          </div>

          <div class="recent-tasks min-w-0 lg:border-l lg:border-app-border/40 lg:pl-6">
            <div class="flex items-center gap-1.5 select-none text-[10px] font-bold uppercase tracking-widest text-app-muted">
              <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
              Recently Implemented
              <span class="text-[9px] text-app-muted/60 font-normal normal-case">(last 5)</span>
            </div>
            <div class="mt-2" id="${this.placeholderId}">
              <span class="text-[11px] text-app-muted animate-pulse">Loading recent tasks...</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Returns the up to 5 most recent completed (SUBMITTED/IMPLEMENTED/DISCARDED)
   * non-deleted tasks of this pipeline, sorted by most recently updated first.
   *
   * The list is derived from {@link statsTasks} (the full task set fetched for
   * the compact stats). This deliberately avoids the backend `/tasks/completed`
   * endpoint, which drops the single most recent task for PipelineDetailView's
   * "latest completed" hero and therefore must not be reused for this list.
   */
  private recentTasks(): Task[] {
    if (!this.statsTasks || this.statsTasks.length === 0) return [];
    return this.statsTasks
      .filter(t => !t.deleted && (
        t.status === TaskStatus.SUBMITTED ||
        t.status === TaskStatus.IMPLEMENTED ||
        t.status === TaskStatus.DISCARDED
      ))
      .sort((a, b) => (
        new Date(b.updated_at || 0).getTime() -
        new Date(a.updated_at || 0).getTime()
      ))
      .slice(0, 5);
  }

  /**
   * Populates the recently-implemented placeholder from the locally derived
   * recent tasks. Safe to call before render / bind: it no-ops harmlessly if
   * the placeholder is not found or the pipeline has no id.
   */
  async loadRecentTasks(): Promise<void> {
    if (!this.pipeline.id) return;
    this.injectRecent(this.recentTasks());
  }

  private getPlaceholder(): HTMLElement | null {
    if (this.boundEl) return this.boundEl;
    return document.getElementById(this.placeholderId);
  }

  private injectRecent(tasks: Task[]): void {
    const placeholder = this.getPlaceholder();
    if (!placeholder) return;

    if (!tasks || tasks.length === 0) {
      placeholder.innerHTML = '<span class="text-[11px] text-app-muted/70 italic">No implemented tasks yet.</span>';
      return;
    }

    const rows = tasks.map(task =>
      `<li class="flex items-center justify-between gap-2 py-1">
        <span class="text-xs text-app-text/80 truncate" title="${task.title}">${task.title}</span>
        <span class="flex items-center gap-2 shrink-0">
          ${this.renderTaskStatus(task.status)}
          <span class="text-[9px] text-app-muted whitespace-nowrap">${this.formatRelative(task.updated_at)}</span>
        </span>
      </li>`
    ).join('');

    placeholder.innerHTML = `<ul class="divide-y divide-app-border/30">${rows}</ul>`;
  }

  private renderTaskStatus(status: TaskStatus): string {
    const statusColors: Record<string, string> = {
      [TaskStatus.IMPLEMENTED]: 'bg-green-600/20 text-green-400 border-green-600/30',
      [TaskStatus.INPROGRESS]: 'bg-amber-600/20 text-amber-400 border-amber-600/30',
      [TaskStatus.PULL_REQUEST_AVAILABLE]: 'bg-cyan-600/20 text-cyan-400 border-cyan-600/30',
      [TaskStatus.SUBMITTED]: 'bg-purple-600/20 text-purple-400 border-purple-600/30',
      [TaskStatus.FAILED]: 'bg-red-600/20 text-red-400 border-red-600/30',
    };
    return `<span class="text-[9px] px-1.5 py-0.5 rounded border font-bold uppercase ${statusColors[status] || 'bg-slate-600/20 text-slate-400 border-slate-600/30'}">${status}</span>`;
  }

  private formatRelative(iso?: string): string {
    if (!iso) return '';
    const diff = Date.now() - parseTimestamp(iso);
    if (diff < 60_000) return 'just now';
    const mins = Math.floor(diff / 60_000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(parseTimestamp(iso)).toLocaleDateString();
  }
}
