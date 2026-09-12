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

import { describe, it, expect, beforeEach } from 'vitest';
import { CoderBotService } from './CoderBotService.ts';
import type { RenderBlock } from './CoderBotService.ts';
import { WebSocketClient } from './WebSocketClient.ts';
import { AuthService } from './AuthService.ts';

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
    this.handlers.get('*')?.forEach((h) => h({ type, payload }));
  }
}

const auth = { getAccessToken: () => 'token' } as unknown as AuthService;

function makeService(): { service: CoderBotService; ws: FakeWS } {
  const ws = new FakeWS();
  const service = new CoderBotService(ws as unknown as WebSocketClient, auth);
  return { service, ws };
}

function rpcEvent(ws: FakeWS, event: any) {
  ws.dispatch('CODERBOT_RPC_EVENT', {
    task_id: 't1',
    pipeline_id: 'p1',
    bot_type: 'coderbot',
    event,
  });
}

function textBlocks(blocks: RenderBlock[]) {
  return blocks.filter((b) => b.kind === 'text');
}

const LAST = (arr: RenderBlock[]) => arr[arr.length - 1];

describe('CoderBotService RPC stream', () => {
  let ws: FakeWS;
  let service: CoderBotService;
  let history: RenderBlock[];

  beforeEach(() => {
    ({ service, ws } = makeService());
    history = service.getHistory();
    service.onBlocks((b) => (history = b));
  });

  it('streams text_delta into a single streaming text block', () => {
    rpcEvent(ws, { type: 'message_update', assistantMessageEvent: { type: 'text_start', contentIndex: 0 } });
    rpcEvent(ws, { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Hello ' } });
    rpcEvent(ws, { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'world' } });

    const texts = textBlocks(history);
    expect(texts).toHaveLength(1);
    expect(LAST(texts).text).toBe('Hello world');
  });

  it('streams thinking_delta separately and dimly', () => {
    rpcEvent(ws, { type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: 'hmm ' } });
    rpcEvent(ws, { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'answer' } });

    const thinking = history.filter((b) => b.kind === 'thinking');
    const texts = textBlocks(history);
    expect(thinking).toHaveLength(1);
    expect(LAST(thinking).text).toBe('hmm ');
    expect(LAST(texts).text).toBe('answer');
  });

  it('starts a new text block after message_start (contentIndex reset)', () => {
    rpcEvent(ws, { type: 'message_start' });
    rpcEvent(ws, { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'first' } });
    rpcEvent(ws, { type: 'message_end' });
    rpcEvent(ws, { type: 'message_start' });
    rpcEvent(ws, { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'second' } });

    const texts = textBlocks(history);
    expect(texts).toHaveLength(2);
    expect(texts[0].text).toBe('first');
    expect(texts[1].text).toBe('second');
  });

  it('builds a tool block from toolcall_start/delta/end', () => {
    rpcEvent(ws, { type: 'message_update', assistantMessageEvent: { type: 'toolcall_start', contentIndex: 1, id: 'call_1', toolName: 'write' } });
    rpcEvent(ws, { type: 'message_update', assistantMessageEvent: { type: 'toolcall_delta', contentIndex: 1, id: 'call_1', delta: '{"path":"a.ts"}' } });
    rpcEvent(ws, { type: 'message_update', assistantMessageEvent: { type: 'toolcall_end', contentIndex: 1, id: 'call_1', toolCall: { name: 'write' } } });

    const tools = history.filter((b) => b.kind === 'tool');
    expect(tools).toHaveLength(1);
    expect(LAST(tools).header).toContain('write');
    expect(LAST(tools).text).toContain('path');
  });

  it('groups bash output into a bash block', () => {
    rpcEvent(ws, { type: 'bash_execution_update', id: 'req-1', delta: 'total 48\n' });
    rpcEvent(ws, { type: 'bash_execution_update', id: 'req-1', delta: 'drwxr-xr-x\n' });

    const bash = history.filter((b) => b.kind === 'bash');
    expect(bash).toHaveLength(1);
    expect(LAST(bash).text).toBe('total 48\ndrwxr-xr-x\n');
  });

  it('renders agent lifecycle and retry notices', () => {
    rpcEvent(ws, { type: 'agent_start' });
    rpcEvent(ws, { type: 'agent_end', willRetry: true });
    rpcEvent(ws, { type: 'auto_retry_start', attempt: 1, maxAttempts: 3 });
    rpcEvent(ws, { type: 'auto_retry_end', success: false, attempt: 3, finalError: '529 overloaded' });

    const notices = history.filter((b) => b.kind === 'notice');
    expect(notices.some((b) => b.text?.includes('Agent run completed'))).toBe(true);
    expect(notices.some((b) => b.text?.includes('Auto-retry failed'))).toBe(true);
    expect(notices.some((b) => b.text?.includes('529 overloaded'))).toBe(true);
  });

  it('marks extension_error as an error block', () => {
    rpcEvent(ws, { type: 'extension_error', extensionPath: '/ext.ts', event: 'tool_call', error: 'boom' });
    const errors = history.filter((b) => b.kind === 'error');
    expect(errors).toHaveLength(1);
    expect(LAST(errors).text).toContain('boom');
  });

  it('renders compaction and queue notices', () => {
    rpcEvent(ws, { type: 'compaction_start', reason: 'threshold' });
    rpcEvent(ws, { type: 'queue_update', steering: ['Focus'], followUp: ['Summarize'] });

    const notices = history.filter((b) => b.kind === 'notice');
    expect(notices.some((b) => b.text?.includes('Compacting'))).toBe(true);
    expect(notices.some((b) => b.text?.includes('Focus'))).toBe(true);
  });

  it('clearHistory resets blocks and notifies listeners', () => {
    rpcEvent(ws, { type: 'agent_start' });
    expect(history.length).toBeGreaterThan(0);
    service.clearHistory();
    expect(history).toHaveLength(0);
  });

  it('calls clearHistory when CODERBOT_STARTED begins a new task', () => {
    rpcEvent(ws, { type: 'agent_start' });
    ws.dispatch('CODERBOT_STARTED', { task_id: 'new-task' });
    expect(service.getCurrentTaskId()).toBe('new-task');
    expect(service.getHistory()).toHaveLength(0);
  });

  it('ignores ASSISTANT_STREAM for coderbot and handles it for other bots', () => {
    ws.dispatch('ASSISTANT_STREAM', { bot_type: 'coderbot', content: 'should be dropped' });
    expect(service.getRawHistory()).toBe('');

    ws.dispatch('ASSISTANT_STREAM', { bot_type: 'docbot', content: 'doc text' });
    expect(service.getRawHistory()).toBe('doc text');
  });
});
