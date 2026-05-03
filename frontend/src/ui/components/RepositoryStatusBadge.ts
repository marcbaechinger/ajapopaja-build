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

import { type GitStatus } from '../../core/domain.ts';

export class RepositoryStatusBadge {
  static render(gitStatus?: GitStatus): string {
    if (!gitStatus) return '';
    return `
      <div data-action-click="refresh_git_status" class="flex items-center gap-2 bg-app-bg px-2 py-1 rounded border border-app-border cursor-pointer transition-all hover:border-app-accent-2/50 group/git" title="Workspace Git Status (Staged, Unstaged, Untracked) - Click to Sync">
        <svg xmlns="http://www.w3.org/2000/svg" width="10pt" height="10pt" viewBox="0 0 78 78" class="opacity-70 group-hover/git:opacity-100"><path fill="currentColor" transform="translate(10 10) rotate(-45 29 29)" d="M5,58c-2.76142,0 -5,-2.23858 -5,-5v-48c0,-2.76142 2.23858,-5 5,-5h33v12.54404c-2.06553,0.94801 -3.5,3.03446 -3.5,5.45596c0,0.73514 0.13221,1.43941 0.37415,2.09031l-15.28384,15.28384c-0.6509,-0.24194 -1.35517,-0.37415 -2.09031,-0.37415c-3.31371,0 -6,2.68629 -6,6c0,3.31371 2.68629,6 6,6c3.31371,0 6,-2.68629 6,-6c0,-0.73514 -0.13221,-1.43941 -0.37415,-2.09031l14.87415,-14.87415l0,11.50851c-2.06553,0.94801 -3.5,3.03446 -3.5,5.45596c0,3.31371 2.68629,6 6,6c3.31371,0 6,-2.68629 6,-6c0,-2.42149 -1.43447,-4.50795 -3.5,-5.45596l0,-12.08808c2.06553,-0.94801 -3.5,-3.03446 -3.5,-5.45596c0,-2.42149 -1.43447,-4.50795 -3.5,-5.45596l0,-12.54404h10c2.76142,0 5,2.23858 5,5v48c0,2.76142 -2.23858,5 -5,5z"/></svg>
        <div class="flex gap-1.5 items-center text-[9px] font-bold">
          <span class="${gitStatus.staged > 0 ? 'text-green-500' : 'text-app-muted'}">${gitStatus.staged}S</span>
          <span class="${gitStatus.unstaged > 0 ? 'text-amber-500' : 'text-app-muted'}">${gitStatus.unstaged}M</span>
          <span class="${gitStatus.untracked > 0 ? 'text-app-text' : 'text-app-muted'}">${gitStatus.untracked}U</span>
        </div>
      </div>
    `;
  }
}
