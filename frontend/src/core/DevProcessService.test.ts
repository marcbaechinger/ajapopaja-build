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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DevProcessService } from './DevProcessService.ts';
import type { DevProcessEvent } from './DevProcessService.ts';
import type { WSMessage } from './domain.ts';

type Handler = (message: WSMessage) => void;

function makeWsClient() {
  const handlers = new Map<string, Set<Handler>>();
  return {
    send: vi.fn(),
    on: vi.fn((type: string, handler: Handler) => {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type)!.add(handler);
      return () => handlers.get(type)!.delete(handler);
    }),
    emit(type: string, payload: any) {
      handlers.get(type)?.forEach((h) => h({ type, payload }));
    },
    handlerCount(type: string) {
      return handlers.get(type)?.size ?? 0;
    },
  };
}

describe('DevProcessService', () => {
  let ws: ReturnType<typeof makeWsClient>;
  let service: DevProcessService;
  let events: DevProcessEvent[];

  beforeEach(() => {
    ws = makeWsClient();
    service = new DevProcessService(ws as any);
    events = [];
  });

  it('sends subscribe and unsubscribe messages', () => {
    const off = service.subscribe('p1', 'r1', (e) => events.push(e));

    expect(ws.send).toHaveBeenCalledWith('dev_process_logs_subscribe', {
      pipeline_id: 'p1',
      run_id: 'r1',
    });

    off();

    expect(ws.send).toHaveBeenCalledWith('dev_process_logs_unsubscribe', {
      pipeline_id: 'p1',
      run_id: 'r1',
    });
  });

  it('dispatches typed events with the pipeline context', () => {
    service.subscribe('p1', 'r1', (e) => events.push(e));

    ws.emit('DEV_PROCESS_STATUS', {
      pipeline_id: 'p1',
      run_id: 'r1',
      pid: 5,
      status: 'running',
    });
    ws.emit('DEV_PROCESS_LOG', {
      pipeline_id: 'p1',
      run_id: 'r1',
      seq: 0,
      stream: 'stdout',
      text: 'hello',
    });
    ws.emit('DEV_PROCESS_STREAM_END', {
      pipeline_id: 'p1',
      run_id: 'r1',
      exit_code: 0,
    });

    expect(events.map((e) => e.type)).toEqual(['status', 'chunk', 'exit']);
    expect(events[0].pid).toBe(5);
    expect(events[1].text).toBe('hello');
    expect(events[2].exit_code).toBe(0);
  });

  it('filters out events from another pipeline or run', () => {
    service.subscribe('p1', 'r1', (e) => events.push(e));

    ws.emit('DEV_PROCESS_LOG', { pipeline_id: 'other', run_id: 'r1', text: 'x' });
    ws.emit('DEV_PROCESS_LOG', { pipeline_id: 'p1', run_id: 'other', text: 'y' });

    expect(events).toEqual([]);
  });

  it('accepts any run when runId is null', () => {
    service.subscribe('p1', null, (e) => events.push(e));

    ws.emit('DEV_PROCESS_LOG', { pipeline_id: 'p1', run_id: 'whatever', text: 'z' });

    expect(events).toHaveLength(1);
    expect(events[0].text).toBe('z');
  });

  it('unregisters its handlers on unsubscribe', () => {
    const off = service.subscribe('p1', 'r1', (e) => events.push(e));
    expect(ws.handlerCount('DEV_PROCESS_LOG')).toBe(1);

    off();

    expect(ws.handlerCount('DEV_PROCESS_LOG')).toBe(0);
    ws.emit('DEV_PROCESS_LOG', { pipeline_id: 'p1', run_id: 'r1', text: 'late' });
    expect(events).toEqual([]);
  });
});
