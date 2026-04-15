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

export interface PaginationOptions {
  currentPage: number;
  pageSize: number;
  totalCount: number;
  prevAction: string;
  nextAction: string;
}

export class PaginationControl {
  static render(options: PaginationOptions): string {
    const { currentPage, pageSize, totalCount, prevAction, nextAction } = options;
    const totalPages = Math.ceil(totalCount / pageSize);

    if (totalPages <= 1) return '';

    return `
      <div class="flex justify-between items-center mt-6 pt-4 border-t border-app-border/20">
        <button data-action-click="${prevAction}" ${currentPage === 0 ? 'disabled' : ''}
                class="text-[10px] font-bold uppercase tracking-widest text-app-muted hover:text-app-accent-1 transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1">
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg>
          Previous
        </button>
        <span class="text-[10px] font-bold text-app-muted uppercase tracking-widest">Page ${currentPage + 1} of ${totalPages}</span>
        <button data-action-click="${nextAction}" ${currentPage === totalPages - 1 ? 'disabled' : ''}
                class="text-[10px] font-bold uppercase tracking-widest text-app-muted hover:text-app-accent-1 transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer flex items-center gap-1">
          Next
          <svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
        </button>
      </div>
    `;
  }
}
