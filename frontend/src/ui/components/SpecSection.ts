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

import { Task, TaskStatus } from '../../core/domain.ts';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { Icon } from './Icon.ts';
import { escapeHtml } from './utils/html.ts';
import { renderMarkdown } from './utils/markdown.ts';
import { renderQuickPromptButton } from './QuickPromptButton.ts';
import {
  registerOnePromptAction,
  type OnePromptAction,
  type OnePromptRenderContext,
} from '../../core/oneprompt.ts';

/** Prompt id of the bundled "Elaborate" one-shot action. */
export const TASK_ELABORATE_SPEC_PROMPT_ID = 'task_elaborate_spec';

/** Applies an accepted "Elaborate" suggestion back onto a task's spec. */
export type TaskElaborateSpecUpdater = (
  taskId: string,
  spec: string,
  ctx: OnePromptRenderContext
) => void | Promise<void>;

let updateSpecHandler: TaskElaborateSpecUpdater | null = null;

/**
 * Injects the write-back implementation used by the `task_elaborate_spec`
 * action's ``accept`` hook. The component stays API-agnostic; the application
 * context supplies a callback that performs ``PATCH /tasks/{id}``.
 */
export function setTaskElaborateSpecUpdater(
  updater: TaskElaborateSpecUpdater | null
): void {
  updateSpecHandler = updater;
}

/** Returns the currently injected write-back implementation (if any). */
export function getTaskElaborateSpecUpdater(): TaskElaborateSpecUpdater | null {
  return updateSpecHandler;
}

/**
 * Renders the suggested specification returned for `task_elaborate_spec` with
 * inline **Accept** / **Reject** controls.
 */
export function renderElaborateSpecResult(
  resultEl: HTMLElement,
  ctx: OnePromptRenderContext
): void {
  const acceptLabel =
    typeof ctx.meta?.accept_label === 'string' ? ctx.meta.accept_label : 'Accept';
  const rejectLabel =
    typeof ctx.meta?.reject_label === 'string' ? ctx.meta.reject_label : 'Reject';

  const body = ctx.result
    ? renderMarkdown(ctx.result)
    : '<span class="italic text-app-muted">No suggestion returned.</span>';

  resultEl.innerHTML = `
    <div class="elaborate-spec-result mt-3 flex flex-col gap-2 rounded-lg border border-app-accent-1/40 bg-app-accent-1/5 p-3">
      <div class="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-app-accent-1">
        ${Icon.render('documentation', { size: 12 })}
        Suggested Specification
      </div>
      <div class="elaborate-spec-content prose-theme prose-xs max-w-none text-app-text/80">
        ${body}
      </div>
      <div class="flex justify-end gap-2">
        <button type="button" data-oneprompt-action="reject"
                class="px-3 py-1 rounded text-[10px] font-bold uppercase tracking-wider text-app-muted hover:text-app-text border border-app-border transition-colors cursor-pointer">
          ${escapeHtml(rejectLabel)}
        </button>
        <button type="button" data-oneprompt-action="accept"
                class="px-4 py-1 rounded text-[10px] font-bold uppercase tracking-wider bg-app-accent-1 text-white hover:brightness-110 transition-all shadow-md cursor-pointer">
          ${escapeHtml(acceptLabel)}
        </button>
      </div>
    </div>
  `;

  resultEl
    .querySelector<HTMLButtonElement>('[data-oneprompt-action="accept"]')
    ?.addEventListener('click', () => {
      void ctx.accept();
    });
  resultEl
    .querySelector<HTMLButtonElement>('[data-oneprompt-action="reject"]')
    ?.addEventListener('click', () => {
      void ctx.reject();
    });
}

/**
 * Renders a failed `task_elaborate_spec` request inline.
 *
 * Design section 9 requires the UI to surface the backend's friendly error
 * message (``unavailable``, ``not_found``, ``timeout``, ``cancelled``, ...)
 * instead of silently dropping the request.
 */
export function renderElaborateSpecError(
  resultEl: HTMLElement,
  ctx: OnePromptRenderContext
): void {
  const message = ctx.error || `The AI request failed (${ctx.status}).`;

  resultEl.innerHTML = `
    <div class="elaborate-spec-error mt-3 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400" role="alert" data-oneprompt-error="${escapeHtml(String(ctx.status))}">
      ${Icon.render('documentation', { size: 12 })}
      <span>${escapeHtml(message)}</span>
    </div>
  `;
}

/**
 * Builds the declarative `task_elaborate_spec` one-shot action.
 *
 * @param updater Optional write-back implementation. When omitted the module
 *   level handler set via {@link setTaskElaborateSpecUpdater} is used.
 */
export function createTaskElaborateSpecAction(
  updater?: TaskElaborateSpecUpdater | null
): OnePromptAction {
  return {
    id: TASK_ELABORATE_SPEC_PROMPT_ID,
    label: 'Elaborate',
    title: 'Expand the task specification with AI',
    iconSvg: Icon.render('documentation', { size: 12 }),
    buildContext: (taskId: string, pipelineId: string) => ({ taskId, pipelineId }),
    anchor: { entity: 'task', field: 'spec' },
    render: renderElaborateSpecResult,
    onError: (ctx) => {
      renderElaborateSpecError(ctx.container, ctx);
    },
    accept: async (ctx, result) => {
      const taskId = String(ctx.taskId ?? ctx.context?.taskId ?? '');
      if (!taskId) return;
      const handler = updater ?? updateSpecHandler;
      if (!handler) {
        console.warn(
          `[oneprompt] No task spec updater registered for "${TASK_ELABORATE_SPEC_PROMPT_ID}".`
        );
        return;
      }
      await handler(taskId, result, ctx);
    },
    reject: () => {},
  };
}

/** Registers the `task_elaborate_spec` action in the global registry. */
export function registerTaskElaborateSpecAction(
  updater?: TaskElaborateSpecUpdater | null
): OnePromptAction {
  const action = createTaskElaborateSpecAction(updater);
  return registerOnePromptAction(action);
}

/**
 * Renders the specification section of a task card.
 * @param task The task object containing the specification.
 * @param isSpecExpanded Whether the specification section is expanded.
 * @returns An HTML string representing the specification section.
 */
export function renderSpecSection(task: Task, isSpecExpanded: boolean): string {
  const taskId = task.id;
  const isCompleted = ([TaskStatus.IMPLEMENTED, TaskStatus.DISCARDED] as any[]).includes(task.status);

  const elaborateButton = isCompleted
    ? ''
    : renderQuickPromptButton({
        id: TASK_ELABORATE_SPEC_PROMPT_ID,
        label: 'Elaborate',
        title: 'Expand the task specification with AI',
        iconSvg: Icon.render('documentation', { size: 12 }),
        mode: 'oneshot',
        taskId,
        pipelineId: task.pipeline_id,
      });

  return `
    <div class="spec-container w-full text-xs bg-app-surface p-3 rounded-lg border border-app-border transition-all"
         data-task-id="${taskId}" data-version="${task.version}" data-oneprompt-target>
      <div class="spec-view ${isCompleted ? '' : 'cursor-pointer group'}" ${isCompleted ? '' : 'data-action-click="edit_spec"'}>
        <div class="flex justify-between items-center mb-1">
          <span class="font-bold text-app-muted">Specification</span>
          <div class="flex items-center gap-2">
            ${elaborateButton}
            ${task.want_design_doc ? '<span class="text-[9px] bg-purple-500/20 text-purple-400 border border-purple-500/30 px-1.5 py-0.5 rounded font-bold uppercase tracking-tighter">Wants Design Doc</span>' : ''}
            ${isCompleted ? '' : '<span class="text-[10px] text-app-muted opacity-0 group-hover:opacity-100 transition-opacity">Click to edit</span>'}
          </div>
        </div>
        <div class="spec-display prose-theme prose-xs max-w-none text-app-text/70 overflow-hidden relative transition-all duration-300 ${isSpecExpanded ? 'expanded' : ''}">
          ${task.spec ? DOMPurify.sanitize(marked.parse(task.spec) as string) : '<span class="italic text-app-muted">No specification provided...</span>'}
          ${task.spec ? '<div class="expand-overlay absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-app-surface to-transparent pointer-events-none"></div>' : ''}
        </div>
      </div>
      ${task.spec ? `
        <button data-action-click="toggle_spec_expand" class="mt-2 text-[10px] text-app-accent-1 hover:underline cursor-pointer">
          ${isSpecExpanded ? 'Show Less' : 'Show More'}
        </button>
      ` : ''}
      
      <div class="spec-edit hidden flex flex-col gap-3">
        <span class="font-bold text-app-muted mb-1">Editing Specification</span>
        <div class="flex items-center gap-2 mb-2">
          <input type="checkbox" id="edit-want-design-doc-${taskId}" class="w-4 h-4 rounded border-app-border bg-app-bg text-app-accent-1 focus:ring-app-accent-1" ${task.want_design_doc ? 'checked' : ''}>
          <label for="edit-want-design-doc-${taskId}" class="text-xs text-app-text cursor-pointer">Require Design Doc Approval</label>
        </div>
        <textarea class="w-full bg-app-bg border border-app-border rounded p-2 text-[15px] leading-relaxed text-app-text outline-none focus:ring-1 focus:ring-app-accent-1 min-h-[300px]" 
                  rows="4"
                  placeholder="Provide a detailed specification for the agent...">${task.spec || ''}</textarea>
        <div class="flex gap-2 justify-end">
          <button data-action-click="cancel_spec_edit" class="px-3 py-1 text-app-muted hover:text-app-text transition-colors cursor-pointer">
            Cancel
          </button>
          <button data-action-click="save_spec" class="px-4 py-1 bg-app-accent-1 text-white rounded hover:brightness-110 transition-all shadow-md cursor-pointer">
            Save Specification
          </button>
        </div>
      </div>
    </div>
  `;
}

/** Aliases kept for callers/tests that prefer a verbose name. */
export const renderTaskElaborateSpecResult = renderElaborateSpecResult;
export const renderElaborateSpecSuggestion = renderElaborateSpecResult;
export const renderElaborateSpecFailure = renderElaborateSpecError;
export const TASK_ELABORATE_SPEC_ACTION_ID = TASK_ELABORATE_SPEC_PROMPT_ID;

/**
 * The bundled action object. Registering it on import makes
 * `onePromptActions.get('task_elaborate_spec')` available as soon as the
 * component is loaded; the application context may re-register it with a
 * concrete write-back handler via {@link registerTaskElaborateSpecAction}.
 */
export const TASK_ELABORATE_SPEC_ACTION: OnePromptAction =
  createTaskElaborateSpecAction();

registerOnePromptAction(TASK_ELABORATE_SPEC_ACTION);
