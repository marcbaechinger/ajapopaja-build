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

import { Task, TaskStatus } from '../../core/domain.ts';
import { ExecutionEngineItemView } from './ExecutionEngineItemView.ts';
import { PipelineHistoryView } from './PipelineHistoryView.ts';

export interface ExecutionEngineViewProps {
  tasks: Task[];
  historyTasks?: Task[];
  historyPage?: number;
}

/**
 * ExecutionEngineView renders the right side panel of the PipelineDetailView.
 *
 * It lists the tasks currently handled by the execution engine, grouped into
 * sections - In Progress (IN_PROGRESS), Queue (SCHEDULED) and Failed (FAILED) -
 * each with a header showing the section type and the total number of tasks in
 * it. Tasks within a section are ordered by their execution order.
 */
export class ExecutionEngineView {
  static render(props: ExecutionEngineViewProps): string {
    const { tasks = [] } = props;
    const historyTasks = props.historyTasks ?? [];
    const historyPage = props.historyPage ?? 0;

    const inProgress = tasks
      .filter(t => !t.deleted && t.status === TaskStatus.INPROGRESS)
      .sort((a, b) => orderSort(a, b));
    const queue = tasks
      .filter(t => !t.deleted && t.status === TaskStatus.SCHEDULED)
      .sort((a, b) => orderSort(a, b));

    return `
      <div class="flex flex-col min-h-0 h-full overflow-hidden pt-2">
        ${ExecutionEngineView.sectionHeader('In Progress', inProgress.length, 'text-amber-400', 'inprogress')}
        ${ExecutionEngineView.sectionBody(inProgress, 'No active work.', '', 'inprogress')}

        <div id="engine-piview-section" class="flex flex-col gap-1.5 mt-1">
          <div class="flex items-center justify-between px-1 pt-1">
            <span class="text-[10px] font-black uppercase tracking-widest text-app-accent-2">CoderBot Activity</span>
          </div>
          <div id="engine-piview-mount" class="min-h-0">
            <p class="text-[10px] italic text-app-muted/50 text-center border border-dashed border-app-border/40 rounded-lg py-3">Start a CoderBot to see its output here.</p>
          </div>
        </div>

        ${ExecutionEngineView.sectionHeader('Queue', queue.length, 'text-app-accent-1', 'queue')}
        ${ExecutionEngineView.sectionBody(queue, 'Nothing scheduled.', 'max-h-48 overflow-y-auto', 'queue')}

        <div id="sidebar-history" class="flex-1 min-h-0 mt-2 flex flex-col overflow-hidden">
          ${PipelineHistoryView.render(historyTasks, historyPage)}
        </div>
      </div>
    `;
  }

  private static sectionHeader(title: string, count: number, accent: string, key?: string): string {
    const headerAttr = key ? ` data-engine-header="${key}"` : '';
    const countAttr = key ? ` data-engine-count="${key}"` : '';
    return `
      <div class="flex items-center justify-between px-1 pt-1"${headerAttr}>
        <span class="text-[10px] font-black uppercase tracking-widest ${accent}">${title}</span>
        <span${countAttr} class="text-[10px] font-bold text-app-muted bg-app-surface border border-app-border rounded-full px-1.5 py-0.5">${count}</span>
      </div>
    `;
  }

  private static sectionBody(tasks: Task[], emptyMessage: string, listClass: string = '', key?: string): string {
    const sectionAttr = key ? ` data-engine-section="${key}"` : '';
    if (tasks.length === 0) {
      return `
        <div class="px-1"${sectionAttr}>
          <p class="text-[10px] italic text-app-muted/50 text-center border border-dashed border-app-border/40 rounded-lg py-3">${emptyMessage}</p>
        </div>
      `;
    }
    return `
      <div class="flex flex-col gap-2 ${listClass}"${sectionAttr}>
        ${tasks.map(t => ExecutionEngineItemView.render(t)).join('')}
      </div>
    `;
  }

  /**
   * Removes a single task from the rendered In Progress section in place,
   * keeping the rest of the ExecutionEngineView DOM (PiView mount, queue, history)
   * untouched. Used when a task transitions out of IN_PROGRESS (e.g. to
   * PULL_REQUEST_AVAILABLE) without a full task re-broadcast. Returns true when
   * the item was found and removed.
   */
  static removeInProgressItem(container: HTMLElement, taskId: string): boolean {
    const list = container.querySelector('[data-engine-section="inprogress"]');
    if (!list) return false;

    const item = list.querySelector(`[data-view-id="${taskId}"]`);
    if (!item) return false;
    item.remove();

    const remaining = list.querySelectorAll('[data-view-id]').length;
    const countEl = container.querySelector('[data-engine-count="inprogress"]');
    if (countEl) {
      countEl.textContent = String(remaining);
    }

    // Restore the empty state if the last in-progress item was just removed.
    if (list.children.length === 0) {
      list.innerHTML = `
        <div class="px-1">
          <p class="text-[10px] italic text-app-muted/50 text-center border border-dashed border-app-border/40 rounded-lg py-3">No active work.</p>
        </div>
      `;
    }
    return true;
  }
}

function orderSort(a: Task, b: Task): number {
  return (a.order || 0) - (b.order || 0);
}
