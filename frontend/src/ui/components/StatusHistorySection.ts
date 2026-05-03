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

/**
 * Renders the status history section of a task card.
 * 
 * @param task The task object containing history.
 * @param expandHistory Whether the history section should be initially expanded.
 * @returns An HTML string representing the history section.
 */
export function renderStatusHistorySection(task: Task, expandHistory: boolean): string {
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
