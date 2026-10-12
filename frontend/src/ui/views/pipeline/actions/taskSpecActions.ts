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

import type { PipelineDetailCtx } from '../PipelineDetailCtx.ts';

export interface TaskSpecActionsDeps {
  /** P7: close the title editor and open/focus the specification textarea. */
  focusSpecAfterTitleSave(titleContainer: HTMLElement): void;
  /** P7: arm / clear the "keep the spec editor open after create" marker. */
  markSpecEditPending(taskId: string | null): void;
  /** P7: arm / clear the "focus Schedule Execution after the next repaint" marker. */
  markScheduleFocusPending(taskId: string | null): void;
  /** P7: apply and consume the pending schedule-focus marker immediately. */
  applyPendingScheduleFocus(taskElement: Element | null, taskId: string): void;
}

/**
 * Registers the task title / specification editing actions on the shared
 * action registry: `edit_title`, `cancel_title_edit`, `save_title`, `edit_spec`,
 * `cancel_spec_edit`, `save_spec`, `toggle_spec_expand` and `copy_spec`.
 *
 * The handlers were extracted verbatim from `PipelineDetailView` (P9a). The
 * shared state they touch (`pendingSpecEditTaskId`, `collapsedSpecs`) comes
 * from `ctx.state`; the title/spec focus hand-off is injected through `deps`
 * so the module binds to the stable `SelectedTaskController` API.
 */
export function registerTaskSpecActions(
  ctx: PipelineDetailCtx,
  deps: TaskSpecActionsDeps,
): void {
  const { actionRegistry } = ctx.context;

  actionRegistry.register('edit_title', async (_e, el) => {
    const container = el.closest('.title-container') as HTMLElement;
    if (!container) return;
    container.querySelector('.title-view')?.classList.add('hidden');
    container.querySelector('.title-edit')?.classList.remove('hidden');
    const input = container.querySelector('input');
    input?.focus();
    input?.select();
  });

  actionRegistry.register('cancel_title_edit', async (_e, el) => {
    const container = el.closest('.title-container') as HTMLElement;
    if (!container) return;
    container.querySelector('.title-view')?.classList.remove('hidden');
    container.querySelector('.title-edit')?.classList.add('hidden');
  });

  actionRegistry.register('save_title', async (_e, el) => {
    const container = el.closest('.title-container') as HTMLElement;
    if (!container) return;
    const taskId = container.getAttribute('data-task-id');
    const version = parseInt(container.getAttribute('data-version') || '1');
    const input = container.querySelector('input');
    if (!taskId || !input) return;

    const newTitle = input.value.trim();
    if (!newTitle) return;

    // No-op when the title is unchanged: pressing Enter (or clicking Save)
    // without editing the text must not trigger an update. Saving anyway would
    // bump ``updated_at`` on the server, which surfaces as a task update where
    // ``prev.title === next.title`` and therefore falls through to a full
    // TaskItem re-render, discarding any unrelated unsaved edits (e.g. an
    // open Specification or Design Doc). Swallow the event so it does not
    // propagate further while still leaving no-op as intended.
    const currentTitle = container.querySelector<HTMLElement>('.title-view span.font-medium')?.textContent?.trim() ?? '';
    if (newTitle === currentTitle) {
      _e.preventDefault?.();
      _e.stopPropagation?.();
      return;
    }

    try {
      await ctx.context.taskClient.updateDetails(taskId, version, { title: newTitle });
      // After a successful save, leave title edit mode and move the cursor
      // into the Specification textarea so the user can keep describing the
      // task seamlessly.
      deps.focusSpecAfterTitleSave(container);
      // WS will refresh
    } catch (error) {
      alert('Failed to save title');
    }
  });

  actionRegistry.register('edit_spec', async (_e, el) => {
    const container = el.closest('.spec-container') as HTMLElement;
    if (!container) return;
    container.querySelector('.spec-view')?.classList.add('hidden');
    container.querySelector('[data-action-click="toggle_spec_expand"]')?.classList.add('hidden');
    container.querySelector('.spec-edit')?.classList.remove('hidden');
    const textarea = container.querySelector('textarea');
    textarea?.focus();
  });

  actionRegistry.register('cancel_spec_edit', async (_e, el) => {
    const container = el.closest('.spec-container') as HTMLElement;
    if (!container) return;
    const taskId = container.getAttribute('data-task-id');
    if (taskId && ctx.state.pendingSpecEditTaskId === taskId) deps.markSpecEditPending(null);
    container.querySelector('.spec-view')?.classList.remove('hidden');
    container.querySelector('[data-action-click="toggle_spec_expand"]')?.classList.remove('hidden');
    container.querySelector('.spec-edit')?.classList.add('hidden');
  });

  actionRegistry.register('save_spec', async (_e, el) => {
    const container = el.closest('.spec-container') as HTMLElement;
    if (!container) return;
    const taskId = container.getAttribute('data-task-id');
    if (taskId && ctx.state.pendingSpecEditTaskId === taskId) deps.markSpecEditPending(null);
    const version = parseInt(container.getAttribute('data-version') || '1');
    const textarea = container.querySelector('textarea');
    const wantDesignCheck = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    if (!taskId || !textarea) return;

    const newSpec = textarea.value.trim();
    const wantDesignDoc = wantDesignCheck.checked;

    // Saving the specification should hand focus to the primary follow-up
    // action of a CREATED task ("Schedule Execution") so the user can save
    // and schedule in one flow. The task id is remembered so the focus is
    // re-applied after the WS-driven re-render that follows the update.
    const taskEl = container.closest('[data-view-id]') as HTMLElement | null;
    const refocusAfterRender = !!taskEl?.closest('#selected-task-view');
    deps.markScheduleFocusPending(taskId);

    try {
      await ctx.context.taskClient.updateDetails(taskId, version, { spec: newSpec, want_design_doc: wantDesignDoc });
      // Keep the spec expanded after saving the changes.
      ctx.state.collapsedSpecs.delete(taskId);
      // Apply focus immediately too, so it also works when no WS re-render
      // arrives (e.g. when saved from the search dialog). The helper consumes
      // the marker, so re-arm it for the selected task: the WS-driven
      // re-render replaces the card and `refreshSelectedTask` then re-applies
      // the focus to the freshly rendered button.
      deps.applyPendingScheduleFocus(taskEl, taskId);
      if (refocusAfterRender) {
        deps.markScheduleFocusPending(taskId);
      }
      // WS will refresh
    } catch (error) {
      deps.markScheduleFocusPending(null);
      alert('Failed to save specification');
    }
  });

  actionRegistry.register('toggle_spec_expand', async (_e, el) => {
    const container = el.closest('.spec-container') as HTMLElement;
    if (!container) return;
    const taskId = container.getAttribute('data-task-id');
    if (!taskId) return;

    const display = container.querySelector('.spec-display');
    if (!display) return;

    const isExpanded = display.classList.toggle('expanded');
    el.textContent = isExpanded ? 'Show Less' : 'Show More';

    if (isExpanded) {
      ctx.state.collapsedSpecs.delete(taskId);
    } else {
      ctx.state.collapsedSpecs.add(taskId);
    }
  });

  // Copies the task's raw Markdown specification to the clipboard. The spec is
  // read from the task cache when available and falls back to the (hidden)
  // editor textarea, which always carries the raw Markdown, so the action also
  // works for cards rendered outside the pipeline detail view (e.g. search
  // results). The button swaps to a check icon for two seconds to confirm the
  // copy, mirroring the other icon-only copy buttons.
  actionRegistry.register('copy_spec', async (_e, el) => {
    const container = el.closest('.spec-container') as HTMLElement;
    if (!container) return;
    const taskId = container.getAttribute('data-task-id');
    const task = taskId
      ? ctx.state.allLoadedTasks.find(t => t.id === taskId)
      : undefined;
    const spec = task?.spec ?? container.querySelector('textarea')?.value ?? '';
    if (!spec) return;

    try {
      await navigator.clipboard.writeText(spec);
      const originalHtml = el.innerHTML;
      el.innerHTML = `<svg class="w-3 h-3 text-green-500 animate-bounce" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>`;
      setTimeout(() => {
        el.innerHTML = originalHtml;
      }, 2000);
    } catch (err) {
      console.error('Failed to copy specification:', err);
    }
  });
}
