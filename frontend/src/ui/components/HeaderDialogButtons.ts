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

export class HeaderDialogButtons {
  static render(pipelineId: string): string {
    return `
      <div class="flex items-center gap-2">
         <button data-action-click="open_search" data-pipeline-id="${pipelineId}" class="p-2 bg-app-bg hover:bg-app-surface rounded-xl border border-app-border text-app-muted hover:text-app-accent-2 transition-all cursor-pointer group" title="Global Search (Ctrl+K)">
           <svg class="w-4 h-4 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
         </button>
         <button data-action-click="toggle_assistant" class="p-2 bg-app-bg hover:bg-app-surface rounded-xl border border-app-border text-app-muted hover:text-app-accent-2 transition-all cursor-pointer group" title="AI Assistant (Ctrl+Shift+A)">
           <svg class="w-4 h-4 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
         </button>
         <button data-action-click="open_stats" class="p-2 bg-app-bg hover:bg-app-surface rounded-xl border border-app-border text-app-muted hover:text-app-accent-2 transition-all cursor-pointer group" title="Statistics (S)">
           <svg class="w-4 h-4 group-hover:scale-110 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
         </button>
      </div>
    `;
  }
}
