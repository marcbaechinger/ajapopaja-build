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

import { CoderBotDialog } from '../../../components/dialogs/CoderBotDialog.ts';
import { DocBotDialog, type DocBotDialogProps } from '../../../components/dialogs/DocBotDialog.ts';
import { ReviewDialog } from '../../../components/dialogs/ReviewDialog.ts';
import { UpdateDesignDialog } from '../../../components/dialogs/UpdateDesignDialog.ts';
import { TaskStatus } from '../../../../core/domain.ts';
import type { ContentTab } from '../../../../core/PipelineRoute.ts';
import type { HashWriteMode } from '../PipelineSubRoute.ts';
import type { PipelineDetailCtx } from '../PipelineDetailCtx.ts';

export interface BotActionsDeps {
  /** The mounted view root; `openDocBotDialog` queries `#docbot-dialog-container`. */
  getHost(): HTMLElement | null;
  /** Switch the active content tab and write the route (currently the shell; P8 will own it). */
  setContentTab(tab: ContentTab, opts?: { hash?: HashWriteMode }): void;
  /** Fetch a single SpecAgent proposal on demand (P6). */
  fetchSpecProposal(taskId: string): void;
  /** Re-sync the compact engine Pi slot after an optimistic CoderBot start (P3). */
  updateEngineSlot(): void;
  /** Persist `ctx.state.pendingReviews` after `open_review_dialog` consumes one (P6). */
  persistPendingReviews(): void;
}

/**
 * Opens the DocBot diff/commit dialog into the shell's `#docbot-dialog-container`
 * mount point. Reads live state from `ctx.state`, so a missing host, task id or
 * preview payload is an intentional no-op.
 */
function openDocBotDialog(ctx: PipelineDetailCtx, deps: BotActionsDeps): void {
  const dialogContainer = deps
    .getHost()
    ?.querySelector('#docbot-dialog-container') as HTMLElement | null;
  if (!dialogContainer || !ctx.state.docbotState.taskId || !ctx.state.docbotPreviewData) return;

  const props: DocBotDialogProps = {
    taskId: ctx.state.docbotState.taskId,
    pipelineId: ctx.pipelineId,
    diff: ctx.state.docbotPreviewData.diff,
    commitMsg: ctx.state.docbotPreviewData.commit_msg,
    filename: ctx.state.docbotPreviewData.filename,
    context: ctx.context,
    onClose: () => {
      dialogContainer.innerHTML = '';
    },
    onSuccess: () => {
      ctx.state.docbotState = {
        status: 'none',
        taskId: null,
      };
      ctx.state.docbotPreviewData = null;
      ctx.refresh.header();
    }
  };

  new DocBotDialog(dialogContainer, props);
}

/**
 * Pops the compact engine log out into the full CoderBot dialog. Exported so the
 * `ExecutionEngineController` callback wired up by the shell can reuse it.
 */
export function openCoderBotDialog(ctx: PipelineDetailCtx): void {
  new CoderBotDialog(ctx.context.coderBotService).show();
}

/**
 * Registers the bot trigger/dialog actions on the shared action registry:
 * `trigger_reviewbot`, `trigger_archbot`, `trigger_specagent`, `trigger_coderbot`,
 * `trigger_docbot`, `open_spec_proposal`, `open_docbot_dialog`,
 * `dismiss_docbot_banner`, `open_coderbot_dialog`, `update_design` and
 * `open_review_dialog`.
 *
 * The handlers were extracted verbatim from `PipelineDetailView`. All mutable
 * state comes from `ctx.state` and every repaint goes through `ctx.refresh`;
 * the shell-only callbacks are injected through `deps`.
 */
export function registerBotActions(ctx: PipelineDetailCtx, deps: BotActionsDeps): void {
  const { actionRegistry } = ctx.context;

  actionRegistry.register('trigger_reviewbot', async (_e, el) => {
    const taskId = el.getAttribute('data-task-id');
    if (!taskId) return;

    try {
      await ctx.context.reviewBotClient.trigger(ctx.pipelineId, taskId);

      ctx.state.reviewbotState = { status: 'inProgress', taskId };
      ctx.refresh.header();
    } catch (error) {
      console.error('Trigger ReviewBot error:', error);
      alert('Failed to trigger ReviewBot');
    }
  });

  actionRegistry.register('trigger_archbot', async (_e, el) => {
    const taskId = el.getAttribute('data-task-id');
    if (!taskId) return;

    try {
      await ctx.context.archBotClient.trigger(ctx.pipelineId, taskId);
      ctx.state.archbotState = { status: 'inProgress', taskId };
      ctx.refresh.header();
    } catch (error) {
      console.error('Trigger ArchBot error:', error);
      alert('Failed to trigger ArchitectureBot');
    }
  });

  actionRegistry.register('trigger_specagent', async (_e, el) => {
    const taskId = el.getAttribute('data-task-id');
    console.log('[SpecAgent] (0) action trigger_specagent (PipelineDetailView handler)', {
      taskId,
      pipelineId: ctx.pipelineId,
    });
    if (!taskId) return;

    try {
      await ctx.context.specBotClient.trigger(ctx.pipelineId, taskId);
      console.log('[SpecAgent] (0) trigger request sent', { taskId });
      ctx.state.specagentState = { status: 'inProgress', taskId };
      ctx.refresh.header();
    } catch (error) {
      console.error('[SpecAgent] (0) trigger failed', error);
      alert('Failed to trigger the specification bot');
    }
  });

  // Header-badge entry point: select the task that owns an outstanding
  // proposal and surface it inline in the Task editor tab.
  actionRegistry.register('open_spec_proposal', async (_e, el) => {
    const taskId = el.getAttribute('data-task-id');
    if (!taskId) return;
    ctx.state.pendingSpecEditTaskId = null;
    ctx.state.selectedTask = ctx.state.allLoadedTasks.find(t => t.id === taskId) || null;
    deps.setContentTab('task-editor', { hash: 'push' });
    ctx.refresh.backlog();
    ctx.refresh.selectedTask();
    if (!ctx.state.pendingSpecProposals.some(p => p.task_id === taskId)) {
      void deps.fetchSpecProposal(taskId);
    }
  });

  actionRegistry.register('update_design', async (_e, el) => {
    const taskId = el.getAttribute('data-task-id');
    if (!taskId) return;

    const dialog = new UpdateDesignDialog();
    const comments = await dialog.show();
    if (!comments) return;

    try {
      await ctx.context.archBotClient.iterate(ctx.pipelineId, taskId, comments);
      ctx.state.archbotState = { status: 'inProgress', taskId };
      ctx.refresh.header();
    } catch (error) {
      console.error('Update Design error:', error);
      alert('Failed to update design document');
    }
  });

  actionRegistry.register('trigger_coderbot', async (_e, el) => {
    const taskId = el.getAttribute('data-task-id');
    if (!taskId) return;

    try {
      await ctx.context.coderBotClient.triggerCoderBot(taskId);
      // Optimistically reflect the INPROGRESS status so the card moves to the
      // In Progress column immediately, even if the broadcast is delayed.
      const task = ctx.state.allLoadedTasks.find(t => t.id === taskId);
      if (task && task.status !== TaskStatus.INPROGRESS) {
        task.status = TaskStatus.INPROGRESS;
        ctx.context.dataManager.updateTask(task); // -> pipeline:tasks notify -> updateSingleTask
      }
      ctx.refresh.header();
      deps.updateEngineSlot();
    } catch (error) {
      console.error('Trigger CoderBot error:', error);
      alert('Failed to trigger CoderBot');
    }
  });

  actionRegistry.register('open_review_dialog', async (_e, el) => {
    const taskId = el.getAttribute('data-task-id');
    if (!taskId) return;

    ctx.state.pendingReviews = ctx.state.pendingReviews.filter(id => id !== taskId);
    deps.persistPendingReviews();
    ctx.refresh.header();

    const task = ctx.state.allLoadedTasks.find(t => t.id === taskId);
    if (!task) return;

    const dialog = new ReviewDialog({
      task,
      pipelineId: ctx.pipelineId,
      context: ctx.context,
      onDelete: () => {
        // Task will be updated via websocket
      }
    });
    await dialog.show();
  });

  actionRegistry.register('open_coderbot_dialog', (e) => {
    e.preventDefault();
    openCoderBotDialog(ctx);
  });

  actionRegistry.register('trigger_docbot', async (_e, el) => {
    const taskId = el.dataset.taskId;
    if (!taskId) return;

    const btn = el as HTMLElement;
    btn.classList.add('animate-pulse', 'text-green-500');

    try {
      await ctx.context.docBotClient.triggerDocBot(ctx.pipelineId, taskId);
      // Remove pulse after a short delay
      setTimeout(() => btn.classList.remove('animate-pulse', 'text-green-500'), 1000);
    } catch (err) {
      console.error('Failed to trigger DocBot:', err);
      btn.classList.remove('animate-pulse', 'text-green-500');
      btn.classList.add('text-red-500');
      setTimeout(() => btn.classList.remove('text-red-500'), 2000);
    }
  });

  actionRegistry.register('open_docbot_dialog', () => {
    openDocBotDialog(ctx, deps);
  });

  actionRegistry.register('dismiss_docbot_banner', () => {
    ctx.state.docbotState = { status: 'none', taskId: null };
    ctx.state.docbotPreviewData = null;
    ctx.refresh.header();
  });
}
