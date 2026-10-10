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

import { Task, TaskStatus, isProcessedStatus } from '../../../core/domain.ts';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { calculateDuration, calculateDesignDuration } from '../utils/duration.ts';
import { renderStatusHistorySection } from './StatusHistorySection.ts';
import { renderSpecSection } from './SpecSection.ts';
import { renderDesignDocSection } from './DesignDocSection.ts';
import { Icon } from '../common/Icon.ts';
import { escapeHtml } from '../utils/html.ts';

export class TaskItem {
  /**
   * Updates only the title-related DOM of an already-rendered TaskItem in
   * place, without re-rendering the rest of the card. This keeps any unrelated
   * in-progress edits in the card (e.g. an unsaved Specification or Design Doc
   * text) intact when the title is saved, instead of wiping them with a full
   * re-render.
   *
   * Specifically it:
   * - sets the newly saved title as the displayed text,
   * - switches back from the edit input to the rendered title,
   * - refreshes the optimistic-concurrency ``data-version`` **on every**
   *   version-bearing element in the card (title container, Specification
   *   container, Design Doc container, status selector, order/move buttons,
   *   …) so a subsequent save action (e.g. "Save Specification") submits the
   *   current version instead of a stale one.
   *
   * It is a no-op when ``element`` is not (or no longer) a TaskItem root that
   * contains a ``.title-container``.
   */
  static updateTitleInPlace(element: Element, task: Task): void {
    const container = element.querySelector('.title-container');
    if (!container) return;

    const version = task.version ?? 1;
    element.querySelectorAll<HTMLElement>('[data-version]').forEach(el => {
      el.setAttribute('data-version', String(version));
    });

    const view = container.querySelector('.title-view');
    const titleEl = view?.querySelector('span.font-medium');
    if (titleEl) {
      titleEl.textContent = task.title;
    }

    // Keep the (hidden) edit input in sync with the saved title. The card is
    // intentionally not re-rendered, so without this the input would keep the
    // stale pre-save value. Re-entering title edit mode would then show (and
    // re-save) the old title, which in turn falls through to a full re-render
    // and discards unrelated unsaved edits such as an open Specification or
    // Design Doc textarea. Updating the input here keeps the whole header
    // self-consistent while leaving the rest of the card untouched.
    const input = container.querySelector<HTMLInputElement>('.title-edit input');
    if (input) {
      input.value = task.title;
    }

    // Switch the edit form back to the rendered title.
    container.querySelector('.title-edit')?.classList.add('hidden');
    view?.classList.remove('hidden');
  }

  /**
   * Updates only the header (status badge, title view/edit form, metadata row
   * and the action toolbar) of an already-rendered TaskItem in place, leaving
   * the body — most importantly an open Specification / Design-Doc editor —
   * wholly untouched.
   *
   * This is used for server-driven state changes (e.g. a task moving from
   * INPROGRESS to PULL_REQUEST_AVAILABLE, or PULL_REQUEST_AVAILABLE to
   * SUBMITTED) where the previously rendered card would otherwise be thrown away
   * by a full re-render, wiping unrelated unsaved edits.
   *
   * The collapse state and the presence of the status selector are read back
   * from the current DOM so the replacement header stays consistent with the
   * card it belongs to. The optimistic-concurrency ``data-version`` is refreshed
   * on every version-bearing element in the card so follow-up actions submit the
   * current version.
   *
   * It is a no-op when ``element`` is not (or no longer) a TaskItem root that
   * contains a ``.task-header``.
   */
  static updateHeaderInPlace(element: Element, task: Task): void {
    const header = element.querySelector('.task-header');
    if (!header) return;

    const isCollapsed =
      element.querySelector('.task-body')?.classList.contains('hidden') ?? false;
    const showStatusSelector = !!header.querySelector(
      'select[data-action-change="change_task_status"]'
    );

    const wrapper = document.createElement('div');
    wrapper.innerHTML = TaskItem.renderHeader(task, isCollapsed, showStatusSelector);
    const newHeader = wrapper.firstElementChild;
    if (!newHeader) return;
    header.replaceWith(newHeader);

    // Keep optimistic-concurrency in sync across the whole card: the header
    // buttons and the body's move / accept-reject controls all carry a version.
    const version = task.version ?? 1;
    element.querySelectorAll<HTMLElement>('[data-version]').forEach(el => {
      el.setAttribute('data-version', String(version));
    });
  }

  /**
   * Tailwind classes applied to the "Schedule Execution" button while it is
   * focused programmatically (e.g. right after saving a Specification).
   *
   * Browsers only paint the ``:focus-visible`` ring for keyboard-driven focus,
   * so a bare programmatic ``.focus()`` can leave the user unable to tell where
   * focus went. This explicit, short-lived highlight makes the move visible;
   * it is removed again on ``blur`` so keyboard users keep the normal ring.
   */
  static readonly PROGRAMMATIC_FOCUS_CLASSES = [
    'ring-2',
    'ring-app-accent-1',
    'ring-offset-2',
    'ring-offset-app-bg',
  ] as const;

  /**
   * Moves focus onto the "Schedule Execution" button of a rendered TaskItem.
   *
   * It is used right after saving a task's Specification so the user can save
   * the spec and schedule the task for execution in one flow, without having
   * to hunt for the button again.
   *
   * The button also receives a visible focus highlight (see
   * ``PROGRAMMATIC_FOCUS_CLASSES``) that is cleared on ``blur``, so the
   * programmatic focus move is apparent in addition to the regular keyboard
   * focus ring.
   *
   * @returns ``true`` only when a focusable schedule button was found and
   *   focused; otherwise ``false``. It is a no-op for cards that have no such
   *   button (e.g. SCHEDULED / PROPOSED / completed tasks) or for non-TaskItem
   *   elements.
   *
   * A matched button that cannot actually receive focus is also ignored:
   * - disabled buttons (``disabled`` attribute / property), and
   * - buttons that are not rendered / hidden (no client rects or
   *   ``aria-hidden="true"``).
   */
  static focusScheduleExecution(element: Element | null | undefined): boolean {
    const button = element?.querySelector<HTMLButtonElement>(
      '[data-action-click="schedule_task"]'
    );
    if (!button) return false;
    if (button.hasAttribute('disabled') || button.disabled) return false;
    if (button.getAttribute('aria-hidden') === 'true') return false;
    if (button.getClientRects().length === 0) return false;
    button.focus();
    this.highlightProgrammaticFocus(button);
    return true;
  }

  /**
   * Applies the programmatic-focus highlight to a button and clears it again
   * the next time the button loses focus. Kept separate from
   * ``focusScheduleExecution`` so tests can assert the highlight lifecycle in
   * isolation.
   */
  private static highlightProgrammaticFocus(button: HTMLButtonElement): void {
    button.classList.add(...TaskItem.PROGRAMMATIC_FOCUS_CLASSES);
    button.addEventListener(
      'blur',
      () => {
        button.classList.remove(...TaskItem.PROGRAMMATIC_FOCUS_CLASSES);
      },
      { once: true }
    );
  }

  private static readonly STATUS_COLORS: Record<string, string> = {
    [TaskStatus.CREATED]: 'bg-slate-600 text-slate-300',
    [TaskStatus.SCHEDULED]: 'bg-blue-600 text-white animate-pulse',
    [TaskStatus.PROPOSED]: 'bg-purple-600 text-white',
    [TaskStatus.INPROGRESS]: 'bg-amber-600 text-white',
    [TaskStatus.IMPLEMENTED]: 'bg-green-600 text-white',
    [TaskStatus.SUBMITTED]: 'bg-teal-600 text-white',
    [TaskStatus.PULL_REQUEST_AVAILABLE]: 'bg-cyan-600 text-white',
    [TaskStatus.FAILED]: 'bg-red-600 text-white',
    [TaskStatus.DISCARDED]: 'bg-slate-800 text-slate-500',
  };

  /**
   * Renders just the ``.task-header`` of a TaskItem. Shared by ``render`` (which
   * embeds it in the full card) and ``updateHeaderInPlace`` (which swaps it into
   * an existing card), so the two can never drift apart.
   */
  private static renderHeader(
    task: Task,
    isCollapsed: boolean,
    showStatusSelector: boolean
  ): string {
    const taskId = task.id;
    const statusColors = TaskItem.STATUS_COLORS;

    const isProposed = task.status === TaskStatus.PROPOSED;
    const canSchedule = task.status === TaskStatus.CREATED;
    const canUnschedule = task.status === TaskStatus.SCHEDULED;
    const canFail = ([TaskStatus.INPROGRESS, TaskStatus.IMPLEMENTED] as any[]).includes(task.status);
    const isSystem = task.type === 'system';
    const isInProgress = task.status === TaskStatus.INPROGRESS;

    const isImplemented = task.status === TaskStatus.IMPLEMENTED;
    // Bot actions apply to settled "finished" states (IMPLEMENTED) and SUBMITTED.
    // NOTE: IMPLEMENTED intentionally overlaps with isImplemented — that boolean
    // covers other UI (quickfix, Order display) which remain scoped to IMPLEMENTED only.
    const canTriggerBots = ([TaskStatus.IMPLEMENTED, TaskStatus.SUBMITTED] as any[]).includes(task.status);

    // "Send to CoderBot" is the primary execution trigger. It is available for
    // tasks that can still be executed manually: freshly created (not yet
    // scheduled) and scheduled (already queued) tasks.
    const canTriggerExecution = canSchedule || canUnschedule;

    const isEditableTitle = ([TaskStatus.CREATED, TaskStatus.PROPOSED] as any[]).includes(task.status);

    const titleEditAttributes: Record<string, string> = isEditableTitle ? { "data-action-click": "edit_title" } : {};

    // Shared styling for the primary actions in the header toolbar so the
    // buttons (Delete / Schedule Execution / Cancel Schedule / Mark as Failed
    // / Cancel Progress / Send to CoderBot) share the same height and are
    // perfectly aligned.
    const headerButtonBase =
      'inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg transition-all cursor-pointer';

    return `        <div class="task-header flex justify-between items-start gap-3 cursor-pointer group/header" data-action-click="toggle_task_collapse">
          <div class="flex items-start gap-3 min-w-0 flex-1">
            <div class="p-1 mt-1 text-app-muted group-hover/header:text-app-text transition-all flex-shrink-0">
              ${Icon.render('chevronRight', { size: 16, className: `transform transition-transform ${isCollapsed ? '' : 'rotate-90'}` })}
            </div>
            <div class="title-container flex flex-col min-w-0 flex-1" data-task-id="${taskId}" data-version="${task.version}">
              <div class="title-view flex items-center gap-2 min-w-0 ${isEditableTitle ? 'cursor-pointer group/title' : ''}" ${isEditableTitle ? 'data-action-click="edit_title"' : ''}>
                <span class="status-badge flex-shrink-0 text-xs px-2 py-1 rounded font-bold uppercase tracking-wide whitespace-nowrap ${statusColors[task.status] || 'bg-slate-600'}" data-action-click="none">
                  ${task.status}
                </span>
                <span class="font-medium text-app-text text-lg truncate">${task.title}</span>
                ${isEditableTitle ? Icon.render('edit', { size: 12, dataAttrs: titleEditAttributes, className: 'flex-shrink-0 text-app-muted opacity-0 group-hover/title:opacity-100 transition-opacity' }) : ''}
              </div>
              ${isEditableTitle ? `
                <div class="title-edit hidden flex flex-col gap-2 mt-1" data-action-click="none">
                  <input type="text" class="w-full bg-app-bg border border-app-border rounded px-2 py-1 text-lg text-app-text outline-none focus:ring-1 focus:ring-app-accent-1" 
                         value="${escapeHtml(task.title)}" placeholder="Task title" data-action-keydown="save_title">
                  <div class="flex gap-2 justify-end">
                    <button data-action-click="cancel_title_edit" class="text-[10px] text-app-muted hover:text-app-text px-2 py-1 cursor-pointer">Cancel</button>
                    <button data-action-click="save_title" class="text-[10px] bg-app-accent-1 text-white px-3 py-1 rounded hover:brightness-110 cursor-pointer">Save</button>
                  </div>
                </div>
              ` : ''}
              <div class="flex items-center gap-2 mt-1 flex-wrap" data-task-id="${taskId}">
                <span class="text-[10px] text-app-muted uppercase font-bold tracking-widest bg-app-surface px-2 py-0.5 rounded border border-app-border">${taskId}</span>
                <button data-action-click="copy_task_id" class="p-1 hover:bg-app-surface text-app-muted hover:text-app-accent-2 rounded transition-all cursor-pointer group/copy" title="Copy Task ID">
                   ${Icon.render('copy', { size: 12, className: 'group-hover/copy:scale-110 transition-transform' })}
                </button>
                <button data-action-click="edit_suggested_model" data-task-id="${taskId}" data-version="${task.version}"
                        class="flex items-center gap-1 text-[10px] text-app-muted uppercase font-bold tracking-widest bg-app-surface px-2 py-0.5 rounded border border-app-border hover:text-app-accent-2 hover:border-app-accent-2/50 transition-all cursor-pointer group/model"
                        title="Change the model used for this task">
                  <span class="truncate max-w-[180px]">Model: ${escapeHtml(task.suggested_model || 'unset')}</span>
                  ${Icon.render('edit', { size: 10, className: 'flex-shrink-0 group-hover/model:scale-110 transition-transform' })}
                </button>
                ${canTriggerBots ? `
                  <button data-action-click="trigger_docbot" data-task-id="${taskId}" class="p-1 hover:bg-app-surface text-app-muted hover:text-green-600 rounded transition-all cursor-pointer group/docbot" title="Trigger DocBot (needs Ollama)">
                     ${Icon.render('documentation', { size: 12, className: 'group-hover/docbot:scale-110 transition-transform' })}
                  </button>
                ` : ''}
                ${isImplemented && task.commit_hash ? `
                  <button data-action-click="open_quickfix" data-task-id="${taskId}" class="p-1 hover:bg-app-surface text-app-muted hover:text-app-accent-2 rounded transition-all cursor-pointer group/quickfix" title="Open Quickfix in Neovim">
                     ${Icon.render('quickfix', { size: 14, className: 'group-hover/quickfix:scale-110 transition-transform' })}
                  </button>
                ` : ''}
                ${task.status === TaskStatus.PULL_REQUEST_AVAILABLE ? `
                  <button data-action-click="open_pr_dialog" data-task-id="${taskId}" class="p-1 hover:bg-app-surface text-cyan-400 hover:text-cyan-300 rounded transition-all cursor-pointer group/pr" title="View Pull Request">
                     ${Icon.render('git-pull-request', { size: 14, className: 'group-hover/pr:scale-110 transition-transform' })}
                  </button>
                ` : ''}
                ${canTriggerBots ? (
        task.review_md
          ? `
                      <button data-action-click="open_review_dialog" data-task-id="${taskId}" class="p-1 hover:bg-app-surface text-app-accent-2 hover:text-app-accent-2/80 rounded transition-all cursor-pointer group/review relative" title="View Technical Review">
                        ${Icon.render('documentation', { size: 12, className: 'group-hover/review:scale-110 transition-transform' })}
                        <span class="absolute -top-1 -right-1 flex h-1.5 w-1.5">
                          <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-app-accent-2 opacity-75"></span>
                          <span class="relative inline-flex rounded-full h-1.5 w-1.5 bg-app-accent-2"></span>
                        </span>
                      </button>
                    `
          : `
                      <button data-action-click="trigger_reviewbot" data-task-id="${taskId}" class="p-1 hover:bg-app-surface text-app-muted hover:text-app-accent-2 rounded transition-all cursor-pointer group/review" title="Trigger Technical Review">
                        ${Icon.render('check', { size: 12, className: 'group-hover/review:scale-110 transition-transform' })}
                      </button>
                    `
      ) : ''}
                ${isImplemented ? '' : `
                  <span class="text-[10px] text-app-muted font-bold uppercase tracking-wider ml-1">Order: ${task.order} ${isSystem ? '• System Task' : ''}</span>
                `}
              </div>
            </div>
          </div>
          <div class="task-header-actions flex items-center justify-end gap-2 flex-shrink-0" data-action-click="none">
            ${!isProposed ? `
              <button data-action-click="delete_task"
                      class="${headerButtonBase} text-app-muted hover:text-red-400 bg-app-surface hover:bg-red-500/20 border border-app-border"
                      title="Delete Task">
                ${Icon.render('trash', { size: 14 })}
              </button>
              ${canSchedule ? `
                <button data-action-click="schedule_task" data-version="${task.version}"
                        class="${headerButtonBase} bg-app-accent-1 hover:brightness-110 text-white shadow-lg">
                  <span>Schedule Execution</span>
                </button>
              ` : ''}
              ${canUnschedule ? `
                <button data-action-click="unschedule_task" data-version="${task.version}"
                        class="${headerButtonBase} bg-slate-700 hover:bg-slate-600 text-slate-200 shadow-lg">
                  <span>Cancel Schedule</span>
                </button>
              ` : ''}
              ${canFail ? `
                <button data-action-click="fail_task" data-version="${task.version}"
                        class="${headerButtonBase} text-red-400 hover:text-red-300 bg-app-surface hover:bg-red-500/20 border border-app-border">
                  <span>Mark as Failed</span>
                </button>
              ` : ''}
              ${isInProgress ? `
                <button data-action-click="cancel_progress" data-version="${task.version}"
                        class="${headerButtonBase} bg-slate-700 hover:bg-slate-600 text-slate-200 shadow-lg">
                  <span>Cancel Progress</span>
                </button>
              ` : ''}
            ` : ''}
            ${canTriggerExecution ? `
              <button data-action-click="trigger_coderbot" data-task-id="${taskId}"
                      class="${headerButtonBase} bg-green-600 hover:bg-green-500 text-white shadow-lg shadow-green-900/20 group/coderbot"
                      title="Send to CoderBot">
                ${Icon.render('lightning', { size: 14, className: 'group-hover/coderbot:scale-110 transition-transform' })}
                <span>Send to CoderBot</span>
              </button>
            ` : ''}
            ${showStatusSelector ? `
              <select data-action-change="change_task_status" data-task-id="${taskId}" data-version="${task.version}"
                      class="bg-app-surface border border-app-border text-[10px] font-bold uppercase tracking-widest text-app-text px-2 py-1.5 rounded-lg outline-none focus:ring-1 focus:ring-app-accent-1 cursor-pointer">
                ${Object.values(TaskStatus).map(s => `
                  <option value="${s}" ${task.status === s ? 'selected' : ''}>${s}</option>
                `).join('')}
              </select>
            ` : ''}
          </div>
        </div>`;
  }

  static render(
    task: Task,
    showOrdering: boolean = true,
    expandHistory: boolean = false,
    isCollapsed: boolean = false,
    showStatusSelector: boolean = false,
    isSpecExpanded: boolean = true
  ): string {
    const taskId = task.id;
    const isProposed = task.status === TaskStatus.PROPOSED;
    const isSystem = task.type === 'system';
    const isInProgress = task.status === TaskStatus.INPROGRESS;

    const specHtml = renderSpecSection(task, isSpecExpanded);
    const designDocHtml = renderDesignDocSection(task, isProposed);

    return `
      <div class="bg-app-bg p-4 rounded-lg border border-app-border flex flex-col gap-3 transition-all hover:border-app-accent-1/30 ${isSystem ? 'border-l-4 border-l-red-500' : ''} ${isProposed ? 'border-purple-500/50 shadow-lg shadow-purple-500/10' : ''}" 
           data-view-type="task" data-view-id="${taskId}">
${TaskItem.renderHeader(task, isCollapsed, showStatusSelector)}
        
        <div class="task-body flex flex-col gap-3 ${isCollapsed ? 'hidden' : ''}">
          <div class="flex justify-between items-center mt-2">
            <div class="flex gap-3 items-center">
              ${showOrdering ? `
              <div class="flex gap-1">
                <button data-action-click="move_task_up" data-version="${task.version}" data-order="${task.order}"
                        ${isInProgress || isProposed ? 'disabled' : ''}
                        class="p-1 hover:bg-app-surface rounded text-app-muted hover:text-app-accent-1 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed" title="Move Up">
                  &uarr;
                </button>
                <button data-action-click="move_task_down" data-version="${task.version}" data-order="${task.order}"
                        ${isInProgress || isProposed ? 'disabled' : ''}
                        class="p-1 hover:bg-app-surface rounded text-app-muted hover:text-app-accent-1 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed" title="Move Down">
                  &darr;
                </button>
              </div>
              ` : ''}
              
              ${task.commit_hash ? `
                <div class="flex items-center gap-2">
                  <button data-action-click="open_diff_view" data-commit-hash="${task.commit_hash}"
                          class="text-[10px] font-mono text-app-accent-2 bg-app-surface px-2 py-0.5 rounded border border-app-border hover:bg-app-accent-2/10 hover:border-app-accent-2/50 transition-all cursor-pointer" 
                          title="View Commit Diff">
                    ${task.commit_hash.substring(0, 7)}
                  </button>
                  <button data-action-click="copy_commit_hash" data-commit-hash="${task.commit_hash}"
                          class="p-1 hover:bg-app-surface text-app-muted hover:text-app-accent-2 rounded transition-all cursor-pointer group/copy-commit"
                          title="Copy Commit Hash">
                    ${Icon.render('copy', { size: 12, className: 'group-hover/copy-commit:scale-110 transition-transform' })}
                  </button>
                  ${isProcessedStatus(task.status) && calculateDuration(task) ? `
                    <div class="text-[10px] text-app-muted flex items-center gap-1" title="Implementation Duration">
                      ${Icon.render('clock', { size: 12 })}
                      Impl: ${calculateDuration(task)}
                    </div>
                  ` : ''}
                  ${calculateDesignDuration(task) ? `
                    <div class="text-[10px] text-app-muted flex items-center gap-1" title="Design Duration">
                      ${Icon.render('edit', { size: 12 })}
                      Design: ${calculateDesignDuration(task)}
                    </div>
                  ` : ''}
                </div>
              ` : ''}
            </div>

            ${isProposed ? `
              <div class="flex gap-2">
                <button data-action-click="reject_design" data-version="${task.version}" 
                        class="text-xs bg-slate-700 hover:bg-red-900/40 text-slate-300 hover:text-red-400 border border-app-border px-4 py-1.5 rounded-lg transition-all cursor-pointer font-bold">
                  Reject Design
                </button>
                <button data-action-click="accept_design" data-version="${task.version}" 
                        class="text-xs bg-green-600 hover:bg-green-500 text-white px-5 py-1.5 rounded-lg transition-all shadow-lg shadow-green-900/20 cursor-pointer font-black uppercase tracking-tight">
                  Accept Design
                </button>
              </div>
            ` : ''}
          </div>
          ${task.description ? `<p class="text-sm text-app-text/70">${task.description}</p>` : ''}
          
          ${task.completion_info ? `
            <div class="bg-green-500/10 border border-green-500/20 p-3 rounded-lg text-sm text-app-text/80">
              <div class="font-bold text-green-400 mb-1 flex items-center gap-2">
                 ${Icon.render('check', { size: 16 })}
                 Implementation Summary
              </div>
              <div class="prose-theme prose-sm max-w-none text-app-text/80 marker:text-green-500">
                ${DOMPurify.sanitize(marked.parse(task.completion_info) as string)}
              </div>
            </div>
          ` : ''}

          ${renderStatusHistorySection(task, expandHistory)}

          ${specHtml}

          ${designDocHtml}
        </div>

      </div>
    `;
  }
}
