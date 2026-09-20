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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Task } from '../../core/domain.ts';
import {
  renderSpecSection,
  renderElaborateSpecResult,
  createTaskElaborateSpecAction,
  registerTaskElaborateSpecAction,
  setTaskElaborateSpecUpdater,
  TASK_ELABORATE_SPEC_PROMPT_ID,
} from './SpecSection.ts';
import { handleQuickPromptButtonClick } from './QuickPromptButton.ts';
import {
  handleQuickPromptResult,
  onePromptActions,
  resetOnePromptState,
  type OnePromptRenderContext,
} from '../../core/oneprompt.ts';

class FakeWS {
  sent: Array<{ type: string; payload: any }> = [];
  send(type: string, payload: any): void {
    this.sent.push({ type, payload });
  }
}

function makeTask(overrides: Record<string, any> = {}): Task {
  return new Task({
    id: 't1',
    title: 'A task',
    spec: '- first point\n- second point',
    pipeline_id: 'p1',
    status: 'created',
    version: 3,
    ...overrides,
  });
}

function makeRenderContext(overrides: Partial<OnePromptRenderContext> = {}): {
  ctx: OnePromptRenderContext;
  accept: ReturnType<typeof vi.fn>;
  reject: ReturnType<typeof vi.fn>;
  container: HTMLElement;
} {
  const container = document.createElement('div');
  const accept = vi.fn();
  const reject = vi.fn();
  const ctx: OnePromptRenderContext = {
    runId: 'run-1',
    promptId: TASK_ELABORATE_SPEC_PROMPT_ID,
    context: { taskId: 't1', pipelineId: 'p1' },
    result: 'Expanded **spec**',
    status: 'ok',
    error: null,
    meta: {},
    container,
    accepted: false,
    rejected: false,
    accept: async (override?: string) => {
      accept(override);
    },
    reject: async () => {
      reject();
    },
    ...overrides,
  };
  return { ctx, accept, reject, container };
}

describe('SpecSection', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    resetOnePromptState();
    setTaskElaborateSpecUpdater(null);
  });

  afterEach(() => {
    resetOnePromptState();
    setTaskElaborateSpecUpdater(null);
    vi.restoreAllMocks();
  });

  describe('renderSpecSection', () => {
    it('mounts an Elaborate one-shot button beside the specification', () => {
      const html = renderSpecSection(makeTask(), true);
      expect(html).toContain('Elaborate');
      expect(html).toContain('data-action-click="quick_prompt"');
      expect(html).toContain(`data-prompt-id="${TASK_ELABORATE_SPEC_PROMPT_ID}"`);
      expect(html).toContain('data-task-id="t1"');
      expect(html).toContain('data-pipeline-id="p1"');
      expect(html).toContain('data-oneprompt-target');
    });

    it('omits the Elaborate button for completed tasks', () => {
      const html = renderSpecSection(makeTask({ status: 'implemented' }), true);
      expect(html).not.toContain('data-prompt-id="task_elaborate_spec"');
    });
  });

  describe('renderElaborateSpecResult', () => {
    it('renders the markdown suggestion with accept/reject controls', () => {
      const { ctx, container } = makeRenderContext();
      renderElaborateSpecResult(container, ctx);

      expect(container.querySelector('.elaborate-spec-result')).toBeTruthy();
      expect(container.querySelector('.elaborate-spec-content')?.innerHTML).toContain('<strong>spec</strong>');
      expect(container.querySelector('[data-oneprompt-action="accept"]')?.textContent?.trim()).toBe('Accept');
      expect(container.querySelector('[data-oneprompt-action="reject"]')?.textContent?.trim()).toBe('Reject');
    });

    it('honours accept/reject labels from the template meta', () => {
      const { ctx, container } = makeRenderContext({
        meta: { accept_label: 'Apply', reject_label: 'Discard' },
      });
      renderElaborateSpecResult(container, ctx);
      expect(container.querySelector('[data-oneprompt-action="accept"]')?.textContent?.trim()).toBe('Apply');
      expect(container.querySelector('[data-oneprompt-action="reject"]')?.textContent?.trim()).toBe('Discard');
    });

    it('wires the buttons to ctx.accept and ctx.reject', async () => {
      const { ctx, accept, reject, container } = makeRenderContext();
      renderElaborateSpecResult(container, ctx);

      container.querySelector<HTMLButtonElement>('[data-oneprompt-action="accept"]')!.click();
      container.querySelector<HTMLButtonElement>('[data-oneprompt-action="reject"]')!.click();
      await Promise.resolve();

      expect(accept).toHaveBeenCalledTimes(1);
      expect(reject).toHaveBeenCalledTimes(1);
    });
  });

  describe('task_elaborate_spec action', () => {
    it('registers in onePromptActions with the spec anchor and context builder', () => {
      const action = registerTaskElaborateSpecAction();
      expect(onePromptActions.get(TASK_ELABORATE_SPEC_PROMPT_ID)).toBe(action);
      expect(action.id).toBe(TASK_ELABORATE_SPEC_PROMPT_ID);
      expect(action.label).toBe('Elaborate');
      expect(action.anchor).toEqual({ entity: 'task', field: 'spec' });
      expect(action.buildContext?.('t1', 'p1')).toEqual({ taskId: 't1', pipelineId: 'p1' });
      expect(typeof action.render).toBe('function');
      expect(typeof action.accept).toBe('function');
    });

    it('uses the injected updater for accept', async () => {
      const updater = vi.fn(async (_taskId: string, _spec: string) => {});
      const action = createTaskElaborateSpecAction(updater);
      const { ctx } = makeRenderContext();
      await action.accept?.(ctx, 'Expanded spec');
      expect(updater).toHaveBeenCalledTimes(1);
      expect(updater.mock.calls[0][0]).toBe('t1');
      expect(updater.mock.calls[0][1]).toBe('Expanded spec');
    });

    it('falls back to the module level updater set via setTaskElaborateSpecUpdater', async () => {
      const updater = vi.fn(async (_taskId: string, _spec: string) => {});
      setTaskElaborateSpecUpdater(updater);
      const action = createTaskElaborateSpecAction();
      const { ctx } = makeRenderContext();
      await action.accept?.(ctx, 'From module handler');
      expect(updater).toHaveBeenCalledWith('t1', 'From module handler', ctx);
    });
  });

  describe('inline end-to-end flow', () => {
    it('dispatches, renders inline and accepts the result', async () => {
      const ws = new FakeWS();
      const updater = vi.fn(async (_taskId: string, _spec: string) => {});
      registerTaskElaborateSpecAction(updater);

      const wrapper = document.createElement('div');
      wrapper.innerHTML = renderSpecSection(makeTask(), true);
      const specContainer = wrapper.querySelector('.spec-container') as HTMLElement;
      const button = wrapper.querySelector('[data-prompt-id="task_elaborate_spec"]') as HTMLElement;
      document.body.appendChild(wrapper);

      // 1. Clicking the Elaborate button dispatches a one-shot request.
      const request = handleQuickPromptButtonClick(ws as any, button);
      expect(request).not.toBeNull();
      expect(ws.sent[0].type).toBe('quick_prompt');
      expect(ws.sent[0].payload.promptId).toBe(TASK_ELABORATE_SPEC_PROMPT_ID);

      // 2. The result arrives and is rendered inline inside the spec container.
      const handled = handleQuickPromptResult({
        type: 'quick_prompt_result',
        payload: {
          runId: request!.runId,
          promptId: TASK_ELABORATE_SPEC_PROMPT_ID,
          context: { taskId: 't1', pipelineId: 'p1' },
          result: 'Expanded specification',
          status: 'ok',
          error: null,
          meta: {},
        },
      });

      expect(handled).toBe(true);
      const resultEl = specContainer.querySelector('[data-oneprompt-result]') as HTMLElement;
      expect(resultEl).toBeTruthy();
      expect(specContainer.querySelector('.elaborate-spec-content')?.textContent).toContain('Expanded specification');

      // 3. Accept applies the result through the injected updater.
      resultEl.querySelector<HTMLButtonElement>('[data-oneprompt-action="accept"]')!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(updater).toHaveBeenCalledTimes(1);
      expect(updater.mock.calls[0][0]).toBe('t1');
      expect(updater.mock.calls[0][1]).toBe('Expanded specification');
      expect(specContainer.querySelector('[data-oneprompt-result]')).toBeFalsy();
    });

    it('rejects the result without applying it', async () => {
      const ws = new FakeWS();
      const updater = vi.fn(async (_taskId: string, _spec: string) => {});
      registerTaskElaborateSpecAction(updater);

      const wrapper = document.createElement('div');
      wrapper.innerHTML = renderSpecSection(makeTask(), true);
      const specContainer = wrapper.querySelector('.spec-container') as HTMLElement;
      const button = wrapper.querySelector('[data-prompt-id="task_elaborate_spec"]') as HTMLElement;
      document.body.appendChild(wrapper);

      const request = handleQuickPromptButtonClick(ws as any, button);
      handleQuickPromptResult({
        type: 'quick_prompt_result',
        payload: {
          runId: request!.runId,
          promptId: TASK_ELABORATE_SPEC_PROMPT_ID,
          context: { taskId: 't1', pipelineId: 'p1' },
          result: 'Expanded specification',
          status: 'ok',
          error: null,
          meta: {},
        },
      });

      specContainer
        .querySelector<HTMLButtonElement>('[data-oneprompt-action="reject"]')!
        .click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(updater).not.toHaveBeenCalled();
      expect(specContainer.querySelector('[data-oneprompt-result]')).toBeFalsy();
    });

    it('drops the result when the task is no longer shown', () => {
      const ws = new FakeWS();
      registerTaskElaborateSpecAction(vi.fn(async (_taskId: string, _spec: string) => {}));

      const button = document.createElement('button');
      button.setAttribute('data-prompt-id', TASK_ELABORATE_SPEC_PROMPT_ID);
      button.setAttribute('data-task-id', 'missing-task');
      button.setAttribute('data-pipeline-id', 'p1');
      document.body.appendChild(button);

      const request = handleQuickPromptButtonClick(ws as any, button);
      // The owning task is no longer displayed.
      button.remove();
      const handled = handleQuickPromptResult({
        type: 'quick_prompt_result',
        payload: {
          runId: request!.runId,
          promptId: TASK_ELABORATE_SPEC_PROMPT_ID,
          context: { taskId: 'missing-task', pipelineId: 'p1' },
          result: 'x',
          status: 'ok',
          meta: {},
        },
      });

      expect(handled).toBe(false);
      expect(document.querySelector('[data-oneprompt-result]')).toBeFalsy();
    });
  });
});
