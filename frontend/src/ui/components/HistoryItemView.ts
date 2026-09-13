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
import { calculateDuration } from './utils/duration.ts';
import { Icon } from './Icon.ts';

/**
 * Slim, single/two-line representation of a settled (IMPLEMENTED / SUBMITTED)
 * task shown in the History Feed. Only the essential metadata is displayed:
 * the title, the commit hash (with a Neovim diff-view action), the
 * implementation duration and a status badge.
 *
 * Clicking the item selects the task and shows it in the main TaskView
 * (handled by the `select_task` action in PipelineDetailView).
 */
export class HistoryItemView {
  static isHistoryStatus(status: TaskStatus): boolean {
    return status === TaskStatus.IMPLEMENTED || status === TaskStatus.SUBMITTED;
  }

  static render(task: Task, isLastCompleted: boolean = false): string {
    const taskId = task.id;
    const isSystem = task.type === 'system';
    const implementationTime = calculateDuration(task);

    return `
      <div class="bg-app-bg px-3 py-2 rounded-lg border border-app-border flex items-center justify-between gap-3 transition-all hover:border-app-accent-1/30 ${isSystem ? 'border-l-4 border-l-red-500' : ''} ${isLastCompleted ? 'border-app-accent-2/40 shadow-lg shadow-app-accent-2/5' : ''}"
           data-view-type="history" data-view-id="${taskId}" data-action-click="select_task" title="Open in Task View" data-task-id="${taskId}" data-version="${task.version}">
        <div class="flex items-center gap-2 min-w-0">
          ${task.commit_hash ? `
            <button data-action-click="open_diff_view" data-commit-hash="${task.commit_hash}"
                    class="text-[10px] font-mono text-app-accent-2 bg-app-surface px-2 py-0.5 rounded border border-app-border hover:bg-app-accent-2/10 hover:border-app-accent-2/50 transition-all cursor-pointer shrink-0"
                    title="Open Diff View in Neovim">
              ${task.commit_hash.substring(0, 7)}
            </button>
          ` : ''}
          <span class="font-medium text-app-text text-sm truncate">${task.title}</span>
          ${implementationTime ? `
            <span class="text-[10px] text-app-muted flex items-center gap-1 shrink-0" title="Implementation Duration">
              ${Icon.render('clock', { size: 12 })}
              Impl: ${implementationTime}
            </span>
          ` : ''}
        </div>
        <span class="text-xs px-2 py-1 rounded font-bold uppercase shrink-0 whitespace-nowrap ${task.status === TaskStatus.IMPLEMENTED ? 'bg-green-600 text-white' : 'bg-teal-600 text-white'}">
          ${task.status}
        </span>
      </div>
    `;
  }
}
