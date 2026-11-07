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
import { registerBotActions } from './botActions.ts';
import type { BotActionsDeps } from './botActions.ts';
import { createPipelineDetailState } from '../PipelineDetailCtx.ts';
import type { PipelineDetailCtx } from '../PipelineDetailCtx.ts';
import type { ActionHandler } from '../../../../core/ActionRegistry.ts';
import { CoderBotDialog } from '../../../components/dialogs/CoderBotDialog.ts';
import { ReviewDialog } from '../../../components/dialogs/ReviewDialog.ts';
import { UpdateDesignDialog } from '../../../components/dialogs/UpdateDesignDialog.ts';
import { Task, TaskStatus } from '../../../../core/domain.ts';

vi.mock('../../../components/dialogs/CoderBotDialog.ts', () => ({
  CoderBotDialog: vi.fn(function CoderBotDialog() {
    return { show: vi.fn() };
  }),
}));

vi.mock('../../../components/dialogs/ReviewDialog.ts', () => ({
  ReviewDialog: vi.fn(function ReviewDialog() {
    return { show: vi.fn() };
  }),
}));

vi.mock('../../../components/dialogs/UpdateDesignDialog.ts', () => ({
  UpdateDesignDialog: vi.fn(function UpdateDesignDialog() {
    return { show: vi.fn().mockResolvedValue('comments') };
  }),
}));

/** The handlers never read the event; a placeholder keeps the signature. */
const noEvent = null as unknown as Event;

const button = (taskId?: string): HTMLButtonElement => {
  const el = document.createElement('button');
  if (taskId) el.setAttribute('data-task-id', taskId);
  return el;
};

describe('registerBotActions', () => {
  let registry: Map<string, ActionHandler>;
  let ctx: PipelineDetailCtx;
  let deps: BotActionsDeps;

  const getAction = (name: string): ActionHandler => {
    const handler = registry.get(name);
    if (!handler) throw new Error(`action "${name}" was not registered`);
    return handler;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';

    registry = new Map<string, ActionHandler>();
    const state = createPipelineDetailState();

    ctx = {
      context: {
        actionRegistry: {
          register: (name: string, handler: ActionHandler) => registry.set(name, handler),
        },
        reviewBotClient: { trigger: vi.fn().mockResolvedValue(undefined) },
        archBotClient: {
          trigger: vi.fn().mockResolvedValue(undefined),
          iterate: vi.fn().mockResolvedValue(undefined),
        },
        specBotClient: { trigger: vi.fn().mockResolvedValue(undefined) },
        coderBotClient: { triggerCoderBot: vi.fn().mockResolvedValue(undefined) },
        docBotClient: { triggerDocBot: vi.fn().mockResolvedValue(undefined) },
        dataManager: { updateTask: vi.fn() },
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
      fetchSpecProposal: vi.fn(),
      updateEngineSlot: vi.fn(),
      persistPendingReviews: vi.fn(),
    };

    registerBotActions(ctx, deps);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('registers all bot actions', () => {
    expect([...registry.keys()].sort()).toEqual(
      [
        'dismiss_docbot_banner',
        'open_coderbot_dialog',
        'open_review_dialog',
        'open_spec_proposal',
        'trigger_archbot',
        'trigger_coderbot',
        'trigger_docbot',
        'trigger_reviewbot',
        'trigger_specagent',
        'update_design',
      ].sort(),
    );
  });

  describe('trigger_reviewbot', () => {
    it('triggers the client, sets the state and refreshes the header', async () => {
      const action = getAction('trigger_reviewbot');

      await action(noEvent, button('t1'));

      expect(ctx.context.reviewBotClient.trigger).toHaveBeenCalledWith('p1', 't1');
      expect(ctx.state.reviewbotState).toEqual({ status: 'inProgress', taskId: 't1' });
      expect(ctx.refresh.header).toHaveBeenCalled();
    });

    it('alerts and does not refresh on failure', async () => {
      const alertSpy = vi.fn();
      vi.stubGlobal('alert', alertSpy);
      vi.spyOn(console, 'error').mockImplementation(() => {});
      (ctx.context.reviewBotClient.trigger as any).mockRejectedValueOnce(new Error('boom'));

      await getAction('trigger_reviewbot')(noEvent, button('t1'));

      expect(alertSpy).toHaveBeenCalledWith('Failed to trigger ReviewBot');
      expect(ctx.refresh.header).not.toHaveBeenCalled();
    });

    it('is a no-op without data-task-id', async () => {
      await getAction('trigger_reviewbot')(noEvent, button());

      expect(ctx.context.reviewBotClient.trigger).not.toHaveBeenCalled();
    });
  });

  describe('trigger_archbot', () => {
    it('triggers the client, sets the state and refreshes the header', async () => {
      await getAction('trigger_archbot')(noEvent, button('t1'));

      expect(ctx.context.archBotClient.trigger).toHaveBeenCalledWith('p1', 't1');
      expect(ctx.state.archbotState).toEqual({ status: 'inProgress', taskId: 't1' });
      expect(ctx.refresh.header).toHaveBeenCalled();
    });

    it('alerts on failure', async () => {
      const alertSpy = vi.fn();
      vi.stubGlobal('alert', alertSpy);
      vi.spyOn(console, 'error').mockImplementation(() => {});
      (ctx.context.archBotClient.trigger as any).mockRejectedValueOnce(new Error('boom'));

      await getAction('trigger_archbot')(noEvent, button('t1'));

      expect(alertSpy).toHaveBeenCalledWith('Failed to trigger ArchitectureBot');
      expect(ctx.refresh.header).not.toHaveBeenCalled();
    });
  });

  describe('trigger_specagent', () => {
    it('triggers the client, sets the state and refreshes the header', async () => {
      await getAction('trigger_specagent')(noEvent, button('t1'));

      expect(ctx.context.specBotClient.trigger).toHaveBeenCalledWith('p1', 't1');
      expect(ctx.state.specagentState).toEqual({ status: 'inProgress', taskId: 't1' });
      expect(ctx.refresh.header).toHaveBeenCalled();
    });

    it('alerts on failure', async () => {
      const alertSpy = vi.fn();
      vi.stubGlobal('alert', alertSpy);
      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(console, 'log').mockImplementation(() => {});
      (ctx.context.specBotClient.trigger as any).mockRejectedValueOnce(new Error('boom'));

      await getAction('trigger_specagent')(noEvent, button('t1'));

      expect(alertSpy).toHaveBeenCalledWith('Failed to trigger the specification bot');
      expect(ctx.refresh.header).not.toHaveBeenCalled();
    });

    it('is a no-op without data-task-id', async () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await getAction('trigger_specagent')(noEvent, button());

      expect(ctx.context.specBotClient.trigger).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalled();
    });
  });

  describe('trigger_coderbot', () => {
    it('optimistically marks the task INPROGRESS and re-syncs the engine slot', async () => {
      const task = new Task({ id: 't1', status: TaskStatus.CREATED });
      ctx.state.allLoadedTasks = [task];

      await getAction('trigger_coderbot')(noEvent, button('t1'));

      expect(ctx.context.coderBotClient.triggerCoderBot).toHaveBeenCalledWith('t1');
      expect(task.status).toBe(TaskStatus.INPROGRESS);
      expect(ctx.context.dataManager.updateTask).toHaveBeenCalledWith(task);
      expect(ctx.refresh.header).toHaveBeenCalled();
      expect(deps.updateEngineSlot).toHaveBeenCalled();
    });

    it('does not touch a task that is already INPROGRESS', async () => {
      const task = new Task({ id: 't1', status: TaskStatus.INPROGRESS });
      ctx.state.allLoadedTasks = [task];

      await getAction('trigger_coderbot')(noEvent, button('t1'));

      expect(ctx.context.dataManager.updateTask).not.toHaveBeenCalled();
      expect(ctx.refresh.header).toHaveBeenCalled();
      expect(deps.updateEngineSlot).toHaveBeenCalled();
    });

    it('alerts on failure', async () => {
      const alertSpy = vi.fn();
      vi.stubGlobal('alert', alertSpy);
      vi.spyOn(console, 'error').mockImplementation(() => {});
      (ctx.context.coderBotClient.triggerCoderBot as any).mockRejectedValueOnce(new Error('boom'));

      await getAction('trigger_coderbot')(noEvent, button('t1'));

      expect(alertSpy).toHaveBeenCalledWith('Failed to trigger CoderBot');
      expect(ctx.refresh.header).not.toHaveBeenCalled();
    });
  });

  describe('DocBot actions', () => {
    it('registers only the trigger and dismiss actions', () => {
      const docbotActions = [...registry.keys()]
        .filter((name) => name.includes('docbot'))
        .sort();

      expect(docbotActions).toEqual([
        'dismiss_docbot_banner',
        'trigger_docbot',
      ]);
    });
  });

  describe('trigger_docbot', () => {
    it('pulses the button and clears the pulse after success', async () => {
      vi.useFakeTimers();

      const el = button();
      el.dataset.taskId = 't1';

      await getAction('trigger_docbot')(noEvent, el);

      expect(ctx.context.docBotClient.triggerDocBot).toHaveBeenCalledWith('p1', 't1');
      expect(el.classList.contains('animate-pulse')).toBe(true);
      expect(el.classList.contains('text-green-500')).toBe(true);

      vi.advanceTimersByTime(1000);

      expect(el.classList.contains('animate-pulse')).toBe(false);
      expect(el.classList.contains('text-green-500')).toBe(false);
    });

    it('toggles the red error class on failure', async () => {
      vi.useFakeTimers();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      (ctx.context.docBotClient.triggerDocBot as any).mockRejectedValueOnce(new Error('boom'));

      const el = button();
      el.dataset.taskId = 't1';

      await getAction('trigger_docbot')(noEvent, el);

      expect(el.classList.contains('animate-pulse')).toBe(false);
      expect(el.classList.contains('text-green-500')).toBe(false);
      expect(el.classList.contains('text-red-500')).toBe(true);

      vi.advanceTimersByTime(2000);

      expect(el.classList.contains('text-red-500')).toBe(false);
    });

    it('is a no-op without a task id', async () => {
      await getAction('trigger_docbot')(noEvent, button());

      expect(ctx.context.docBotClient.triggerDocBot).not.toHaveBeenCalled();
    });
  });

  describe('open_spec_proposal', () => {
    it('selects the task, switches tab, refreshes and fetches the proposal', async () => {
      const task = new Task({ id: 't1' });
      ctx.state.allLoadedTasks = [task];
      ctx.state.pendingSpecEditTaskId = 'stale';

      await getAction('open_spec_proposal')(noEvent, button('t1'));

      expect(ctx.state.pendingSpecEditTaskId).toBeNull();
      expect(ctx.state.selectedTask).toBe(task);
      expect(deps.setContentTab).toHaveBeenCalledWith('task-editor', { hash: 'push' });
      expect(ctx.refresh.backlog).toHaveBeenCalled();
      expect(ctx.refresh.selectedTask).toHaveBeenCalled();
      expect(deps.fetchSpecProposal).toHaveBeenCalledWith('t1');
    });

    it('does not fetch when a proposal for the task is already pending', async () => {
      ctx.state.allLoadedTasks = [new Task({ id: 't1' })];
      ctx.state.pendingSpecProposals = [{ task_id: 't1' } as any];

      await getAction('open_spec_proposal')(noEvent, button('t1'));

      expect(deps.fetchSpecProposal).not.toHaveBeenCalled();
    });

    it('is a no-op without data-task-id', async () => {
      await getAction('open_spec_proposal')(noEvent, button());

      expect(deps.setContentTab).not.toHaveBeenCalled();
    });
  });

  describe('dismiss_docbot_banner', () => {
    it('resets the DocBot state and refreshes the header', async () => {
      ctx.state.docbotState = { status: 'prCreated', taskId: 't1' };

      await getAction('dismiss_docbot_banner')(noEvent, button());

      expect(ctx.state.docbotState).toEqual({ status: 'none', taskId: null });
      expect(ctx.refresh.header).toHaveBeenCalled();
    });
  });

  describe('open_coderbot_dialog', () => {
    it('prevents the default and constructs CoderBotDialog', async () => {
      const event = { preventDefault: vi.fn() } as unknown as Event;

      await getAction('open_coderbot_dialog')(event, button());

      expect((event as any).preventDefault).toHaveBeenCalled();
      expect(CoderBotDialog).toHaveBeenCalledTimes(1);
      expect((CoderBotDialog as any).mock.calls[0][0]).toBe(ctx.context.coderBotService);
    });
  });

  describe('update_design', () => {
    it('is a no-op when the dialog returns falsy', async () => {
      (UpdateDesignDialog as any).mockImplementationOnce(function CancelledDialog() {
        return { show: vi.fn().mockResolvedValue(null) };
      });

      await getAction('update_design')(noEvent, button('t1'));

      expect(ctx.context.archBotClient.iterate).not.toHaveBeenCalled();
      expect(ctx.refresh.header).not.toHaveBeenCalled();
    });

    it('iterates the design and sets the ArchBot state on confirm', async () => {
      await getAction('update_design')(noEvent, button('t1'));

      expect(ctx.context.archBotClient.iterate).toHaveBeenCalledWith('p1', 't1', 'comments');
      expect(ctx.state.archbotState).toEqual({ status: 'inProgress', taskId: 't1' });
      expect(ctx.refresh.header).toHaveBeenCalled();
    });

    it('alerts on failure', async () => {
      const alertSpy = vi.fn();
      vi.stubGlobal('alert', alertSpy);
      vi.spyOn(console, 'error').mockImplementation(() => {});
      (ctx.context.archBotClient.iterate as any).mockRejectedValueOnce(new Error('boom'));

      await getAction('update_design')(noEvent, button('t1'));

      expect(alertSpy).toHaveBeenCalledWith('Failed to update design document');
      expect(ctx.refresh.header).not.toHaveBeenCalled();
    });
  });

  describe('open_review_dialog', () => {
    it('removes the pending id, persists, refreshes and opens the dialog', async () => {
      const task = new Task({ id: 't1' });
      ctx.state.allLoadedTasks = [task];
      ctx.state.pendingReviews = ['t1', 't2'];

      await getAction('open_review_dialog')(noEvent, button('t1'));

      expect(ctx.state.pendingReviews).toEqual(['t2']);
      expect(deps.persistPendingReviews).toHaveBeenCalled();
      expect(ctx.refresh.header).toHaveBeenCalled();
      expect(ReviewDialog).toHaveBeenCalledTimes(1);
      const props = (ReviewDialog as any).mock.calls[0][0];
      expect(props.task).toBe(task);
      expect(props.pipelineId).toBe('p1');
      expect(props.context).toBe(ctx.context);
    });

    it('still removes and persists when the task is not loaded, but does not open the dialog', async () => {
      ctx.state.allLoadedTasks = [];
      ctx.state.pendingReviews = ['t1'];

      await getAction('open_review_dialog')(noEvent, button('t1'));

      expect(ctx.state.pendingReviews).toEqual([]);
      expect(deps.persistPendingReviews).toHaveBeenCalled();
      expect(ctx.refresh.header).toHaveBeenCalled();
      expect(ReviewDialog).not.toHaveBeenCalled();
    });

    it('is a no-op without data-task-id', async () => {
      await getAction('open_review_dialog')(noEvent, button());

      expect(deps.persistPendingReviews).not.toHaveBeenCalled();
      expect(ReviewDialog).not.toHaveBeenCalled();
    });
  });
});
