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

import { ExecutionEngineView } from '../../components/pipeline/ExecutionEngineView.ts';
import { PullRequestSection } from '../../components/pipeline/PullRequestSection.ts';
import { TaskItem } from '../../components/pipeline/TaskItem.ts';
import { TaskStatus } from '../../../core/domain.ts';
import type { Pipeline, Task } from '../../../core/domain.ts';
import type { SpecProposal } from '../../../core/clients/SpecBotClient.ts';
import { LocalStorageManager } from '../../../core/LocalStorageManager.ts';
import type { PipelineDetailCtx } from './PipelineDetailCtx.ts';

/** Shell / cross-controller effects the realtime controller must trigger. */
export interface PipelineRealtimeCallbacks {
  /** Full task refresh after the initial PR load. */
  refreshTasks(): void;
  /** Incremental single-task update (P7 SelectedTaskController). */
  updateSingleTask(task: Task): void;
  /** Coalesced git-status repoll after a task becomes IMPLEMENTED (shell poller). */
  scheduleRefreshGitStatus(): void;
  /** Activate the Coding Agent tab and re-sync its slot (P8). */
  openCodingAgent(): void;
  /** Re-sync the Coding Agent slot only (P8). */
  syncInteractiveSession(): void;
}

export interface PipelineRealtimeControllerDeps {
  ctx: PipelineDetailCtx;
  /** The mounted view root; queried for #pull-request-section / #execution-engine-view. */
  getHost(): HTMLElement | null;
  callbacks: PipelineRealtimeCallbacks;
}

/**
 * Owns the DataManager / WebSocket subscription wiring and the realtime data
 * fetchers that reconcile the shared `ctx.state` bot / PR / dev-process state.
 *
 * Extracted verbatim from `PipelineDetailView` (P6). The shell keeps only the
 * `start()` / `stop()` lifecycle call. Host-dependent DOM lookups go through
 * the lazily-evaluated `getHost()` callback so the controller can be
 * constructed before `mount()`.
 */
export class PipelineRealtimeController {
  private readonly deps: PipelineRealtimeControllerDeps;
  private readonly unsubs: (() => void)[] = [];
  private readonly storage = LocalStorageManager.getInstance('pipeline');

  constructor(deps: PipelineRealtimeControllerDeps) {
    this.deps = deps;
  }

  /** Loads the persisted pending-review ids (call once before `start()`). */
  loadPendingReviews(): void {
    const { state, pipelineId } = this.deps.ctx;
    state.pendingReviews = this.storage.get<string[]>(`pending_reviews:${pipelineId}`, []) || [];
  }

  /**
   * Persists `ctx.state.pendingReviews` after `open_review_dialog` consumes
   * one. Kept public so the P5b botActions persist callback can reach it; the
   * `REVIEWBOT_REVIEW_READY` handler uses the private `savePendingReviews()`.
   */
  persistPendingReviews(): void {
    this.savePendingReviews();
  }

  private savePendingReviews(): void {
    const { state, pipelineId } = this.deps.ctx;
    this.storage.put(`pending_reviews:${pipelineId}`, state.pendingReviews);
  }

  /** Subscribes to DataManager / WS events. */
  start(): void {
    const { ctx, callbacks } = this.deps;
    const dm = ctx.context.dataManager;

    // Listen for pipeline metadata updates
    this.unsubs.push(dm.on(`pipeline:${ctx.pipelineId}`, (pipeline: Pipeline) => {
      ctx.state.pipeline = pipeline;
      ctx.refresh.header();
    }));

    // Listen for task updates (created, updated, moved, deleted)
    this.unsubs.push(dm.on(`pipeline:tasks:${ctx.pipelineId}`, (taskOrDeleted: any) => {
      if (!taskOrDeleted) return;

      if (taskOrDeleted.deleted) {
        ctx.state.allLoadedTasks = ctx.state.allLoadedTasks.filter(t => t.id !== taskOrDeleted.id);
        ctx.refresh.backlog();
        ctx.refresh.selectedTask();
        ctx.refresh.executionEngine();
      } else {
        const task = taskOrDeleted as Task;
        callbacks.updateSingleTask(task);
        if (task.status === TaskStatus.IMPLEMENTED) {
          callbacks.scheduleRefreshGitStatus();
        }
      }
      ctx.refresh.header();
    }));

    // Listen for process and bot status updates via specific WS event queries
    const eventHandlers: Record<string, (payload: any) => void> = {
      'DOCBOT_STARTED': (p) => { ctx.state.docbotState = { status: 'inProgress', taskId: p.task_id }; },
      'DOCBOT_COMPLETED': (p) => {
        const result = p.result;
        if (result?.status === 'no_update_needed') {
          ctx.state.docbotState = { status: 'noUpdate', taskId: p.task_id, reason: result.reason };
        } else if (result?.status === 'update_needed') {
          if (ctx.state.docbotState.status !== 'ready') {
            this.fetchDocBotPreview(p.task_id);
          }
        } else if (ctx.state.docbotState.status !== 'ready') {
          ctx.state.docbotState = { status: 'none', taskId: null };
        }
      },
      'DOCBOT_PREVIEW_READY': (p) => { this.fetchDocBotPreview(p.task_id); },
      'REVIEWBOT_STARTED': (p) => { ctx.state.reviewbotState = { status: 'inProgress', taskId: p.task_id }; },
      'REVIEWBOT_COMPLETED': () => { ctx.state.reviewbotState = { status: 'none', taskId: null }; },
      'REVIEWBOT_REVIEW_READY': (p) => {
        ctx.state.reviewbotState = { status: 'none', taskId: null };
        const taskId = p.id || p._id || p.task_id;
        if (taskId && !ctx.state.pendingReviews.includes(taskId)) {
          ctx.state.pendingReviews.push(taskId);
          this.savePendingReviews();
        }
      },

      'ARCHBOT_STARTED': (p) => { ctx.state.archbotState = { status: 'inProgress', taskId: p.task_id }; },
      'ARCHBOT_COMPLETED': () => { ctx.state.archbotState = { status: 'none', taskId: null }; },
      'SPECAGENT_STARTED': (p) => {
        console.log('[SpecAgent] (4) PipelineDetailView SPECAGENT_STARTED', p);
        ctx.state.specagentState = { status: 'inProgress', taskId: p.task_id };
      },
      'SPECAGENT_COMPLETED': (p) => {
        console.log('[SpecAgent] (4) PipelineDetailView SPECAGENT_COMPLETED', p);
        ctx.state.specagentState = { status: 'none', taskId: null };
      },
      'SPECAGENT_SPEC_READY': (p) => {
        console.log(
          '[SpecAgent] (4) PipelineDetailView SPECAGENT_SPEC_READY',
          p,
          'view pipelineId=',
          ctx.pipelineId
        );
        if (p?.pipeline_id && p.pipeline_id !== ctx.pipelineId) {
          console.warn('[SpecAgent] (4) drop SPEC_READY: pipeline mismatch');
          return;
        }
        if (!p?.task_id) {
          console.warn('[SpecAgent] (4) drop SPEC_READY: missing task_id');
          return;
        }
        // Always reconcile, even when the owning task card is not mounted: the
        // proposal is surfaced through the header badge and (once selected) the
        // inline controls. The notification framework carries the primary path.
        void this.fetchSpecProposal(p.task_id);
      },
      'INTERACTIVE_STARTED': (p) => {
        if (p?.pipeline_id && p.pipeline_id !== ctx.pipelineId) return;
        // Re-attach to the freshly started session, then switch into the
        // interactive view for this pipeline.
        Promise.resolve(ctx.context.interactiveCodingService?.refreshSession?.()).then(() => {
          callbacks.openCodingAgent();
        });
      },
      'INTERACTIVE_STOPPED': (p) => {
        if (p?.pipeline_id && p.pipeline_id !== ctx.pipelineId) return;
        // Keep the user on the Coding Agent tab: the always-mounted view now
        // shows the ended log / empty state itself.
        callbacks.syncInteractiveSession();
      },
      'DEV_PROCESS_STARTED': (p) => {
        ctx.state.devProcessState = {
          running: true,
          pid: typeof p?.pid === 'number' ? p.pid : null,
          port: typeof p?.port === 'number' ? p.port : null,
          target: typeof p?.target === 'string' ? p.target : null,
        };
      },
      'DEV_PROCESS_EXITED': () => {
        ctx.state.devProcessState = { running: false, pid: null, port: null, target: null };
      },
      // Insert a newly created PR precisely into its container instead of
      // re-running the full task refresh (which re-renders the whole prep column
      // and re-publishes every task, cascading UI re-renders page-wide).
      'PULL_REQUEST_CREATED': (p) => {
        this.refreshPullRequests();
        // The CoderBot also transitions the task IN_PROGRESS ->
        // PULL_REQUEST_AVAILABLE, but only broadcasts the PR event (no task-status
        // update). Detect it here and remove the task from the engine's In Progress
        // list in place so the sidebar stays accurate without a full re-render.
        this.removeTaskFromInProgressOnPullRequest(p?.task_id);
      },
    };

    Object.entries(eventHandlers).forEach(([event, handler]) => {
      this.unsubs.push(dm.on(`ws:${event}:${ctx.pipelineId}`, (payload) => {
        handler(payload);
        ctx.refresh.header();
      }));
    });
  }

  /** Unsubscribes. Safe to call twice. */
  stop(): void {
    this.unsubs.forEach(unsub => unsub());
    this.unsubs.length = 0;
  }

  async fetchPullRequests(): Promise<void> {
    const { ctx, callbacks } = this.deps;
    try {
      ctx.state.pullRequests = await ctx.context.pullRequestClient.getPullRequestsByPipeline(ctx.pipelineId);
      callbacks.refreshTasks(); // PRs are rendered above the content tabs
    } catch (error) {
      console.error('Failed to fetch pull requests:', error);
    }
  }

  /**
   * Fetches the pull requests and refreshes only the dedicated pull-request
   * container in the preparation column. This avoids re-rendering the whole
   * prep column and, crucially, avoids re-publishing every task through the
   * DataManager (which would fire updateSingleTask per task and cascade into
   * full backlog/selection/engine re-renders). Used for the intrusive
   * PULL_REQUEST_CREATED websocket insert.
   */
  async refreshPullRequests(): Promise<void> {
    const { ctx, getHost } = this.deps;
    try {
      const prs = await ctx.context.pullRequestClient.getPullRequestsByPipeline(ctx.pipelineId);
      ctx.state.pullRequests = prs;
      const sectionEl = getHost()?.querySelector('#pull-request-section');
      if (sectionEl) {
        sectionEl.innerHTML = PullRequestSection.render(ctx.state.pullRequests);
      }
    } catch (error) {
      console.error('Failed to fetch pull requests:', error);
    }
  }

  /**
   * When a CoderBot creates a pull request it also transitions the task
   * IN_PROGRESS -> PULL_REQUEST_AVAILABLE, but that status change is only
   * broadcast as a PULL_REQUEST_CREATED event (no task-status update flows
   * through the DataManager). Reflect it in the local cache and remove the task
   * from the ExecutionEngineView's In Progress list via a targeted, in-place DOM
   * removal so the rest of the sidebar (PiView mount, history) is not
   * disturbed.
   */
  removeTaskFromInProgressOnPullRequest(taskId?: string): void {
    if (!taskId) return;
    const { state } = this.deps.ctx;
    const task = state.allLoadedTasks.find(t => t.id === taskId);
    if (!task) return;
    // Only act when the transition actually comes from IN_PROGRESS.
    if (task.status !== TaskStatus.INPROGRESS) return;

    task.status = TaskStatus.PULL_REQUEST_AVAILABLE;

    const host = this.deps.getHost();

    // The task may be displayed as a full TaskItem (e.g. the selected task in
    // the main content area). Patch only its header so the status badge and
    // action toolbar reflect the new state without re-rendering the body and
    // discarding an open Specification/Design-Doc editor.
    host
      ?.querySelectorAll<HTMLElement>(`[data-view-id="${taskId}"]`)
      .forEach((el) => TaskItem.updateHeaderInPlace(el, task));

    const engine = host?.querySelector('#execution-engine-view');
    if (engine) {
      ExecutionEngineView.removeInProgressItem(engine as HTMLElement, taskId);
    }
  }

  async fetchDocBotPreview(taskId: string): Promise<void> {
    const { ctx } = this.deps;
    try {
      const response = await fetch(`/api/pipelines/${ctx.pipelineId}/docbot/preview/${taskId}`, {
        headers: {
          'Authorization': `Bearer ${ctx.context.authService.getAccessToken()}`
        }
      });

      if (response.ok) {
        const data = await response.json();
        ctx.state.docbotPreviewData = data;
        ctx.state.docbotState = {
          status: 'ready',
          taskId: data.task_id,
        };
        ctx.refresh.header();
      }
    } catch (error) {
      console.error('Failed to fetch DocBot preview:', error);
    }
  }

  async fetchSpecProposal(taskId: string): Promise<void> {
    const { ctx } = this.deps;
    if (!taskId || !ctx.context.specBotClient) {
      console.warn('[SpecAgent] (5) fetchSpecProposal skipped', {
        taskId,
        hasClient: !!ctx.context.specBotClient,
      });
      return;
    }
    console.log(
      `[SpecAgent] (5) fetchSpecProposal GET /pipelines/${ctx.pipelineId}/specagent/proposal/${taskId}`
    );
    try {
      const proposal = await ctx.context.specBotClient.getProposal(ctx.pipelineId, taskId);
      console.log('[SpecAgent] (5) fetchSpecProposal response', proposal);
      if (!proposal) {
        console.warn('[SpecAgent] (5) drop: proposal response was falsy');
        return;
      }
      this.upsertPendingSpecProposal(proposal);
      ctx.refresh.specProposals();
      ctx.refresh.header();
    } catch (error) {
      console.error('[SpecAgent] (5) fetchSpecProposal failed', error);
    }
  }

  /**
   * Reconciles outstanding proposals from the durable backend cache. Called on
   * every full task refresh so a proposal that finished while the user was on
   * another page (or before a reload) is re-surfaced when the pipeline opens.
   */
  async fetchSpecProposals(): Promise<void> {
    const { ctx } = this.deps;
    const client = ctx.context.specBotClient;
    if (!client?.getProposals) return;
    try {
      const proposals = await client.getProposals(ctx.pipelineId);
      ctx.state.pendingSpecProposals = Array.isArray(proposals) ? proposals : [];
      ctx.refresh.specProposals();
      ctx.refresh.header();
    } catch (error) {
      console.error('[SpecAgent] Failed to fetch pending proposals:', error);
    }
  }

  upsertPendingSpecProposal(proposal: SpecProposal): void {
    const proposals = this.deps.ctx.state.pendingSpecProposals;
    const index = proposals.findIndex(
      (p) => p.task_id === proposal.task_id
    );
    if (index === -1) proposals.push(proposal);
    else proposals[index] = proposal;
  }

  removePendingSpecProposal(taskId: string): void {
    const { ctx } = this.deps;
    ctx.state.pendingSpecProposals = ctx.state.pendingSpecProposals.filter(
      (p) => p.task_id !== taskId
    );
    // A task update can re-render the selected view while the accept is in
    // flight, so re-run the injection pass to drop any stale controls.
    ctx.refresh.specProposals();
    ctx.refresh.header();
  }
}
