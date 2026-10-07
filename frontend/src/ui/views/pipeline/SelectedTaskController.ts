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

import { TaskItem } from '../../components/TaskItem.ts';
import type { Task } from '../../../core/domain.ts';
import type { PipelineDetailCtx } from './PipelineDetailCtx.ts';

export interface SelectedTaskControllerDeps {
  ctx: PipelineDetailCtx;
  /** The mounted view root containing #selected-task-view and the task cards. */
  getHost(): HTMLElement | null;
}

/**
 * Owns the incremental selected/inlined task updates and the title/spec
 * edit -> focus hand-off.
 *
 * Extracted verbatim from `PipelineDetailView` (P7). The shell keeps only thin
 * delegators so the existing action handlers, the WebSocket callback and the
 * route code keep working. All mutable data comes from `ctx.state` and every
 * repaint goes through the `ctx.refresh` hooks; the mounted view root is
 * reached through the lazily-evaluated `getHost()` callback so the controller
 * can be constructed before `mount()`.
 */
export class SelectedTaskController {
  private readonly deps: SelectedTaskControllerDeps;

  constructor(deps: SelectedTaskControllerDeps) {
    this.deps = deps;
  }

  /**
   * Incoming task update: upserts the local cache and then repaints only the
   * part of the UI that actually needs to change:
   *
   * - a title-only change patches the title in place,
   * - a status-only change patches just the TaskItem header in place (so an open
   *   Specification/Design-Doc editor in the body survives the server-driven
   *   state transition) while the backlog / execution engine are refreshed
   *   because the task may have moved between sections,
   * - anything else repaints the backlog, the execution engine and, only when
   *   the updated task is the selected one, the selected task view.
   *
   * Unrelated updates never touch `#selected-task-view`, so an open
   * Specification/Design-Doc editor there is preserved.
   */
  update(task: Task): void {
    const { ctx } = this.deps;
    const taskId = task.id ?? '';
    if (!taskId) return;

    // Update local cache, capturing the previous state so we can detect a
    // title-/status-only change (which must not trigger a full re-render).
    const index = ctx.state.allLoadedTasks.findIndex(t => t.id === taskId);
    const prev = index !== -1 ? ctx.state.allLoadedTasks[index] : null;
    if (index !== -1) {
      ctx.state.allLoadedTasks[index] = task;
    } else {
      ctx.state.allLoadedTasks.push(task);
    }
    ctx.refresh.header();

    // A title-only update must not re-render the TaskItem / views, otherwise
    // unrelated unsaved text edits (e.g. an open Specification editor) get
    // wiped. Update just the title DOM in place instead.
    if (prev) {
      const onlyTitle = this.isTitleOnlyChange(prev, task);
      if (onlyTitle) {
        this.updateTitleOnly(task);
        return;
      }

      // A status transition only affects the card header (badge + action
      // toolbar) from the card's perspective; the sidebar sections are still
      // refreshed because the task may have moved between them. Patch the header
      // in place instead of re-rendering the whole card, so an open
      // Specification/Design-Doc editor in the body is not discarded.
      if (this.isStatusChange(prev, task)) {
        this.updateHeaderOnly(task);
        ctx.refresh.backlog();
        ctx.refresh.executionEngine();
        return;
      }
    }

    ctx.refresh.backlog();
    // Only the selected task lives in #selected-task-view. Re-rendering it for
    // an unrelated task update would discard any open Specification/Design-Doc
    // editor in the selected task, so leave that fragment untouched.
    if (ctx.state.selectedTask?.id === taskId) {
      this.refreshSelected();
    }
    ctx.refresh.executionEngine();
  }

  /** Repaints `#selected-task-view` from the freshest cache. */
  refreshSelected(): void {
    const { ctx } = this.deps;
    const host = this.deps.getHost();
    if (!host) return;
    const viewEl = host.querySelector('#selected-task-view');
    if (!viewEl) return;

    const hint = `<p class="text-app-muted/60 text-xs italic text-center border border-dashed border-app-border/40 rounded-xl py-6 px-3">Select a task from the backlog to open it here.</p>`;

    if (!ctx.state.selectedTask) {
      viewEl.innerHTML = hint;
      return;
    }

    // Re-derive from the freshest cache so status edits are reflected immediately.
    const fresh = ctx.state.allLoadedTasks.find(t => t.id === ctx.state.selectedTask!.id);
    if (!fresh || fresh.deleted) {
      ctx.state.selectedTask = null;
      viewEl.innerHTML = hint;
      return;
    }

    ctx.state.selectedTask = fresh;
    viewEl.innerHTML = TaskItem.render(fresh, false, false, false, false, !ctx.state.collapsedSpecs.has(fresh.id!));

    // A just-saved Specification hands focus to the task's "Schedule Execution"
    // button. The WS-driven re-render above replaces the card, so re-apply it
    // here (the helper clears the pending marker).
    this.applyPendingScheduleFocus(viewEl, fresh.id!);

    // Keep the Specification in edit mode for a newly created task even if a
    // WebSocket re-render happens right after creation.
    if (ctx.state.pendingSpecEditTaskId && fresh.id === ctx.state.pendingSpecEditTaskId) {
      this.enterSpecEditMode();
    }

    // Re-inject any outstanding proposal for the task that is now shown.
    ctx.refresh.specProposals();
  }

  /** Arms the "keep the spec editor open after create" marker. */
  markSpecEditPending(taskId: string | null): void {
    this.deps.ctx.state.pendingSpecEditTaskId = taskId;
  }

  /** Arms the "focus Schedule Execution after the next repaint" marker. */
  markScheduleFocusPending(taskId: string | null): void {
    this.deps.ctx.state.pendingScheduleFocusTaskId = taskId;
  }

  /**
   * Applies the pending "focus the Schedule Execution button" request to a
   * rendered task card.
   *
   * Focus is only handed over when the pending marker belongs to `taskId`, so
   * a re-render of an unrelated card cannot steal the focus. The marker is
   * always cleared afterwards so it cannot leak to a later render.
   */
  applyPendingScheduleFocus(taskElement: Element | null, taskId: string): void {
    const { ctx } = this.deps;
    if (ctx.state.pendingScheduleFocusTaskId === taskId) {
      TaskItem.focusScheduleExecution(taskElement);
    }
    ctx.state.pendingScheduleFocusTaskId = null;
  }

  /**
   * Transitions the just-saved title from edit mode back to view mode and then
   * focuses the task's Specification textarea (opening it for editing) so the
   * user can continue seamlessly by specifying the task, without the previous
   * collapse/expand action interfering.
   */
  focusSpecAfterTitleSave(titleContainer: HTMLElement): void {
    const host = this.deps.getHost();
    if (!host) return;

    // 1) Switch the title edit form back to the rendered title view.
    titleContainer.querySelector('.title-edit')?.classList.add('hidden');
    titleContainer.querySelector('.title-view')?.classList.remove('hidden');

    // 2) Locate the task card owning this title and open its Specification.
    const taskId = titleContainer.closest('[data-view-id]')?.getAttribute('data-view-id');
    if (!taskId) return;
    const taskEl = host.querySelector(`[data-view-id="${taskId}"]`) as HTMLElement | null;
    if (!taskEl) return;
    const specContainer = taskEl.querySelector('.spec-container') as HTMLElement | null;
    if (!specContainer) return;

    specContainer.querySelector('.spec-view')?.classList.add('hidden');
    specContainer.querySelector('[data-action-click="toggle_spec_expand"]')?.classList.add('hidden');
    specContainer.querySelector('.spec-edit')?.classList.remove('hidden');
    const textarea = specContainer.querySelector('textarea') as HTMLTextAreaElement | null;
    if (textarea) textarea.focus();
  }

  /**
   * Returns whether an incoming task update is a pure title change (i.e. every
   * field other than title / version / updated_at is unchanged), so callers can
   * avoid re-rendering the whole view and preserve unrelated unsaved edits.
   */
  private isTitleOnlyChange(prev: Task, next: Task): boolean {
    if (prev.title === next.title) {
      return false;
    }
    const comparable = (t: Task) => {
      const { title, version, updated_at, ...rest } = t as any;
      return rest;
    };
    const onlyTitle = JSON.stringify(comparable(prev)) === JSON.stringify(comparable(next));
    return onlyTitle;
  }

  /**
   * Returns whether an incoming task update carries a status change. Such an
   * update is reflected by patching only the TaskItem header in place (see
   * {@link updateHeaderOnly}) so a server-driven state transition cannot wipe an
   * open Specification/Design-Doc editor in the card body.
   */
  private isStatusChange(prev: Task, next: Task): boolean {
    return prev.status !== next.status;
  }

  /**
   * Patches only the header of every rendered TaskItem for the task in place,
   * keeping the rest of each card (and therefore any open editor) untouched.
   */
  private updateHeaderOnly(task: Task): void {
    const { ctx } = this.deps;
    const host = this.deps.getHost();
    const taskId = task.id ?? '';
    if (!taskId || !host) return;

    if (ctx.state.selectedTask?.id === taskId) {
      ctx.state.selectedTask = task;
    }

    host
      .querySelectorAll<HTMLElement>(`[data-view-id="${taskId}"]`)
      .forEach((el) => TaskItem.updateHeaderInPlace(el, task));
  }

  /**
   * Updates only the title-related DOM for a task in place across every
   * rendered instance (TaskItem, backlog / engine sidebar rows, history feed),
   * skipping the heavy full-view refreshes that would discard unrelated edits.
   */
  private updateTitleOnly(task: Task): void {
    const { ctx } = this.deps;
    const host = this.deps.getHost();
    const taskId = task.id ?? '';
    if (!taskId || !host) return;

    if (ctx.state.selectedTask?.id === taskId) {
      ctx.state.selectedTask = task;
    }

    // Full TaskItem cards (e.g. the selected task view): switch the edit form
    // back to the rendered title and refresh the version, without a re-render.
    host
      .querySelectorAll<HTMLElement>(`[data-view-id="${taskId}"]`)
      .forEach((el) => TaskItem.updateTitleInPlace(el, task));

    // Compact sidebar/history rows (BacklogTaskView, ExecutionEngineItemView,
    // HistoryItemView): refresh the rendered title text and optimistic-concurrency
    // version in place so later saves use the current version.
    const version = task.version ?? 1;
    host
      .querySelectorAll<HTMLElement>(`[data-task-id="${taskId}"]`)
      .forEach((el) => {
        const titleEl = el.querySelector<HTMLElement>('span.font-bold.text-app-text, span.font-medium.text-app-text');
        if (titleEl) titleEl.textContent = task.title;
        el.querySelectorAll<HTMLElement>('[data-version]').forEach(v => {
          v.setAttribute('data-version', String(version));
        });
      });
  }

  /**
   * Switches the selected task's Specification section into edit mode and moves
   * the cursor into the textarea so the user can keep writing the spec in one flow.
   */
  private enterSpecEditMode(): void {
    const host = this.deps.getHost();
    if (!host) return;
    const viewEl = host.querySelector('#selected-task-view');
    if (!viewEl) return;
    const specContainer = viewEl.querySelector('.spec-container') as HTMLElement | null;
    if (!specContainer) return;
    specContainer.querySelector('.spec-view')?.classList.add('hidden');
    specContainer.querySelector('[data-action-click="toggle_spec_expand"]')?.classList.add('hidden');
    specContainer.querySelector('.spec-edit')?.classList.remove('hidden');
    const textarea = specContainer.querySelector('textarea') as HTMLTextAreaElement | null;
    if (textarea) textarea.focus();
  }
}
