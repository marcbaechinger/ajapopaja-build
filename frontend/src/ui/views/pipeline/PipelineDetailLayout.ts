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

/**
 * Static page chrome for `PipelineDetailView`.
 *
 * This module owns only pure template functions plus the single
 * `applySidebarState` DOM helper. It holds no state and performs no DOM queries
 * other than the sidebar toggle, so the shell can compose live data into it.
 *
 * The `#id` mount points are a stable contract (see `PipelineDetailCtx`'s
 * `PIPELINE_DOM_IDS`); they must never be renamed or removed here.
 */

export interface RenderShellOptions {
  /** Pre-rendered header inner HTML (loading header or PipelineHeaderView output). */
  headerHtml?: string;
  sidebarCollapsed?: boolean;
  /**
   * Pre-rendered preparation-column HTML (`PipelineDetailLayout.renderPrepColumn`
   * output). Defaults to an empty prep column so the shell can also be rendered
   * without a pull-request section (e.g. for tests).
   */
  prepColumnHtml?: string;
}

export interface RenderPrepColumnOptions {
  /** Pre-rendered PullRequestSection HTML for `#pull-request-section`. */
  pullRequestSectionHtml: string;
}

export class PipelineDetailLayout {
  /** The pre-pipeline header with the back button and "Loading..." title. */
  static renderLoadingHeader(): string {
    return `
        <header class="flex justify-between items-center bg-app-surface px-4 py-2 border-b border-app-border shrink-0">
          <div class="flex gap-4 items-center">
            <button onclick="window.location.hash = '#'" class="p-2 hover:bg-app-bg rounded-xl transition-all text-app-muted hover:text-app-accent-1 border border-transparent hover:border-app-border group cursor-pointer" title="Back to Dashboard">
              <svg class="w-5 h-5 transform group-hover:-translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path>
              </svg>
            </button>
            <div class="min-w-[400px]">
              <h2 class="text-2xl font-black text-app-accent-1 tracking-tight">Loading...</h2>
            </div>
          </div>
        </header>
      `;
  }

  /** The outer page shell: header, sidebar toggle rail, backlog sidebar, main and right sidebar. */
  static renderShell(opts: RenderShellOptions): string {
    const headerHtml = opts.headerHtml ?? '';
    const sidebarCollapsed = opts.sidebarCollapsed ?? false;
    const backlogHidden = sidebarCollapsed ? ' hidden' : '';
    const prepColumnHtml =
      opts.prepColumnHtml ??
      PipelineDetailLayout.renderPrepColumn({ pullRequestSectionHtml: '' });
    return `
      <div class="h-screen flex flex-col overflow-hidden bg-app-bg">
        <div id="pipeline-header-container" class="flex-none shrink-0 border-b border-app-border/60">
          ${headerHtml}
        </div>

        <div class="flex flex-1 min-h-0">
          <!-- Sidebar toggle rail: always visible so the backlog sidebar can be
               collapsed to reclaim horizontal space and expanded again. -->
          <div class="w-9 flex-none shrink-0 flex flex-col items-center py-2 bg-app-surface/30 border-r border-app-border/60">
            <button id="backlog-sidebar-toggle" type="button"
              data-action-click="toggle_backlog_sidebar"
              class="p-1.5 rounded-lg text-app-muted hover:text-app-accent-1 hover:bg-app-bg transition-colors cursor-pointer"
              aria-pressed="${sidebarCollapsed}" aria-controls="backlog-sidebar"
              title="${sidebarCollapsed ? 'Expand backlog sidebar' : 'Collapse backlog sidebar'}">
              ${PipelineDetailLayout.sidebarToggleIcon(sidebarCollapsed)}
            </button>
          </div>

          <!-- Left Sidebar: BacklogView (proposed designs + backlog + queue) -->
          <aside id="backlog-sidebar"
            class="w-96 flex-none shrink-0 border-r border-app-border/60 bg-app-surface/30 overflow-y-auto${backlogHidden}">
            <div id="backlog-view" class="min-h-full">
              <p class="text-app-muted/40 text-[10px] uppercase font-bold tracking-widest text-center py-6">Loading backlog...</p>
            </div>
          </aside>

          <!-- Main Content Area (Preparation / PullRequests only; history moved to sidebar) -->
          <main class="flex-[2] min-w-0 overflow-y-auto">
            <!-- Top padding lives on the prep column's inner p-2 wrapper; keep
                 the outer wrapper from adding a second top padding (p-4). -->
            <div class="w-full px-4 pb-4">
              ${prepColumnHtml}
            </div>
          </main>

          <!-- Right Sidebar: ExecutionEngineView + PipelineHistoryView (bottom) -->
          <aside class="flex-1 min-w-[660px] shrink-0 border-l border-app-border/60 bg-app-surface/30 flex flex-col overflow-hidden px-1">
            <div id="execution-engine-view" class="flex-1 min-h-0 flex flex-col overflow-hidden">
              <p class="text-app-muted/40 text-[10px] uppercase font-bold tracking-widest text-center py-6">Loading execution engine...</p>
            </div>
          </aside>
        </div>
      </div>
    `;
  }

  /** The preparation column: session list, pull requests, tab list and the five tab panels. */
  static renderPrepColumn(opts: RenderPrepColumnOptions): string {
    return `
      <div class="flex flex-col gap-8 min-w-0 lg:min-w-[350px]">
        <div class="p-2 flex flex-col">
          <div id="pipeline-session-list" class="mt-3 hidden flex flex-col gap-2"></div>
          <!-- Pull requests awaiting review sit between the session list and
               the content tabs. #pull-request-section is updated in place by
               fetchPullRequests/refreshPullRequests; when nothing is awaiting
               review it stays empty and consumes no vertical space. -->
          <div id="col-prep">
            <div id="pull-request-section">${opts.pullRequestSectionHtml}</div>
          </div>
          <!-- Five tabs over five pre-rendered DOM fragments. The tab list is
               always visible; the Coding Agent tab shows its "No active
               session" state (with a Start action for remote pipelines) while
               no session is attached, and the Getting Started tab holds the
               pipeline onboarding guide. "Task editor" is the default. -->
          ${PipelineDetailLayout.renderTabList()}
          <div id="selected-task-view" role="tabpanel" aria-labelledby="tab-task-editor" class="mt-6">
            <p class="text-app-muted/60 text-xs italic text-center border border-dashed border-app-border/40 rounded-xl py-6 px-3">Select a task from the backlog to open it here.</p>
          </div>
          <div id="interactive-coding-view-mount" role="tabpanel" aria-labelledby="tab-coding-agent" class="mt-6 hidden"></div>
          <div id="file-browser-view-mount" role="tabpanel" aria-labelledby="tab-file-browser" class="mt-6 hidden"></div>
          <div id="history-view-mount" role="tabpanel" aria-labelledby="tab-history" class="mt-6 hidden"></div>
          <div id="getting-started-view-mount" role="tabpanel" aria-labelledby="tab-getting-started" class="mt-6 hidden"></div>
        </div>
      </div>
    `;
  }

  /** The five always-visible content tab buttons. "Task editor" is the default active tab. */
  static renderTabList(): string {
    return `<div class="mt-6 flex items-end gap-1 border-b border-app-border/40">
            <div id="content-tablist" role="tablist" aria-label="Pipeline content"
              class="flex items-center gap-1 min-w-0 overflow-x-auto overflow-y-hidden whitespace-nowrap">
            <button id="tab-task-editor" data-action-click="select_content_tab" data-content-tab="task-editor" type="button"
              role="tab" aria-selected="true" aria-controls="selected-task-view"
              class="px-3 py-2 text-xs font-bold uppercase tracking-widest border-b-2 -mb-px transition-colors cursor-pointer border-app-accent-1 text-app-accent-1">
              Task editor
            </button>
            <button id="tab-coding-agent" data-action-click="select_content_tab" data-content-tab="coding-agent" type="button"
              role="tab" aria-selected="false" aria-controls="interactive-coding-view-mount"
              class="px-3 py-2 text-xs font-bold uppercase tracking-widest border-b-2 -mb-px transition-colors cursor-pointer border-transparent text-app-muted hover:text-app-text">
              Coding Agent
            </button>
            <button id="tab-file-browser" data-action-click="select_content_tab" data-content-tab="file-browser" type="button"
              role="tab" aria-selected="false" aria-controls="file-browser-view-mount"
              class="px-3 py-2 text-xs font-bold uppercase tracking-widest border-b-2 -mb-px transition-colors cursor-pointer border-transparent text-app-muted hover:text-app-text">
              File Browser
            </button>
            <button id="tab-history" data-action-click="select_content_tab" data-content-tab="history" type="button"
              role="tab" aria-selected="false" aria-controls="history-view-mount"
              class="px-3 py-2 text-xs font-bold uppercase tracking-widest border-b-2 -mb-px transition-colors cursor-pointer border-transparent text-app-muted hover:text-app-text">
              Commits
            </button>
            <button id="tab-getting-started" data-action-click="select_content_tab" data-content-tab="getting-started" type="button"
              role="tab" aria-selected="false" aria-controls="getting-started-view-mount"
              class="px-3 py-2 text-xs font-bold uppercase tracking-widest border-b-2 -mb-px transition-colors cursor-pointer border-transparent text-app-muted hover:text-app-text">
              Getting Started
            </button>
            </div>
          </div>`;
  }

  /** Chevron icon for the backlog sidebar toggle (points the way it will move). */
  static sidebarToggleIcon(collapsed: boolean): string {
    const points = collapsed ? '9 18 15 12 9 6' : '15 18 9 12 15 6';
    return `<svg class="w-4 h-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="${points}"></polyline></svg>`;
  }

  /**
   * Applies the persisted backlog-sidebar collapse state to the mounted DOM.
   * The sidebar is fully hidden to reclaim its width; the toggle rail next to
   * it stays visible so it can be expanded again.
   */
  static applySidebarState(root: ParentNode, collapsed: boolean): void {
    const sidebar = root.querySelector<HTMLElement>('#backlog-sidebar');
    sidebar?.classList.toggle('hidden', collapsed);

    const button = root.querySelector<HTMLElement>('#backlog-sidebar-toggle');
    if (button) {
      button.setAttribute('aria-pressed', String(collapsed));
      button.setAttribute(
        'title',
        collapsed ? 'Expand backlog sidebar' : 'Collapse backlog sidebar'
      );
      button.innerHTML = PipelineDetailLayout.sidebarToggleIcon(collapsed);
    }
  }
}
