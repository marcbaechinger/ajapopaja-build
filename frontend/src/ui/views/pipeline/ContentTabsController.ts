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

import { FileBrowseView } from '../../components/files/FileBrowseView.ts';
import { HistoryView } from '../../components/pipeline/HistoryView.ts';
import { InteractiveCodingView } from '../../components/session/InteractiveCodingView.ts';
import type { ContentTab } from '../../../core/PipelineRoute.ts';
import type { PipelineSubRoute, HashWriteMode } from './PipelineSubRoute.ts';
import type { PipelineDetailCtx } from './PipelineDetailCtx.ts';

export interface ContentTabsControllerDeps {
  ctx: PipelineDetailCtx;
  /** The mounted view root containing the tab strip and the four mount points. */
  getHost(): HTMLElement | null;
  /** Shared pure hash I/O (P1). */
  subRoute: PipelineSubRoute;
}

/**
 * Owns the four content tabs, the lazy mount/teardown of the File Browser /
 * History / Interactive-Coding fragments, the Coding-Agent session lifecycle
 * and the tab ⇄ sub-route wiring.
 *
 * Extracted verbatim from `PipelineDetailView` (P8). The shell keeps only a
 * thin `update(params)` entry point (delegating to {@link applyRoute}) plus
 * one-line delegators, so the action handlers, the WebSocket callback and the
 * keyboard shortcut keep working. All scalar state lives in `ctx.state`; the
 * four mounted view instances are owned here. The host is reached through the
 * lazily-evaluated `getHost()` callback so the controller can be constructed
 * before `mount()`.
 */
export class ContentTabsController {
  private readonly deps: ContentTabsControllerDeps;
  private fileBrowseView: FileBrowseView | null = null;
  private historyView: HistoryView | null = null;
  private interactiveCodingView: InteractiveCodingView | null = null;
  // Whether the mounted InteractiveCodingView was created with a Start action
  // (i.e. the pipeline's `repo_uri` was known and remote). Tracked so the view is
  // rebuilt once after `loadPipeline()` resolves, when the capability becomes
  // known for a deep-linked Coding Agent tab. `null` = no view mounted.
  private interactiveViewAllowsStart: boolean | null = null;

  constructor(deps: ContentTabsControllerDeps) {
    this.deps = deps;
  }

  /**
   * Repaints visibility + tab active state and lazily mounts the active
   * fragment.
   *
   * Shows/hides the four content fragments (TaskItem, InteractiveCodingView,
   * FileBrowseView, HistoryView) and keeps every tab button's active/disabled
   * state in sync. Switching tabs only toggles the visibility of pre-rendered
   * DOM fragments (no re-render, no teardown), so in-progress edits and the file
   * browser's/history's state survive switching back and forth. The File Browser
   * and History are lazily mounted on first activation; the Coding Agent view is
   * kept mounted so the tab is always available, with the embedded PiView showing
   * its empty state while no session is attached.
   */
  refresh(): void {
    const container = this.deps.getHost();
    if (!container) return;
    const selected = container.querySelector('#selected-task-view') as HTMLElement | null;
    const mount = container.querySelector('#interactive-coding-view-mount') as HTMLElement | null;
    const fileMount = container.querySelector('#file-browser-view-mount') as HTMLElement | null;
    const historyMount = container.querySelector('#history-view-mount') as HTMLElement | null;
    const taskTab = container.querySelector('#tab-task-editor') as HTMLElement | null;
    const codingTab = container.querySelector('#tab-coding-agent') as HTMLElement | null;
    const fileTab = container.querySelector('#tab-file-browser') as HTMLElement | null;
    const historyTab = container.querySelector('#tab-history') as HTMLElement | null;

    const showTaskEditor = this.deps.ctx.state.contentTab === 'task-editor';
    const showInteractive = this.deps.ctx.state.contentTab === 'coding-agent';
    const showFileBrowser = this.deps.ctx.state.contentTab === 'file-browser';
    const showHistory = this.deps.ctx.state.contentTab === 'history';

    selected?.classList.toggle('hidden', !showTaskEditor);
    mount?.classList.toggle('hidden', !showInteractive);
    fileMount?.classList.toggle('hidden', !showFileBrowser);
    historyMount?.classList.toggle('hidden', !showHistory);

    if (showInteractive) {
      this.mountInteractiveCodingView();
    }
    if (showFileBrowser) {
      this.mountFileBrowseView();
    }
    if (showHistory) {
      this.mountHistoryView();
    }

    const setTabActive = (el: HTMLElement | null, active: boolean) => {
      if (!el) return;
      el.classList.toggle('border-app-accent-1', active);
      el.classList.toggle('text-app-accent-1', active);
      el.classList.toggle('border-transparent', !active);
      el.classList.toggle('text-app-muted', !active);
      el.setAttribute('aria-selected', String(active));
    };
    setTabActive(taskTab, showTaskEditor);
    setTabActive(codingTab, showInteractive);
    setTabActive(fileTab, showFileBrowser);
    setTabActive(historyTab, showHistory);

    this.deps.ctx.refresh.sessionList();
  }

  /**
   * Single mutation point for the active content tab. Also synchronises the
   * URL so the browser history reflects in-view tab changes.
   */
  setTab(tab: ContentTab, opts: { hash?: HashWriteMode } = {}): void {
    this.deps.ctx.state.contentTab = tab;
    this.refresh();
    this.writeRoute(opts.hash ?? 'none');
  }

  /**
   * Route -> selection. Resolves the uid against the loaded tasks and selects
   * it, but is a no-op when the id already matches the current selection (and
   * when both are absent), so unrelated hash changes never discard edits.
   * Deliberately does not switch tabs; the caller has already done so.
   */
  activateForTask(taskId: string | null): void {
    const { ctx } = this.deps;
    const current = ctx.state.selectedTask?.id ?? null;
    if (current === (taskId ?? null)) return;
    ctx.state.pendingSpecEditTaskId = null;
    ctx.state.selectedTask = taskId
      ? ctx.state.allLoadedTasks.find(t => t.id === taskId) ?? null
      : null;
    ctx.refresh.backlog();
    ctx.refresh.selectedTask();
  }

  /** Applies a parsed sub-route from the Navigator. */
  applyRoute(params: Record<string, string>): void {
    const { ctx, subRoute } = this.deps;
    const { tab, fbPath, taskId } = subRoute.parse(params.rest);

    if (tab === 'file-browser' && fbPath !== null) {
      // Only a lazy first mount consumes the explicit path; when the view is
      // already mounted we resolve the path directly below.
      if (!this.fileBrowseView) ctx.state.pendingFbPath = fbPath;
      this.setTab(tab, { hash: 'none' });
      this.mountFileBrowseView(); // no-op when already mounted
      const current = this.currentFbPath();
      if (current !== fbPath) void this.fileBrowseView?.navigateTo(fbPath, { silent: true });
      return;
    }

    this.setTab(tab, { hash: 'none' });
    // The uid is meaningful only for the task editor; apply it in place so a
    // Back/Forward or externally crafted hash never re-enters the router and
    // only re-renders when the selected task actually changes.
    if (tab === 'task-editor') this.activateForTask(taskId);
  }

  /**
   * Canonicalises the hash once, after the first mount: a missing tab segment
   * is filled in. `replaceState` keeps Back pointing at the previous page.
   */
  canonicaliseRoute(): void {
    const { ctx, subRoute } = this.deps;
    const canonical = subRoute.build(
      ctx.state.contentTab,
      this.currentFbPath(),
      // Tasks are not loaded yet, so fall back to the deep-linked uid to avoid
      // stripping it before `refreshTasks()` can consume it.
      this.currentTaskId() ?? ctx.state.pendingTaskId
    );
    subRoute.canonicalise(canonical);
  }

  /**
   * Synchronises the Coding Agent slot: keeps one InteractiveCodingView mounted
   * (the view itself renders the active session or the "No active session…"
   * empty state) and refreshes the tab visibility.
   */
  syncInteractiveSession(): void {
    if (!this.deps.getHost()) return;
    this.mountInteractiveCodingView();
    this.refresh();
  }

  /**
   * Starts an interactive session for this (remote) pipeline and reveals the
   * Coding Agent tab. Shared by the `start_interactive_session` action and the
   * empty-state button rendered inside the embedded PiView.
   */
  async startInteractiveSession(): Promise<void> {
    const { ctx } = this.deps;
    // Only remote pipelines (repo_uri set) support an interactive session; the
    // empty-state button is not offered otherwise.
    if (!ctx.state.pipeline?.repo_uri) return;

    try {
      await ctx.context.interactiveCodingService.startSession(ctx.pipelineId);
      this.setTab('coding-agent', { hash: 'push' });
      this.syncInteractiveSession();
    } catch (error) {
      console.error('Start interactive session error:', error);
      alert('Failed to start interactive session');
    }
  }

  /** Opens the app-wide session-manager panel for this pipeline. */
  openSessionManager(): void {
    this.deps.ctx.context.sessionManagerPanel?.open(this.deps.ctx.pipelineId);
  }

  /** Destroys the mounted fragments. */
  teardown(): void {
    this.teardownInteractiveCodingView();
    if (this.fileBrowseView) {
      this.fileBrowseView.destroy();
      this.fileBrowseView = null;
    }
    if (this.historyView) {
      this.historyView.destroy();
      this.historyView = null;
    }
    this.deps.ctx.state.pendingFbPath = null;
  }

  /**
   * Lazily mounts the one persistent InteractiveCodingView for the Coding Agent
   * tab (mirroring {@link mountFileBrowseView}/{@link mountHistoryView}), then
   * keeps it mounted so the log survives tab switches and the tab is always
   * available. Recreates it when `repo_uri` becomes known after `loadPipeline()`
   * so the empty-state Start action matches the pipeline's capabilities.
   */
  private mountInteractiveCodingView(): void {
    const container = this.deps.getHost();
    if (!container) return;
    const allowsStart = !!this.deps.ctx.state.pipeline?.repo_uri;
    if (this.interactiveCodingView && this.interactiveViewAllowsStart === allowsStart) return;
    if (this.interactiveCodingView) this.teardownInteractiveCodingView();
    const mount = container.querySelector(
      '#interactive-coding-view-mount'
    ) as HTMLElement | null;
    if (!mount) return;
    this.interactiveCodingView = new InteractiveCodingView(
      this.deps.ctx.context.interactiveCodingService,
      mount,
      {
        pipelineId: this.deps.ctx.pipelineId,
        // Local pipelines expose no start affordance, so the empty state has no
        // action button for them.
        emptyStateAction: allowsStart
          ? {
              label: 'Start Interactive Session',
              onClick: () => this.startInteractiveSession(),
            }
          : undefined,
      }
    );
    this.interactiveViewAllowsStart = allowsStart;
    this.interactiveCodingView.render();
  }

  private teardownInteractiveCodingView() {
    if (this.interactiveCodingView) {
      this.interactiveCodingView.destroy();
      this.interactiveCodingView = null;
    }
    this.interactiveViewAllowsStart = null;
  }

  /**
   * Lazily mounts the FileBrowseView the first time the File Browser tab is
   * selected, then keeps it mounted so its state (current directory, selected
   * file, scroll position) survives tab switches.
   */
  private mountFileBrowseView(): void {
    const container = this.deps.getHost();
    if (this.fileBrowseView || !container) return;
    const mount = container.querySelector(
      '#file-browser-view-mount'
    ) as HTMLElement | null;
    if (!mount) return;
    // Consume the route-supplied path once, on the lazy first mount, so a later
    // re-mount never re-applies a stale deep link.
    const initialPath = this.deps.ctx.state.pendingFbPath;
    this.deps.ctx.state.pendingFbPath = null;
    this.fileBrowseView = new FileBrowseView(mount, {
      pipelineId: this.deps.ctx.pipelineId,
      client: this.deps.ctx.context.fileBrowserClient,
      actionRegistry: this.deps.ctx.context.actionRegistry,
      // Let the user drag the listing / file content area's bottom edge to
      // tune its height within the detail view.
      resizable: true,
      initialPath,
      // Fold user-driven file/directory navigation into the sub-route and push
      // a history entry, so the browser Back button walks back through them.
      onNavigate: ({ dir, file }) => {
        this.writeRoute('push', file ?? dir);
      },
    });
    this.fileBrowseView.render();
  }

  /**
   * Lazily mounts the HistoryView the first time the History tab is selected,
   * then keeps it mounted so its page/expanded/diff state survives tab switches.
   */
  private mountHistoryView(): void {
    const container = this.deps.getHost();
    if (this.historyView || !container) return;
    const mount = container.querySelector(
      '#history-view-mount'
    ) as HTMLElement | null;
    if (!mount) return;
    this.historyView = new HistoryView(mount, {
      pipelineId: this.deps.ctx.pipelineId,
      client: this.deps.ctx.context.pipelineClient,
      actionRegistry: this.deps.ctx.context.actionRegistry,
    });
    this.historyView.render();
  }

  /**
   * Pushes (user navigation) or replaces (canonicalisation) the pipeline
   * sub-route. `replaceState` never fires `hashchange`, and the equality guard
   * makes the `push` re-entry a no-op, so the route stays idempotent.
   */
  private writeRoute(
    mode: HashWriteMode,
    fbPath: string | null = this.currentFbPath(),
    taskId: string | null = this.currentTaskId()
  ): void {
    const hash = this.deps.subRoute.build(this.deps.ctx.state.contentTab, fbPath, taskId);
    this.deps.subRoute.write(mode, hash);
  }

  /** Current file-browser path from the mounted view, or `null` when not relevant. */
  private currentFbPath(): string | null {
    if (this.deps.ctx.state.contentTab !== 'file-browser') return null;
    const path = this.fileBrowseView?.getCurrentPath();
    if (!path) return null;
    if (path.file) return path.file;
    return path.dir ? path.dir : null;
  }

  /**
   * Route-side projection of the selection: the uid is only meaningful while
   * the Task editor tab is active, mirroring `currentFbPath()`.
   */
  private currentTaskId(): string | null {
    if (this.deps.ctx.state.contentTab !== 'task-editor') return null;
    return this.deps.ctx.state.selectedTask?.id ?? null;
  }
}
