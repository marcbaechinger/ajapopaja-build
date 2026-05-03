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

export class ReviewNotificationBadge {
  static render(pendingReviewTaskIds: string[], allTasks: Task[]): string {
    if (!pendingReviewTaskIds || pendingReviewTaskIds.length === 0) {
      return '';
    }

    if (pendingReviewTaskIds.length === 1) {
      const taskId = pendingReviewTaskIds[0];
      const task = allTasks.find(t => t.id === taskId);
      const title = task ? task.title : 'Task';
      return `
        <div class="inline-flex bg-app-accent-2/10 border border-app-accent-2/30 text-app-accent-2 rounded-full px-3 py-1 text-[10px] shadow-sm items-center gap-2">
          <span class="w-1.5 h-1.5 rounded-full bg-app-accent-2 animate-pulse"></span>
          <span class="font-bold uppercase tracking-wider truncate max-w-[150px]" title="${title}">Review: ${title}</span>
          <button data-action-click="open_review_dialog" data-task-id="${taskId}" class="font-black underline hover:text-app-accent-2/80 transition-colors cursor-pointer ml-1">Open</button>
        </div>
      `;
    }

    // Multiple reviews
    const oldestTaskId = pendingReviewTaskIds[0];
    
    let dropdownHtml = '';
    for (let i = 1; i < pendingReviewTaskIds.length; i++) {
        const taskId = pendingReviewTaskIds[i];
        const task = allTasks.find(t => t.id === taskId);
        const title = task ? task.title : `Task ${taskId.substring(0,6)}...`;
        dropdownHtml += `
            <button data-action-click="open_review_dialog" data-task-id="${taskId}" class="block w-full text-left px-4 py-2 text-[11px] font-medium text-app-text hover:bg-app-bg transition-colors truncate border-b border-app-border last:border-b-0" title="${title}">
                ${title}
            </button>
        `;
    }

    return `
      <div class="relative group/reviewdropdown inline-flex">
        <div class="inline-flex bg-app-accent-2/10 border border-app-accent-2/30 text-app-accent-2 rounded-full px-3 py-1 text-[10px] shadow-sm items-center gap-2 cursor-pointer group-hover/reviewdropdown:rounded-b-none group-hover/reviewdropdown:border-b-transparent relative z-10">
          <span class="w-1.5 h-1.5 rounded-full bg-app-accent-2 animate-pulse"></span>
          <span class="font-bold uppercase tracking-wider">${pendingReviewTaskIds.length} Reviews Ready</span>
          <button data-action-click="open_review_dialog" data-task-id="${oldestTaskId}" class="font-black underline hover:text-app-accent-2/80 transition-colors cursor-pointer ml-1 pl-2 border-l border-app-accent-2/30">Open Oldest</button>
          <svg class="w-3 h-3 transform group-hover/reviewdropdown:rotate-180 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>
        </div>
        <div class="absolute top-full left-0 right-0 hidden group-hover/reviewdropdown:flex flex-col bg-app-surface border border-app-accent-2/30 rounded-b-lg shadow-xl z-50 overflow-hidden min-w-[200px]">
           <div class="bg-app-bg/50 px-3 py-1.5 border-b border-app-border text-[9px] font-black tracking-widest text-app-muted uppercase">Other pending reviews</div>
           <div class="py-1 max-h-48 overflow-y-auto">
             ${dropdownHtml}
           </div>
        </div>
      </div>
    `;
  }
}
