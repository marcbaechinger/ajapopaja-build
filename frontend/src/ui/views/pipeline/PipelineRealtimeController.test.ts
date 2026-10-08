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
import { PipelineRealtimeController } from './PipelineRealtimeController.ts';
import { createPipelineDetailCtx, type PipelineDetailCtx } from './PipelineDetailCtx.ts';
import { LocalStorageManager } from '../../../core/LocalStorageManager.ts';
import { ExecutionEngineView } from '../../components/pipeline/ExecutionEngineView.ts';
import { TaskItem } from '../../components/pipeline/TaskItem.ts';
import { TaskStatus } from '../../../core/domain.ts';
import type { AppContext } from '../../../core/AppContext.ts';

const PR: any = {
  id: 'pr1',
  _id: 'pr1',
  pipeline_id: 'p1',
  task_id: 't1',
  subject: 'My PR',
  branch_name: 'feature/x',
  status: 'open',
  created_at: '2026-04-12T10:00:00Z',
};

describe('PipelineRealtimeController', () => {
  let ctx: PipelineDetailCtx;
  let host: HTMLElement;
  let handlers: Record<string, (payload: any) => void>;
  let context: any;
  let callbacks: any;
  let storageSetItem: ReturnType<typeof vi.fn>;
  let controller: PipelineRealtimeController | null;

  beforeEach(() => {
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
    handlers = {};
    controller = null;

    storageSetItem = vi.fn();
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: storageSetItem,
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(),
      length: 0,
    });
    LocalStorageManager.resetInstances();

    context = {
      dataManager: {
        on: vi.fn((event: string, handler: (payload: any) => void) => {
          handlers[event] = handler;
          return () => {
            delete handlers[event];
          };
        }),
        updateTask: vi.fn(),
        updatePipeline: vi.fn(),
      },
      pullRequestClient: {
        getPullRequestsByPipeline: vi.fn().mockResolvedValue([]),
      },
      authService: {
        getAccessToken: vi.fn().mockReturnValue('token'),
      },
      specBotClient: {
        getProposal: vi.fn().mockResolvedValue(null),
        getProposals: vi.fn().mockResolvedValue([]),
      },
      interactiveCodingService: {
        refreshSession: vi.fn().mockResolvedValue(undefined),
      },
    };

    ctx = createPipelineDetailCtx({
      context: context as unknown as AppContext,
      pipelineId: 'p1',
      refresh: {
        header: vi.fn(),
        backlog: vi.fn(),
        selectedTask: vi.fn(),
        executionEngine: vi.fn(),
        sessionList: vi.fn(),
        specProposals: vi.fn(),
      },
    });

    callbacks = {
      refreshTasks: vi.fn(),
      updateSingleTask: vi.fn(),
      scheduleRefreshGitStatus: vi.fn(),
      openCodingAgent: vi.fn(),
      syncInteractiveSession: vi.fn(),
    };
  });

  afterEach(() => {
    controller?.stop();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const makeController = (): PipelineRealtimeController => {
    controller = new PipelineRealtimeController({
      ctx,
      getHost: () => host,
      callbacks,
    });
    return controller;
  };

  describe('pending reviews', () => {
    it('tracks pending reviews from REVIEWBOT_REVIEW_READY events', () => {
      const ctrl = makeController();
      ctrl.start();

      const handler = handlers['ws:REVIEWBOT_REVIEW_READY:p1'];
      expect(handler).toBeDefined();

      handler({ id: 't1', pipeline_id: 'p1' });
      handler({ id: 't2', pipeline_id: 'p1' });

      expect(ctx.state.pendingReviews).toEqual(['t1', 't2']);
      expect(ctx.state.reviewbotState).toEqual({ status: 'none', taskId: null });
      expect(storageSetItem).toHaveBeenCalledWith(
        'pipeline:pending_reviews:p1',
        JSON.stringify(['t1', 't2'])
      );
    });

    it('loads persisted pending reviews for the pipeline', () => {
      (localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(
        JSON.stringify(['seed'])
      );
      LocalStorageManager.resetInstances();

      makeController().loadPendingReviews();

      expect(localStorage.getItem).toHaveBeenCalledWith('pipeline:pending_reviews:p1');
      expect(ctx.state.pendingReviews).toEqual(['seed']);
    });

    it('persistPendingReviews writes the shared state back to storage', () => {
      ctx.state.pendingReviews = ['t1'];
      makeController().persistPendingReviews();
      expect(storageSetItem).toHaveBeenCalledWith(
        'pipeline:pending_reviews:p1',
        JSON.stringify(['t1'])
      );
    });
  });

  describe('pipeline:tasks', () => {
    it('removes a deleted task and refreshes backlog/selection/engine', () => {
      ctx.state.allLoadedTasks = [
        { id: 't1', status: TaskStatus.CREATED } as any,
        { id: 't2', status: TaskStatus.CREATED } as any,
      ];
      const ctrl = makeController();
      ctrl.start();

      handlers['pipeline:tasks:p1']({ id: 't1', deleted: true });

      expect(ctx.state.allLoadedTasks.map((t) => t.id)).toEqual(['t2']);
      expect(ctx.refresh.backlog).toHaveBeenCalledTimes(1);
      expect(ctx.refresh.selectedTask).toHaveBeenCalledTimes(1);
      expect(ctx.refresh.executionEngine).toHaveBeenCalledTimes(1);
      expect(ctx.refresh.header).toHaveBeenCalledTimes(1);
      expect(callbacks.updateSingleTask).not.toHaveBeenCalled();
    });

    it('delegates an update to updateSingleTask and refreshes the header', () => {
      const ctrl = makeController();
      ctrl.start();
      const task = { id: 't1', status: TaskStatus.CREATED } as any;

      handlers['pipeline:tasks:p1'](task);

      expect(callbacks.updateSingleTask).toHaveBeenCalledWith(task);
      expect(callbacks.scheduleRefreshGitStatus).not.toHaveBeenCalled();
      expect(ctx.refresh.header).toHaveBeenCalledTimes(1);
    });

    it('schedules a git-status refresh only once a task becomes IMPLEMENTED', () => {
      const ctrl = makeController();
      ctrl.start();

      handlers['pipeline:tasks:p1']({ id: 't1', status: TaskStatus.IMPLEMENTED } as any);

      expect(callbacks.updateSingleTask).toHaveBeenCalledTimes(1);
      expect(callbacks.scheduleRefreshGitStatus).toHaveBeenCalledTimes(1);
    });

    it('ignores a falsy task payload', () => {
      const ctrl = makeController();
      ctrl.start();

      handlers['pipeline:tasks:p1'](null);

      expect(ctx.refresh.header).not.toHaveBeenCalled();
    });
  });

  describe('pull requests', () => {
    it('renders the pull request section inside a dedicated container', async () => {
      host.innerHTML = '<div id="pull-request-section"></div>';
      context.pullRequestClient.getPullRequestsByPipeline.mockResolvedValue([PR]);

      await makeController().refreshPullRequests();

      expect(context.pullRequestClient.getPullRequestsByPipeline).toHaveBeenCalledWith('p1');
      expect(ctx.state.pullRequests).toEqual([PR]);
      expect(host.querySelector('#pull-request-section')!.innerHTML).toContain('My PR');
    });

    it('inserts a PULL_REQUEST_CREATED update precisely without re-rendering the rest of the page', async () => {
      host.innerHTML = `
        <div id="selected-task-view">selected</div>
        <div id="execution-engine-view">engine</div>
        <div id="backlog-view">backlog</div>
        <div id="pull-request-section"></div>
      `;
      const selected = host.querySelector('#selected-task-view') as HTMLElement;
      const engine = host.querySelector('#execution-engine-view') as HTMLElement;
      const backlog = host.querySelector('#backlog-view') as HTMLElement;

      const ctrl = makeController();
      ctrl.start();

      const newPr = { ...PR, id: 'pr2', _id: 'pr2', task_id: 't2', subject: 'Freshly Created PR' };
      context.pullRequestClient.getPullRequestsByPipeline.mockResolvedValue([newPr]);

      handlers['ws:PULL_REQUEST_CREATED:p1']({ task_id: 't2' });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(host.querySelector('#pull-request-section')!.innerHTML).toContain('Freshly Created PR');
      expect(selected.innerHTML).toBe('selected');
      expect(engine.innerHTML).toBe('engine');
      expect(backlog.innerHTML).toBe('backlog');
      // The lightweight insert never triggers a full task refresh (which would
      // re-publish every task through the DataManager).
      expect(callbacks.refreshTasks).not.toHaveBeenCalled();
      expect(context.dataManager.updateTask).not.toHaveBeenCalled();
    });

    it('fetchPullRequests stores the PRs then triggers a full task refresh', async () => {
      context.pullRequestClient.getPullRequestsByPipeline.mockResolvedValue([PR]);

      await makeController().fetchPullRequests();

      expect(ctx.state.pullRequests).toEqual([PR]);
      expect(callbacks.refreshTasks).toHaveBeenCalledTimes(1);
    });

    it('removeTaskFromInProgressOnPullRequest only transitions INPROGRESS tasks', () => {
      host.innerHTML = '<div id="execution-engine-view"></div>';
      const removeSpy = vi
        .spyOn(ExecutionEngineView, 'removeInProgressItem')
        .mockReturnValue(true);

      const inProgress = { id: 't1', status: TaskStatus.INPROGRESS } as any;
      const implemented = { id: 't2', status: TaskStatus.IMPLEMENTED } as any;
      ctx.state.allLoadedTasks = [inProgress, implemented];

      const ctrl = makeController();
      ctrl.removeTaskFromInProgressOnPullRequest('t1');

      expect(inProgress.status).toBe(TaskStatus.PULL_REQUEST_AVAILABLE);
      expect(removeSpy).toHaveBeenCalledWith(host.querySelector('#execution-engine-view'), 't1');

      ctrl.removeTaskFromInProgressOnPullRequest('t2');
      expect(implemented.status).toBe(TaskStatus.IMPLEMENTED);

      ctrl.removeTaskFromInProgressOnPullRequest(undefined);
      ctrl.removeTaskFromInProgressOnPullRequest('missing');
      expect(removeSpy).toHaveBeenCalledTimes(1);
    });

    it('patches the rendered TaskItem header in place when a PR is created from INPROGRESS', () => {
      host.innerHTML = `
        <div id="selected-task-view"></div>
        <div id="execution-engine-view"></div>
      `;
      const view = host.querySelector('#selected-task-view') as HTMLElement;
      const task = {
        id: 't1',
        title: 'Task',
        spec: 'a spec',
        status: TaskStatus.INPROGRESS,
        deleted: false,
        version: 1,
        order: 0,
        type: 'manual',
        want_design_doc: false,
      } as any;
      ctx.state.allLoadedTasks = [task];
      view.innerHTML = TaskItem.render(task, false, false, false, false, true);

      const card = view.querySelector('[data-view-id="t1"]')!;
      const bodyBefore = card.querySelector('.task-body');
      vi.spyOn(ExecutionEngineView, 'removeInProgressItem').mockReturnValue(true);

      makeController().removeTaskFromInProgressOnPullRequest('t1');

      // Only the header is replaced: the card and its body survive, while the
      // status badge and action toolbar reflect the new state.
      expect(view.querySelector('[data-view-id="t1"]')).toBe(card);
      expect(card.querySelector('.task-body')).toBe(bodyBefore);
      expect(card.querySelector('.status-badge')!.textContent).toContain(
        TaskStatus.PULL_REQUEST_AVAILABLE
      );
      expect(card.querySelector('[data-action-click="open_pr_dialog"]')).not.toBeNull();
      expect(task.status).toBe(TaskStatus.PULL_REQUEST_AVAILABLE);
    });
  });

  describe('dev process', () => {
    it('updates the indicator from DEV_PROCESS_STARTED/EXITED events', () => {
      const ctrl = makeController();
      ctrl.start();

      handlers['ws:DEV_PROCESS_STARTED:p1']({ pid: 9, port: 1224, pipeline_id: 'p1' });
      expect(ctx.state.devProcessState).toEqual({ running: true, pid: 9, port: 1224 });

      handlers['ws:DEV_PROCESS_EXITED:p1']({ pipeline_id: 'p1', exit_code: 0 });
      expect(ctx.state.devProcessState).toEqual({ running: false, pid: null, port: null });
    });
  });

  describe('interactive session', () => {
    it('INTERACTIVE_STARTED refreshes the session then opens the Coding Agent', async () => {
      const ctrl = makeController();
      ctrl.start();

      handlers['ws:INTERACTIVE_STARTED:p1']({ pipeline_id: 'p1' });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(context.interactiveCodingService.refreshSession).toHaveBeenCalledTimes(1);
      expect(callbacks.openCodingAgent).toHaveBeenCalledTimes(1);
    });

    it('INTERACTIVE_STOPPED re-syncs the interactive session', () => {
      const ctrl = makeController();
      ctrl.start();

      handlers['ws:INTERACTIVE_STOPPED:p1']({ pipeline_id: 'p1' });

      expect(callbacks.syncInteractiveSession).toHaveBeenCalledTimes(1);
    });

    it('ignores INTERACTIVE_STARTED/STOPPED for another pipeline', async () => {
      const ctrl = makeController();
      ctrl.start();

      handlers['ws:INTERACTIVE_STARTED:p1']({ pipeline_id: 'other' });
      handlers['ws:INTERACTIVE_STOPPED:p1']({ pipeline_id: 'other' });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(context.interactiveCodingService.refreshSession).not.toHaveBeenCalled();
      expect(callbacks.openCodingAgent).not.toHaveBeenCalled();
      expect(callbacks.syncInteractiveSession).not.toHaveBeenCalled();
    });
  });

  describe('DocBot preview', () => {
    it('sets the preview/state and refreshes the header on success', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ task_id: 't1', diff: 'd' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await makeController().fetchDocBotPreview('t1');

      expect(fetchMock).toHaveBeenCalledWith('/api/pipelines/p1/docbot/preview/t1', {
        headers: { Authorization: 'Bearer token' },
      });
      expect(ctx.state.docbotPreviewData).toEqual({ task_id: 't1', diff: 'd' });
      expect(ctx.state.docbotState).toEqual({ status: 'ready', taskId: 't1' });
      expect(ctx.refresh.header).toHaveBeenCalledTimes(1);
    });

    it('leaves the state untouched on a non-ok response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));

      await makeController().fetchDocBotPreview('t1');

      expect(ctx.state.docbotPreviewData).toBeNull();
      expect(ctx.state.docbotState).toEqual({ status: 'none', taskId: null });
      expect(ctx.refresh.header).not.toHaveBeenCalled();
    });
  });

  describe('SpecAgent proposals', () => {
    it('ignores a SPECAGENT_SPEC_READY event for another pipeline', () => {
      const ctrl = makeController();
      ctrl.start();

      handlers['ws:SPECAGENT_SPEC_READY:p1']({ task_id: 't1', pipeline_id: 'other' });

      expect(context.specBotClient.getProposal).not.toHaveBeenCalled();
    });

    it('toggles the in-progress state on SPECAGENT_STARTED/COMPLETED', () => {
      const ctrl = makeController();
      ctrl.start();

      handlers['ws:SPECAGENT_STARTED:p1']({ task_id: 't1' });
      expect(ctx.state.specagentState).toEqual({ status: 'inProgress', taskId: 't1' });

      handlers['ws:SPECAGENT_COMPLETED:p1']({ id: 't1' });
      expect(ctx.state.specagentState).toEqual({ status: 'none', taskId: null });
    });

    it('reconciles outstanding proposals even when no task card is mounted', async () => {
      context.specBotClient.getProposals.mockResolvedValue([
        { task_id: 't9', pipeline_id: 'p1', spec_md: '# late', rationale: '' },
      ]);

      await makeController().fetchSpecProposals();

      expect(context.specBotClient.getProposals).toHaveBeenCalledWith('p1');
      expect(ctx.state.pendingSpecProposals).toHaveLength(1);
      expect(ctx.state.pendingSpecProposals[0].task_id).toBe('t9');
      expect(ctx.refresh.specProposals).toHaveBeenCalledTimes(1);
      expect(ctx.refresh.header).toHaveBeenCalledTimes(1);
    });

    it('fetchSpecProposal drops a falsy proposal without refreshing', async () => {
      context.specBotClient.getProposal.mockResolvedValue(null);

      await makeController().fetchSpecProposal('t1');

      expect(ctx.state.pendingSpecProposals).toEqual([]);
      expect(ctx.refresh.specProposals).not.toHaveBeenCalled();
      expect(ctx.refresh.header).not.toHaveBeenCalled();
    });

    it('fetchSpecProposal upserts the proposal and triggers the refresh hooks', async () => {
      const proposal = { task_id: 't1', pipeline_id: 'p1', spec_md: '# x' };
      context.specBotClient.getProposal.mockResolvedValue(proposal);

      await makeController().fetchSpecProposal('t1');

      expect(context.specBotClient.getProposal).toHaveBeenCalledWith('p1', 't1');
      expect(ctx.state.pendingSpecProposals).toEqual([proposal]);
      expect(ctx.refresh.specProposals).toHaveBeenCalledTimes(1);
      expect(ctx.refresh.header).toHaveBeenCalledTimes(1);
    });

    it('upsertPendingSpecProposal replaces same-task_id entries; remove filters and refreshes', () => {
      const ctrl = makeController();

      ctrl.upsertPendingSpecProposal({ task_id: 't1', spec_md: 'a' } as any);
      ctrl.upsertPendingSpecProposal({ task_id: 't2', spec_md: 'b' } as any);
      ctrl.upsertPendingSpecProposal({ task_id: 't1', spec_md: 'c' } as any);

      expect(ctx.state.pendingSpecProposals.map((p) => p.spec_md)).toEqual(['c', 'b']);

      ctrl.removePendingSpecProposal('t1');

      expect(ctx.state.pendingSpecProposals.map((p) => p.task_id)).toEqual(['t2']);
      expect(ctx.refresh.specProposals).toHaveBeenCalledTimes(1);
      expect(ctx.refresh.header).toHaveBeenCalledTimes(1);
    });
  });

  describe('stop()', () => {
    it('removes every subscription so later emissions are ignored', () => {
      const ctrl = makeController();
      ctrl.start();

      expect(Object.keys(handlers).length).toBeGreaterThan(0);
      expect(handlers['ws:DEV_PROCESS_STARTED:p1']).toBeDefined();

      ctrl.stop();

      expect(Object.keys(handlers)).toHaveLength(0);
      expect(ctx.state.devProcessState).toBeUndefined();

      // Safe to call twice.
      expect(() => ctrl.stop()).not.toThrow();
    });
  });
});
