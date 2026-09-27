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

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InteractiveCodingService } from './InteractiveCodingService.ts';
import { WebSocketClient } from './WebSocketClient.ts';
import type { CoderBotClient } from './clients/CoderBotClient.ts';
import type { RenderBlock } from './PiLogReducer.ts';

type WSHandler = (message: { type: string; payload: any }) => void;

class FakeWS {
  private handlers: Map<string, Set<WSHandler>> = new Map();
  on(type: string, handler: WSHandler): () => void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(handler);
    return () => this.handlers.get(type)!.delete(handler);
  }
  dispatch(type: string, payload: any) {
    this.handlers.get(type)?.forEach((h) => h({ type, payload }));
  }
}

function makeService(): {
  service: InteractiveCodingService;
  ws: FakeWS;
  client: {
    startInteractiveSession: ReturnType<typeof vi.fn>;
    sendInteractiveMessage: ReturnType<typeof vi.fn>;
    stopInteractiveSession: ReturnType<typeof vi.fn>;
    getInteractiveSession: ReturnType<typeof vi.fn>;
  };
} {
  const ws = new FakeWS();
  const client = {
    startInteractiveSession: vi.fn().mockResolvedValue({
      pipeline_id: 'p1',
      is_active: true,
      start_time: null,
      busy: false,
    }),
    sendInteractiveMessage: vi.fn().mockResolvedValue(undefined),
    stopInteractiveSession: vi.fn().mockResolvedValue(undefined),
    getInteractiveSession: vi.fn().mockResolvedValue(null),
  };
  const service = new InteractiveCodingService(
    ws as unknown as WebSocketClient,
    client as unknown as CoderBotClient
  );
  return { service, ws, client };
}

function rpc(ws: FakeWS, event: any, pipelineId = 'p1', botType = 'interactive') {
  ws.dispatch('INTERACTIVE_RPC_EVENT', {
    pipeline_id: pipelineId,
    bot_type: botType,
    event,
  });
}

const texts = (blocks: RenderBlock[]) => blocks.filter((b) => b.kind === 'text');

describe('InteractiveCodingService', () => {
  let service: InteractiveCodingService;
  let ws: FakeWS;
  let client: ReturnType<typeof makeService>['client'];

  beforeEach(() => {
    ({ service, ws, client } = makeService());
    ws.dispatch('INTERACTIVE_STARTED', {
      pipeline_id: 'p1',
      bot_type: 'interactive',
      start_time: '2026-01-02T03:04:05Z',
    });
  });

  it('feeds INTERACTIVE_RPC_EVENT into the reducer for the current pipeline', () => {
    rpc(ws, {
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'hello' },
    });
    expect(texts(service.getHistory())).toHaveLength(1);
    expect(texts(service.getHistory())[0].text).toBe('hello');
  });

  it('filters out events for another pipeline', () => {
    rpc(
      ws,
      {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'other' },
      },
      'p2'
    );
    expect(service.getHistory()).toHaveLength(0);
  });

  it('filters out events for another bot type', () => {
    rpc(
      ws,
      {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'batch' },
      },
      'p1',
      'coderbot'
    );
    expect(service.getHistory()).toHaveLength(0);
  });

  it('ignores batch CODERBOT_* messages (no cross-talk)', () => {
    ws.dispatch('CODERBOT_RPC_EVENT', {
      pipeline_id: 'p1',
      bot_type: 'coderbot',
      event: {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'batch' },
      },
    });
    expect(service.getHistory()).toHaveLength(0);
  });

  it('adopts session state and start time from INTERACTIVE_STARTED', () => {
    expect(service.isActive()).toBe(true);
    expect(service.getCurrentTaskId()).toBe('p1');
    expect(service.getSessionStartTime()).toBe(Date.parse('2026-01-02T03:04:05Z'));
  });

  it('resets the log and busy state when a new session starts', () => {
    rpc(ws, { type: 'agent_start' });
    expect(service.getHistory().length).toBeGreaterThan(0);
    ws.dispatch('INTERACTIVE_STARTED', {
      pipeline_id: 'p1',
      bot_type: 'interactive',
      start_time: null,
    });
    expect(service.getHistory()).toHaveLength(0);
    expect(service.isBusy()).toBe(false);
  });

  it('startSession calls the client and sets the pipeline id', async () => {
    await service.startSession('p1');
    expect(client.startInteractiveSession).toHaveBeenCalledWith('p1');
    expect(service.getCurrentTaskId()).toBe('p1');
    expect(service.isActive()).toBe(true);
  });

  it('sendMessage calls the client and toggles busy until turn ended', async () => {
    await service.sendMessage('do the thing');
    expect(client.sendInteractiveMessage).toHaveBeenCalledWith('do the thing');
    expect(service.isBusy()).toBe(true);

    ws.dispatch('INTERACTIVE_TURN_ENDED', { pipeline_id: 'p1', bot_type: 'interactive' });
    expect(service.isBusy()).toBe(false);
  });

  it('does not clear busy on a turn-ended event for another pipeline', async () => {
    await service.sendMessage('x');
    ws.dispatch('INTERACTIVE_TURN_ENDED', { pipeline_id: 'p2', bot_type: 'interactive' });
    expect(service.isBusy()).toBe(true);
  });

  it('stopSession calls the client and marks the session inactive', async () => {
    await service.stopSession('p1');
    expect(client.stopInteractiveSession).toHaveBeenCalled();
    expect(service.isActive()).toBe(false);
  });

  it('adds an error block on INTERACTIVE_ERROR', () => {
    ws.dispatch('INTERACTIVE_ERROR', {
      pipeline_id: 'p1',
      bot_type: 'interactive',
      message: 'boom',
    });
    const errors = service.getHistory().filter((b) => b.kind === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].text).toContain('boom');
  });

  it('refreshSession adopts an active backend session', async () => {
    client.getInteractiveSession.mockResolvedValue({
      pipeline_id: 'p7',
      is_active: true,
      start_time: '2026-02-03T04:05:00Z',
      busy: true,
    });
    const info = await service.refreshSession();
    expect(info).not.toBeNull();
    expect(service.getCurrentTaskId()).toBe('p7');
    expect(service.isActive()).toBe(true);
    expect(service.isBusy()).toBe(true);
    expect(service.getSessionStartTime()).toBe(Date.parse('2026-02-03T04:05:00Z'));
  });

  it('refreshSession clears state when there is no backend session', async () => {
    client.getInteractiveSession.mockResolvedValue(null);
    await service.refreshSession();
    expect(service.isActive()).toBe(false);
  });

  it('clearHistory resets the log', () => {
    rpc(ws, { type: 'agent_start' });
    service.clearHistory();
    expect(service.getHistory()).toHaveLength(0);
  });

  it('notifies state listeners on start and stop', () => {
    const listener = vi.fn();
    service.onSessionStateChange(listener);
    ws.dispatch('INTERACTIVE_STOPPED', { pipeline_id: 'p1', bot_type: 'interactive' });
    expect(listener).toHaveBeenCalledWith(false);
    ws.dispatch('INTERACTIVE_STARTED', { pipeline_id: 'p1', bot_type: 'interactive' });
    expect(listener).toHaveBeenCalledWith(true);
  });
});
