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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Strips markdown and collapses whitespace so the spec can be shown as a
 * compact plain-text excerpt in the sidebar.
 */
function specExcerpt(spec: string): string {
  return spec
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_>#~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const statusMeta: Record<string, { label: string; badgeClass: string }> = {
  [TaskStatus.INPROGRESS]: { label: 'Running', badgeClass: 'text-amber-400 bg-amber-500/15 border-amber-500/30' },
  [TaskStatus.SCHEDULED]: { label: 'Queued', badgeClass: 'text-app-accent-1 bg-app-accent-1/15 border-app-accent-1/30' },
  [TaskStatus.FAILED]: { label: 'Failed', badgeClass: 'text-red-400 bg-red-500/15 border-red-500/30' },
};

/**
 * Renders a single task inside the ExecutionEngineView right sidebar.
 *
 * It mirrors the compact look of BacklogTaskView but without action buttons:
 * it shows the title, a spec excerpt and a small status badge, and is clickable
 * to select the task so it appears in the selected TaskView in the main area.
 */
export class ExecutionEngineItemView {
  static render(task: Task): string {
    const taskId = escapeHtml(task.id || '');
    const excerpt = task.spec ? specExcerpt(task.spec) : '';
    const meta = statusMeta[task.status] || { label: task.status, badgeClass: 'text-app-muted bg-app-surface border-app-border' };

    return `
      <div class="group rounded-lg border border-app-border bg-app-bg/60 p-3 flex flex-col gap-2 transition-colors cursor-pointer hover:border-app-accent-2/40 hover:bg-app-bg"
           data-action-click="select_task" data-view-id="${taskId}" data-task-id="${taskId}">
        <div class="flex items-start justify-between gap-2">
          <span class="text-[11px] font-bold text-app-text leading-snug break-words">${escapeHtml(task.title || '')}</span>
          <span class="flex-none text-[9px] font-black uppercase tracking-widest rounded-full px-1.5 py-0.5 border ${meta.badgeClass}">${meta.label}</span>
        </div>
        ${excerpt ? `
          <p class="text-[10px] text-app-muted leading-snug line-clamp-3">${escapeHtml(excerpt)}</p>
        ` : `<p class="text-[10px] text-app-muted italic line-clamp-2">No specification yet.</p>`}
      </div>
    `;
  }
}
