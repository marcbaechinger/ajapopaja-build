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

/**
 * Renders a compact, inline-editable priority (order) control for a task.
 *
 * ``Task.order`` drives the ordering of the backlog and the queue (lower values
 * first). The control supports two ways to reorder a task:
 *
 * - nudge it one step up/down via the ``&uarr;`` / ``&darr;`` buttons
 *   (``move_task_up`` / ``move_task_down``); or
 * - type an absolute order value directly into the number field, which commits
 *   through the ``update_task_order`` action on change/blur.
 *
 * Because every task exposes the same control, an entire column can be
 * re-ordered quickly by nudging or retyping values across multiple tasks.
 *
 * The actions are registered by PipelineDetailView and persisted through the
 * Task API; a WebSocket refresh keeps the UI (and the sort order) in sync.
 */
export class OrderControl {
  static render(task: Task): string {
    const taskId = task.id ?? '';
    const version = task.version ?? 1;
    const order = task.order ?? 0;

    return `
      <span class="inline-flex items-center gap-0.5 text-app-muted" title="Priority order (lower = higher priority)" data-order-control="">
        <button data-action-click="move_task_up" data-version="${version}" data-order="${order}"
                class="p-0.5 px-1 hover:bg-app-surface rounded text-app-muted hover:text-app-accent-1 transition-colors cursor-pointer shrink-0" title="Move up">
          &uarr;
        </button>
        <input
          type="number"
          data-action-change="update_task_order"
          data-task-id="${taskId}"
          data-version="${version}"
          value="${order}"
          aria-label="Priority order"
          title="Priority order (lower = higher priority)"
          class="w-10 bg-app-surface border border-app-border rounded px-1 py-0.5 text-[10px] text-center text-app-text outline-none focus:ring-1 focus:ring-app-accent-1 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
        <button data-action-click="move_task_down" data-version="${version}" data-order="${order}"
                class="p-0.5 px-1 hover:bg-app-surface rounded text-app-muted hover:text-app-accent-1 transition-colors cursor-pointer shrink-0" title="Move down">
          &darr;
        </button>
      </span>
    `;
  }
}
