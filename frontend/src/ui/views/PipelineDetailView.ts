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

import { View } from '../../core/Navigator.ts';
import { type ContentTab } from '../../core/PipelineRoute.ts';
import { PipelineSubRoute } from './pipeline/PipelineSubRoute.ts';
import { AppContext } from '../../core/AppContext.ts';
import { Pipeline, TaskStatus, Task, type GitStatusDetails } from '../../core/domain.ts';
import { StatsDialog } from '../components/dialogs/StatsDialog.ts';
import { BacklogView } from '../components/pipeline/BacklogView.ts';
import { PipelineHistoryView } from '../components/pipeline/PipelineHistoryView.ts';
import { PullRequestSection } from '../components/pipeline/PullRequestSection.ts';
import { PipelineHeaderView, type DocbotState, type ReviewbotState, type ArchbotState, type SpecAgentState } from '../components/pipeline/PipelineHeaderView.ts';
import { renderSpecProposalResult, getTaskSpecProposalUpdater } from '../components/pipeline/SpecSection.ts';
import type { SpecProposal } from '../../core/clients/SpecBotClient.ts';
import { createPipelineDetailCtx, type DevProcessState, type PipelineDetailCtx } from './pipeline/PipelineDetailCtx.ts';
import { PipelineDetailLayout } from './pipeline/PipelineDetailLayout.ts';
import { ExecutionEngineController } from './pipeline/ExecutionEngineController.ts';
import { PipelineSessionListController } from './pipeline/PipelineSessionListController.ts';
import { PipelineRealtimeController } from './pipeline/PipelineRealtimeController.ts';
import { SelectedTaskController } from './pipeline/SelectedTaskController.ts';
import { ContentTabsController } from './pipeline/ContentTabsController.ts';
import { registerPullRequestActions } from './pipeline/actions/pullRequestActions.ts';
import { registerBotActions, openCoderBotDialog } from './pipeline/actions/botActions.ts';
import { registerMiscActions } from './pipeline/actions/miscActions.ts';
import { registerTaskSpecActions } from './pipeline/actions/taskSpecActions.ts';
import { registerTaskDesignDocActions } from './pipeline/actions/taskDesignDocActions.ts';
import { registerTaskLifecycleActions } from './pipeline/actions/taskLifecycleActions.ts';
import EasyMDE from 'easymde';
import { LocalStorageManager } from '../../core/LocalStorageManager.ts';

export class PipelineDetailView extends View {
  private storage = LocalStorageManager.getInstance('pipeline');
  private container: HTMLElement | null = null;
  private pipelineId: string;
  private context: AppContext;
  private readonly ctx: PipelineDetailCtx;
  private readonly subRoute: PipelineSubRoute;
  private unsubs: (() => void)[] = [];
  //
  // Mutable pipeline state now lives in `ctx.state`; the private getters/setters
  // below keep the existing `this.<field>` call sites working while routing every
  // read/write through the shared context that the extracted controllers consume.
  //
  private get activeEditors(): Map<string, EasyMDE> { return this.ctx.state.activeEditors; }
  private set activeEditors(value: Map<string, EasyMDE>) { this.ctx.state.activeEditors = value; }
  private get allLoadedTasks(): Task[] { return this.ctx.state.allLoadedTasks; }
  private set allLoadedTasks(value: Task[]) { this.ctx.state.allLoadedTasks = value; }
  private get collapsedTasks(): Set<string> { return this.ctx.state.collapsedTasks; }
  private set collapsedTasks(value: Set<string>) { this.ctx.state.collapsedTasks = value; }
  private isFirstLoad: boolean = true;
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;
  private get gitStatus(): GitStatusDetails | undefined { return this.ctx.state.gitStatus; }
  private set gitStatus(value: GitStatusDetails | undefined) { this.ctx.state.gitStatus = value; }
  private gitStatusRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  private gitStatusRefreshInProgress: boolean = false;
  private gitStatusRefreshPending: boolean = false;
  private get pendingReviews(): string[] { return this.ctx.state.pendingReviews; }
  private set pendingReviews(value: string[]) { this.ctx.state.pendingReviews = value; }
  private get historyPage(): number { return this.ctx.state.historyPage; }
  private set historyPage(value: number) { this.ctx.state.historyPage = value; }
  private get selectedTask(): Task | null { return this.ctx.state.selectedTask; }
  private set selectedTask(value: Task | null) { this.ctx.state.selectedTask = value; }
  private get pipeline(): Pipeline | null { return this.ctx.state.pipeline; }
  private set pipeline(value: Pipeline | null) { this.ctx.state.pipeline = value; }
  // When a task is created via the Quick Add panel, keep its Specification open in
  // edit mode (even across WS-driven re-renders) until the user saves, cancels, or
  // selects a different task.
  private get pendingSpecEditTaskId(): string | null { return this.ctx.state.pendingSpecEditTaskId; }
  private set pendingSpecEditTaskId(value: string | null) { this.ctx.state.pendingSpecEditTaskId = value; }
  private engine: ExecutionEngineController | null = null;
  private sessionList: PipelineSessionListController | null = null;
  private realtime: PipelineRealtimeController | null = null;
  private selectedTaskCtrl: SelectedTaskController | null = null;
  private contentTabs: ContentTabsController | null = null;

  // Which content tab is active in the prep column. The tab list is always
  // visible; the Coding Agent tab is always selectable and shows its empty
  // state while no session is attached to this pipeline.
  private get contentTab(): ContentTab { return this.ctx.state.contentTab; }
  private set contentTab(value: ContentTab) { this.ctx.state.contentTab = value; }
  // Explicit file-browser path from the route, consumed once when the File
  // Browser is lazily mounted. `null` = use the persisted last path.
  private get pendingFbPath(): string | null { return this.ctx.state.pendingFbPath; }
  private set pendingFbPath(value: string | null) { this.ctx.state.pendingFbPath = value; }
  // Deep-linked task uid, consumed once by `refreshTasks()` (the task list is
  // not loaded yet when the route is first applied). `null` = no explicit task.
  private get pendingTaskId(): string | null { return this.ctx.state.pendingTaskId; }
  private set pendingTaskId(value: string | null) { this.ctx.state.pendingTaskId = value; }

  // Whether the left backlog sidebar (proposed designs + backlog) is collapsed.
  // Persisted per pipeline so the chosen layout survives reloads.
  private get sidebarCollapsed(): boolean { return this.ctx.state.sidebarCollapsed; }
  private set sidebarCollapsed(value: boolean) { this.ctx.state.sidebarCollapsed = value; }

  private get docbotState(): DocbotState { return this.ctx.state.docbotState; }
  private set docbotState(value: DocbotState) { this.ctx.state.docbotState = value; }

  private get reviewbotState(): ReviewbotState { return this.ctx.state.reviewbotState; }
  private set reviewbotState(value: ReviewbotState) { this.ctx.state.reviewbotState = value; }

  private get archbotState(): ArchbotState { return this.ctx.state.archbotState; }
  private set archbotState(value: ArchbotState) { this.ctx.state.archbotState = value; }

  private get specagentState(): SpecAgentState { return this.ctx.state.specagentState; }
  private set specagentState(value: SpecAgentState) { this.ctx.state.specagentState = value; }

  // Outstanding SpecAgent proposals for this pipeline, reconciled from the
  // durable backend cache and kept in sync with live SPECAGENT_SPEC_READY
  // events. Drives the header badge and the inline injection.
  private get pendingSpecProposals(): SpecProposal[] { return this.ctx.state.pendingSpecProposals; }
  private set pendingSpecProposals(value: SpecProposal[]) { this.ctx.state.pendingSpecProposals = value; }

  private get devProcessState(): DevProcessState | undefined { return this.ctx.state.devProcessState; }
  private set devProcessState(value: DevProcessState | undefined) { this.ctx.state.devProcessState = value; }

  private get pullRequests(): any[] { return this.ctx.state.pullRequests; }
  private set pullRequests(value: any[]) { this.ctx.state.pullRequests = value; }


  constructor(context: AppContext, params: Record<string, string>) {
    super();
    this.context = context;
    this.pipelineId = params.id;
    this.subRoute = new PipelineSubRoute(this.pipelineId);
    this.ctx = createPipelineDetailCtx({
      context,
      pipelineId: this.pipelineId,
      refresh: {
        header: () => this.updateHeader(),
        backlog: () => this.refreshBacklog(),
        selectedTask: () => this.refreshSelectedTask(),
        executionEngine: () => this.refreshExecutionEngine(),
        sessionList: () => this.sessionList?.refresh(),
        specProposals: () => this.renderPendingSpecProposals(),
      },
    });
    // Parse the sub-route once so the very first render already reflects a
    // deep link (no flash of the wrong tab). The Coding-Agent guard is applied
    // later, once the session state is known.
    const route = this.subRoute.parse(params.rest);
    this.contentTab = route.tab;
    this.pendingFbPath = route.fbPath;
    this.pendingTaskId = route.taskId;
    this.sidebarCollapsed =
      this.storage.get<boolean>(`sidebar_collapsed:${this.pipelineId}`, false) === true;
    this.registerActions();
    this.realtime = new PipelineRealtimeController({
      ctx: this.ctx,
      getHost: () => this.container,
      callbacks: {
        refreshTasks: () => this.refreshTasks(),
        // P7 will introduce `SelectedTaskController.update`; the shell method is
        // the pre-P7 implementation of the same incremental update.
        updateSingleTask: (task) => this.updateSingleTask(task),
        scheduleRefreshGitStatus: () => this.scheduleRefreshGitStatus(),
        openCodingAgent: () => {
          this.setContentTab('coding-agent', { hash: 'push' });
          this.syncInteractiveSession();
        },
        syncInteractiveSession: () => this.syncInteractiveSession(),
      },
    });
    this.realtime.loadPendingReviews();
    this.realtime.start();
    this.setupKeyboardShortcuts();
  }

  private setupKeyboardShortcuts() {
    this.keydownHandler = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input or textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || (e.target as HTMLElement).isContentEditable) {
        return;
      }

      // Ctrl/Cmd+Shift+P opens the edit dialog for the current pipeline. This
      // mirrors the "Edit Pipeline" button in the header by dispatching the
      // same `edit_pipeline` action, so there is a single place that constructs
      // the dialog.
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        void this.context.actionRegistry.execute('edit_pipeline', e, document.body);
        return;
      }

      // 'h' key opens the History tab
      if (e.key === 'h' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        this.setContentTab('history', { hash: 'push' });
      }

      // 's' key for stats dialog
      if (e.key === 's' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        new StatsDialog(this.allLoadedTasks, this.pipelineId, this.context.pipelineClient).show();
      }
    };
    document.addEventListener('keydown', this.keydownHandler);
  }

  /**
   * Re-renders the inline proposal controls for the selected task view,
   * removing any stale injections whose proposal no longer exists. Only the
   * card inside `#selected-task-view` is ever targeted, so sidebar backlog cards
   * are never touched.
   */
  private renderPendingSpecProposals() {
    const viewRoot = this.container?.querySelector('#selected-task-view') as HTMLElement | null;
    if (!viewRoot) return;
    viewRoot
      .querySelectorAll('.spec-proposal-host')
      .forEach((el) => el.remove());
    for (const proposal of this.pendingSpecProposals) {
      this.renderSpecProposal(proposal);
    }
  }

  /**
   * Renders an elaborated-spec proposal inline in the selected task's spec
   * container. Looking only inside `#selected-task-view` avoids injecting the
   * proposal into an unrelated sidebar backlog card. Accept writes the spec back
   * through the registered updater; reject clears the pending proposal on the
   * backend. Missing the selected card is non-fatal: the notification dialog and
   * the header badge remain the primary, view-independent paths.
   */
  private renderSpecProposal(proposal: SpecProposal) {
    const viewRoot = this.container?.querySelector('#selected-task-view') as HTMLElement | null;
    if (!viewRoot) {
      console.warn('[SpecAgent] (6) renderSpecProposal: no #selected-task-view mounted');
      return;
    }
    // Locate the TaskItem card root by its `data-view-id` (the same anchor used
    // by `focusSpecAfterTitleSave`).
    const taskEl = viewRoot.querySelector(`[data-view-id="${proposal.task_id}"]`);
    const specContainer = taskEl?.querySelector('.spec-container') as HTMLElement | null;
    console.log(
      `[SpecAgent] (6) renderSpecProposal selected task found? ${!!taskEl}, ` +
        `.spec-container found? ${!!specContainer}`
    );
    if (!specContainer) {
      console.warn(
        '[SpecAgent] (6) proposal not rendered inline: task is not the selected task',
        proposal.task_id
      );
      return;
    }

    let resultEl = specContainer.querySelector('.spec-proposal-host') as HTMLElement | null;
    if (!resultEl) {
      resultEl = document.createElement('div');
      resultEl.className = 'spec-proposal-host';
      specContainer.appendChild(resultEl);
    }

    renderSpecProposalResult(resultEl, {
      spec_md: proposal.spec_md,
      onAccept: async (spec) => {
        const updater = getTaskSpecProposalUpdater();
        if (updater) await updater(proposal.task_id, spec);
        // Accepting locally must also drop the durable proposal, otherwise it
        // would be reconciled and re-surfaced on the next reload.
        try {
          await this.context.specBotClient?.clearProposal(this.pipelineId, proposal.task_id);
        } catch (error) {
          console.error('Failed to clear accepted SpecAgent proposal:', error);
        }
        resultEl!.innerHTML = '';
        this.realtime?.removePendingSpecProposal(proposal.task_id);
      },
      onReject: async () => {
        try {
          await this.context.specBotClient?.rejectProposal(this.pipelineId, proposal.task_id);
        } catch (error) {
          console.error('Failed to reject SpecAgent proposal:', error);
        }
        resultEl!.innerHTML = '';
        this.realtime?.removePendingSpecProposal(proposal.task_id);
      },
    });
  }

  private registerActions() {
    registerPullRequestActions(this.ctx, {
      // Accepting/rejecting/submitting a PR only changes the pull-request
      // section. Use the targeted refresh so the rest of the page (notably the
      // selected TaskItem with its open Specification/Design-Doc editors) is not
      // re-rendered by a full task refresh.
      refreshPullRequests: () => this.realtime?.refreshPullRequests(),
      updateEngineSlot: () => this.updateEnginePiSlot(),
    });

    registerBotActions(this.ctx, {
      getHost: () => this.container,
      setContentTab: (tab, opts) => this.setContentTab(tab, opts),
      fetchSpecProposal: (taskId) => this.realtime?.fetchSpecProposal(taskId),
      updateEngineSlot: () => this.updateEnginePiSlot(),
      persistPendingReviews: () => this.realtime?.persistPendingReviews(),
    });

    registerMiscActions(this.ctx, {
      getHost: () => this.container,
      setContentTab: (tab, opts) => this.setContentTab(tab, opts),
      setHistoryPage: (page) => this.setHistoryPage(page),
      applySidebarState: () => this.applySidebarState(),
      persistSidebarCollapsed: (collapsed) =>
        this.storage.put(`sidebar_collapsed:${this.pipelineId}`, collapsed),
    });

    registerTaskSpecActions(this.ctx, {
      focusSpecAfterTitleSave: (c) => this.focusSpecAfterTitleSave(c),
      markSpecEditPending: (id) => this.markSpecEditPending(id),
      markScheduleFocusPending: (id) => this.markScheduleFocusPending(id),
      applyPendingScheduleFocus: (el, id) => this.applyPendingScheduleFocus(el, id),
    });

    registerTaskDesignDocActions(this.ctx, {});

    registerTaskLifecycleActions(this.ctx, {
      setContentTab: (tab, opts) => this.setContentTab(tab, opts),
    });

    this.context.actionRegistry.register('start_interactive_session', () =>
      this.startInteractiveSession()
    );

    this.context.actionRegistry.register('resume_interactive_session', async (_e, el) => {
      const uid = el.getAttribute('data-session-uid');
      if (!uid) return;
      await this.sessionList?.switchToSession(uid);
    });

    this.context.actionRegistry.register('open_pipeline_sessions', () => {
      this.ensureContentTabs().openSessionManager();
    });

    // Tab selection. The Task editor, Coding Agent and File Browser are
    // pre-rendered DOM fragments that are shown/hidden in place; selecting a
    // tab never re-renders (and never tears down) an already mounted fragment.
    this.context.actionRegistry.register('select_content_tab', (_e, el) => {
      const tab = el.getAttribute('data-content-tab');
      if (tab !== 'task-editor' && tab !== 'coding-agent' && tab !== 'file-browser' && tab !== 'history') {
        return;
      }
      this.setContentTab(tab, { hash: 'push' });
    });

    this.context.actionRegistry.register('toggle_interactive_view', () => {
      if (this.contentTab === 'coding-agent') {
        this.setContentTab('task-editor', { hash: 'push' });
      } else {
        this.setContentTab('coding-agent', { hash: 'push' });
      }
      this.syncInteractiveSession();
    });

  }

  async loadPipeline() {
    try {
      this.pipeline = await this.context.pipelineClient.get(this.pipelineId);
      if (this.pipeline) {
        this.context.dataManager.updatePipeline(this.pipeline);
      }
      this.realtime?.fetchPullRequests();
      this.scheduleRefreshGitStatus();
      this.loadDevServerStatus();
      this.updateHeader();
      this.syncInteractiveSession();
    } catch (error) {
      console.error('Error loading pipeline:', error);
    }
  }

  /** Loads the dev-process running state so the header indicator is accurate. */
  private async loadDevServerStatus() {
    try {
      const status = await this.context.pipelineClient.getDevServerStatus(
        this.pipelineId,
      );
      this.devProcessState = {
        running: !!status?.running,
        pid: typeof status?.pid === 'number' ? status.pid : null,
        port: typeof status?.port === 'number' ? status.port : null,
      };
      this.updateHeader();
    } catch (error) {
      console.error('Failed to load dev server status:', error);
    }
  }

  private scheduleRefreshGitStatus() {
    if (this.gitStatusRefreshInProgress) {
      this.gitStatusRefreshPending = true;
      return;
    }
    if (this.gitStatusRefreshTimer) {
      return; // Already scheduled
    }
    this.gitStatusRefreshTimer = setTimeout(() => {
      this.gitStatusRefreshTimer = null;
      this.refreshGitStatusInternal();
    }, 500);
  }

  private async refreshGitStatusInternal() {
    this.gitStatusRefreshInProgress = true;
    try {
      this.gitStatus = await this.context.pipelineClient.getGitStatus(this.pipelineId);
      this.updateHeader();
    } catch (error) {
      console.error('Failed to refresh git status:', error);
    } finally {
      this.gitStatusRefreshInProgress = false;
      if (this.gitStatusRefreshPending) {
        this.gitStatusRefreshPending = false;
        this.scheduleRefreshGitStatus();
      }
    }
  }

  async refreshTasks() {
    if (!this.container) return;
    const pullRequestSection = this.container.querySelector('#pull-request-section');
    const completedCountEl = this.container.querySelector('#completed-count');

    if (!pullRequestSection) return;

    try {
      this.allLoadedTasks = await this.context.taskClient.listByPipeline(this.pipelineId, true);

      // Update DataManager cache
      this.allLoadedTasks.forEach(task => this.context.dataManager.updateTask(task));

      this.updateHeader();
      const allTasks = this.allLoadedTasks;

      // Handle default task collapsing on first load
      if (this.isFirstLoad && allTasks.length > 0) {
        allTasks.forEach(t => {
          if (t.status !== TaskStatus.INPROGRESS && t.status !== TaskStatus.PROPOSED) {
            this.collapsedTasks.add(t.id!);
          }
        });
        this.isFirstLoad = false;
      }

      const completedTasks = allTasks.filter(t => !t.deleted && ([TaskStatus.IMPLEMENTED, TaskStatus.SUBMITTED, TaskStatus.DISCARDED] as any[]).includes(t.status));

      // Render the pull-request list in place. It lives between the session
      // list and the content tabs; PullRequestSection.render returns an empty
      // string when nothing is awaiting review, so it takes no space.
      pullRequestSection.innerHTML = PullRequestSection.render(this.pullRequests);

      // Completed count (retained only if the element exists).
      if (completedCountEl) {
        completedCountEl.textContent = `(${completedTasks.length})`;
      }

      // Consume a deep-linked task uid exactly once, now that the task list is
      // loaded, so the selected task is shown on first paint. A uid that does
      // not resolve simply leaves the empty hint in place.
      if (this.pendingTaskId) {
        this.selectedTask =
          this.allLoadedTasks.find(t => t.id === this.pendingTaskId) ?? null;
        this.pendingTaskId = null;
      }

      this.refreshBacklog();
      this.refreshSelectedTask();
      this.refreshExecutionEngine();
      // Reconcile outstanding SpecAgent proposals from the durable cache so a
      // proposal that finished while the user was elsewhere is re-surfaced.
      void this.realtime?.fetchSpecProposals();
    } catch (error) {
      console.error('Error refreshing tasks:', error);
    }
  }

  private setHistoryPage(page: number) {
    if (!this.container) return;
    this.historyPage = page;

    // PipelineHistoryView moved into the right sidebar at the bottom; re-render
    // only its feed so the engine sections / CoderBot slot stay untouched.
    const feed = this.container.querySelector('#history-feed');
    if (!feed) return;

    const completedTasks = this.allLoadedTasks
      .filter(t => !t.deleted && ([TaskStatus.IMPLEMENTED, TaskStatus.SUBMITTED, TaskStatus.DISCARDED] as any[]).includes(t.status));
    // Sort completed tasks by completion time (updated_at)
    completedTasks.sort((a, b) => new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime());

    feed.innerHTML = PipelineHistoryView.render(completedTasks, page);
  }

  private updateHeader() {
    if (!this.container) return;
    const headerContainer = this.container.querySelector('#pipeline-header-container');
    if (headerContainer) {
      // The create-task input now lives in the header, which is re-rendered on
      // every pipeline/task/bot event. Preserve whatever the user has typed (and
      // the focus/caret) so a background WebSocket update never wipes it.
      const prevInput = headerContainer.querySelector<HTMLInputElement>('input[name="task_title"]');
      const value = prevInput?.value ?? '';
      const hadFocus = !!prevInput && document.activeElement === prevInput;
      const selectionStart = prevInput?.selectionStart ?? null;

      headerContainer.innerHTML = this.renderHeader();

      const nextInput = headerContainer.querySelector<HTMLInputElement>('input[name="task_title"]');
      if (nextInput && value) {
        nextInput.value = value;
        if (hadFocus) {
          nextInput.focus();
          if (selectionStart !== null) {
            try {
              nextInput.setSelectionRange(selectionStart, selectionStart);
            } catch {
              // setSelectionRange is not supported by every input type; ignore.
            }
          }
        }
      }
    }
  }

  private renderHeader(): string {
    if (!this.pipeline) {
      return PipelineDetailLayout.renderLoadingHeader();
    }
    return PipelineHeaderView.render({
      pipeline: this.pipeline,
      pipelineId: this.pipelineId,
      docbotState: this.docbotState,
      reviewbotState: this.reviewbotState,
      archbotState: this.archbotState,
      specagentState: this.specagentState,
      devProcessState: this.devProcessState,
      user: this.context.authService.getUser(),
      allTasks: this.allLoadedTasks,
      gitStatus: this.gitStatus,
      pendingReviews: this.pendingReviews,
      pendingSpecProposals: this.pendingSpecProposals
    });


  }

  private renderPrepColumn(): string {
    return PipelineDetailLayout.renderPrepColumn({
      pullRequestSectionHtml: PullRequestSection.render(this.pullRequests),
    });
  }



  /**
   * Applies the persisted backlog-sidebar collapse state to the mounted DOM.
   * Delegates to `PipelineDetailLayout` so the layout owns the toggle markup.
   */
  private applySidebarState(): void {
    if (!this.container) return;
    PipelineDetailLayout.applySidebarState(this.container, this.sidebarCollapsed);
  }

  render() {
    return PipelineDetailLayout.renderShell({
      headerHtml: this.renderHeader(),
      sidebarCollapsed: this.sidebarCollapsed,
      prepColumnHtml: this.renderPrepColumn(),
    });
  }

  mount(container: HTMLElement) {
    this.container = container;
    this.applySidebarState();
    // Reflect a deep-linked sub-route (tab / file-browser path) before the
    // async pipeline and session loads resolve, then canonicalise the hash so
    // a missing tab segment is rewritten without adding a history entry.
    this.ensureContentTabs().refresh();
    this.ensureContentTabs().canonicaliseRoute();
    this.loadPipeline();
    this.refreshTasks();
    this.checkOllama();

    // React to app-wide CoderBot session changes so the engine Pi slot stays
    // correct (mount for this pipeline, notice for another pipeline).
    const cb = () => this.updateEnginePiSlot();
    const unsub = this.context.coderBotService?.onSessionChange?.(cb);
    if (unsub) this.unsubs.push(unsub);

    // React to interactive session changes so the slot/tabs stay accurate and
    // re-attach after a reload.
    const interactiveCb = () => this.syncInteractiveSession();
    const interactiveUnsub =
      this.context.interactiveCodingService?.onSessionChange?.(interactiveCb);
    if (interactiveUnsub) this.unsubs.push(interactiveUnsub);

    // React to durable-session list changes (e.g. a batch CoderBot session
    // completing after this view was opened) by repainting ONLY the inline
    // session list, so tabs/editor/file-browser DOM stay untouched.
    const sessionsUnsub =
      this.context.interactiveCodingService?.onSessionsChange?.(() =>
        this.sessionList?.refresh()
      );
    if (sessionsUnsub) this.unsubs.push(sessionsUnsub);

    // When a SpecAgent notification action (accept/reject) completes, possibly
    // from another page, reconcile the proposals for this pipeline.
    const notificationsUnsub = this.context.notifications?.onActionResult?.((result) => {
      if (result?.action?.startsWith('specagent_')) {
        void this.realtime?.fetchSpecProposals();
      }
    });
    if (notificationsUnsub) this.unsubs.push(notificationsUnsub);

    // Reconnect a running CoderBot session to this view (e.g. after a reload).
    this.refreshEnginePiSlot();
    Promise.resolve(this.context.interactiveCodingService?.refreshSession?.()).then(() => {
      this.syncInteractiveSession();
    });

    // Inline per-pipeline session rows use `data-session-action` so they never
    // collide with the global action registry. The controller owns the list
    // render + row click lifecycle on `#pipeline-session-list`.
    this.sessionList = new PipelineSessionListController({
      ctx: this.ctx,
      host: this.container!,
      onOpenCodingAgent: () => {
        this.setContentTab('coding-agent', { hash: 'push' });
        this.syncInteractiveSession();
      },
      onSessionsChanged: () => this.syncInteractiveSession(),
    });
    void this.context.interactiveCodingService?.refreshSessions?.({ kind: 'interactive' });
  }

  private async checkOllama() {
    if (!this.container) return;
    const isAvailable = await this.context.systemClient.isOllamaAvailable();
    if (!isAvailable) {
      this.container.querySelector('[data-action-click="toggle_assistant"]')?.classList.add('hidden');
    }
  }

  unmount() {
    this.activeEditors.forEach(editor => editor.toTextArea());
    this.activeEditors.clear();
    this.engine?.teardown();
    this.engine = null;
    this.realtime?.stop();
    this.realtime = null;
    this.selectedTaskCtrl = null;
    this.sessionList?.teardown();
    this.sessionList = null;
    this.contentTabs?.teardown();
    this.contentTabs = null;
    this.unsubs.forEach(unsub => unsub());
    this.unsubs = [];
    this.pendingSpecEditTaskId = null;
    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
  }

  private updateSingleTask(task: Task): void {
    this.ensureSelectedTask().update(task);
  }

  private refreshSelectedTask(): void {
    this.ensureSelectedTask().refreshSelected();
  }

  private applyPendingScheduleFocus(taskElement: Element | null, taskId: string): void {
    this.ensureSelectedTask().applyPendingScheduleFocus(taskElement, taskId);
  }

  private focusSpecAfterTitleSave(titleContainer: HTMLElement): void {
    this.ensureSelectedTask().focusSpecAfterTitleSave(titleContainer);
  }

  private markSpecEditPending(taskId: string | null): void {
    this.ensureSelectedTask().markSpecEditPending(taskId);
  }

  private markScheduleFocusPending(taskId: string | null): void {
    this.ensureSelectedTask().markScheduleFocusPending(taskId);
  }

  private ensureSelectedTask(): SelectedTaskController {
    this.selectedTaskCtrl ??= new SelectedTaskController({
      ctx: this.ctx,
      getHost: () => this.container,
    });
    return this.selectedTaskCtrl;
  }

  private ensureContentTabs(): ContentTabsController {
    this.contentTabs ??= new ContentTabsController({
      ctx: this.ctx,
      getHost: () => this.container,
      subRoute: this.subRoute,
    });
    return this.contentTabs;
  }

  private ensureEngine(): ExecutionEngineController {
    this.engine ??= new ExecutionEngineController({
      ctx: this.ctx,
      host: this.container!,
      onOpenCoderBotDialog: () => openCoderBotDialog(this.ctx),
    });
    return this.engine;
  }

  private refreshExecutionEngine() {
    if (!this.container) return;
    this.ensureEngine().refresh();
  }

  /** Render the engine Pi slot based on the running session vs this pipeline. */
  private updateEnginePiSlot() {
    if (!this.container) return;
    this.ensureEngine().updateSlot();
  }

  private async refreshEnginePiSlot() {
    await this.context.coderBotService?.refreshSession?.();
    this.updateEnginePiSlot();
  }

  /**
   * Synchronises the Coding Agent slot: keeps one InteractiveCodingView mounted
   * (the view itself renders the active session or the "No active session…"
   * empty state) and refreshes the tab visibility.
   */
  private syncInteractiveSession() {
    this.ensureContentTabs().syncInteractiveSession();
  }

  /**
   * Starts an interactive session for this (remote) pipeline and reveals the
   * Coding Agent tab. Shared by the `start_interactive_session` action and the
   * empty-state button rendered inside the embedded PiView.
   */
  private async startInteractiveSession(): Promise<void> {
    await this.ensureContentTabs().startInteractiveSession();
  }

  // --- pipeline sub-route (tab + file-browser path) -----------------------

  /**
   * Applies a hash sub-route to the mounted view. Returns `false` when the
   * route belongs to a different pipeline, forcing the Navigator to re-create
   * the view. Returns `true` when the update was applied in place.
   */
  update(params: Record<string, string>): boolean {
    if (params.id !== this.pipelineId) return false;
    this.ensureContentTabs().applyRoute(params);
    return true;
  }

  /**
   * Single mutation point for the active content tab. Also synchronises the
   * URL so the browser history reflects in-view tab changes.
   */
  private setContentTab(
    tab: ContentTab,
    opts: { hash?: 'push' | 'replace' | 'none' } = {}
  ): void {
    this.ensureContentTabs().setTab(tab, opts);
  }

  private refreshBacklog() {
    if (!this.container) return;
    const backlogEl = this.container.querySelector('#backlog-view');
    if (!backlogEl) return;
    const backlogTasks = this.allLoadedTasks.filter(t => !t.deleted && (t.status === TaskStatus.PROPOSED || t.status === TaskStatus.CREATED));
    const selectedTaskId =
      this.selectedTask && this.selectedTask.status === TaskStatus.CREATED
        ? this.selectedTask.id
        : undefined;

    backlogEl.innerHTML = BacklogView.render({ tasks: backlogTasks, selectedTaskId });
  }
}
