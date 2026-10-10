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
import type { PiSessionSummary } from './InteractiveCodingService.ts';
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

const summary = (uid: string, overrides: Partial<PiSessionSummary> = {}): PiSessionSummary => ({
  uid,
  kind: 'interactive',
  status: 'paused',
  pipeline_id: 'p1',
  resume_count: 1,
  last_active_at: '2026-01-02T03:04:05Z',
  ...overrides,
});

function make() {
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
    pauseSession: vi.fn().mockResolvedValue(undefined),
    resumeSession: vi.fn().mockResolvedValue(summary('u2', { status: 'running' })),
    listSessions: vi.fn().mockResolvedValue([]),
    getSessionEvents: vi.fn().mockResolvedValue([]),
    discardSession: vi.fn().mockResolvedValue(undefined),
    updateSessionLabel: vi
      .fn()
      .mockImplementation((uid: string, label: string) => Promise.resolve(summary(uid, { label }))),
    updateSessionModel: vi
      .fn()
      .mockImplementation((uid: string, model: string | null) =>
        Promise.resolve(summary(uid, { model }))
      ),
  };
  const service = new InteractiveCodingService(
    ws as unknown as WebSocketClient,
    client as unknown as CoderBotClient
  );
  return { service, ws, client };
}

const texts = (blocks: RenderBlock[]) => blocks.filter((b) => b.kind === 'text');

describe('InteractiveCodingService session cache', () => {
  let service: InteractiveCodingService;
  let ws: FakeWS;
  let client: ReturnType<typeof make>['client'];

  beforeEach(() => {
    ({ service, ws, client } = make());
  });

  it('refreshSessions populates the cache and getSessions sorts active first', async () => {
    client.listSessions.mockResolvedValue([
      summary('u-paused', { status: 'paused', last_active_at: '2026-01-01T00:00:00Z' }),
      summary('u-running', { status: 'running', last_active_at: '2026-01-03T00:00:00Z' }),
      summary('u-completed', { status: 'completed', last_active_at: '2026-01-02T00:00:00Z' }),
    ]);
    await service.refreshSessions({ kind: 'interactive' });
    expect(service.getSessions().map((s) => s.uid)).toEqual([
      'u-running',
      'u-paused',
      'u-completed',
    ]);
    expect(service.getSession('u-paused')?.status).toBe('paused');
    expect(service.isSessionsLoading()).toBe(false);
    expect(service.getSessionsError()).toBeNull();
  });

  it('refreshSessions de-dupes concurrent requests', async () => {
    let resolve!: (value: PiSessionSummary[]) => void;
    client.listSessions.mockImplementation(
      () =>
        new Promise<PiSessionSummary[]>((r) => {
          resolve = r;
        })
    );
    const p1 = service.refreshSessions({ kind: 'interactive' });
    const p2 = service.refreshSessions({ kind: 'interactive' });
    resolve([summary('u1')]);
    await Promise.all([p1, p2]);
    expect(client.listSessions).toHaveBeenCalledTimes(1);
  });

  it('switchSession pauses the previous session and resumes the target', async () => {
    client.listSessions.mockResolvedValue([
      summary('u1', { status: 'running' }),
      summary('u2', { status: 'paused' }),
    ]);
    await service.refreshSessions({ kind: 'interactive' });
    // Adopt u1 as the current session.
    ws.dispatch('INTERACTIVE_STARTED', {
      pipeline_id: 'p1',
      bot_type: 'interactive',
      session_uid: 'u1',
    });

    client.listSessions.mockResolvedValue([
      summary('u1', { status: 'paused' }),
      summary('u2', { status: 'running' }),
    ]);
    await service.switchSession('u2');

    expect(client.resumeSession).toHaveBeenCalledWith('u2');
    expect(service.getSession('u2')?.status).toBe('running');
    expect(service.getSession('u1')?.status).toBe('paused');
    expect(service.isSwitching()).toBeNull();
  });

  it('switchSession is a no-op for the already active session', async () => {
    ws.dispatch('INTERACTIVE_STARTED', {
      pipeline_id: 'p1',
      bot_type: 'interactive',
      session_uid: 'u1',
    });
    const listener = vi.fn();
    service.onSessionsChange(listener);
    listener.mockClear();
    await service.switchSession('u1');
    expect(client.resumeSession).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it('switchSession ignores a batch (coderbot) session', async () => {
    client.listSessions.mockResolvedValue([
      summary('batch-1', { kind: 'coderbot', status: 'completed' }),
    ]);
    await service.refreshSessions();

    await service.switchSession('batch-1');

    expect(client.resumeSession).not.toHaveBeenCalled();
    expect(service.getCurrentSession().uid).toBeNull();
    expect(service.getCurrentSession().active).toBe(false);
  });

  it('resumeSession rejects a batch (coderbot) session', async () => {
    client.listSessions.mockResolvedValue([
      summary('batch-1', { kind: 'coderbot', status: 'completed' }),
    ]);
    await service.refreshSessions();

    await expect(service.resumeSession('batch-1')).rejects.toThrow(
      /batch coderbot sessions/i
    );
    expect(client.resumeSession).not.toHaveBeenCalled();
    expect(service.getCurrentSession().uid).toBeNull();
  });

  it('pauseSession marks the active session paused in the cache', async () => {
    ws.dispatch('INTERACTIVE_STARTED', {
      pipeline_id: 'p1',
      bot_type: 'interactive',
      session_uid: 'u1',
    });
    await service.pauseSession();
    expect(client.pauseSession).toHaveBeenCalledWith('u1');
    expect(service.getSession('u1')?.status).toBe('paused');
  });

  it('discardSession calls the client and marks the record discarded', async () => {
    client.listSessions.mockResolvedValue([summary('u1', { status: 'paused' })]);
    await service.refreshSessions({ kind: 'interactive' });
    await service.discardSession('u1');
    expect(client.discardSession).toHaveBeenCalledWith('u1');
    expect(service.getSession('u1')?.status).toBe('discarded');
  });

  it('renameSession updates the label from the server response', async () => {
    client.listSessions.mockResolvedValue([summary('u1', { label: 'old' })]);
    await service.refreshSessions({ kind: 'interactive' });
    await service.renameSession('u1', 'new');
    expect(client.updateSessionLabel).toHaveBeenCalledWith('u1', 'new');
    expect(service.getSession('u1')?.label).toBe('new');
  });

  it('updateSessionModel persists the model and updates the cache', async () => {
    client.listSessions.mockResolvedValue([summary('u1', { model: 'old-model' })]);
    await service.refreshSessions({ kind: 'interactive' });
    await service.updateSessionModel('u1', 'new-model');
    expect(client.updateSessionModel).toHaveBeenCalledWith('u1', 'new-model');
    expect(service.getSession('u1')?.model).toBe('new-model');
  });

  it('onSessionsChange fires on start and stop', () => {
    const listener = vi.fn();
    service.onSessionsChange(listener);
    ws.dispatch('INTERACTIVE_STARTED', {
      pipeline_id: 'p1',
      bot_type: 'interactive',
      session_uid: 'u1',
    });
    expect(listener).toHaveBeenCalled();
    listener.mockClear();
    ws.dispatch('INTERACTIVE_STOPPED', {
      pipeline_id: 'p1',
      bot_type: 'interactive',
      session_uid: 'u1',
    });
    expect(listener).toHaveBeenCalled();
  });

  it('CODERBOT_COMPLETED upserts a completed batch session and notifies', async () => {
    const listener = vi.fn();
    service.onSessionsChange(listener);

    ws.dispatch('CODERBOT_COMPLETED', {
      pipeline_id: 'p1',
      task_id: 't1',
      session_uid: 'batch-1',
    });

    const record = service.getSession('batch-1');
    expect(record?.status).toBe('completed');
    expect(record?.kind).toBe('coderbot');
    expect(record?.pipeline_id).toBe('p1');
    expect(record?.task_id).toBe('t1');
    expect(listener).toHaveBeenCalled();

    // Let the best-effort reconcile settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it('CODERBOT_COMPLETED reconciles with pipelineId and without a kind filter', async () => {
    ws.dispatch('CODERBOT_COMPLETED', {
      pipeline_id: 'p1',
      task_id: 't1',
      session_uid: 'batch-1',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(client.listSessions).toHaveBeenCalledWith({ pipelineId: 'p1' });
  });

  it('CODERBOT_STARTED upserts a running batch session for cache completeness', () => {
    ws.dispatch('CODERBOT_STARTED', {
      pipeline_id: 'p1',
      task_id: 't1',
      session_uid: 'batch-2',
    });
    const record = service.getSession('batch-2');
    expect(record?.status).toBe('running');
    expect(record?.kind).toBe('coderbot');
    expect(record?.pipeline_id).toBe('p1');
  });

  it('CODERBOT_COMPLETED without a session_uid is a no-op', () => {
    const listener = vi.fn();
    service.onSessionsChange(listener);
    listener.mockClear();

    ws.dispatch('CODERBOT_COMPLETED', { pipeline_id: 'p1', task_id: 't1' });

    expect(listener).not.toHaveBeenCalled();
    expect(service.getSessions()).toHaveLength(0);
    expect(client.listSessions).not.toHaveBeenCalled();
  });

  it('a late INTERACTIVE_STARTED for a resumed session does not clear replayed history', async () => {
    client.getSessionEvents.mockResolvedValue([
      {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'replayed' },
      },
    ]);
    await service.resumeSession('u2');
    expect(texts(service.getHistory())[0].text).toBe('replayed');

    // Late duplicate STARTED after the replay completed.
    ws.dispatch('INTERACTIVE_STARTED', {
      pipeline_id: 'p1',
      bot_type: 'interactive',
      session_uid: 'u2',
    });
    expect(texts(service.getHistory())).toHaveLength(1);
    expect(texts(service.getHistory())[0].text).toBe('replayed');
  });

  it('initialize adopts a running session without auto-resuming', async () => {
    client.getInteractiveSession.mockResolvedValue({
      pipeline_id: 'p1',
      is_active: true,
      start_time: null,
      busy: false,
      uid: 'u9',
    });
    client.listSessions.mockResolvedValue([summary('u9', { status: 'running' })]);
    await service.initialize();
    expect(client.resumeSession).not.toHaveBeenCalled();
    expect(service.getCurrentSession().uid).toBe('u9');
    expect(service.getSession('u9')?.status).toBe('running');
  });
});
