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

import { ConfirmationDialog } from '../../../components/dialogs/ConfirmationDialog.ts';
import { IteratePullRequestDialog } from '../../../components/dialogs/IteratePullRequestDialog.ts';
import { PullRequestDialog } from '../../../components/dialogs/PullRequestDialog.ts';
import { DevServerStartErrorDialog } from '../../../components/dialogs/DevServerStartErrorDialog.ts';
import { showPullRequestSyncToast } from '../../../components/utils/prSync.ts';
import type { PipelineDetailCtx } from '../PipelineDetailCtx.ts';

export interface PullRequestActionsDeps {
  /**
   * Re-fetch the pull requests and repaint only the dedicated
   * `#pull-request-section` container. The shell binds this to
   * `PipelineRealtimeController.refreshPullRequests()` so accepting, submitting
   * or rejecting a PR never triggers a full task refresh (which would re-render
   * the selected TaskItem and discard any open Specification/Design-Doc editor).
   */
  refreshPullRequests(): void;
  /** Re-sync the compact engine Pi slot after starting an iteration (P3). */
  updateEngineSlot(): void;
  /**
   * Optional full task refresh after a sync changes several task statuses at
   * once. When omitted, the notifier's TASK_STATUS_UPDATED broadcasts still
   * update the open clients live.
   */
  refreshTasks?(): void;
}

/**
 * Registers the pull-request actions on the shared action registry:
 * `open_pr_dialog`, `accept_pr`, `iterate_pr` and `toggle_pr_summary`.
 *
 * The handlers were extracted verbatim from `PipelineDetailView`; the view
 * state they need (`pipelineId`) comes from `ctx`, while the two shell
 * callbacks they invoke are injected through `deps`.
 */
export function registerPullRequestActions(
  ctx: PipelineDetailCtx,
  deps: PullRequestActionsDeps,
): void {
  const { actionRegistry } = ctx.context;

  /**
   * Re-reads a task after a PR action mutated its status and pushes the fresh
   * record through the DataManager, which fans it out to the pipeline's
   * incremental task update path. For a status change that path patches only the
   * TaskItem header, so the card visibly moves to its new state without
   * re-rendering (and therefore without discarding) an open
   * Specification/Design-Doc editor.
   *
   * Best-effort: a missing client/get or a failed fetch must not break the PR
   * action itself.
   */
  const refreshTaskAfterMutation = async (taskId: string | null): Promise<void> => {
    if (!taskId || typeof ctx.context.taskClient?.get !== 'function') return;
    try {
      const fresh = await ctx.context.taskClient.get(taskId);
      if (fresh) ctx.context.dataManager.updateTask(fresh);
    } catch (error) {
      console.error('Failed to refresh task after PR action:', error);
    }
  };

  actionRegistry.register('open_pr_dialog', async (_e, el) => {
    const taskId = el.getAttribute('data-task-id');
    const prId = el.getAttribute('data-pr-id');
    if (!taskId) return;

    const dialog = new PullRequestDialog({
      taskId,
      prId: prId || undefined,
      pipelineId: ctx.pipelineId,
      context: ctx.context,
      onAccept: () => {
        deps.refreshPullRequests();
        void refreshTaskAfterMutation(taskId);
      },
      onReject: () => {
        deps.refreshPullRequests();
        void refreshTaskAfterMutation(taskId);
      }
    });
    await dialog.show();
  });

  actionRegistry.register('accept_pr', async (_e, el) => {
    const prId = el.getAttribute('data-pr-id');
    if (!prId) return;

    const confirmed = await new ConfirmationDialog(
      'Accept Pull Request',
      'This pull request will be applied and committed to the pipeline workspace. Continue?',
      'Accept & Apply'
    ).show();
    if (!confirmed) return;

    const btn = el as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = 'Applying...';
    try {
      await ctx.context.pullRequestClient.acceptPullRequest(prId);
      deps.refreshPullRequests();
      await refreshTaskAfterMutation(el.getAttribute('data-task-id'));
    } catch (error: any) {
      console.error('Accept PR error:', error);
      alert(`Failed to accept Pull Request: ${error.message}`);
      btn.disabled = false;
      btn.textContent = 'Accept';
    }
  });

  actionRegistry.register('iterate_pr', async (_e, el) => {
    const prId = el.getAttribute('data-pr-id');
    if (!prId) return;

    const dialog = new IteratePullRequestDialog();
    const comments = await dialog.show();
    if (!comments) return;

    try {
      await ctx.context.pullRequestClient.iteratePullRequest(prId, comments);
      deps.updateEngineSlot();
    } catch (error: any) {
      console.error('Iterate PR error:', error);
      alert(`Failed to start iteration: ${error.message}`);
    }
  });

  actionRegistry.register('start_pr_dev_server', async (_e, el) => {
    const prId = el.getAttribute('data-pr-id');
    if (!prId) return;

    const btn = el as HTMLButtonElement;
    const original = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Building...';
    try {
      await ctx.context.pipelineClient.startDevServerOnPr(ctx.pipelineId, prId);
      // The header indicator is updated by the DEV_PROCESS_STARTED broadcast;
      // switching to another PR's server is automatic on the backend.
    } catch (error: any) {
      console.error('Start PR dev server error:', error);
      const pr = ctx.state.pullRequests.find((candidate) => candidate.id === prId);
      const taskId = el.getAttribute('data-task-id') ?? pr?.task_id ?? null;
      const task = taskId
        ? ctx.state.allLoadedTasks.find((candidate) => candidate.id === taskId)
        : undefined;
      void new DevServerStartErrorDialog({
        pipelineId: ctx.pipelineId,
        prId: prId,
        prSubject: pr?.subject ?? null,
        branch: pr?.branch_name ?? null,
        taskId,
        taskTitle: task?.title ?? null,
        error: error?.message ?? String(error),
      }).show();
    } finally {
      btn.disabled = false;
      btn.textContent = original;
    }
  });

  actionRegistry.register('sync_from_gitea', async (_e, el) => {
    const btn = el as HTMLButtonElement;
    const originalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = 'Syncing...';
    try {
      const result = await ctx.context.pullRequestClient.syncPullRequests(
        ctx.pipelineId,
      );
      showPullRequestSyncToast(result);
      deps.refreshPullRequests();
      deps.refreshTasks?.();
    } catch (error: any) {
      console.error('Sync from Gitea error:', error);
      alert(`Failed to sync from Gitea: ${error.message}`);
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
    }
  });

  actionRegistry.register('toggle_pr_summary', (_e, el) => {
    const body = el.closest('[data-pr-card]')?.querySelector('.pr-summary');
    const icon = el.querySelector('svg.transform');
    if (!body) return;
    const isHidden = body.classList.toggle('hidden');
    if (icon) icon.classList.toggle('rotate-90', !isHidden);
  });
}
