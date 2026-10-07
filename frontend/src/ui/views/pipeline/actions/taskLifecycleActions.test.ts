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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerTaskLifecycleActions } from './taskLifecycleActions.ts';
import type { TaskLifecycleActionsDeps } from './taskLifecycleActions.ts';
import { createPipelineDetailState } from '../PipelineDetailCtx.ts';
import type { PipelineDetailCtx } from '../PipelineDetailCtx.ts';
import type { ActionHandler } from '../../../../core/ActionRegistry.ts';
import { ConfirmationDialog } from '../../../components/ConfirmationDialog.ts';
import { TaskStatus } from '../../../../core/domain.ts';

vi.mock('../../../components/ConfirmationDialog.ts', () => ({
  ConfirmationDialog: vi.fn(function ConfirmationDialog() {
    return { show: vi.fn().mockResolvedValue(true) };
  }),
}));

/** The handlers never read the event; a placeholder keeps the signature. */
const noEvent = null as unknown as Event;

/**
 * Builds a `[data-view-id]` wrapper with a clickable descendant carrying the
 * optional `data-version` / `data-order` attributes the handlers read.
 */
const makeTarget = (opts: { taskId?: string; version?: string; order?: string } = {}) => {
  const wrapper = document.createElement('div');
  if (opts.taskId) wrapper.setAttribute('data-view-id', opts.taskId);
  const button = document.createElement('button');
  if (opts.version) button.setAttribute('data-version', opts.version);
  if (opts.order) button.setAttribute('data-order', opts.order);
  wrapper.appendChild(button);
  document.body.appendChild(wrapper);
  return { wrapper, button };
};

describe('registerTaskLifecycleActions', () => {
  let registry: Map<string, ActionHandler>;
  let ctx: PipelineDetailCtx;
  let deps: TaskLifecycleActionsDeps;
  let setContentTab: ReturnType<typeof vi.fn>;
  let updateStatus: ReturnType<typeof vi.fn>;
  let updateDetails: ReturnType<typeof vi.fn>;
  let deleteTask: ReturnType<typeof vi.fn>;

  const getAction = (name: string): ActionHandler => {
    const handler = registry.get(name);
    if (!handler) throw new Error(`action "${name}" was not registered`);
    return handler;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';

    registry = new Map<string, ActionHandler>();
    setContentTab = vi.fn();
    updateStatus = vi.fn().mockResolvedValue({ id: 't1' });
    updateDetails = vi.fn().mockResolvedValue({ id: 't1' });
    deleteTask = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('alert', vi.fn());

    const state = createPipelineDetailState();

    ctx = {
      context: {
        actionRegistry: {
          register: (name: string, handler: ActionHandler) => registry.set(name, handler),
        },
        taskClient: { updateStatus, updateDetails, delete: deleteTask },
      },
      pipelineId: 'p1',
      state,
      refresh: {
        header: vi.fn(),
        backlog: vi.fn(),
        selectedTask: vi.fn(),
        executionEngine: vi.fn(),
        sessionList: vi.fn(),
        specProposals: vi.fn(),
      },
    } as unknown as PipelineDetailCtx;

    deps = { setContentTab: setContentTab as unknown as TaskLifecycleActionsDeps['setContentTab'] };

    registerTaskLifecycleActions(ctx, deps);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('registers all ten task-lifecycle actions', () => {
    expect([...registry.keys()].sort()).toEqual(
      [
        'cancel_progress',
        'delete_task',
        'fail_task',
        'move_task_down',
        'move_task_up',
        'schedule_task',
        'select_task',
        'toggle_task_collapse',
        'unschedule_task',
        'update_task_order',
      ].sort(),
    );
  });

  describe('schedule_task / unschedule_task / cancel_progress', () => {
    it('schedules with SCHEDULED and the parsed version', async () => {
      const { button } = makeTarget({ taskId: 't1', version: '4' });

      await getAction('schedule_task')(noEvent, button);

      expect(updateStatus).toHaveBeenCalledWith('t1', TaskStatus.SCHEDULED, 4);
    });

    it('unschedules with CREATED and the parsed version', async () => {
      const { button } = makeTarget({ taskId: 't1', version: '2' });

      await getAction('unschedule_task')(noEvent, button);

      expect(updateStatus).toHaveBeenCalledWith('t1', TaskStatus.CREATED, 2);
    });

    it('cancels progress by moving back to SCHEDULED', async () => {
      const { button } = makeTarget({ taskId: 't1', version: '5' });

      await getAction('cancel_progress')(noEvent, button);

      expect(updateStatus).toHaveBeenCalledWith('t1', TaskStatus.SCHEDULED, 5);
    });

    it('defaults the version to 1 and is a no-op without a task id', async () => {
      const { button } = makeTarget({ taskId: 't1' });
      await getAction('schedule_task')(noEvent, button);
      expect(updateStatus).toHaveBeenCalledWith('t1', TaskStatus.SCHEDULED, 1);

      const orphan = document.createElement('button');
      await getAction('unschedule_task')(noEvent, orphan);
      expect(updateStatus).toHaveBeenCalledTimes(1);
    });

    it('alerts when the request rejects', async () => {
      updateStatus.mockRejectedValueOnce(new Error('boom'));
      const { button } = makeTarget({ taskId: 't1' });

      await getAction('cancel_progress')(noEvent, button);

      expect(alert).toHaveBeenCalledWith('Failed to cancel progress');
    });
  });

  describe('move_task_up / move_task_down', () => {
    it('decrements the order read from data-order', async () => {
      const { button } = makeTarget({ taskId: 't1', version: '3', order: '10' });

      await getAction('move_task_up')(noEvent, button);

      expect(updateDetails).toHaveBeenCalledWith('t1', 3, { order: 9 });
    });

    it('increments the order read from data-order', async () => {
      const { button } = makeTarget({ taskId: 't1', version: '3', order: '10' });

      await getAction('move_task_down')(noEvent, button);

      expect(updateDetails).toHaveBeenCalledWith('t1', 3, { order: 11 });
    });

    it('defaults the order to 0 and alerts on failure', async () => {
      updateDetails.mockRejectedValueOnce(new Error('boom'));
      const { button } = makeTarget({ taskId: 't1' });

      await getAction('move_task_up')(noEvent, button);

      expect(updateDetails).toHaveBeenCalledWith('t1', 1, { order: -1 });
      expect(alert).toHaveBeenCalledWith('Failed to move task');
    });
  });

  describe('update_task_order', () => {
    it('updates the order with the version read from the clicked element', async () => {
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-view-id', 't1');
      const input = document.createElement('input');
      input.type = 'number';
      input.value = '25';
      input.setAttribute('data-task-id', 't1');
      input.setAttribute('data-version', '3');
      wrapper.appendChild(input);
      document.body.appendChild(wrapper);

      await getAction('update_task_order')(noEvent, input);

      expect(updateDetails).toHaveBeenCalledWith('t1', 3, { order: 25 });
    });

    it('falls back to the closest [data-view-id] version', async () => {
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-view-id', 't1');
      wrapper.setAttribute('data-version', '7');
      const input = document.createElement('input');
      input.value = '25';
      wrapper.appendChild(input);
      document.body.appendChild(wrapper);

      await getAction('update_task_order')(noEvent, input);

      expect(updateDetails).toHaveBeenCalledWith('t1', 7, { order: 25 });
    });

    it('is a no-op when the new order is not a number', async () => {
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-view-id', 't1');
      const input = document.createElement('input');
      input.value = '';
      wrapper.appendChild(input);
      document.body.appendChild(wrapper);

      await getAction('update_task_order')(noEvent, input);

      expect(updateDetails).not.toHaveBeenCalled();
    });

    it('alerts when the request rejects', async () => {
      updateDetails.mockRejectedValueOnce(new Error('boom'));
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-view-id', 't1');
      const input = document.createElement('input');
      input.value = '25';
      wrapper.appendChild(input);
      document.body.appendChild(wrapper);

      await getAction('update_task_order')(noEvent, input);

      expect(alert).toHaveBeenCalledWith('Failed to update order');
    });
  });

  describe('fail_task', () => {
    it('confirms then marks the task FAILED with the parsed version', async () => {
      const { button } = makeTarget({ taskId: 't1', version: '6' });

      await getAction('fail_task')(noEvent, button);

      expect(ConfirmationDialog).toHaveBeenCalledWith(
        'Mark Task as Failed',
        'Are you sure you want to mark this task as FAILED? This may trigger an automated fix sequence.',
        'Mark Failed',
      );
      expect(updateStatus).toHaveBeenCalledWith('t1', TaskStatus.FAILED, 6);
    });

    it('does nothing when the confirmation is cancelled', async () => {
      (ConfirmationDialog as any).mockImplementationOnce(function CancelledDialog() {
        return { show: vi.fn().mockResolvedValue(false) };
      });
      const { button } = makeTarget({ taskId: 't1' });

      await getAction('fail_task')(noEvent, button);

      expect(updateStatus).not.toHaveBeenCalled();
    });

    it('alerts when the request rejects', async () => {
      updateStatus.mockRejectedValueOnce(new Error('boom'));
      const { button } = makeTarget({ taskId: 't1' });

      await getAction('fail_task')(noEvent, button);

      expect(alert).toHaveBeenCalledWith('Failed to update task');
    });
  });

  describe('delete_task', () => {
    it('confirms then deletes the task (no version check)', async () => {
      const { button } = makeTarget({ taskId: 't1' });

      await getAction('delete_task')(noEvent, button);

      expect(ConfirmationDialog).toHaveBeenCalledWith(
        'Delete Task',
        'Are you sure you want to delete this task? This action cannot be undone.',
        'Delete',
      );
      expect(deleteTask).toHaveBeenCalledWith('t1');
    });

    it('does nothing when the confirmation is cancelled', async () => {
      (ConfirmationDialog as any).mockImplementationOnce(function CancelledDialog() {
        return { show: vi.fn().mockResolvedValue(false) };
      });
      const { button } = makeTarget({ taskId: 't1' });

      await getAction('delete_task')(noEvent, button);

      expect(deleteTask).not.toHaveBeenCalled();
    });

    it('alerts when the request rejects', async () => {
      deleteTask.mockRejectedValueOnce(new Error('boom'));
      const { button } = makeTarget({ taskId: 't1' });

      await getAction('delete_task')(noEvent, button);

      expect(alert).toHaveBeenCalledWith('Failed to delete task');
    });
  });

  describe('toggle_task_collapse', () => {
    const makeCollapsible = (taskId = 't1') => {
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-view-id', taskId);
      const body = document.createElement('div');
      body.className = 'task-body';
      const button = document.createElement('button');
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.classList.add('transform');
      button.appendChild(icon);
      wrapper.append(body, button);
      document.body.appendChild(wrapper);
      return { body, button, icon };
    };

    it('toggles .hidden/rotate-90 and collapsedTasks in both directions', () => {
      const { body, button, icon } = makeCollapsible('t1');

      getAction('toggle_task_collapse')(noEvent, button);

      expect(body.classList.contains('hidden')).toBe(true);
      expect(icon.classList.contains('rotate-90')).toBe(false);
      expect(ctx.state.collapsedTasks.has('t1')).toBe(true);

      getAction('toggle_task_collapse')(noEvent, button);

      expect(body.classList.contains('hidden')).toBe(false);
      expect(icon.classList.contains('rotate-90')).toBe(true);
      expect(ctx.state.collapsedTasks.has('t1')).toBe(false);
    });

    it('is a no-op without the body or icon', () => {
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-view-id', 't1');
      const button = document.createElement('button');
      wrapper.appendChild(button);
      document.body.appendChild(wrapper);

      expect(() => getAction('toggle_task_collapse')(noEvent, button)).not.toThrow();
      expect(ctx.state.collapsedTasks.size).toBe(0);
    });

    it('is a no-op without a task id', () => {
      const { button } = makeTarget();
      expect(() => getAction('toggle_task_collapse')(noEvent, button)).not.toThrow();
    });
  });

  describe('select_task', () => {
    const makeTask = (id: string) => ({ id, title: id, version: 1 } as any);

    it('clears the pending spec edit, selects the task, switches tab and refreshes', () => {
      ctx.state.allLoadedTasks = [makeTask('t1'), makeTask('t2')];
      ctx.state.pendingSpecEditTaskId = 't2';
      const el = document.createElement('div');
      el.setAttribute('data-view-id', 't1');

      getAction('select_task')(noEvent, el);

      expect(ctx.state.pendingSpecEditTaskId).toBeNull();
      expect(ctx.state.selectedTask?.id).toBe('t1');
      expect(setContentTab).toHaveBeenCalledWith('task-editor', { hash: 'push' });
      expect(ctx.refresh.backlog).toHaveBeenCalled();
      expect(ctx.refresh.selectedTask).toHaveBeenCalled();
    });

    it('writes the selection before switching tabs so the pushed hash has the uid', () => {
      ctx.state.allLoadedTasks = [makeTask('t1')];
      const el = document.createElement('div');
      el.setAttribute('data-view-id', 't1');

      const order: string[] = [];
      Object.defineProperty(ctx.state, 'selectedTask', {
        configurable: true,
        get: () => null,
        set: () => {
          order.push('select');
        },
      });
      setContentTab.mockImplementation(() => {
        order.push('tab');
      });

      getAction('select_task')(noEvent, el);

      expect(order).toEqual(['select', 'tab']);
    });

    it('selects null for an unknown uid and still reveals the tab', () => {
      ctx.state.allLoadedTasks = [makeTask('t1')];
      const el = document.createElement('div');
      el.setAttribute('data-view-id', 'missing');

      getAction('select_task')(noEvent, el);

      expect(ctx.state.selectedTask).toBeNull();
      expect(setContentTab).toHaveBeenCalledWith('task-editor', { hash: 'push' });
    });

    it('is a no-op without an id', () => {
      ctx.state.allLoadedTasks = [makeTask('t1')];
      const el = document.createElement('div');

      getAction('select_task')(noEvent, el);

      expect(setContentTab).not.toHaveBeenCalled();
      expect(ctx.refresh.backlog).not.toHaveBeenCalled();
      expect(ctx.refresh.selectedTask).not.toHaveBeenCalled();
    });
  });
});
