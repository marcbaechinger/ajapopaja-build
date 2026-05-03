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

/**
 * Renders the design document section of a task card.
 * 
 * @param task The task object containing the design document.
 * @param isProposed Whether the design is currently in a proposed state.
 * @returns An HTML string representing the design document section.
 */
export function renderDesignDocSection(task: Task, isProposed: boolean): string {
  const taskId = task.id;
  const isImplemented = task.status === TaskStatus.IMPLEMENTED;
  const isDiscarded = task.status === TaskStatus.DISCARDED;
  const canTriggerArchBot = task.status === TaskStatus.CREATED && !task.design_doc;

  return `
    <div class="design-doc-container w-full text-xs bg-app-surface p-3 rounded-lg border border-app-border transition-all ${isProposed ? 'ring-2 ring-purple-500/50 bg-purple-500/5' : ''}"
         data-task-id="${taskId}" data-version="${task.version}">
      <div class="design-doc-view group">
        <div class="flex justify-between items-center mb-1">
          <span class="font-bold text-app-accent-2">${isProposed ? 'Proposed Design' : 'Design Document'}</span>
          <div class="flex items-center gap-2">
            ${canTriggerArchBot ? `
              <button data-action-click="trigger_archbot" data-task-id="${taskId}" 
                      ${!task.spec ? 'disabled title="Please create a spec first"' : 'title="Generate design document with ArchitectureBot"'}
                      class="text-[10px] bg-purple-600/20 hover:bg-purple-600/40 text-purple-300 border border-purple-500/30 px-2 py-0.5 rounded font-bold uppercase tracking-tight transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                <span class="flex items-center gap-1">
                  <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path></svg>
                  Auto-Design
                </span>
              </button>
            ` : ''}
            ${(isImplemented || isDiscarded) ? `<button data-action-click="view_design_doc" class="text-[10px] text-app-accent-1 opacity-0 group-hover:opacity-100 transition-opacity hover:underline cursor-pointer">Open to view</button>` : ''}
            ${(isImplemented || isDiscarded) ? '' : `<button data-action-click="edit_design_doc" class="text-[10px] text-app-muted opacity-0 group-hover:opacity-100 transition-opacity hover:underline cursor-pointer">Click to edit</button>`}
            <button data-action-click="toggle_design_doc_expand" class="text-[10px] text-app-accent-2 hover:underline cursor-pointer">
              ${isProposed ? 'Show Less' : 'Show More'}
            </button>
          </div>
        </div>
        <div class="design-doc-display prose-theme prose-sm max-w-none text-app-text/70 overflow-hidden relative transition-all duration-300 ${isProposed ? 'expanded' : ''}">
          ${task.design_doc ? DOMPurify.sanitize(marked.parse(task.design_doc) as string) : `<span class="italic text-app-muted cursor-pointer" data-action-click="edit_design_doc">Click to add design doc...</span>`}
          ${task.design_doc ? '<div class="expand-overlay absolute bottom-0 left-0 right-0 h-12 bg-gradient-to-t from-app-surface to-transparent pointer-events-none"></div>' : ''}
        </div>
      </div>
      ${task.design_doc ? `
        <div class="design-doc-actions flex items-center gap-3 mt-2">
          <button data-action-click="copy_design_doc" class="flex items-center gap-1 text-[10px] text-app-muted hover:text-app-text transition-colors cursor-pointer" title="Copy markdown to clipboard">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            Copy
          </button>
          <button data-action-click="view_design_doc_history" class="flex items-center gap-1 text-[10px] text-app-muted hover:text-app-text transition-colors cursor-pointer" title="View version history">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
            History
          </button>
        </div>
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
}
