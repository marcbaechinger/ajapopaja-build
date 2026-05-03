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
import { calculateDuration, calculateDesignDuration } from './utils/duration.ts';
import { renderStatusHistorySection } from './StatusHistorySection.ts';
import { renderSpecSection } from './SpecSection.ts';
import { renderDesignDocSection } from './DesignDocSection.ts';

export class TaskItem {
  static render(
    task: Task,
    showOrdering: boolean = true,
    expandHistory: boolean = false,
    isCollapsed: boolean = false,
    showStatusSelector: boolean = false,
    isSpecExpanded: boolean = false
  ): string {
    const taskId = task.id;
    const statusColors: Record<string, string> = {
      [TaskStatus.CREATED]: 'bg-slate-600 text-slate-300',
      [TaskStatus.SCHEDULED]: 'bg-blue-600 text-white animate-pulse',
      [TaskStatus.PROPOSED]: 'bg-purple-600 text-white',
      [TaskStatus.INPROGRESS]: 'bg-amber-600 text-white',
      [TaskStatus.IMPLEMENTED]: 'bg-green-600 text-white',
      [TaskStatus.FAILED]: 'bg-red-600 text-white',
      [TaskStatus.DISCARDED]: 'bg-slate-800 text-slate-500',
    };

    const isProposed = task.status === TaskStatus.PROPOSED;
    const canSchedule = task.status === TaskStatus.CREATED;
    const canUnschedule = task.status === TaskStatus.SCHEDULED;
    const canFail = ([TaskStatus.INPROGRESS, TaskStatus.IMPLEMENTED] as any[]).includes(task.status);
    const isSystem = task.type === 'system';
    const isInProgress = task.status === TaskStatus.INPROGRESS;

    const isImplemented = task.status === TaskStatus.IMPLEMENTED;
    const isCompleted = ([TaskStatus.IMPLEMENTED, TaskStatus.DISCARDED] as any[]).includes(task.status);

    const isEditableTitle = ([TaskStatus.CREATED, TaskStatus.PROPOSED] as any[]).includes(task.status);

    const specHtml = renderSpecSection(task, isSpecExpanded);
    const designDocHtml = renderDesignDocSection(task, isProposed);

    return `
      <div class="bg-app-bg p-4 rounded-lg border border-app-border flex flex-col gap-3 transition-all hover:border-app-accent-1/30 ${isSystem ? 'border-l-4 border-l-red-500' : ''} ${isProposed ? 'border-purple-500/50 shadow-lg shadow-purple-500/10' : ''}" 
           data-view-type="task" data-view-id="${taskId}">
        <div class="flex justify-between items-start cursor-pointer group/header" data-action-click="toggle_task_collapse">
          <div class="flex items-center gap-3">
            <div class="p-1 text-app-muted group-hover/header:text-app-text transition-all">
              <svg class="w-4 h-4 transform transition-transform ${isCollapsed ? '' : 'rotate-90'}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path>
              </svg>
            </div>
            <div class="title-container flex flex-col" data-task-id="${taskId}" data-version="${task.version}">
              <div class="title-view flex items-center gap-2 ${isEditableTitle ? 'cursor-pointer group/title' : ''}" 
                   ${isEditableTitle ? 'data-action-click="edit_title"' : ''}>
                <span class="font-medium text-app-text text-lg">${task.title}</span>
                ${isEditableTitle ? '<svg class="w-3 h-3 text-app-muted opacity-0 group-hover/title:opacity-100 transition-opacity" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>' : ''}
              </div>
              ${isEditableTitle ? `
                <div class="title-edit hidden flex flex-col gap-2 mt-1">
                  <input type="text" class="w-full bg-app-bg border border-app-border rounded px-2 py-1 text-lg text-app-text outline-none focus:ring-1 focus:ring-app-accent-1" 
                         value="${task.title.replace(/"/g, '&quot;')}" placeholder="Task title">
                  <div class="flex gap-2 justify-end">
                    <button data-action-click="cancel_title_edit" class="text-[10px] text-app-muted hover:text-app-text px-2 py-1 cursor-pointer">Cancel</button>
                    <button data-action-click="save_title" class="text-[10px] bg-app-accent-1 text-white px-3 py-1 rounded hover:brightness-110 cursor-pointer">Save</button>
                  </div>
                </div>
              ` : ''}
              <div class="flex items-center gap-2 mt-1" data-task-id="${taskId}">
                <span class="text-[10px] text-app-muted uppercase font-bold tracking-widest bg-app-surface px-2 py-0.5 rounded border border-app-border">${taskId}</span>
                <button data-action-click="copy_task_id" class="p-1 hover:bg-app-surface text-app-muted hover:text-app-accent-2 rounded transition-all cursor-pointer group/copy" title="Copy Task ID">
                   <svg class="w-3 h-3 group-hover/copy:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg>
                </button>
                ${isImplemented ? `
                  <button data-action-click="trigger_docbot" data-task-id="${taskId}" class="p-1 hover:bg-app-surface text-app-muted hover:text-green-600 rounded transition-all cursor-pointer group/docbot" title="Trigger DocBot (needs Ollama)">
                     <svg class="w-3 h-3 group-hover/docbot:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                     </svg>
                  </button>
                ` : ''}
                ${isImplemented && task.commit_hash ? `
                  <button data-action-click="open_quickfix" data-task-id="${taskId}" class="p-1 hover:bg-app-surface text-app-muted hover:text-app-accent-2 rounded transition-all cursor-pointer group/quickfix" title="Open Quickfix in Neovim">
                     <svg class="w-3.5 h-3.5 group-hover/quickfix:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M4 14h16M4 18h16"></path>
                     </svg>
                  </button>
                ` : ''}
                ${isImplemented ? (
                  task.review_md 
                    ? `
                      <button data-action-click="open_review_dialog" data-task-id="${taskId}" class="p-1 hover:bg-app-surface text-app-accent-2 hover:text-app-accent-2/80 rounded transition-all cursor-pointer group/review relative" title="View Technical Review">
                        <svg class="w-3 h-3 group-hover/review:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                        <span class="absolute -top-1 -right-1 flex h-1.5 w-1.5">
                          <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-app-accent-2 opacity-75"></span>
                          <span class="relative inline-flex rounded-full h-1.5 w-1.5 bg-app-accent-2"></span>
                        </span>
                      </button>
                    `
                    : `
                      <button data-action-click="trigger_reviewbot" data-task-id="${taskId}" class="p-1 hover:bg-app-surface text-app-muted hover:text-app-accent-2 rounded transition-all cursor-pointer group/review" title="Trigger Technical Review">
                        <svg class="w-3 h-3 group-hover/review:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"></path></svg>
                      </button>
                    `
                ) : ''}
                ${isImplemented ? '' : `
                  <span class="text-[10px] text-app-muted font-bold uppercase tracking-wider ml-1">Order: ${task.order} ${isSystem ? '• System Task' : ''}</span>
                `}
              </div>
            </div>
          </div>
          <div class="flex items-center gap-2" data-action-click="none">
            <span class="text-xs px-2 py-1 rounded font-bold uppercase ${statusColors[task.status] || 'bg-slate-600'}">
              ${task.status}
            </span>
            ${showStatusSelector ? `
              <select data-action-change="change_task_status" data-task-id="${taskId}" data-version="${task.version}"
                      class="bg-app-surface border border-app-border text-[10px] font-bold uppercase tracking-widest text-app-text px-2 py-1 rounded outline-none focus:ring-1 focus:ring-app-accent-1 cursor-pointer">
                ${Object.values(TaskStatus).map(s => `
                  <option value="${s}" ${task.status === s ? 'selected' : ''}>${s}</option>
                `).join('')}
              </select>
            ` : ''}
          </div>
        </div>
        
        <div class="task-body flex flex-col gap-3 ${isCollapsed ? 'hidden' : ''}">
          <div class="flex justify-between items-center mt-2">
            <div class="flex gap-3 items-center">
              ${showOrdering ? `
              <div class="flex gap-1">
                <button data-action-click="move_task_up" data-version="${task.version}" data-order="${task.order}"
                        ${isInProgress || isProposed ? 'disabled' : ''}
                        class="p-1 hover:bg-app-surface rounded text-app-muted hover:text-app-accent-1 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed" title="Move Up">
                  &uarr;
                </button>
                <button data-action-click="move_task_down" data-version="${task.version}" data-order="${task.order}"
                        ${isInProgress || isProposed ? 'disabled' : ''}
                        class="p-1 hover:bg-app-surface rounded text-app-muted hover:text-app-accent-1 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed" title="Move Down">
                  &darr;
                </button>
              </div>
              ` : ''}
              
              ${task.commit_hash ? `
                <div class="flex items-center gap-2">
                  <button data-action-click="open_diff_view" data-commit-hash="${task.commit_hash}"
                          class="text-[10px] font-mono text-app-accent-2 bg-app-surface px-2 py-0.5 rounded border border-app-border hover:bg-app-accent-2/10 hover:border-app-accent-2/50 transition-all cursor-pointer" 
                          title="Open Diff View in Neovim">
                    ${task.commit_hash.substring(0, 7)}
                  </button>
                  ${isImplemented && calculateDuration(task) ? `
                    <div class="text-[10px] text-app-muted flex items-center gap-1" title="Implementation Duration">
                      <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                      Impl: ${calculateDuration(task)}
                    </div>
                  ` : ''}
                  ${calculateDesignDuration(task) ? `
                    <div class="text-[10px] text-app-muted flex items-center gap-1" title="Design Duration">
                      <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                      Design: ${calculateDesignDuration(task)}
                    </div>
                  ` : ''}
                </div>
              ` : ''}
            </div>

            <div class="flex gap-2">
              ${isProposed ? `
                <button data-action-click="reject_design" data-version="${task.version}" 
                        class="text-xs bg-slate-700 hover:bg-red-900/40 text-slate-300 hover:text-red-400 border border-app-border px-4 py-1.5 rounded-lg transition-all cursor-pointer font-bold">
                  Reject Design
                </button>
                <button data-action-click="accept_design" data-version="${task.version}" 
                        class="text-xs bg-green-600 hover:bg-green-500 text-white px-5 py-1.5 rounded-lg transition-all shadow-lg shadow-green-900/20 cursor-pointer font-black uppercase tracking-tight">
                  Accept Design
                </button>
              ` : `
                <button data-action-click="delete_task" 
                        class="p-1.5 hover:bg-red-500/20 text-app-muted hover:text-red-400 rounded transition-all cursor-pointer" title="Delete Task">
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                </button>
                ${canFail ? `
                  <button data-action-click="fail_task" data-version="${task.version}" 
                          class="text-xs text-red-400 hover:text-red-300 px-3 py-1 rounded transition-all cursor-pointer">
                    Mark as Failed
                  </button>
                ` : ''}
                ${canSchedule ? `
                  <button data-action-click="schedule_task" data-version="${task.version}" 
                          class="text-xs bg-app-accent-1 hover:brightness-110 text-white px-3 py-1 rounded transition-all shadow-lg cursor-pointer">
                    Schedule Execution
                  </button>
                ` : ''}
                ${canUnschedule ? `
                  <button data-action-click="unschedule_task" data-version="${task.version}" 
                          class="text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 px-3 py-1 rounded transition-all shadow-lg cursor-pointer">
                    Cancel Schedule
                  </button>
                ` : ''}
                ${isInProgress ? `
                  <button data-action-click="cancel_progress" data-version="${task.version}" 
                          class="text-xs bg-slate-700 hover:bg-slate-600 text-slate-200 px-3 py-1 rounded transition-all shadow-lg cursor-pointer">
                    Cancel Progress
                  </button>
                ` : ''}
              `}
            </div>
          </div>
          ${task.description ? `<p class="text-sm text-app-text/70">${task.description}</p>` : ''}
          
          ${task.completion_info ? `
            <div class="bg-green-500/10 border border-green-500/20 p-3 rounded-lg text-sm text-app-text/80">
              <div class="font-bold text-green-400 mb-1 flex items-center gap-2">
                 <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>
                 Implementation Summary
              </div>
              <div class="prose-theme prose-sm max-w-none text-app-text/80 marker:text-green-500">
                ${DOMPurify.sanitize(marked.parse(task.completion_info) as string)}
              </div>
            </div>
          ` : ''}

          ${renderStatusHistorySection(task, expandHistory)}

          ${specHtml}

          ${designDocHtml}
        </div>

      </div>
    `;
  }
}
