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
import { HistoryItemView } from './HistoryItemView.ts';
import { PaginationControl } from '../common/PaginationControl.ts';

/**
 * Compact history panel for a pipeline. Renders settled tasks as a single
 * HistoryItemView in one flat "History Feed" list, paged with a fixed page size
 * (10). The first page is shown by default and a PaginationControl is rendered
 * to navigate through the remaining pages. There is no separate "last completed"
 * section and no redundant wrapping containers/padding.
 */
export class PipelineHistoryView {
  static readonly PAGE_SIZE: number = 10;

  static render(tasks: Task[], page: number = 0): string {
    const totalCount = tasks.length;
    const pageSize = PipelineHistoryView.PAGE_SIZE;
    const totalPages = Math.ceil(totalCount / pageSize);
    // Clamp the requested page to a valid range so it never exceeds bounds.
    const currentPage = pageSize <= 0 ? 0 : Math.max(0, Math.min(page, Math.max(0, totalPages - 1)));
    const start = currentPage * pageSize;
    const pageTasks = tasks.slice(start, start + pageSize);

    const items = pageTasks.length > 0
      ? pageTasks.map((t) => HistoryItemView.render(t)).join('')
      : '<p class="text-app-muted italic text-[10px] text-center py-3">No tasks completed yet.</p>';

    const pagination = PaginationControl.render({
      currentPage,
      pageSize,
      totalCount,
      prevAction: 'prev_history_page',
      nextAction: 'next_history_page',
    });

    return `
      <section id="history-feed" class="flex flex-col min-h-0 flex-1 overflow-hidden gap-1">
        <h3 class="text-sm font-black text-app-muted uppercase tracking-widest px-1 shrink-0">History Feed</h3>
        <div id="completed-task-list" class="flex flex-col gap-1 px-1 flex-1 overflow-y-auto min-h-[7rem]">
          ${items}
        </div>
        <div class="shrink-0">${pagination}</div>
      </section>
    `;
  }
}
