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

import { ConfirmationDialog } from '../../../components/dialogs/ConfirmationDialog.ts';
import { TaskStatus } from '../../../../core/domain.ts';
import type { ContentTab } from '../../../../core/PipelineRoute.ts';
import type { HashWriteMode } from '../PipelineSubRoute.ts';
import type { PipelineDetailCtx } from '../PipelineDetailCtx.ts';

export interface TaskLifecycleActionsDeps {
  /** P8: switch the active content tab and write the route. */
  setContentTab(tab: ContentTab, opts?: { hash?: HashWriteMode }): void;
}

/**
 * Registers the task-lifecycle actions on the shared action registry:
 * `schedule_task`, `unschedule_task`, `cancel_progress`, `move_task_up`,
 * `move_task_down`, `update_task_order`, `fail_task`, `delete_task`,
 * `select_task` and `toggle_task_collapse`.
 *
 * The handlers were extracted verbatim from `PipelineDetailView` (P9c). The
 * only shell dependency is `setContentTab` (used by `select_task`); everything
 * else comes from `ctx`: the task client, the shared selection/collapse state
 * and the P0 refresh hooks. Status changes are reflected by the WebSocket, so
 * the handlers never repaint directly — only `select_task` refreshes the
 * backlog and the selected task after switching the tab.
 */
export function registerTaskLifecycleActions(
  ctx: PipelineDetailCtx,
  deps: TaskLifecycleActionsDeps,
): void {
  const { actionRegistry } = ctx.context;

  actionRegistry.register('select_task', (_e, el) => {
    const taskId = (el.closest('[data-view-id]') as HTMLElement | null)?.getAttribute('data-view-id') || el.getAttribute('data-view-id') || el.getAttribute('data-task-id');
    if (!taskId) return;
    ctx.state.pendingSpecEditTaskId = null;
    ctx.state.selectedTask = ctx.state.allLoadedTasks.find(t => t.id === taskId) || null;
    // Selecting a task must surface it in the main content area: switch the
    // active tab back to the Task editor so the selection is visible even
    // when the Coding Agent or File Browser tab was active.
    // NOTE: the selection is written before the tab switch because the pushed
    // task hash reads the selected uid.
    deps.setContentTab('task-editor', { hash: 'push' });
    ctx.refresh.backlog();
    ctx.refresh.selectedTask();
  });

  actionRegistry.register('toggle_task_collapse', (_e, el) => {
    const taskId = el.closest('[data-view-id]')?.getAttribute('data-view-id');
    if (!taskId) return;

    const body = el.closest('[data-view-id]')?.querySelector('.task-body');
    const icon = el.querySelector('svg.transform');
    if (!body || !icon) return;

    const isHidden = body.classList.toggle('hidden');
    icon.classList.toggle('rotate-90', !isHidden);

    if (isHidden) ctx.state.collapsedTasks.add(taskId);
    else ctx.state.collapsedTasks.delete(taskId);
  });

  actionRegistry.register('schedule_task', async (_e, el) => {
    const taskId = el.closest('[data-view-id]')?.getAttribute('data-view-id');
    const version = parseInt(el.getAttribute('data-version') || '1');
    if (!taskId) return;

    try {
      await ctx.context.taskClient.updateStatus(taskId, TaskStatus.SCHEDULED, version);
      // Refresh handled by WS
    } catch (error) {
      alert('Failed to schedule task');
    }
  });

  actionRegistry.register('unschedule_task', async (_e, el) => {
    const taskId = el.closest('[data-view-id]')?.getAttribute('data-view-id');
    const version = parseInt(el.getAttribute('data-version') || '1');
    if (!taskId) return;

    try {
      await ctx.context.taskClient.updateStatus(taskId, TaskStatus.CREATED, version);
      // Refresh handled by WS
    } catch (error) {
      alert('Failed to unschedule task');
    }
  });

  actionRegistry.register('cancel_progress', async (_e, el) => {
    const taskId = el.closest('[data-view-id]')?.getAttribute('data-view-id');
    const version = parseInt(el.getAttribute('data-version') || '1');
    if (!taskId) return;

    try {
      await ctx.context.taskClient.updateStatus(taskId, TaskStatus.SCHEDULED, version);
      // Refresh handled by WS
    } catch (error) {
      alert('Failed to cancel progress');
    }
  });

  actionRegistry.register('move_task_up', async (_e, el) => {
    const taskId = el.closest('[data-view-id]')?.getAttribute('data-view-id');
    const version = parseInt(el.getAttribute('data-version') || '1');
    const currentOrder = parseInt(el.getAttribute('data-order') || '0');
    if (!taskId) return;

    try {
      await ctx.context.taskClient.updateDetails(taskId, version, { order: currentOrder - 1 });
      // Refresh handled by WS
    } catch (error) {
      alert('Failed to move task');
    }
  });

  actionRegistry.register('move_task_down', async (_e, el) => {
    const taskId = el.closest('[data-view-id]')?.getAttribute('data-view-id');
    const version = parseInt(el.getAttribute('data-version') || '1');
    const currentOrder = parseInt(el.getAttribute('data-order') || '0');
    if (!taskId) return;

    try {
      await ctx.context.taskClient.updateDetails(taskId, version, { order: currentOrder + 1 });
      // Refresh handled by WS
    } catch (error) {
      alert('Failed to move task');
    }
  });

  actionRegistry.register('update_task_order', async (_e, el) => {
    const taskId = el.closest('[data-view-id]')?.getAttribute('data-view-id') || el.getAttribute('data-task-id');
    const version = parseInt(el.getAttribute('data-version') || el.closest('[data-view-id]')?.getAttribute('data-version') || '1');
    const input = el as HTMLInputElement;
    const newOrder = parseInt(input.value, 10);
    if (!taskId || Number.isNaN(newOrder)) return;

    try {
      await ctx.context.taskClient.updateDetails(taskId, version, { order: newOrder });
      // Refresh handled by WS
    } catch (error) {
      alert('Failed to update order');
    }
  });

  actionRegistry.register('fail_task', async (_e, el) => {
    const taskId = el.closest('[data-view-id]')?.getAttribute('data-view-id');
    const version = parseInt(el.getAttribute('data-version') || '1');
    if (!taskId) return;

    const confirmed = await new ConfirmationDialog(
      'Mark Task as Failed',
      'Are you sure you want to mark this task as FAILED? This may trigger an automated fix sequence.',
      'Mark Failed'
    ).show();

    if (!confirmed) return;

    try {
      await ctx.context.taskClient.updateStatus(taskId, TaskStatus.FAILED, version);
      // Refresh handled by WS
    } catch (error) {
      alert('Failed to update task');
    }
  });

  actionRegistry.register('delete_task', async (_e, el) => {
    const taskId = el.closest('[data-view-id]')?.getAttribute('data-view-id');
    if (!taskId) return;

    const confirmed = await new ConfirmationDialog(
      'Delete Task',
      'Are you sure you want to delete this task? This action cannot be undone.',
      'Delete'
    ).show();

    if (!confirmed) return;

    try {
      await ctx.context.taskClient.delete(taskId);
      // Refresh handled by WS
    } catch (error) {
      alert('Failed to delete task');
    }
  });
}
