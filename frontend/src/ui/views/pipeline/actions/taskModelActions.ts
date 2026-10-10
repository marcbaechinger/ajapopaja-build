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

import { SuggestedModelDialog } from '../../../components/dialogs/SuggestedModelDialog.ts';
import type { PipelineDetailCtx } from '../PipelineDetailCtx.ts';

/**
 * Registers the task model-pinning action on the shared action registry:
 * `edit_suggested_model`.
 *
 * The handler pops up {@link SuggestedModelDialog} (which reuses the same pi-agent
 * model catalog as the pipeline edit dialog), sends the selection to the backend
 * via ``taskClient.updateDetails`` and lets the WebSocket ``TASK_UPDATED`` message
 * refresh the card in place.
 */
export function registerTaskModelActions(ctx: PipelineDetailCtx): void {
  const { actionRegistry } = ctx.context;

  actionRegistry.register('edit_suggested_model', async (_e, el) => {
    const taskId = el.getAttribute('data-task-id');
    const version = parseInt(el.getAttribute('data-version') || '1', 10);
    if (!taskId) return;

    const task = ctx.state.allLoadedTasks.find((t) => t.id === taskId);
    const current = task?.suggested_model ?? null;

    const dialog = new SuggestedModelDialog(ctx.context, ctx.pipelineId, current);
    const result = await dialog.show();
    if (result === null) return;

    try {
      await ctx.context.taskClient.updateDetails(taskId, version, {
        suggested_model: result === '' ? null : result,
      });
      // The backend broadcasts TASK_UPDATED; the realtime controller patches
      // the card in place with the new model.
    } catch (error) {
      console.error('Failed to update task model:', error);
      alert('Failed to update task model');
    }
  });
}
