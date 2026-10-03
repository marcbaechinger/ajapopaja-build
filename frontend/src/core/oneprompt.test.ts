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
import {
  inFlightPrompts,
  onePromptActions,
  defaultVisibilityResolver,
  handleQuickPromptResult,
  handleQuickPromptStream,
  registerOnePromptAction,
  registerOnePromptHandlers,
  resetOnePromptState,
  resolveAnchorElement,
  sendQuickPrompt,
  setOnePromptVisibilityResolver,
  startQuickPrompt,
  type OnePromptAction,
  type OnePromptRenderContext,
} from './oneprompt.ts';

type WSHandler = (message: { type: string; id?: string; payload: any }) => void;

class FakeWS {
  sent: Array<{ type: string; payload: any }> = [];
  private handlers: Map<string, Set<WSHandler>> = new Map();

  send(type: string, payload: any): void {
    this.sent.push({ type, payload });
  }

  on(type: string, handler: WSHandler): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
    return () => this.handlers.get(type)?.delete(handler);
  }

  off(type: string, handler: WSHandler): void {
    this.handlers.get(type)?.delete(handler);
  }

  dispatch(type: string, payload: any, id = ''): void {
    this.handlers.get(type)?.forEach((h) => h({ type, id, payload }));
  }
}

function makeAction(overrides: Partial<OnePromptAction> = {}): OnePromptAction {
  return {
    id: 'task_elaborate_spec',
    label: 'Elaborate',
    title: 'Expand the task specification',
    buildContext: (taskId: string, pipelineId: string) => ({ taskId, pipelineId }),
    render: vi.fn(),
    ...overrides,
  };
}

function resultPayload(overrides: Record<string, any> = {}) {
  return {
    runId: 'run-1',
    promptId: 'task_elaborate_spec',
    context: { taskId: 't1', pipelineId: 'p1' },
    result: 'Expanded spec',
    error: null,
    status: 'ok',
    meta: {},
    ...overrides,
  };
}

describe('oneprompt core', () => {
  let ws: FakeWS;
  let action: OnePromptAction;

  beforeEach(() => {
    document.body.innerHTML = '';
    resetOnePromptState();
    ws = new FakeWS();
    action = registerOnePromptAction(makeAction());
  });

  afterEach(() => {
    resetOnePromptState();
    vi.restoreAllMocks();
  });

  describe('sendQuickPrompt', () => {
    it('sends a correctly shaped quick_prompt message and tracks the run', () => {
      const request = sendQuickPrompt(ws, action, { taskId: 't1', pipelineId: 'p1' });

      expect(ws.sent).toHaveLength(1);
      const { type, payload } = ws.sent[0];
      expect(type).toBe('quick_prompt');
      expect(Object.keys(payload).sort()).toEqual(['context', 'promptId', 'runId']);
      expect(typeof payload.runId).toBe('string');
      expect(payload.runId.length).toBeGreaterThan(0);
      expect(payload.promptId).toBe('task_elaborate_spec');
      expect(payload.context).toEqual({ taskId: 't1', pipelineId: 'p1' });
      expect(request.runId).toBe(payload.runId);
      expect(inFlightPrompts.get(payload.runId)?.action).toBe(action);
    });

    it('is resolvable by prompt id string', () => {
      sendQuickPrompt(ws, 'task_elaborate_spec', { taskId: 't9', pipelineId: 'p9' });
      expect(ws.sent[0].payload.promptId).toBe('task_elaborate_spec');
      expect(ws.sent[0].payload.context).toEqual({ taskId: 't9', pipelineId: 'p9' });
    });

    it('includes optional stream/timeout fields only when provided', () => {
      sendQuickPrompt(ws, action, { taskId: 't1', pipelineId: 'p1' }, { stream: true, timeout: 30 });
      expect(ws.sent[0].payload.stream).toBe(true);
      expect(ws.sent[0].payload.timeout).toBe(30);
    });

    it('startQuickPrompt builds context via buildContext', () => {
      startQuickPrompt(ws, action, 't1', 'p1');
      expect(ws.sent[0].payload.context).toEqual({ taskId: 't1', pipelineId: 'p1' });
    });
  });

  describe('handleQuickPromptResult routing', () => {
    it('routes a result to the action correlated by runId and calls render', () => {
      const request = sendQuickPrompt(ws, action, { taskId: 't1', pipelineId: 'p1' });

      const handled = handleQuickPromptResult({
        type: 'quick_prompt_result',
        id: request.runId,
        payload: resultPayload({ runId: request.runId }),
      });

      expect(handled).toBe(true);
      expect(action.render).toHaveBeenCalledTimes(1);
      const [el, ctx] = (action.render as any).mock.calls[0] as [HTMLElement, OnePromptRenderContext];
      expect(el).toBeInstanceOf(HTMLElement);
      expect(ctx.promptId).toBe('task_elaborate_spec');
      expect(ctx.context).toEqual({ taskId: 't1', pipelineId: 'p1' });
      expect(ctx.taskId).toBe('t1');
      expect(ctx.result).toBe('Expanded spec');
      expect(ctx.status).toBe('ok');
      // The run is no longer in flight once its terminal result arrived.
      expect(inFlightPrompts.has(request.runId)).toBe(false);
    });

    it('falls back to the registry by promptId when nothing is in flight', () => {
      handleQuickPromptResult({
        type: 'quick_prompt_result',
        payload: resultPayload({ runId: 'orphan-run' }),
      });
      expect(action.render).toHaveBeenCalledTimes(1);
    });

    it('drops results whose anchored entity is no longer displayed', () => {
      action = registerOnePromptAction(
        makeAction({ anchor: { entity: 'task', field: 'spec' } })
      );
      const request = sendQuickPrompt(ws, action, { taskId: 't-gone', pipelineId: 'p1' });

      const handled = handleQuickPromptResult({
        type: 'quick_prompt_result',
        payload: resultPayload({ runId: request.runId, context: { taskId: 't-gone', pipelineId: 'p1' } }),
      });

      expect(handled).toBe(false);
      expect(action.render).not.toHaveBeenCalled();
      expect(inFlightPrompts.has(request.runId)).toBe(false);
    });

    it('renders anchored results when the entity is still displayed', () => {
      action = registerOnePromptAction(
        makeAction({ anchor: { entity: 'task', field: 'spec' } })
      );
      const card = document.createElement('div');
      card.setAttribute('data-task-id', 't1');
      document.body.appendChild(card);

      const request = sendQuickPrompt(ws, action, { taskId: 't1', pipelineId: 'p1' });
      handleQuickPromptResult({
        type: 'quick_prompt_result',
        payload: resultPayload({ runId: request.runId }),
      });

      expect(action.render).toHaveBeenCalledTimes(1);
      // The result container is mounted inside the owning task card.
      expect(card.querySelector('[data-oneprompt-result]')).toBeTruthy();
    });

    it('honours a per-action visibility override', () => {
      action = registerOnePromptAction(
        makeAction({ anchor: { entity: 'task', isVisible: () => false } })
      );
      sendQuickPrompt(ws, action, { taskId: 't1', pipelineId: 'p1' });
      const handled = handleQuickPromptResult({
        type: 'quick_prompt_result',
        payload: resultPayload(),
      });
      expect(handled).toBe(false);
      expect(action.render).not.toHaveBeenCalled();
    });

    it('honours a global visibility resolver override', () => {
      action = registerOnePromptAction(makeAction({ anchor: { entity: 'task' } }));
      setOnePromptVisibilityResolver(() => true);
      sendQuickPrompt(ws, action, { taskId: 'never-in-dom', pipelineId: 'p1' });
      handleQuickPromptResult({ type: 'quick_prompt_result', payload: resultPayload() });
      expect(action.render).toHaveBeenCalledTimes(1);
    });

    it('logs and drops results for unknown prompt ids', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const handled = handleQuickPromptResult({
        type: 'quick_prompt_result',
        payload: resultPayload({ promptId: 'does_not_exist' }),
      });
      expect(handled).toBe(false);
      expect(warn).toHaveBeenCalled();
    });

    it('routes error statuses to onError instead of render', () => {
      const onError = vi.fn();
      action = registerOnePromptAction(makeAction({ onError }));
      sendQuickPrompt(ws, action, { taskId: 't1', pipelineId: 'p1' });

      handleQuickPromptResult({
        type: 'quick_prompt_error',
        payload: resultPayload({
          status: 'unavailable',
          result: null,
          error: 'Ollama is unavailable',
        }),
      });

      expect(action.render).not.toHaveBeenCalled();
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError.mock.calls[0][1]).toBe('Ollama is unavailable');
    });
  });

  describe('render / accept / reject', () => {
    it('wires the default Accept button to the action accept hook', async () => {
      const accept = vi.fn();
      action = registerOnePromptAction(makeAction({ accept }));

      const target = document.createElement('div');
      document.body.appendChild(target);
      const request = sendQuickPrompt(ws, action, { taskId: 't1', pipelineId: 'p1' }, { target });

      handleQuickPromptResult({
        type: 'quick_prompt_result',
        payload: resultPayload({ runId: request.runId }),
      });

      const btn = target.querySelector<HTMLButtonElement>('[data-oneprompt-action="accept"]');
      expect(btn).toBeTruthy();
      btn!.click();
      await Promise.resolve();

      expect(accept).toHaveBeenCalledTimes(1);
      expect(accept.mock.calls[0][1]).toBe('Expanded spec');
      expect((accept.mock.calls[0][0] as OnePromptRenderContext).taskId).toBe('t1');
      // Accepted containers are removed.
      expect(target.querySelector('[data-oneprompt-result]')).toBeFalsy();
    });

    it('wires the default Reject button to the action reject hook', async () => {
      const reject = vi.fn();
      action = registerOnePromptAction(makeAction({ reject }));

      const target = document.createElement('div');
      document.body.appendChild(target);
      const request = sendQuickPrompt(ws, action, { taskId: 't1', pipelineId: 'p1' }, { target });

      handleQuickPromptResult({
        type: 'quick_prompt_result',
        payload: resultPayload({ runId: request.runId }),
      });

      const btn = target.querySelector<HTMLButtonElement>('[data-oneprompt-action="reject"]');
      expect(btn).toBeTruthy();
      btn!.click();
      await Promise.resolve();

      expect(reject).toHaveBeenCalledTimes(1);
      expect(target.querySelector('[data-oneprompt-result]')).toBeFalsy();
    });

    it('lets an action render its own controls without adding a default bar', () => {
      const render = vi.fn((el: HTMLElement, ctx: OnePromptRenderContext) => {
        const btn = document.createElement('button');
        btn.setAttribute('data-oneprompt-action', 'accept');
        btn.addEventListener('click', () => void ctx.accept());
        el.appendChild(btn);
      });
      action = registerOnePromptAction(makeAction({ render }));

      const target = document.createElement('div');
      document.body.appendChild(target);
      const request = sendQuickPrompt(ws, action, { taskId: 't1', pipelineId: 'p1' }, { target });
      handleQuickPromptResult({ type: 'quick_prompt_result', payload: resultPayload({ runId: request.runId }) });

      expect(target.querySelectorAll('[data-oneprompt-action="accept"]').length).toBe(1);
    });

    it('passes an accept override value and guards against double handling', async () => {
      const accept = vi.fn();
      action = registerOnePromptAction(makeAction({ accept }));

      const target = document.createElement('div');
      document.body.appendChild(target);
      const request = sendQuickPrompt(ws, action, { taskId: 't1', pipelineId: 'p1' }, { target });
      handleQuickPromptResult({ type: 'quick_prompt_result', payload: resultPayload({ runId: request.runId }) });

      const ctx = (action.render as any).mock.calls[0][1] as OnePromptRenderContext;
      await Promise.all([ctx.accept('override'), ctx.accept('second')]);

      expect(accept).toHaveBeenCalledTimes(1);
      expect(accept.mock.calls[0][1]).toBe('override');
    });
  });

  describe('handleQuickPromptStream', () => {
    it('forwards deltas to the action onStream hook after the stale check', () => {
      const onStream = vi.fn();
      action = registerOnePromptAction(makeAction({ onStream }));
      const request = sendQuickPrompt(ws, action, { taskId: 't1', pipelineId: 'p1' });

      const handled = handleQuickPromptStream({
        type: 'quick_prompt_stream',
        payload: {
          runId: request.runId,
          promptId: 'task_elaborate_spec',
          context: { taskId: 't1', pipelineId: 'p1' },
          delta: 'hello ',
        },
      });

      expect(handled).toBe(true);
      expect(onStream).toHaveBeenCalledTimes(1);
      expect(onStream.mock.calls[0][0]).toBe('hello ');
      // Streaming does not clear the in-flight run.
      expect(inFlightPrompts.has(request.runId)).toBe(true);
    });

    it('drops stale stream chunks for entities no longer displayed', () => {
      const onStream = vi.fn();
      action = registerOnePromptAction(
        makeAction({ anchor: { entity: 'task' }, onStream })
      );
      const request = sendQuickPrompt(ws, action, { taskId: 'gone', pipelineId: 'p1' });

      const handled = handleQuickPromptStream({
        type: 'quick_prompt_stream',
        payload: { runId: request.runId, promptId: action.id, delta: 'x' },
      });

      expect(handled).toBe(false);
      expect(onStream).not.toHaveBeenCalled();
    });

    it('reuses a single preview container across deltas and the terminal result', () => {
      const onStream = vi.fn();
      action = registerOnePromptAction(makeAction({ onStream }));

      const target = document.createElement('div');
      document.body.appendChild(target);
      const request = sendQuickPrompt(ws, action, { taskId: 't1', pipelineId: 'p1' }, { target });

      for (const delta of ['a', 'b', 'c']) {
        handleQuickPromptStream({
          type: 'quick_prompt_stream',
          payload: { runId: request.runId, promptId: action.id, delta },
        });
      }
      expect(target.querySelectorAll('[data-oneprompt-result]').length).toBe(1);

      handleQuickPromptResult({
        type: 'quick_prompt_result',
        payload: resultPayload({ runId: request.runId }),
      });
      expect(target.querySelectorAll('[data-oneprompt-result]').length).toBe(1);
    });
  });

  describe('session anchors', () => {
    it('resolves visibility via [data-session-uid]', () => {
      const row = document.createElement('div');
      row.setAttribute('data-session-uid', 's1');
      document.body.appendChild(row);

      expect(defaultVisibilityResolver({ entity: 'session' }, { sessionUid: 's1' })).toBe(
        true
      );
      expect(defaultVisibilityResolver({ entity: 'session' }, { sessionUid: 's2' })).toBe(
        false
      );
      expect(defaultVisibilityResolver({ entity: 'session' }, {})).toBe(false);
    });

    it('resolves a session anchor element to the row target', () => {
      const row = document.createElement('div');
      row.setAttribute('data-session-uid', 's1');
      row.setAttribute('data-oneprompt-target', '');
      document.body.appendChild(row);

      expect(resolveAnchorElement({ entity: 'session' }, { sessionUid: 's1' })).toBe(row);
      expect(resolveAnchorElement({ entity: 'session' }, { sessionUid: 's2' })).toBeNull();
    });
  });

  describe('registerOnePromptHandlers', () => {
    it('subscribes and unsubscribes the result/error/stream handlers', () => {
      const fresh = registerOnePromptAction(
        makeAction({ id: 'fresh', render: vi.fn() })
      );
      const unregister = registerOnePromptHandlers(ws);

      ws.dispatch(
        'quick_prompt_result',
        { runId: 'r1', promptId: 'fresh', context: { taskId: 't1' }, result: 'x', status: 'ok' }
      );
      expect(fresh.render).toHaveBeenCalledTimes(1);

      // Error variant shares the result handler.
      const onError = vi.fn();
      onePromptActions.set('fresh2', makeAction({ id: 'fresh2', onError }));
      ws.dispatch('quick_prompt_error', {
        runId: 'r2',
        promptId: 'fresh2',
        context: { taskId: 't1' },
        status: 'timeout',
        error: 'timed out',
      });
      expect(onError).toHaveBeenCalledTimes(1);

      unregister();
      const before = (fresh.render as any).mock.calls.length;
      ws.dispatch('quick_prompt_result', {
        runId: 'r3',
        promptId: 'fresh',
        context: { taskId: 't1' },
        result: 'y',
        status: 'ok',
      });
      expect((fresh.render as any).mock.calls.length).toBe(before);
    });
  });

  describe('resetOnePromptState', () => {
    it('clears in-flight runs and registered actions', () => {
      sendQuickPrompt(ws, action, { taskId: 't1', pipelineId: 'p1' });
      expect(inFlightPrompts.size).toBe(1);
      expect(onePromptActions.size).toBe(1);

      resetOnePromptState();
      expect(inFlightPrompts.size).toBe(0);
      expect(onePromptActions.size).toBe(0);
    });
  });
});
