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
import { registerMiscActions } from './miscActions.ts';
import type { MiscActionsDeps } from './miscActions.ts';
import { createPipelineDetailState } from '../PipelineDetailCtx.ts';
import type { PipelineDetailCtx } from '../PipelineDetailCtx.ts';
import type { ActionHandler } from '../../../../core/ActionRegistry.ts';
import { DevServerDialog } from '../../../components/DevServerDialog.ts';
import { DiffDialog } from '../../../components/DiffDialog.ts';
import { PipelineEditDialog } from '../../../components/PipelineEditDialog.ts';
import { StatsDialog } from '../../../components/StatsDialog.ts';

vi.mock('../../../components/DevServerDialog.ts', () => ({
  DevServerDialog: vi.fn(function DevServerDialog() {
    return { show: vi.fn() };
  }),
}));

vi.mock('../../../components/DiffDialog.ts', () => ({
  DiffDialog: vi.fn(function DiffDialog() {
    return { show: vi.fn() };
  }),
}));

vi.mock('../../../components/PipelineEditDialog.ts', () => ({
  PipelineEditDialog: vi.fn(function PipelineEditDialog() {
    return { show: vi.fn() };
  }),
}));

vi.mock('../../../components/StatsDialog.ts', () => ({
  StatsDialog: vi.fn(function StatsDialog() {
    return { show: vi.fn() };
  }),
}));

/** The handlers never read the event; a placeholder keeps the signature. */
const noEvent = null as unknown as Event;

const button = (taskId?: string): HTMLButtonElement => {
  const el = document.createElement('button');
  if (taskId) el.setAttribute('data-task-id', taskId);
  return el;
};

describe('registerMiscActions', () => {
  let registry: Map<string, ActionHandler>;
  let ctx: PipelineDetailCtx;
  let deps: MiscActionsDeps;
  let create: ReturnType<typeof vi.fn>;
  let clipboardWrite: ReturnType<typeof vi.fn>;

  const getAction = (name: string): ActionHandler => {
    const handler = registry.get(name);
    if (!handler) throw new Error(`action "${name}" was not registered`);
    return handler;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';

    registry = new Map<string, ActionHandler>();
    create = vi.fn().mockResolvedValue({ id: 'n1', title: 'New Task' });
    clipboardWrite = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText: clipboardWrite } });
    vi.stubGlobal('alert', vi.fn());

    const state = createPipelineDetailState();

    ctx = {
      context: {
        actionRegistry: {
          register: (name: string, handler: ActionHandler) => registry.set(name, handler),
        },
        pipelineClient: { get: vi.fn() },
        taskClient: { create },
        editorClient: { quickfix: vi.fn().mockResolvedValue(undefined) },
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

    deps = {
      getHost: vi.fn(() => null),
      setContentTab: vi.fn(),
      setHistoryPage: vi.fn(),
      applySidebarState: vi.fn(),
      persistSidebarCollapsed: vi.fn(),
    };

    registerMiscActions(ctx, deps);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('registers all miscellaneous actions', () => {
    expect([...registry.keys()].sort()).toEqual(
      [
        'copy_pipeline_id',
        'copy_task_id',
        'create_task',
        'edit_pipeline',
        'next_history_page',
        'open_dev_server_dialog',
        'open_diff_view',
        'open_history',
        'open_quickfix',
        'open_stats',
        'prev_history_page',
        'toggle_backlog_sidebar',
      ].sort(),
    );
  });

  describe('edit_pipeline', () => {
    it('is a no-op without a pipeline', async () => {
      await getAction('edit_pipeline')(noEvent, button());

      expect(PipelineEditDialog).not.toHaveBeenCalled();
    });

    it('constructs PipelineEditDialog in edit mode with the loaded pipeline', async () => {
      const pipeline = { id: 'p1', name: 'Pipe 1' };
      ctx.state.pipeline = pipeline as any;

      await getAction('edit_pipeline')(noEvent, button());

      expect(PipelineEditDialog).toHaveBeenCalledTimes(1);
      expect(PipelineEditDialog).toHaveBeenCalledWith({
        mode: 'edit',
        pipeline,
        pipelineId: 'p1',
        context: ctx.context,
      });
      expect((PipelineEditDialog as any).mock.results[0].value.show).toHaveBeenCalled();
    });
  });

  describe('copy_pipeline_id', () => {
    it('writes the pipeline id to the clipboard and reverts the icon', async () => {
      vi.useFakeTimers();
      const el = document.createElement('button');
      el.innerHTML = 'ORIGINAL';

      await getAction('copy_pipeline_id')(noEvent, el);

      expect(clipboardWrite).toHaveBeenCalledWith('p1');
      expect(el.innerHTML).toContain('text-green-500');

      vi.advanceTimersByTime(2000);
      expect(el.innerHTML).toBe('ORIGINAL');
    });

    it('logs and leaves the icon untouched when the clipboard write fails', async () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      clipboardWrite.mockRejectedValueOnce(new Error('denied'));
      const el = document.createElement('button');
      el.innerHTML = 'ORIGINAL';

      await getAction('copy_pipeline_id')(noEvent, el);

      expect(errorSpy).toHaveBeenCalledWith('Failed to copy pipeline ID:', expect.any(Error));
      expect(el.innerHTML).toBe('ORIGINAL');
    });
  });

  describe('copy_task_id', () => {
    it('writes the ancestor task id to the clipboard and reverts the icon', async () => {
      vi.useFakeTimers();
      const wrapper = document.createElement('div');
      wrapper.setAttribute('data-task-id', 't1');
      const el = document.createElement('button');
      el.innerHTML = 'ORIGINAL';
      wrapper.appendChild(el);

      await getAction('copy_task_id')(noEvent, el);

      expect(clipboardWrite).toHaveBeenCalledWith('t1');
      expect(el.innerHTML).toContain('text-green-500');

      vi.advanceTimersByTime(2000);
      expect(el.innerHTML).toBe('ORIGINAL');
    });

    it('is a no-op without a task-id ancestor', async () => {
      const el = document.createElement('button');

      await getAction('copy_task_id')(noEvent, el);

      expect(clipboardWrite).not.toHaveBeenCalled();
    });
  });

  describe('open_dev_server_dialog', () => {
    it('constructs DevServerDialog with the context and pipeline id', () => {
      getAction('open_dev_server_dialog')(noEvent, button());

      expect(DevServerDialog).toHaveBeenCalledTimes(1);
      expect(DevServerDialog).toHaveBeenCalledWith(ctx.context, 'p1');
    });
  });

  describe('open_stats', () => {
    it('constructs StatsDialog with the loaded tasks and pipeline id', () => {
      const tasks = [{ id: 't1' }, { id: 't2' }];
      ctx.state.allLoadedTasks = tasks as any;

      getAction('open_stats')(noEvent, button());

      expect(StatsDialog).toHaveBeenCalledTimes(1);
      expect(StatsDialog).toHaveBeenCalledWith(tasks, 'p1', ctx.context.pipelineClient);
    });
  });

  describe('open_history', () => {
    it('activates the history tab and pushes the canonical hash', () => {
      getAction('open_history')(noEvent, button());

      expect(deps.setContentTab).toHaveBeenCalledWith('history', { hash: 'push' });
    });
  });

  describe('create_task', () => {
    it('is a no-op for an empty title', async () => {
      const form = document.createElement('form');
      form.innerHTML = '<input name="task_title" value="   ">';

      await getAction('create_task')(noEvent, form);

      expect(create).not.toHaveBeenCalled();
      expect(deps.setContentTab).not.toHaveBeenCalled();
    });

    it('selects the created task, marks the spec edit and clears both inputs', async () => {
      const created = { id: 'n1', title: 'New Task' };
      create.mockResolvedValueOnce(created);
      ctx.state.allLoadedTasks = [];

      const form = document.createElement('form');
      form.innerHTML = '<input name="task_title" value="New Task">';
      const capturedInput = form.querySelector('input') as HTMLInputElement;

      const host = document.createElement('div');
      host.innerHTML = '<input name="task_title" value="New Task">';
      const liveInput = host.querySelector('input') as HTMLInputElement;
      (deps.getHost as any).mockReturnValue(host);

      await getAction('create_task')(noEvent, form);

      expect(create).toHaveBeenCalledWith('p1', 'New Task');
      expect(capturedInput.value).toBe('');
      expect(liveInput.value).toBe('');
      expect(ctx.state.selectedTask).toBe(created);
      expect(ctx.state.allLoadedTasks).toEqual([created]);
      expect(ctx.state.pendingSpecEditTaskId).toBe('n1');
      expect(deps.setContentTab).toHaveBeenCalledWith('task-editor', { hash: 'push' });
      expect(ctx.refresh.backlog).toHaveBeenCalled();
      expect(ctx.refresh.selectedTask).toHaveBeenCalled();
    });

    it('replaces an existing task with the same id instead of pushing a duplicate', async () => {
      const existing = { id: 'n1', title: 'Old' };
      const created = { id: 'n1', title: 'New' };
      create.mockResolvedValueOnce(created);
      ctx.state.allLoadedTasks = [existing as any, { id: 'other' } as any];

      const form = document.createElement('form');
      form.innerHTML = '<input name="task_title" value="New">';

      await getAction('create_task')(noEvent, form);

      expect(ctx.state.allLoadedTasks).toHaveLength(2);
      expect(ctx.state.allLoadedTasks[0]).toBe(created);
      expect(ctx.state.allLoadedTasks[1]).toEqual({ id: 'other' });
    });

    it('alerts when the create request fails', async () => {
      create.mockRejectedValueOnce(new Error('boom'));
      const form = document.createElement('form');
      form.innerHTML = '<input name="task_title" value="New">';

      await getAction('create_task')(noEvent, form);

      expect(alert).toHaveBeenCalledWith('Failed to create task');
      expect(deps.setContentTab).not.toHaveBeenCalled();
    });
  });

  describe('history pagination', () => {
    it('prev_history_page decrements the page', () => {
      ctx.state.historyPage = 2;

      getAction('prev_history_page')(noEvent, button());

      expect(deps.setHistoryPage).toHaveBeenCalledWith(1);
    });

    it('next_history_page increments the page', () => {
      ctx.state.historyPage = 2;

      getAction('next_history_page')(noEvent, button());

      expect(deps.setHistoryPage).toHaveBeenCalledWith(3);
    });
  });

  describe('toggle_backlog_sidebar', () => {
    it('flips the state, persists it and re-applies the DOM state', () => {
      ctx.state.sidebarCollapsed = false;
      const action = getAction('toggle_backlog_sidebar');

      action(noEvent, button());

      expect(ctx.state.sidebarCollapsed).toBe(true);
      expect(deps.persistSidebarCollapsed).toHaveBeenCalledWith(true);
      expect(deps.applySidebarState).toHaveBeenCalledTimes(1);

      action(noEvent, button());

      expect(ctx.state.sidebarCollapsed).toBe(false);
      expect(deps.persistSidebarCollapsed).toHaveBeenLastCalledWith(false);
      expect(deps.applySidebarState).toHaveBeenCalledTimes(2);
    });
  });

  describe('open_quickfix', () => {
    it('applies and reverts the accent classes on success', async () => {
      vi.useFakeTimers();
      const el = button();
      el.dataset.taskId = 't1';

      await getAction('open_quickfix')(noEvent, el);

      expect(ctx.context.editorClient.quickfix).toHaveBeenCalledWith('t1');
      expect(el.classList.contains('animate-pulse')).toBe(true);
      expect(el.classList.contains('text-app-accent-2')).toBe(true);

      vi.advanceTimersByTime(1000);

      expect(el.classList.contains('animate-pulse')).toBe(false);
      expect(el.classList.contains('text-app-accent-2')).toBe(false);
    });

    it('toggles the red error class on failure', async () => {
      vi.useFakeTimers();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      (ctx.context.editorClient.quickfix as any).mockRejectedValueOnce(new Error('boom'));
      const el = button();
      el.dataset.taskId = 't1';

      await getAction('open_quickfix')(noEvent, el);

      expect(el.classList.contains('animate-pulse')).toBe(false);
      expect(el.classList.contains('text-app-accent-2')).toBe(false);
      expect(el.classList.contains('text-red-500')).toBe(true);

      vi.advanceTimersByTime(2000);

      expect(el.classList.contains('text-red-500')).toBe(false);
    });

    it('is a no-op without a task id', async () => {
      await getAction('open_quickfix')(noEvent, button());

      expect(ctx.context.editorClient.quickfix).not.toHaveBeenCalled();
    });
  });

  describe('open_diff_view', () => {
    it('opens a DiffDialog with the task commit hash', async () => {
      ctx.state.allLoadedTasks = [
        { id: 't1', title: 'Task One', commit_hash: 'abcdef123456' },
      ] as any;

      const el = document.createElement('button');
      el.setAttribute('data-commit-hash', 'abcdef123456');
      el.setAttribute('data-task-id', 't1');

      await getAction('open_diff_view')(noEvent, el);

      expect(DiffDialog).toHaveBeenCalledTimes(1);
      expect(DiffDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          context: ctx.context,
          pipelineId: 'p1',
          commitHash: 'abcdef123456',
          title: 'Task One',
        }),
      );
      expect((DiffDialog as any).mock.results[0].value.show).toHaveBeenCalled();
    });

    it('leaves the title undefined when the task is not loaded', async () => {
      const el = document.createElement('button');
      el.setAttribute('data-commit-hash', 'abcdef123456');

      await getAction('open_diff_view')(noEvent, el);

      expect(DiffDialog).toHaveBeenCalledWith(
        expect.objectContaining({ title: undefined }),
      );
    });

    it('does nothing when the element has no commit hash', async () => {
      await getAction('open_diff_view')(noEvent, document.createElement('button'));

      expect(DiffDialog).not.toHaveBeenCalled();
    });
  });
});
