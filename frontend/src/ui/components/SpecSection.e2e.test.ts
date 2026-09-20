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
 * End-to-end tests for the Elaborate one-shot action
 * (`design/dd_one_shot_ai.md` sections 3, 4.2 and 9).
 *
 * Unlike the focused component/core tests, this suite wires the *real* pieces
 * together the way `AppContext` does:
 *
 *   renderSpecSection → Elaborate button → `quick_prompt` over the (fake) WS →
 *   inbound handlers registered via `registerOnePromptHandlers` →
 *   `quick_prompt_result` rendered inline → Accept → `TaskClient.updateDetails`
 *   (the `PATCH /tasks/{id}` write-back).
 *
 * It also verifies the `unavailable`, `not_found`, `timeout` and `cancelled`
 * error paths surface inline, and that stale results are dropped when the task
 * is no longer displayed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Task } from '../../core/domain.ts';
import {
  renderSpecSection,
  registerTaskElaborateSpecAction,
  TASK_ELABORATE_SPEC_PROMPT_ID,
} from './SpecSection.ts';
import { handleQuickPromptButtonClick } from './QuickPromptButton.ts';
import {
  registerOnePromptHandlers,
  resetOnePromptState,
} from '../../core/oneprompt.ts';

/* ------------------------------------------------------------------------- *
 * Test doubles
 * ------------------------------------------------------------------------- */

/**
 * A fake `WebSocketClient` that records outbound messages and lets the test
 * simulate inbound (server → client) frames through the very same `on`/`off`
 * contract the real client exposes.
 */
class FakeWebSocketClient {
  sent: Array<{ type: string; payload: any }> = [];
  private handlers = new Map<string, Set<(message: any) => void>>();

  send(type: string, payload: any): void {
    this.sent.push({ type, payload });
  }

  on(type: string, handler: (message: any) => void): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
    return () => this.off(type, handler);
  }

  off(type: string, handler: (message: any) => void): void {
    this.handlers.get(type)?.delete(handler);
  }

  /** Simulate the backend pushing a frame to the client. */
  receive(type: string, payload: any): void {
    const message = { type, id: payload?.runId, payload };
    this.handlers.get(type)?.forEach((handler) => handler(message));
  }

  get inboundTypes(): string[] {
    return [...this.handlers.keys()];
  }
}

interface AppHarness {
  ws: FakeWebSocketClient;
  taskClient: { updateDetails: ReturnType<typeof vi.fn> };
  dataManager: {
    getTask: ReturnType<typeof vi.fn>;
    updateTask: ReturnType<typeof vi.fn>;
  };
  task: Task;
  container: HTMLElement;
  button: HTMLElement;
  wrapper: HTMLElement;
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

/**
 * Builds a harness that mirrors `AppContext.initOnePrompt`: the real inbound
 * handlers, the real `task_elaborate_spec` action, and a write-back that goes
 * through a `TaskClient` double.
 */
function setupHarness(task: Task = makeTask()): AppHarness {
  const ws = new FakeWebSocketClient();
  registerOnePromptHandlers(ws);

  const taskClient = {
    updateDetails: vi.fn(
      async (
        _id: string,
        version: number,
        details: Partial<{ spec: string }>
      ): Promise<Task> => new Task({ ...task, ...details, version: version + 1 })
    ),
  };
  const dataManager = {
    getTask: vi.fn((id: string) => (id === task.id ? task : undefined)),
    updateTask: vi.fn((updated: Task) => updated),
  };

  // Mirrors the callback registered in AppContext.initOnePrompt().
  registerTaskElaborateSpecAction(async (taskId, spec) => {
    const current = dataManager.getTask(taskId);
    const updated = await taskClient.updateDetails(
      taskId,
      current?.version ?? 1,
      { spec }
    );
    dataManager.updateTask(updated);
  });

  const wrapper = document.createElement('div');
  wrapper.innerHTML = renderSpecSection(task, true);
  document.body.appendChild(wrapper);

  const container = wrapper.querySelector('.spec-container') as HTMLElement;
  const button = wrapper.querySelector(
    `[data-prompt-id="${TASK_ELABORATE_SPEC_PROMPT_ID}"]`
  ) as HTMLElement;

  return { ws, taskClient, dataManager, task, container, button, wrapper };
}

const EXPECTED_CONTEXT = { taskId: 't1', pipelineId: 'p1' };

/* ------------------------------------------------------------------------- *
 * Tests
 * ------------------------------------------------------------------------- */

describe('Elaborate one-shot end-to-end', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    resetOnePromptState();
  });

  afterEach(() => {
    resetOnePromptState();
    vi.restoreAllMocks();
  });

  it('subscribes to the result/error/stream frames on the real client contract', () => {
    const { ws } = setupHarness();
    expect(ws.inboundTypes).toEqual(
      expect.arrayContaining([
        'quick_prompt_result',
        'quick_prompt_error',
        'quick_prompt_stream',
      ])
    );
  });

  it('dispatches quick_prompt, renders the result inline and writes back on Accept', async () => {
    const { ws, taskClient, dataManager, container, button } = setupHarness();

    // 1. Clicking the Elaborate button emits quick_prompt with runId/promptId/
    //    context.
    const request = handleQuickPromptButtonClick(ws as any, button);
    expect(request).not.toBeNull();
    expect(ws.sent).toHaveLength(1);
    const { type, payload } = ws.sent[0];
    expect(type).toBe('quick_prompt');
    expect(payload.promptId).toBe(TASK_ELABORATE_SPEC_PROMPT_ID);
    expect(typeof payload.runId).toBe('string');
    expect(payload.runId).toBe(request!.runId);
    expect(payload.context).toEqual(EXPECTED_CONTEXT);

    // 2/3. The backend pushes quick_prompt_result; the registered handler
    //      renders it inline inside the spec container.
    ws.receive('quick_prompt_result', {
      runId: request!.runId,
      promptId: TASK_ELABORATE_SPEC_PROMPT_ID,
      context: EXPECTED_CONTEXT,
      result: 'Expanded **specification**',
      status: 'ok',
      error: null,
      meta: {},
    });

    const resultEl = container.querySelector(
      '[data-oneprompt-result]'
    ) as HTMLElement;
    expect(resultEl).toBeTruthy();
    expect(
      container.querySelector('.elaborate-spec-content')?.textContent
    ).toContain('Expanded specification');

    // 4. Accept issues the normal PATCH /tasks/{id} write-back.
    container
      .querySelector<HTMLButtonElement>('[data-oneprompt-action="accept"]')!
      .click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(taskClient.updateDetails).toHaveBeenCalledTimes(1);
    expect(taskClient.updateDetails).toHaveBeenCalledWith('t1', 3, {
      spec: 'Expanded **specification**',
    });
    expect(dataManager.updateTask).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-oneprompt-result]')).toBeFalsy();
  });

  it('discards the result when Reject is clicked', async () => {
    const { ws, taskClient, container, button } = setupHarness();

    const request = handleQuickPromptButtonClick(ws as any, button);
    ws.receive('quick_prompt_result', {
      runId: request!.runId,
      promptId: TASK_ELABORATE_SPEC_PROMPT_ID,
      context: EXPECTED_CONTEXT,
      result: 'Expanded specification',
      status: 'ok',
      error: null,
      meta: {},
    });

    container
      .querySelector<HTMLButtonElement>('[data-oneprompt-action="reject"]')!
      .click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(taskClient.updateDetails).not.toHaveBeenCalled();
    expect(container.querySelector('[data-oneprompt-result]')).toBeFalsy();
  });

  it.each([
    ['unavailable', 'Ollama is not available.'],
    ['not_found', 'Unknown prompt id: "task_elaborate_spec"'],
    ['timeout', 'The one-shot prompt timed out after 60s.'],
    ['cancelled', 'The one-shot prompt was cancelled.'],
  ])(
    'surfaces an inline error for status "%s" and never writes back',
    async (status, error) => {
      const { ws, taskClient, container, button } = setupHarness();

      const request = handleQuickPromptButtonClick(ws as any, button);
      ws.receive('quick_prompt_error', {
        runId: request!.runId,
        promptId: TASK_ELABORATE_SPEC_PROMPT_ID,
        context: EXPECTED_CONTEXT,
        result: null,
        status,
        error,
        meta: {},
      });

      expect(container.querySelector('.elaborate-spec-result')).toBeFalsy();
      const errorEl = container.querySelector('.elaborate-spec-error');
      expect(errorEl).toBeTruthy();
      expect(errorEl?.getAttribute('data-oneprompt-error')).toBe(status);
      expect(errorEl?.textContent).toContain(error);

      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(taskClient.updateDetails).not.toHaveBeenCalled();
    }
  );

  it('drops a stale result when the owning task is no longer displayed', () => {
    const { ws, taskClient, wrapper, button } = setupHarness();

    const request = handleQuickPromptButtonClick(ws as any, button);

    // The task card is removed from the DOM before the response arrives.
    wrapper.remove();

    ws.receive('quick_prompt_result', {
      runId: request!.runId,
      promptId: TASK_ELABORATE_SPEC_PROMPT_ID,
      context: EXPECTED_CONTEXT,
      result: 'Expanded specification',
      status: 'ok',
      error: null,
      meta: {},
    });

    expect(document.querySelector('[data-oneprompt-result]')).toBeFalsy();
    expect(taskClient.updateDetails).not.toHaveBeenCalled();
  });

  it('streams deltas into the inline preview before the terminal result', () => {
    const { ws, container, button } = setupHarness();

    const request = handleQuickPromptButtonClick(ws as any, button);
    ws.receive('quick_prompt_stream', {
      runId: request!.runId,
      promptId: TASK_ELABORATE_SPEC_PROMPT_ID,
      context: EXPECTED_CONTEXT,
      delta: 'Expanded ',
    });

    expect(container.querySelector('[data-oneprompt-result]')).toBeTruthy();

    ws.receive('quick_prompt_result', {
      runId: request!.runId,
      promptId: TASK_ELABORATE_SPEC_PROMPT_ID,
      context: EXPECTED_CONTEXT,
      result: 'Expanded specification',
      status: 'ok',
      error: null,
      meta: {},
    });

    expect(container.querySelectorAll('[data-oneprompt-result]')).toHaveLength(1);
    expect(
      container.querySelector('.elaborate-spec-content')?.textContent
    ).toContain('Expanded specification');
  });
});
