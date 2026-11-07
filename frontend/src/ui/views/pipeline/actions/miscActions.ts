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

import { DevServerDialog } from '../../../components/dialogs/DevServerDialog.ts';
import { DiffDialog } from '../../../components/dialogs/DiffDialog.ts';
import { PipelineEditDialog } from '../../../components/dialogs/PipelineEditDialog.ts';
import { StatsDialog } from '../../../components/dialogs/StatsDialog.ts';
import type { ContentTab } from '../../../../core/PipelineRoute.ts';
import type { HashWriteMode } from '../PipelineSubRoute.ts';
import type { PipelineDetailCtx } from '../PipelineDetailCtx.ts';
import {
  BacklogView,
  BACKLOG_SECTION_KEYS,
  type BacklogSectionKey,
} from '../../../components/pipeline/BacklogView.ts';

export interface MiscActionsDeps {
  /** The mounted view root; `create_task` re-reads the live title input. */
  getHost(): HTMLElement | null;
  /** Switch the active content tab and write the route (currently the shell; P8 will own it). */
  setContentTab(tab: ContentTab, opts?: { hash?: HashWriteMode }): void;
  /** Set the history page and repaint the history feed (shell, ~1602). */
  setHistoryPage(page: number): void;
  /** Re-apply the backlog sidebar collapse state to the DOM (P2). */
  applySidebarState(): void;
  /** Persist `sidebar_collapsed:<pipelineId>` (shell owns `LocalStorageManager`). */
  persistSidebarCollapsed(collapsed: boolean): void;
}

/**
 * Registers the miscellaneous pipeline/dialog/navigation actions on the shared
 * action registry: `edit_pipeline`, `copy_pipeline_id`, `copy_task_id`,
 * `copy_commit_hash`, `open_stats`, `open_history`, `open_dev_server_dialog`,
 * `open_quickfix`, `open_diff_view`, `create_task`, `prev_history_page`,
 * `next_history_page` and `toggle_backlog_sidebar`.
 *
 * It also registers `toggle_backlog_section`, which independently collapses or
 * expands the Proposed, Backlog and Queue sections of the left sidebar.
 *
 * The handlers were extracted verbatim from `PipelineDetailView`. All mutable
 * state comes from `ctx.state` and every repaint goes through `ctx.refresh`;
 * the shell-only callbacks are injected through `deps`.
 */
export function registerMiscActions(ctx: PipelineDetailCtx, deps: MiscActionsDeps): void {
  const { actionRegistry } = ctx.context;

  actionRegistry.register('edit_pipeline', async () => {
    if (!ctx.state.pipeline) return;
    const dialog = new PipelineEditDialog({
      mode: 'edit',
      pipeline: ctx.state.pipeline,
      pipelineId: ctx.pipelineId,
      context: ctx.context
    });
    await dialog.show();
    // After dialog closes, we might want to refresh the header if it was updated
    // The dialog itself calls update on the client, and we'll get a websocket update
    // or we can refresh manually if needed.
  });

  // Collapse/expand the left backlog sidebar (proposed designs + backlog + queue) to
  // reclaim horizontal space on demand. The chosen state is persisted per
  // pipeline and restored on the next visit.
  actionRegistry.register('toggle_backlog_sidebar', () => {
    ctx.state.sidebarCollapsed = !ctx.state.sidebarCollapsed;
    deps.persistSidebarCollapsed(ctx.state.sidebarCollapsed);
    deps.applySidebarState();
  });

  // Collapse/expand one of the three backlog sections independently. The
  // section header is a native <summary>, but this action keeps the state in
  // sync so a later backlog repaint does not reopen the section.
  actionRegistry.register('toggle_backlog_section', (_e, el) => {
    const section = (el.getAttribute('data-backlog-toggle') ||
      el.closest('[data-backlog-collapsible]')?.getAttribute('data-backlog-collapsible')) as
      BacklogSectionKey | null;
    if (!section || !BACKLOG_SECTION_KEYS.includes(section)) return;

    const root = el.closest('#backlog-view') ?? el.closest('[data-backlog-collapsible]') ?? el.parentElement;
    if (!root) return;

    const collapsed = BacklogView.toggleSection(root, section);
    if (collapsed) ctx.state.collapsedBacklogSections.add(section);
    else ctx.state.collapsedBacklogSections.delete(section);
  });

  actionRegistry.register('copy_pipeline_id', async (_e, el) => {
    try {
      await navigator.clipboard.writeText(ctx.pipelineId);
      const originalHtml = el.innerHTML;
      el.innerHTML = `<svg class="w-3 h-3 text-green-500 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>`;
      setTimeout(() => {
        el.innerHTML = originalHtml;
      }, 2000);
    } catch (err) {
      console.error('Failed to copy pipeline ID:', err);
    }
  });

  actionRegistry.register('copy_task_id', async (_e, el) => {
    const taskId = el.closest('[data-task-id]')?.getAttribute('data-task-id');
    if (!taskId) return;
    try {
      await navigator.clipboard.writeText(taskId);
      const originalHtml = el.innerHTML;
      el.innerHTML = `<svg class="w-3 h-3 text-green-500 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>`;
      setTimeout(() => {
        el.innerHTML = originalHtml;
      }, 2000);
    } catch (err) {
      console.error('Failed to copy task ID:', err);
    }
  });

  actionRegistry.register('copy_commit_hash', async (_e, el) => {
    const commitHash = el.dataset.commitHash;
    if (!commitHash) return;
    try {
      await navigator.clipboard.writeText(commitHash);
      const originalHtml = el.innerHTML;
      el.innerHTML = `<svg class="w-3 h-3 text-green-500 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>`;
      setTimeout(() => {
        el.innerHTML = originalHtml;
      }, 2000);
    } catch (err) {
      console.error('Failed to copy commit hash:', err);
    }
  });

  actionRegistry.register('open_dev_server_dialog', () => {
    new DevServerDialog(ctx.context, ctx.pipelineId).show();
  });

  actionRegistry.register('open_stats', () => {
    new StatsDialog(ctx.state.allLoadedTasks, ctx.pipelineId, ctx.context.pipelineClient).show();
  });

  actionRegistry.register('open_history', () => {
    deps.setContentTab('history', { hash: 'push' });
  });

  actionRegistry.register('create_task', async (_e, el) => {
    const form = el as HTMLFormElement;
    const titleInput = form.querySelector('input[name="task_title"]') as HTMLInputElement;
    const title = titleInput.value.trim();
    if (!title) return;

    try {
      const created = await ctx.context.taskClient.create(ctx.pipelineId, title);
      // The header (and with it the form) may have been re-rendered by a
      // WebSocket update while the request was in flight, so clear the input
      // that is currently mounted rather than the (possibly detached) node we
      // captured before the await.
      titleInput.value = '';
      const liveInput = deps.getHost()?.querySelector<HTMLInputElement>('input[name="task_title"]');
      if (liveInput) liveInput.value = '';

      // Make the newly created task the selected task so it is shown in the main
      // content area immediately. Add it to the local cache so the detail view can
      // render it even before the WebSocket TASK_CREATED notification arrives.
      ctx.state.selectedTask = created;
      const existingIndex = ctx.state.allLoadedTasks.findIndex(t => t.id === created.id);
      if (existingIndex === -1) {
        ctx.state.allLoadedTasks.push(created);
      } else {
        ctx.state.allLoadedTasks[existingIndex] = created;
      }
      ctx.state.pendingSpecEditTaskId = created.id ?? null;
      // Selecting a task must be visible to the user, so make sure the Task
      // editor tab is the active one in the main content area.
      deps.setContentTab('task-editor', { hash: 'push' });
      ctx.refresh.backlog();
      ctx.refresh.selectedTask();
    } catch (error) {
      alert('Failed to create task');
    }
  });

  actionRegistry.register('prev_history_page', () => {
    deps.setHistoryPage(ctx.state.historyPage - 1);
  });

  actionRegistry.register('next_history_page', () => {
    deps.setHistoryPage(ctx.state.historyPage + 1);
  });

  actionRegistry.register('open_quickfix', async (_e, el) => {
    const taskId = el.dataset.taskId;
    if (!taskId) return;

    const btn = el as HTMLElement;
    btn.classList.add('animate-pulse', 'text-app-accent-2');

    try {
      await ctx.context.editorClient.quickfix(taskId);
      setTimeout(() => btn.classList.remove('animate-pulse', 'text-app-accent-2'), 1000);
    } catch (err) {
      console.error('Failed to open quickfix:', err);
      btn.classList.remove('animate-pulse', 'text-app-accent-2');
      btn.classList.add('text-red-500');
      setTimeout(() => btn.classList.remove('text-red-500'), 2000);
    }
  });

  actionRegistry.register('open_diff_view', async (_e, el) => {
    const commitHash = el.dataset.commitHash;
    if (!commitHash) return;

    const taskId = el.closest('[data-task-id]')?.getAttribute('data-task-id');
    const task = ctx.state.allLoadedTasks.find(t => t.id === taskId);

    new DiffDialog({
      context: ctx.context,
      pipelineId: ctx.pipelineId,
      commitHash,
      title: task?.title,
    }).show();
  });
}
