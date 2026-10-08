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
 * Quick-prompt buttons (design `dd_one_shot_ai.md` sections 6 and 8).
 *
 * A button can operate in one of two modes:
 *
 * * ``copy`` (the historical default) — a pre-built prompt is copied to the
 *   clipboard by the surrounding view (e.g. ``ReviewDialog``). The rendered
 *   button carries a ``data-action-copy="<promptId>"`` attribute.
 * * ``oneshot`` / ``quick_prompt`` — clicking the button dispatches a
 *   ``quick_prompt`` WebSocket message through the one-shot framework instead
 *   of touching the clipboard. The rendered button carries
 *   ``data-action-click="quick_prompt"`` plus the prompt/context ids so the
 *   generic :func:`handleQuickPromptButtonClick` dispatcher can build the
 *   request.
 */

import {
  sendQuickPrompt,
  type OnePromptAction,
  type OnePromptRequest,
  type PromptContext,
  type QuickPromptSender,
} from '../../../core/oneprompt.ts';
import { escapeHtml } from '../utils/html.ts';

/** Rendering modes supported by :func:`renderQuickPromptButton`. */
export type QuickPromptButtonMode = 'copy' | 'oneshot' | 'quick_prompt';

export interface PromptConfig {
  id: string;
  label: string;
  title: string;
  iconSvg: string;
  /**
   * ``copy`` (default) keeps the current clipboard behaviour. ``oneshot`` (or
   * its alias ``quick_prompt``) dispatches a one-shot ``quick_prompt``.
   */
  mode?: QuickPromptButtonMode;
  /** Copy mode: builds the prompt text that is copied to the clipboard. */
  getPrompt?: (taskId: string, pipelineId: string) => string;
  /** One-shot mode: the owning task id (emitted as ``data-task-id``). */
  taskId?: string;
  /** One-shot mode: the owning pipeline id (emitted as ``data-pipeline-id``). */
  pipelineId?: string;
  /** Extra attributes to add to the rendered button (e.g. per-instance hooks). */
  dataAttrs?: Record<string, string | undefined>;
}

const BUTTON_CLASSES =
  'px-3 py-1.5 rounded bg-app-bg border border-app-border text-[10px] font-bold uppercase tracking-wider text-app-accent-2 hover:bg-app-accent-2/10 transition-all cursor-pointer flex items-center gap-1.5 group';

/**
 * Returns ``true`` when the config should dispatch a one-shot request rather
 * than copy the prompt to the clipboard.
 */
export function isOneShotPromptButton(config: PromptConfig): boolean {
  return config.mode === 'oneshot' || config.mode === 'quick_prompt';
}

function renderAttributes(attrs: Record<string, string | undefined>): string {
  return Object.entries(attrs)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}="${escapeHtml(String(value))}"`)
    .join(' ');
}

export function renderQuickPromptButton(config: PromptConfig): string {
  const oneShot = isOneShotPromptButton(config);

  const attributes: Record<string, string | undefined> = {
    'data-prompt-id': config.id,
    'data-task-id': config.taskId,
    'data-pipeline-id': config.pipelineId,
    ...config.dataAttrs,
  };

  if (oneShot) {
    attributes['data-action-click'] = 'quick_prompt';
    attributes['data-prompt-mode'] = 'oneshot';
  } else {
    attributes['data-action-copy'] = config.id;
  }

  return `
    <button ${renderAttributes(attributes)}
            class="${BUTTON_CLASSES}" 
            title="${escapeHtml(config.title)}">
      ${config.iconSvg}
      ${config.label}
    </button>
  `;
}

/**
 * Reads the task/pipeline identifiers for a one-shot button, looking at the
 * button itself first and then at its closest owning element.
 */
export function collectQuickPromptContext(button: HTMLElement): PromptContext {
  const taskId =
    button.getAttribute('data-task-id') ||
    button.closest('[data-task-id]')?.getAttribute('data-task-id') ||
    undefined;
  const pipelineId =
    button.getAttribute('data-pipeline-id') ||
    button.closest('[data-pipeline-id]')?.getAttribute('data-pipeline-id') ||
    undefined;

  const context: PromptContext = {};
  if (taskId) context.taskId = taskId;
  if (pipelineId) context.pipelineId = pipelineId;
  return context;
}

/**
 * Resolves the element a result should be rendered into. A container marked
 * with ``data-oneprompt-target`` takes precedence; otherwise the anchor is left
 * to the core handler's default resolution.
 */
export function resolveQuickPromptTarget(button: HTMLElement): HTMLElement | null {
  return button.closest<HTMLElement>('[data-oneprompt-target]');
}

/**
 * Dispatches the one-shot request described by a rendered quick-prompt button.
 *
 * This is the glue registered for the global ``quick_prompt`` action: the
 * surrounding view supplies its {@link QuickPromptSender} (normally the shared
 * ``WebSocketClient``) and the button contributes the ``promptId`` and context
 * ids from its ``data-*`` attributes.
 *
 * Returns the created {@link OnePromptRequest}, or ``null`` when the button does
 * not identify a prompt.
 */
export function handleQuickPromptButtonClick(
  wsClient: QuickPromptSender,
  button: HTMLElement,
  actionOrId?: OnePromptAction | string
): OnePromptRequest | null {
  const promptId = actionOrId
    ? typeof actionOrId === 'string'
      ? actionOrId
      : actionOrId.id
    : button.getAttribute('data-prompt-id') || '';

  if (!promptId) return null;

  const context = collectQuickPromptContext(button);
  const target = resolveQuickPromptTarget(button);
  const options = target ? { target } : {};

  return sendQuickPrompt(wsClient, promptId, context, options);
}

/** Natural aliases used by callers/tests. */
export const dispatchQuickPromptButton = handleQuickPromptButtonClick;
export const dispatchOneShotPrompt = handleQuickPromptButtonClick;
