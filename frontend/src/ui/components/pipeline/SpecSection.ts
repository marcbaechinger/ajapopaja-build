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

import { Task, TaskStatus } from '../../../core/domain.ts';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { Icon } from '../common/Icon.ts';
import { escapeHtml } from '../utils/html.ts';
import { renderMarkdown } from '../utils/markdown.ts';

/** Applies an accepted SpecAgent proposal back onto a task's spec. */
export type TaskSpecProposalUpdater = (
  taskId: string,
  spec: string
) => void | Promise<void>;

let updateSpecProposalHandler: TaskSpecProposalUpdater | null = null;

/**
 * Injects the write-back implementation used by the accepted SpecAgent
 * proposal. The component stays API-agnostic; the application context supplies
 * a callback that performs ``PATCH /tasks/{id}``.
 */
export function setTaskSpecProposalUpdater(
  updater: TaskSpecProposalUpdater | null
): void {
  updateSpecProposalHandler = updater;
}

/** Returns the currently injected write-back implementation (if any). */
export function getTaskSpecProposalUpdater(): TaskSpecProposalUpdater | null {
  return updateSpecProposalHandler;
}

/**
 * Describes a proposal as handed to the renderer. The SpecAgent proposal uses
 * ``spec_md``; the aliases keep the renderer usable from both the bot flow and
 * the historical one-shot flow.
 */
export interface SpecProposalRenderContext {
  spec_md?: string;
  spec?: string;
  result?: string;
  rationale?: string;
  acceptLabel?: string;
  rejectLabel?: string;
  /** Preferred callback names. */
  onAccept?: (spec: string) => void | Promise<void>;
  onReject?: () => void | Promise<void>;
  /** Backwards-compatible callback names. */
  accept?: (spec?: string) => void | Promise<void>;
  reject?: () => void | Promise<void>;
}

function proposalSpec(ctx: SpecProposalRenderContext): string {
  return ctx.spec_md ?? ctx.spec ?? ctx.result ?? '';
}

/**
 * Renders an elaborated-specification proposal with inline **Accept** /
 * **Reject** controls.
 */
export function renderSpecProposalResult(
  resultEl: HTMLElement,
  ctx: SpecProposalRenderContext
): void {
  const acceptLabel = ctx.acceptLabel ?? 'Accept';
  const rejectLabel = ctx.rejectLabel ?? 'Reject';
  const spec = proposalSpec(ctx);

  const body = spec
    ? renderMarkdown(spec)
    : '<span class="italic text-app-muted">No suggestion returned.</span>';

  resultEl.innerHTML = `
    <div class="spec-proposal-result mt-3 flex flex-col gap-2 rounded-lg border border-app-accent-1/40 bg-app-accent-1/5 p-3">
      <div class="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-app-accent-1">
        ${Icon.render('documentation', { size: 12 })}
        Suggested Specification
      </div>
      <div class="spec-proposal-content prose-theme prose-xs max-w-none text-app-text/80">
        ${body}
      </div>
      <div class="flex justify-end gap-2">
        <button type="button" data-spec-proposal-action="reject"
                class="px-3 py-1 rounded text-[10px] font-bold uppercase tracking-wider text-app-muted hover:text-app-text border border-app-border transition-colors cursor-pointer">
          ${escapeHtml(rejectLabel)}
        </button>
        <button type="button" data-spec-proposal-action="accept"
                class="px-4 py-1 rounded text-[10px] font-bold uppercase tracking-wider bg-app-accent-1 text-app-accent-fg hover:brightness-110 transition-all shadow-md cursor-pointer">
          ${escapeHtml(acceptLabel)}
        </button>
      </div>
    </div>
  `;

  resultEl
    .querySelector<HTMLButtonElement>('[data-spec-proposal-action="accept"]')
    ?.addEventListener('click', () => {
      void (ctx.onAccept ?? ctx.accept)?.(spec);
    });
  resultEl
    .querySelector<HTMLButtonElement>('[data-spec-proposal-action="reject"]')
    ?.addEventListener('click', () => {
      void (ctx.onReject ?? ctx.reject)?.();
    });
}

/**
 * Renders a failed SpecAgent proposal inline.
 */
export function renderSpecProposalError(
  resultEl: HTMLElement,
  error: string | { error?: string | null; status?: string }
): void {
  const message =
    typeof error === 'string'
      ? error
      : error.error || `The spec request failed (${error.status ?? 'error'}).`;

  resultEl.innerHTML = `
    <div class="spec-proposal-error mt-3 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-400" role="alert">
      ${Icon.render('documentation', { size: 12 })}
      <span>${escapeHtml(message)}</span>
    </div>
  `;
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
    : `
      <button data-action-click="trigger_specagent"
              data-task-id="${taskId}"
              data-pipeline-id="${task.pipeline_id}"
              class="px-3 py-1.5 rounded bg-app-bg border border-app-border text-[10px] font-bold uppercase tracking-wider text-app-accent-2 hover:bg-app-accent-2/10 transition-all cursor-pointer flex items-center gap-1.5 group"
              title="Elaborate the task specification with an AI spec bot">
        ${Icon.render('documentation', { size: 12 })}
        Elaborate
      </button>
    `;

  // Copy button shown next to the "Specification" label in read-only mode.
  const copySpecButton = task.spec
    ? `
      <button data-action-click="copy_spec"
              class="p-1 hover:bg-app-bg text-app-muted hover:text-app-accent-2 rounded transition-all cursor-pointer group/copy-spec"
              title="Copy Specification">
        ${Icon.render('copy', { size: 12, className: 'group-hover/copy-spec:scale-110 transition-transform' })}
      </button>
    `
    : '';

  // The collapse/expand control lives in the section header, to the left of
  // the "Elaborate" button, so the read-only view keeps a single action row.
  const specExpandButton = task.spec
    ? `
      <button data-action-click="toggle_spec_expand" class="text-[10px] text-app-accent-1 hover:underline cursor-pointer">
        ${isSpecExpanded ? 'Show Less' : 'Show More'}
      </button>
    `
    : '';

  return `
    <div class="spec-container w-full text-xs bg-app-surface p-3 rounded-lg border border-app-border transition-all"
         data-task-id="${taskId}" data-version="${task.version}" data-oneprompt-target>
      <div class="spec-view ${isCompleted ? '' : 'cursor-pointer group'}" ${isCompleted ? '' : 'data-action-click="edit_spec"'}>
        <div class="flex justify-between items-center mb-1">
          <div class="flex items-center gap-2 min-w-0">
            <span class="font-bold text-app-muted">Specification</span>
            ${copySpecButton}
          </div>
          <div class="flex items-center gap-2">
            ${specExpandButton}
            ${elaborateButton}
            ${task.want_design_doc ? '<span class="text-[9px] bg-purple-500/20 text-purple-400 border border-purple-500/30 px-1.5 py-0.5 rounded font-bold uppercase tracking-tighter">Wants Design Doc</span>' : ''}
          </div>
        </div>
        <div class="spec-display prose-theme prose-xs max-w-none text-app-text/70 overflow-hidden relative transition-all duration-300 ${isSpecExpanded ? 'expanded' : ''}">
          ${task.spec ? DOMPurify.sanitize(marked.parse(task.spec) as string) : '<span class="italic text-app-muted">No specification provided...</span>'}
          ${task.spec ? '<div class="expand-overlay absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-app-surface to-transparent pointer-events-none"></div>' : ''}
        </div>
      </div>

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
          <button data-action-click="save_spec" class="px-4 py-1 bg-app-accent-1 text-app-accent-fg rounded hover:brightness-110 transition-all shadow-md cursor-pointer">
            Save Specification
          </button>
        </div>
      </div>
    </div>
  `;
}

/** Aliases kept for callers/tests that prefer the historical names. */
export const renderElaborateSpecResult = renderSpecProposalResult;
export const renderElaborateSpecError = renderSpecProposalError;
export const setTaskElaborateSpecUpdater = setTaskSpecProposalUpdater;
export const getTaskElaborateSpecUpdater = getTaskSpecProposalUpdater;
