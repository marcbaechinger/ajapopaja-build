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

import { PullRequest, PullRequestStatus } from '../../core/domain.ts';
import { Icon } from './Icon.ts';

export class PullRequestSection {
  static render(prs: PullRequest[]): string {
    const openPrs = prs.filter(pr => pr.status === PullRequestStatus.OPEN)
      .sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime());

    if (openPrs.length === 0) return '';

    return `
      <section class="mb-10 bg-app-accent-2/5 border border-app-accent-2/20 rounded-3xl p-6 shadow-sm">
        <div class="flex items-center justify-between mb-6 px-1">
          <div class="flex items-center gap-3">
             <div class="p-2 bg-app-accent-2/20 rounded-xl text-app-accent-2">
                ${Icon.render('git-pull-request', { size: 18 })}
             </div>
             <div>
                <h3 class="text-lg font-black text-app-accent-2 tracking-tight">Pull Requests</h3>
                <p class="text-[10px] font-bold text-app-muted uppercase tracking-widest">Awaiting Review</p>
             </div>
          </div>
          <span class="bg-app-accent-2/20 text-app-accent-2 text-[10px] font-black px-2.5 py-1 rounded-full border border-app-accent-2/30 shadow-sm">${openPrs.length}</span>
        </div>
        
        <div class="space-y-4">
          ${openPrs.map(pr => this.renderPr(pr)).join('')}
        </div>
      </section>
    `;
  }

  private static renderPr(pr: PullRequest): string {
    return `
      <div class="bg-app-surface border border-app-border rounded-2xl p-4 shadow-sm group hover:border-app-accent-2/40 transition-all duration-300">
        <div class="flex justify-between items-start gap-4">
          <div class="flex-grow min-w-0">
            <h4 class="font-bold text-app-text mb-1 truncate">${pr.summary}</h4>
            <p class="text-[10px] text-app-muted font-mono bg-app-bg px-2 py-0.5 rounded inline-block border border-app-border/50">
              branch: ${pr.branch_name}
            </p>
          </div>
          <div class="flex gap-2 shrink-0">
             <button data-action-click="open_pr_dialog" data-task-id="${pr.task_id}" class="px-4 py-2 bg-app-accent-2 text-white text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-app-accent-2/80 transition-all shadow-lg shadow-app-accent-2/20 cursor-pointer flex items-center gap-2">
               ${Icon.render('git-pull-request', { size: 14 })}
               Review
             </button>
          </div>
        </div>
      </div>
    `;
  }
}
