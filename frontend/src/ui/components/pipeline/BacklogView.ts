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

import { Task, TaskStatus } from '../../../core/domain.ts';
import { BacklogTaskView } from './BacklogTaskView.ts';

export interface BacklogViewProps {
  tasks: Task[];
  /** Id of the currently selected backlog task (only CREATED ones are highlighted). */
  selectedTaskId?: string;
}

/**
 * BacklogView renders the left sidebar of the PipelineDetailView.
 *
 * It lists the tasks that are still in the "backlog", i.e. those with state
 * PROPOSED (design doc submitted) and CREATED (awaiting design). They are
 * grouped into two vertical sections - PROPOSED on top and CREATED below - each
 * with a header showing the section type and the number of tasks in it.
 *
 * Tasks inside a section are sorted by their ``order`` value ascending (lower
 * values first) so the user can prioritise work regardless of when it was
 * created or updated.
 */
export class BacklogView {
  static render(props: BacklogViewProps): string {
    const { tasks, selectedTaskId } = props;

    const proposed = tasks
      .filter(t => !t.deleted && t.status === TaskStatus.PROPOSED)
      .sort((a, b) => taskSort(a, b));
    const created = tasks
      .filter(t => !t.deleted && t.status === TaskStatus.CREATED)
      .sort((a, b) => taskSort(a, b));

    return `
      <div class="flex flex-col gap-3 p-2 min-h-0">
        ${BacklogView.sectionHeader('Proposed', proposed.length, 'text-purple-400')}
        ${BacklogView.sectionBody(proposed, 'No proposed designs.', selectedTaskId)}

        ${BacklogView.sectionHeader('Backlog', created.length, 'text-app-muted')}
        ${BacklogView.sectionBody(created, 'Backlog is empty.', selectedTaskId)}
      </div>
    `;
  }

  private static sectionHeader(title: string, count: number, accent: string): string {
    return `
      <div class="flex items-center justify-between px-1 pt-1">
        <span class="text-[10px] font-black uppercase tracking-widest ${accent}">${title}</span>
        <span class="text-[10px] font-bold text-app-muted bg-app-surface border border-app-border rounded-full px-1.5 py-0.5">${count}</span>
      </div>
    `;
  }

  private static sectionBody(tasks: Task[], emptyMessage: string, selectedTaskId?: string): string {
    if (tasks.length === 0) {
      return `
        <div class="px-1">
          <p class="text-[10px] italic text-app-muted/50 text-center border border-dashed border-app-border/40 rounded-lg py-3">${emptyMessage}</p>
        </div>
      `;
    }
    return `
      <div class="flex flex-col gap-2">
        ${tasks.map(t => BacklogTaskView.render(t, t.id === selectedTaskId)).join('')}
      </div>
    `;
  }
}

/**
 * Sort tasks by their ``order`` value ascending (lower order first). The order
 * can be negative; default tasks use 100 so they naturally sort below anything
 * explicitly prioritised.
 */
function taskSort(a: Task, b: Task): number {
  return (a.order || 0) - (b.order || 0);
}
