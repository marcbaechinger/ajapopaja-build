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

export class TaskItem {
  private static renderHistory(task: Task, expandHistory: boolean): string {
    if (!task.history || task.history.length === 0) return '';

    return `
      <details class="group/history mt-4 pt-4 border-t border-app-border/30" ${expandHistory ? 'open' : ''}>
        <summary class="flex items-center gap-2 cursor-pointer list-none text-[10px] font-bold text-app-muted uppercase tracking-widest mb-2 hover:text-app-text transition-colors">
          <svg class="w-3 h-3 transition-transform group-open/history:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
          Status History
        </summary>
        <div class="space-y-2 mt-2">
          ${task.history.map(t => `
            <div class="flex items-center gap-2 text-[10px]">
              <span class="text-app-muted w-24">${new Date(t.timestamp).toLocaleString()}</span>
              <span class="px-1.5 py-0.5 rounded bg-app-surface border border-app-border font-mono text-app-accent-1">${t.to_status}</span>
              <span class="text-app-muted">by</span>
              <span class="font-bold text-app-text/80 italic">${t.by}</span>
            </div>
          `).join('')}
        </div>
      </details>
    `;
  }

  private static calculateDuration(task: Task): string | null {
    if (!task.history || task.history.length === 0) return null;

    // Use the last INPROGRESS entry as the start of the current/final implementation attempt
    const inProgressEntries = task.history.filter(t => t.to_status === TaskStatus.INPROGRESS);
    if (inProgressEntries.length === 0) return null;
    const inProgressEntry = inProgressEntries[inProgressEntries.length - 1];

    const implementedEntry = task.history.find(t => t.to_status === TaskStatus.IMPLEMENTED);

    if (!inProgressEntry || !implementedEntry) return null;

    const start = new Date(inProgressEntry.timestamp).getTime();
    const end = new Date(implementedEntry.timestamp).getTime();
    const durationMs = end - start;

    return this.formatMs(durationMs);
  }

  private static calculateDesignDuration(task: Task): string | null {
    if (!task.history || task.history.length === 0) return null;

    const proposedEntry = task.history.find(t => t.to_status === TaskStatus.PROPOSED);
    if (!proposedEntry) return null;

    const inProgressEntriesBeforeProposed = task.history.filter(t => 
      t.to_status === TaskStatus.INPROGRESS && 
      new Date(t.timestamp).getTime() < new Date(proposedEntry.timestamp).getTime()
    );

    if (inProgressEntriesBeforeProposed.length === 0) return null;
    const designStartEntry = inProgressEntriesBeforeProposed[0];

    const start = new Date(designStartEntry.timestamp).getTime();
    const end = new Date(proposedEntry.timestamp).getTime();
    const durationMs = end - start;

    return this.formatMs(durationMs);
  }

  private static formatMs(durationMs: number): string | null {
    if (durationMs < 0) return null;

    const seconds = Math.floor((durationMs / 1000) % 60);
    const minutes = Math.floor((durationMs / (1000 * 60)) % 60);
    const hours = Math.floor(durationMs / (1000 * 60 * 60));

    const parts = [];
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

    return parts.join(' ');
  }

  static render(task: Task, showOrdering: boolean = true, expandHistory: boolean = false, isCollapsed: boolean = false): string {
    const taskId = task.id;
    const statusColors: Record<string, string> = {
      [TaskStatus.CREATED]: 'bg-slate-600 text-slate-300',
      [TaskStatus.SCHEDULED]: 'bg-blue-600 text-white animate-pulse',
      [TaskStatus.PROPOSED]: 'bg-purple-600 text-white',
      [TaskStatus.INPROGRESS]: 'bg-amber-600 text-white',
      [TaskStatus.IMPLEMENTED]: 'bg-green-600 text-white',
      [TaskStatus.FAILED]: 'bg-red-600 text-white',
      [TaskStatus.DISCARDED]: 'bg-slate-800 text-slate-500'
    };

    const isProposed = task.status === TaskStatus.PROPOSED;
    const canSchedule = task.status === TaskStatus.CREATED;
    const canUnschedule = task.status === TaskStatus.SCHEDULED;
    const canFail = ([TaskStatus.INPROGRESS, TaskStatus.IMPLEMENTED] as any[]).includes(task.status);
    const isSystem = task.type === 'system';
    const isInProgress = task.status === TaskStatus.INPROGRESS;

    const isImplemented = task.status === TaskStatus.IMPLEMENTED;
    const isDiscarded = task.status === TaskStatus.DISCARDED;
    const isCompleted = ([TaskStatus.IMPLEMENTED, TaskStatus.DISCARDED] as any[]).includes(task.status);

    const isEditableTitle = ([TaskStatus.CREATED, TaskStatus.PROPOSED] as any[]).includes(task.status);

    const specHtml = `
      <div class="spec-container w-full text-xs bg-app-surface p-3 rounded-lg border border-app-border transition-all"
           data-task-id="${taskId}" data-version="${task.version}">
        <div class="spec-view ${isCompleted ? '' : 'cursor-pointer group'}" ${isCompleted ? '' : 'data-action-click="edit_spec"'}>
          <div class="flex justify-between items-center mb-1">
            <span class="font-bold text-app-muted">Specification</span>
            <div class="flex items-center gap-2">
              ${task.want_design_doc ? '<span class="text-[9px] bg-purple-500/20 text-purple-400 border border-purple-500/30 px-1.5 py-0.5 rounded font-bold uppercase tracking-tighter">Wants Design Doc</span>' : ''}
              ${isCompleted ? '' : '<span class="text-[10px] text-app-muted opacity-0 group-hover:opacity-100 transition-opacity">Click to edit</span>'}
            </div>
          </div>
          <div class="spec-display prose prose-invert prose-xs max-w-none text-app-text/70 overflow-hidden relative transition-all duration-300">
            ${task.spec ? DOMPurify.sanitize(marked.parse(task.spec) as string) : '<span class="italic text-app-muted">No specification provided...</span>'}
            ${task.spec ? '<div class="expand-overlay absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-app-surface to-transparent pointer-events-none"></div>' : ''}
          </div>
        </div>
        ${task.spec ? `
          <button data-action-click="toggle_spec_expand" class="mt-2 text-[10px] text-app-accent-1 hover:underline cursor-pointer">
            Show More
          </button>
        ` : ''}
        
        <div class="spec-edit hidden flex flex-col gap-3">
          <span class="font-bold text-app-muted mb-1">Editing Specification</span>
          <div class="flex items-center gap-2 mb-2">
            <input type="checkbox" id="edit-want-design-doc-${taskId}" class="w-4 h-4 rounded border-app-border bg-app-bg text-app-accent-1 focus:ring-app-accent-1" ${task.want_design_doc ? 'checked' : ''}>
            <label for="edit-want-design-doc-${taskId}" class="text-xs text-app-text cursor-pointer">Require Design Doc Approval</label>
          </div>
          <textarea class="w-full bg-app-bg border border-app-border rounded p-2 text-app-text outline-none focus:ring-1 focus:ring-app-accent-1 min-h-[100px]" 
                    placeholder="Provide a detailed specification for the agent...">${task.spec || ''}</textarea>
          <div class="flex gap-2 justify-end">
            <button data-action-click="cancel_spec_edit" class="px-3 py-1 text-app-muted hover:text-app-text transition-colors cursor-pointer">
              Cancel
            </button>
            <button data-action-click="save_spec" class="px-4 py-1 bg-app-accent-1 text-white rounded hover:brightness-110 transition-all shadow-md cursor-pointer">
              Save Specification
            </button>
          </div>
        </div>
      </div>
    `;

    const designDocHtml = `
        <div class="design-doc-container w-full text-xs bg-app-surface p-3 rounded-lg border border-app-border transition-all ${isProposed ? 'ring-2 ring-purple-500/50 bg-purple-500/5' : ''}"
             data-task-id="${taskId}" data-version="${task.version}">
          <div class="design-doc-view cursor-pointer group" data-action-click="${(isImplemented || isDiscarded) ? 'view_design_doc' : 'edit_design_doc'}">
            <div class="flex justify-between items-center mb-1">
              <span class="font-bold text-app-accent-2">${isProposed ? 'Proposed Design' : 'Design Document'}</span>
              ${(isImplemented || isDiscarded) ? '<span class="text-[10px] text-app-accent-1 opacity-0 group-hover:opacity-100 transition-opacity ml-2">Click to view</span>' : ''}
              ${(isImplemented || isDiscarded) ? '' : '<span class="text-[10px] text-app-muted opacity-0 group-hover:opacity-100 transition-opacity">Click to edit</span>'}
            </div>
            <div class="design-doc-display prose prose-invert prose-sm max-w-none text-app-text/70 overflow-hidden relative transition-all duration-300 ${isProposed ? 'expanded' : ''}">
              ${task.design_doc ? DOMPurify.sanitize(marked.parse(task.design_doc) as string) : '<span class="italic text-app-muted">Click to add design doc...</span>'}
              ${task.design_doc ? '<div class="expand-overlay absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-app-surface to-transparent pointer-events-none"></div>' : ''}
            </div>
          </div>
          ${task.design_doc ? `
            <button data-action-click="toggle_design_doc_expand" class="mt-2 text-[10px] text-app-accent-2 hover:underline cursor-pointer">
              ${isProposed ? 'Show Less' : 'Show More'}
            </button>
          ` : ''}
          
          <div class="design-doc-edit hidden flex flex-col gap-2">
            <span class="font-bold text-app-accent-2 mb-1">Editing Design Document</span>
            <textarea class="w-full bg-app-bg border border-app-border rounded p-2 text-app-text outline-none focus:ring-1 focus:ring-app-accent-2 min-h-[120px]" 
                      placeholder="Describe the implementation details...">${task.design_doc || ''}</textarea>
            <div class="flex gap-2 justify-between items-center">
              <button data-action-click="toggle_edit_design_doc_expand" class="text-[10px] text-app-accent-2 hover:underline cursor-pointer">
                Show More
              </button>
              <div class="flex gap-2">
                <button data-action-click="cancel_design_doc" class="px-3 py-1 text-app-muted hover:text-app-text transition-colors cursor-pointer">
                  Cancel
                </button>
                <button data-action-click="save_design_doc" class="px-4 py-1 bg-app-accent-2 text-white rounded hover:brightness-110 transition-all shadow-md cursor-pointer">
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
    `;

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
              <span class="text-xs text-app-muted">Order: ${task.order} ${isSystem ? '• System Task' : ''}</span>
            </div>
          </div>
          <span class="text-xs px-2 py-1 rounded font-bold uppercase ${statusColors[task.status] || 'bg-slate-600'}">
            ${task.status}
          </span>
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
                  <div class="text-[10px] font-mono text-app-accent-2 bg-app-surface px-2 py-0.5 rounded border border-app-border" title="Commit Hash">
                    ${task.commit_hash.substring(0, 7)}
                  </div>
                  ${isImplemented && this.calculateDuration(task) ? `
                    <div class="text-[10px] text-app-muted flex items-center gap-1" title="Implementation Duration">
                      <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                      Impl: ${this.calculateDuration(task)}
                    </div>
                  ` : ''}
                  ${this.calculateDesignDuration(task) ? `
                    <div class="text-[10px] text-app-muted flex items-center gap-1" title="Design Duration">
                      <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>
                      Design: ${this.calculateDesignDuration(task)}
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
              <div class="prose prose-invert prose-sm max-w-none text-app-text/80 marker:text-green-500">
                ${DOMPurify.sanitize(marked.parse(task.completion_info) as string)}
              </div>
            </div>
          ` : ''}

          ${this.renderHistory(task, expandHistory)}

          ${specHtml}

          ${designDocHtml}
        </div>

      </div>
    `;
  }
}
