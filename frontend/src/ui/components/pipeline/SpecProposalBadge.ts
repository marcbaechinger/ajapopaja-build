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

import { Task } from '../../../core/domain.ts';
import type { SpecProposal } from '../../../core/clients/SpecBotClient.ts';
import { Icon } from '../common/Icon.ts';

/**
 * Header badge listing outstanding SpecAgent proposals for the current
 * pipeline. Driven by the durable reconciliation fetch, so a proposal that
 * finished while the user was on another page is still visible on return (and
 * after a reload).
 */
export class SpecProposalBadge {
  static render(proposals: SpecProposal[] | undefined, allTasks: Task[]): string {
    if (!proposals || proposals.length === 0) return '';

    const titleFor = (taskId: string): string => {
      const task = allTasks.find((t) => t.id === taskId);
      return task ? task.title : `Task ${taskId.substring(0, 6)}...`;
    };

    if (proposals.length === 1) {
      const proposal = proposals[0];
      const title = titleFor(proposal.task_id);
      return `
        <div class="inline-flex bg-teal-500/10 border border-teal-500/30 text-teal-400 rounded-full px-3 py-1 text-[10px] shadow-sm items-center gap-2">
          <span class="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse"></span>
          <span class="font-bold uppercase tracking-wider truncate max-w-[150px]" title="${title}">Spec ready: ${title}</span>
          <button data-action-click="open_spec_proposal" data-task-id="${proposal.task_id}" class="font-black underline hover:text-teal-300 transition-colors cursor-pointer ml-1">Review</button>
        </div>
      `;
    }

    const oldest = proposals[0];
    let dropdownHtml = '';
    for (let i = 1; i < proposals.length; i++) {
      const proposal = proposals[i];
      const title = titleFor(proposal.task_id);
      dropdownHtml += `
        <button data-action-click="open_spec_proposal" data-task-id="${proposal.task_id}" class="block w-full text-left px-4 py-2 text-[11px] font-medium text-app-text hover:bg-app-bg transition-colors truncate border-b border-app-border last:border-b-0" title="${title}">
          ${title}
        </button>
      `;
    }

    return `
      <div class="relative group/specdropdown inline-flex">
        <div class="inline-flex bg-teal-500/10 border border-teal-500/30 text-teal-400 rounded-full px-3 py-1 text-[10px] shadow-sm items-center gap-2 cursor-pointer group-hover/specdropdown:rounded-b-none group-hover/specdropdown:border-b-transparent relative z-10">
          <span class="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse"></span>
          <span class="font-bold uppercase tracking-wider">${proposals.length} Specs Ready</span>
          <button data-action-click="open_spec_proposal" data-task-id="${oldest.task_id}" class="font-black underline hover:text-teal-300 transition-colors cursor-pointer ml-1 pl-2 border-l border-teal-500/30">Review Oldest</button>
          ${Icon.render('chevronDown', { size: 12, className: 'transform group-hover/specdropdown:rotate-180 transition-transform' })}
        </div>
        <div class="absolute top-full left-0 right-0 hidden group-hover/specdropdown:flex flex-col bg-app-surface border border-teal-500/30 rounded-b-lg shadow-xl z-50 overflow-hidden min-w-[200px]">
          <div class="bg-app-bg/50 px-3 py-1.5 border-b border-app-border text-[9px] font-black tracking-widest text-app-muted uppercase">Other pending specs</div>
          <div class="py-1 max-h-48 overflow-y-auto">
            ${dropdownHtml}
          </div>
        </div>
      </div>
    `;
  }
}
