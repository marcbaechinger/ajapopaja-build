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
 * Renders the specification section of a task card.
 * @param task The task object containing the specification.
 * @param isSpecExpanded Whether the specification section is expanded.
 * @returns An HTML string representing the specification section.
 */
export function renderSpecSection(task: Task, isSpecExpanded: boolean): string {
  const taskId = task.id;
  const isCompleted = ([TaskStatus.IMPLEMENTED, TaskStatus.DISCARDED] as any[]).includes(task.status);

  return `
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
        <div class="spec-display prose-theme prose-xs max-w-none text-app-text/70 overflow-hidden relative transition-all duration-300 ${isSpecExpanded ? 'expanded' : ''}">
          ${task.spec ? DOMPurify.sanitize(marked.parse(task.spec) as string) : '<span class="italic text-app-muted">No specification provided...</span>'}
          ${task.spec ? '<div class="expand-overlay absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-app-surface to-transparent pointer-events-none"></div>' : ''}
        </div>
      </div>
      ${task.spec ? `
        <button data-action-click="toggle_spec_expand" class="mt-2 text-[10px] text-app-accent-1 hover:underline cursor-pointer">
          ${isSpecExpanded ? 'Show Less' : 'Show More'}
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
}
