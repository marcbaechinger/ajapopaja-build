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

import { Task } from '../../core/domain.ts';
import { Icon } from './Icon.ts';

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

/**
 * Renders a single task inside the BacklogView sidebar.
 *
 * It gives a compact overview of the task (title, spec excerpt and whether a
 * design doc is available) and exposes the two main actions: starting ArchBot
 * to create/update a design doc, and starting CoderBot to implement the task.
 */
export class BacklogTaskView {
  static render(task: Task): string {
    const taskId = escapeHtml(task.id || '');
    const hasDesignDoc = !!(task.design_doc && task.design_doc.trim());
    const excerpt = task.spec ? specExcerpt(task.spec) : '';

    return `
      <div class="group rounded-lg border border-app-border bg-app-bg/60 p-3 flex flex-col gap-2 transition-colors hover:border-app-accent-1/40 hover:bg-app-bg"
           data-task-id="${taskId}">
        <div class="flex items-start justify-between gap-2">
          <span class="text-[11px] font-bold text-app-text leading-snug break-words">${escapeHtml(task.title || '')}</span>
          ${hasDesignDoc ? `
            <span class="flex-none text-[9px] font-black uppercase tracking-widest text-purple-400 bg-purple-500/15 border border-purple-500/30 rounded-full px-1.5 py-0.5" title="Design doc available">Design</span>
          ` : ''}
        </div>
        ${excerpt ? `
          <p class="text-[10px] text-app-muted leading-snug line-clamp-3">${escapeHtml(excerpt)}</p>
        ` : `<p class="text-[10px] text-app-muted italic line-clamp-2">No specification yet.</p>`}
        <div class="flex items-center gap-1.5 pt-0.5">
          <button data-action-click="trigger_archbot" data-task-id="${taskId}"
                  class="flex-1 inline-flex items-center justify-center gap-1 text-[9px] font-bold uppercase tracking-widest bg-purple-500/15 hover:bg-purple-500/30 text-purple-300 border border-purple-500/30 rounded-md px-1.5 py-1 transition-colors cursor-pointer"
                  title="Design (ArchBot)">
            ${Icon.render('architecture', { size: 10 })}
            <span class="leading-none">Design</span>
          </button>
          <button data-action-click="trigger_coderbot" data-task-id="${taskId}"
                  class="flex-1 inline-flex items-center justify-center gap-1 text-[9px] font-bold uppercase tracking-widest bg-green-500/15 hover:bg-green-500/30 text-green-300 border border-green-500/30 rounded-md px-1.5 py-1 transition-colors cursor-pointer"
                  title="Implement (CoderBot)">
            ${Icon.render('lightning', { size: 10 })}
            <span class="leading-none">Implement</span>
          </button>
        </div>
      </div>
    `;
  }
}
