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
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { calculateDuration } from './utils/duration.ts';
import { renderStatusHistorySection } from './StatusHistorySection.ts';
import { Icon } from './Icon.ts';

/**
 * Compact one-card representation of a settled (IMPLEMENTED / SUBMITTED) task
 * shown in the History Feed. It is essentially the header of a TaskView plus the
 * implementation-related meta data, with the Status History collapsed by default.
 *
 * Clicking the title/header selects the task and shows it in the main TaskView
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
      <div class="bg-app-bg p-4 rounded-lg border border-app-border flex flex-col gap-3 transition-all hover:border-app-accent-1/30 ${isSystem ? 'border-l-4 border-l-red-500' : ''} ${isLastCompleted ? 'border-app-accent-2/40 shadow-lg shadow-app-accent-2/5' : ''}"
           data-view-type="history" data-view-id="${taskId}">
        <div class="flex justify-between items-start cursor-pointer group/header" data-action-click="select_task" title="Open in Task View">
          <div class="flex items-center gap-3">
            <div class="title-container flex flex-col" data-task-id="${taskId}" data-version="${task.version}">
              <div class="title-view flex items-center gap-2">
                ${Icon.render('chevronRight', { size: 16, className: 'text-app-muted' })}
                <span class="font-medium text-app-text text-lg group-hover/header:text-app-accent-2 transition-colors">${task.title}</span>
              </div>
              <div class="flex items-center gap-2 mt-1" data-task-id="${taskId}">
                <span class="text-[10px] text-app-muted uppercase font-bold tracking-widest bg-app-surface px-2 py-0.5 rounded border border-app-border">${taskId}</span>
                <button data-action-click="copy_task_id" class="p-1 hover:bg-app-surface text-app-muted hover:text-app-accent-2 rounded transition-all cursor-pointer group/copy" title="Copy Task ID">
                   ${Icon.render('copy', { size: 12, className: 'group-hover/copy:scale-110 transition-transform' })}
                </button>
                <button data-action-click="trigger_docbot" data-task-id="${taskId}" class="p-1 hover:bg-app-surface text-app-muted hover:text-green-600 rounded transition-all cursor-pointer group/docbot" title="Trigger DocBot (needs Ollama)">
                   ${Icon.render('documentation', { size: 12, className: 'group-hover/docbot:scale-110 transition-transform' })}
                </button>
                ${task.commit_hash ? `
                  <button data-action-click="open_quickfix" data-task-id="${taskId}" class="p-1 hover:bg-app-surface text-app-muted hover:text-app-accent-2 rounded transition-all cursor-pointer group/quickfix" title="Open Quickfix in Neovim">
                     ${Icon.render('quickfix', { size: 14, className: 'group-hover/quickfix:scale-110 transition-transform' })}
                  </button>
                ` : ''}
                ${task.review_md
                  ? `
                      <button data-action-click="open_review_dialog" data-task-id="${taskId}" class="p-1 hover:bg-app-surface text-app-accent-2 hover:text-app-accent-2/80 rounded transition-all cursor-pointer group/review relative" title="View Technical Review">
                        ${Icon.render('documentation', { size: 12, className: 'group-hover/review:scale-110 transition-transform' })}
                        <span class="absolute -top-1 -right-1 flex h-1.5 w-1.5">
                          <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-app-accent-2 opacity-75"></span>
                          <span class="relative inline-flex rounded-full h-1.5 w-1.5 bg-app-accent-2"></span>
                        </span>
                      </button>
                    `
                  : `
                      <button data-action-click="trigger_reviewbot" data-task-id="${taskId}" class="p-1 hover:bg-app-surface text-app-muted hover:text-app-accent-2 rounded transition-all cursor-pointer group/review" title="Trigger Technical Review">
                        ${Icon.render('check', { size: 12, className: 'group-hover/review:scale-110 transition-transform' })}
                      </button>
                    `}
              </div>
            </div>
          </div>
          <div class="flex items-center gap-2" data-action-click="none">
            <div class="flex items-center gap-2">
              ${task.commit_hash ? `
                <div class="flex items-center gap-2">
                  <button data-action-click="open_diff_view" data-commit-hash="${task.commit_hash}"
                          class="text-[10px] font-mono text-app-accent-2 bg-app-surface px-2 py-0.5 rounded border border-app-border hover:bg-app-accent-2/10 hover:border-app-accent-2/50 transition-all cursor-pointer"
                          title="Open Diff View in Neovim">
                    ${task.commit_hash.substring(0, 7)}
                  </button>
                </div>
              ` : ''}
              ${implementationTime ? `
                <div class="text-[10px] text-app-muted flex items-center gap-1" title="Implementation Duration">
                  ${Icon.render('clock', { size: 12 })}
                  Impl: ${implementationTime}
                </div>
              ` : ''}
            </div>
            ${isSystem ? '• System Task' : ''}
            <span class="text-xs px-2 py-1 rounded font-bold uppercase ${task.status === TaskStatus.IMPLEMENTED ? 'bg-green-600 text-white' : 'bg-teal-600 text-white'}">
              ${task.status}
            </span>
          </div>
        </div>

        ${task.completion_info ? `
          <details class="group/summary bg-green-500/10 border border-green-500/20 p-3 rounded-lg text-sm text-app-text/80">
            <summary class="font-bold text-green-400 flex items-center gap-2 cursor-pointer list-none hover:text-green-300 transition-colors">
               ${Icon.render('chevronRight', { size: 16, className: 'text-green-400 transition-transform group-open/summary:rotate-90' })}
               Implementation Summary
            </summary>
            <div class="prose-theme prose-sm max-w-none text-app-text/80 marker:text-green-500 mt-2">
              ${DOMPurify.sanitize(marked.parse(task.completion_info) as string)}
            </div>
          </details>
        ` : ''}

        ${renderStatusHistorySection(task, false)}

        <div class="flex justify-end items-center gap-2" data-action-click="none">
          <button data-action-click="fail_task" data-version="${task.version}"
                  class="text-xs text-red-400 hover:text-red-300 px-3 py-1 rounded transition-all cursor-pointer">
            Mark as Failed
          </button>
          <button data-action-click="delete_task"
                  class="p-1.5 hover:bg-red-500/20 text-app-muted hover:text-red-400 rounded transition-all cursor-pointer" title="Delete Task">
            ${Icon.render('trash', { size: 16 })}
          </button>
        </div>
      </div>
    `;
  }
}
