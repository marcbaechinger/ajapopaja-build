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
import { registerPullRequestActions } from './pullRequestActions.ts';
import type { PullRequestActionsDeps } from './pullRequestActions.ts';
import type { PipelineDetailCtx } from '../PipelineDetailCtx.ts';
import type { ActionHandler } from '../../../../core/ActionRegistry.ts';
import { ConfirmationDialog } from '../../../components/dialogs/ConfirmationDialog.ts';
import { IteratePullRequestDialog } from '../../../components/dialogs/IteratePullRequestDialog.ts';
import { PullRequestDialog } from '../../../components/dialogs/PullRequestDialog.ts';

vi.mock('../../../components/dialogs/ConfirmationDialog.ts', () => ({
  ConfirmationDialog: vi.fn(function ConfirmationDialog() {
    return { show: vi.fn().mockResolvedValue(true) };
  }),
}));

vi.mock('../../../components/dialogs/IteratePullRequestDialog.ts', () => ({
  IteratePullRequestDialog: vi.fn(function IteratePullRequestDialog() {
    return { show: vi.fn().mockResolvedValue('Review comments') };
  }),
}));

vi.mock('../../../components/dialogs/PullRequestDialog.ts', () => ({
  PullRequestDialog: vi.fn(function PullRequestDialog() {
    return { show: vi.fn().mockResolvedValue(undefined) };
  }),
}));

/** The four handlers never read the event; a placeholder keeps the signature. */
const noEvent = null as unknown as Event;

describe('registerPullRequestActions', () => {
  let registry: Map<string, ActionHandler>;
  let ctx: PipelineDetailCtx;
  let deps: PullRequestActionsDeps;
  let acceptPullRequest: ReturnType<typeof vi.fn>;
  let iteratePullRequest: ReturnType<typeof vi.fn>;

  const getAction = (name: string): ActionHandler => {
    const handler = registry.get(name);
    if (!handler) throw new Error(`action "${name}" was not registered`);
    return handler;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';

    registry = new Map<string, ActionHandler>();
    acceptPullRequest = vi.fn().mockResolvedValue({});
    iteratePullRequest = vi.fn().mockResolvedValue({});

    ctx = {
      context: {
        actionRegistry: {
          register: (name: string, handler: ActionHandler) => registry.set(name, handler),
        },
        pullRequestClient: {
          acceptPullRequest,
          iteratePullRequest,
        },
      },
      pipelineId: 'p1',
    } as unknown as PipelineDetailCtx;

    deps = {
      refreshPullRequests: vi.fn(),
      updateEngineSlot: vi.fn(),
    };

    registerPullRequestActions(ctx, deps);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should register the accept_pr action', () => {
    expect(registry.has('accept_pr')).toBe(true);
  });

  it('should register the iterate_pr action', () => {
    expect(registry.has('iterate_pr')).toBe(true);
  });

  it('should register all four pull-request actions', () => {
    expect([...registry.keys()].sort()).toEqual([
      'accept_pr',
      'iterate_pr',
      'open_pr_dialog',
      'toggle_pr_summary',
    ]);
  });

  describe('open_pr_dialog', () => {
    it('constructs PullRequestDialog with the right props and refreshes on accept/reject', async () => {
      const action = getAction('open_pr_dialog');
      const el = document.createElement('button');
      el.setAttribute('data-task-id', 't1');
      el.setAttribute('data-pr-id', 'pr1');

      await action(noEvent, el);

      expect(PullRequestDialog).toHaveBeenCalledTimes(1);
      const props = (PullRequestDialog as any).mock.calls[0][0];
      expect(props).toMatchObject({
        taskId: 't1',
        prId: 'pr1',
        pipelineId: 'p1',
      });
      expect(props.context).toBe(ctx.context);

      props.onAccept();
      props.onReject();
      expect(deps.refreshPullRequests).toHaveBeenCalledTimes(2);
    });

    it('passes prId as undefined when data-pr-id is missing', async () => {
      const action = getAction('open_pr_dialog');
      const el = document.createElement('button');
      el.setAttribute('data-task-id', 't1');

      await action(noEvent, el);

      const props = (PullRequestDialog as any).mock.calls[0][0];
      expect(props.prId).toBeUndefined();
    });

    it('does not open the dialog without data-task-id', async () => {
      const action = getAction('open_pr_dialog');
      const el = document.createElement('button');

      await action(noEvent, el);

      expect(PullRequestDialog).not.toHaveBeenCalled();
    });
  });

  describe('accept_pr', () => {
    it('should call acceptPullRequest and refresh after confirmation', async () => {
      const action = getAction('accept_pr');
      const el = document.createElement('button');
      el.setAttribute('data-pr-id', 'pr1');

      await action(noEvent, el);

      expect(acceptPullRequest).toHaveBeenCalledWith('pr1');
      expect(deps.refreshPullRequests).toHaveBeenCalled();
    });

    it('should not call acceptPullRequest when the confirmation is cancelled', async () => {
      (ConfirmationDialog as any).mockImplementationOnce(function CancelledDialog() {
        return { show: vi.fn().mockResolvedValue(false) };
      });

      const action = getAction('accept_pr');
      const el = document.createElement('button');
      el.setAttribute('data-pr-id', 'pr1');

      await action(noEvent, el);

      expect(acceptPullRequest).not.toHaveBeenCalled();
      expect(deps.refreshPullRequests).not.toHaveBeenCalled();
    });

    it('should not call acceptPullRequest when data-pr-id is missing', async () => {
      const action = getAction('accept_pr');
      const el = document.createElement('button');

      await action(noEvent, el);

      expect(acceptPullRequest).not.toHaveBeenCalled();
    });

    it('refreshes the mutated task through the DataManager after accepting', async () => {
      const fresh = { id: 't1', status: 'submitted' };
      const get = vi.fn().mockResolvedValue(fresh);
      const updateTask = vi.fn();
      (ctx.context as any).taskClient = { get };
      (ctx.context as any).dataManager = { updateTask };

      const action = getAction('accept_pr');
      const el = document.createElement('button');
      el.setAttribute('data-pr-id', 'pr1');
      el.setAttribute('data-task-id', 't1');

      await action(noEvent, el);

      // The task is re-read and pushed through the DataManager so the pipeline's
      // incremental update path can patch the TaskItem header in place.
      expect(get).toHaveBeenCalledWith('t1');
      expect(updateTask).toHaveBeenCalledWith(fresh);
    });

    it('still accepts the PR when refreshing the mutated task fails', async () => {
      const get = vi.fn().mockRejectedValue(new Error('offline'));
      (ctx.context as any).taskClient = { get };
      (ctx.context as any).dataManager = { updateTask: vi.fn() };
      vi.spyOn(console, 'error').mockImplementation(() => {});

      const action = getAction('accept_pr');
      const el = document.createElement('button');
      el.setAttribute('data-pr-id', 'pr1');
      el.setAttribute('data-task-id', 't1');

      await expect(action(noEvent, el)).resolves.toBeUndefined();
      expect(acceptPullRequest).toHaveBeenCalledWith('pr1');
      expect(deps.refreshPullRequests).toHaveBeenCalled();
    });

    it('restores the button and surfaces the error message when accept fails', async () => {
      const alertSpy = vi.fn();
      vi.stubGlobal('alert', alertSpy);
      vi.spyOn(console, 'error').mockImplementation(() => {});
      acceptPullRequest.mockRejectedValueOnce(new Error('boom'));

      const action = getAction('accept_pr');
      const el = document.createElement('button');
      el.setAttribute('data-pr-id', 'pr1');
      el.textContent = 'Accept';

      await action(noEvent, el);

      expect(alertSpy).toHaveBeenCalledWith('Failed to accept Pull Request: boom');
      expect(el.disabled).toBe(false);
      expect(el.textContent).toBe('Accept');
      expect(deps.refreshPullRequests).not.toHaveBeenCalled();
    });
  });

  describe('iterate_pr', () => {
    it('should open the dialog and call iteratePullRequest on confirm', async () => {
      const action = getAction('iterate_pr');
      const el = document.createElement('button');
      el.setAttribute('data-pr-id', 'pr1');
      el.setAttribute('data-task-id', 't1');

      await action(noEvent, el);

      expect(iteratePullRequest).toHaveBeenCalledWith('pr1', 'Review comments');
      expect(deps.updateEngineSlot).toHaveBeenCalled();
    });

    it('should not call iteratePullRequest when the dialog is cancelled', async () => {
      (IteratePullRequestDialog as any).mockImplementationOnce(function CancelledDialog() {
        return { show: vi.fn().mockResolvedValue(null) };
      });

      const action = getAction('iterate_pr');
      const el = document.createElement('button');
      el.setAttribute('data-pr-id', 'pr1');
      el.setAttribute('data-task-id', 't1');

      await action(noEvent, el);

      expect(iteratePullRequest).not.toHaveBeenCalled();
      expect(deps.updateEngineSlot).not.toHaveBeenCalled();
    });

    it('should not call iteratePullRequest when data-pr-id is missing', async () => {
      const action = getAction('iterate_pr');
      const el = document.createElement('button');

      await action(noEvent, el);

      expect(iteratePullRequest).not.toHaveBeenCalled();
    });

    it('does not update the engine slot when iteration fails', async () => {
      const alertSpy = vi.fn();
      vi.stubGlobal('alert', alertSpy);
      vi.spyOn(console, 'error').mockImplementation(() => {});
      iteratePullRequest.mockRejectedValueOnce(new Error('nope'));

      const action = getAction('iterate_pr');
      const el = document.createElement('button');
      el.setAttribute('data-pr-id', 'pr1');
      el.setAttribute('data-task-id', 't1');

      await action(noEvent, el);

      expect(deps.updateEngineSlot).not.toHaveBeenCalled();
      expect(alertSpy).toHaveBeenCalledWith('Failed to start iteration: nope');
    });
  });

  describe('toggle_pr_summary', () => {
    const buildCard = () => {
      const card = document.createElement('div');
      card.setAttribute('data-pr-card', '');
      const body = document.createElement('div');
      body.className = 'pr-summary hidden';
      const button = document.createElement('button');
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.classList.add('transform');
      button.appendChild(icon);
      card.appendChild(body);
      card.appendChild(button);
      return { card, body, button, icon };
    };

    it('toggles the summary body and the icon rotation class', () => {
      const { body, button, icon } = buildCard();
      const action = getAction('toggle_pr_summary');

      action(noEvent, button);
      expect(body.classList.contains('hidden')).toBe(false);
      expect(icon.classList.contains('rotate-90')).toBe(true);

      action(noEvent, button);
      expect(body.classList.contains('hidden')).toBe(true);
      expect(icon.classList.contains('rotate-90')).toBe(false);
    });

    it('is a no-op without a [data-pr-card] ancestor', () => {
      const button = document.createElement('button');
      const action = getAction('toggle_pr_summary');

      expect(() => action(noEvent, button)).not.toThrow();
    });
  });
});
