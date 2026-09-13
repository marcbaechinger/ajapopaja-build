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
import { HistoryItemView } from './HistoryItemView.ts';

/**
 * Compact history panel for a pipeline. Renders every settled task as a single
 * HistoryItemView in one flat "History Feed" list. There is no separate "last
 * completed" section and no redundant wrapping containers/padding.
 */
export class PipelineHistoryView {
  static render(tasks: Task[]): string {
    const items = tasks.length > 0
      ? tasks.map((t) => HistoryItemView.render(t)).join('')
      : '<p class="text-app-muted italic text-[10px] text-center py-3">No tasks completed yet.</p>';

    return `
      <section id="history-feed" class="flex flex-col gap-2">
        <h3 class="text-sm font-black text-app-muted uppercase tracking-widest px-1">History Feed</h3>
        <div id="completed-task-list" class="flex flex-col gap-2 px-1">
          ${items}
        </div>
      </section>
    `;
  }
}
