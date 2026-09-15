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

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

  it('preserves the executed command on a finished tool block', () => {
    rpcEvent(ws, {
      type: 'tool_execution_start',
      toolCallId: 'c1',
      toolName: 'bash',
      args: { command: 'ls -la' },
    });
    rpcEvent(ws, { type: 'tool_execution_end', toolCallId: 'c1', toolName: 'bash', isError: false, result: { content: [{ type: 'text', text: 'total 48' }] } });

    const tools = history.filter((b) => b.kind === 'tool');
    expect(tools).toHaveLength(1);
    const tool = LAST(tools);
    // Tab text still flips to "bash finished".
    expect(tool.header).toContain('bash finished');
    // The executed command is preserved on the block.
    expect(tool.command).toBe('ls -la');
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

  it('renders a passing CODERBOT_VERIFICATION block', () => {
    ws.dispatch('CODERBOT_VERIFICATION', {
      task_id: 't1',
      pipeline_id: 'p1',
      bot_type: 'coderbot',
      result: {
        passed: true,
        commands: [{ cmd: 'cd backend && uv run pytest', exit_code: 0, output_tail: '' }],
      },
    });
    const verif = history.filter((b) => b.kind === 'verification');
    expect(verif).toHaveLength(1);
    expect(LAST(verif).text).toContain('PASSED');
    expect(LAST(verif).error).toBeFalsy();
  });

  it('renders a failing CODERBOT_VERIFICATION block with output tail', () => {
    ws.dispatch('CODERBOT_VERIFICATION', {
      task_id: 't1',
      pipeline_id: 'p1',
      bot_type: 'coderbot',
      result: {
        passed: false,
        commands: [
          { cmd: 'cd backend && uv run pytest', exit_code: 1, output_tail: 'FAILURES!' },
        ],
      },
    });
    const verif = history.filter((b) => b.kind === 'verification');
    expect(verif).toHaveLength(1);
    expect(LAST(verif).text).toContain('FAILED');
    expect(LAST(verif).error).toBe(true);
    expect(LAST(verif).sub?.join('\n')).toContain('exit code 1');
    expect(LAST(verif).sub?.join('\n')).toContain('FAILURES!');
  });

  it('ignores CODERBOT_VERIFICATION for non-coderbot bot types', () => {
    ws.dispatch('CODERBOT_VERIFICATION', {
      task_id: 't1',
      pipeline_id: 'p1',
      bot_type: 'docbot',
      result: { passed: true, commands: [] },
    });
    expect(history.filter((b) => b.kind === 'verification')).toHaveLength(0);
  });

  it('renders a notice when CODERBOT_VERIFICATION_STARTED is received', () => {
    ws.dispatch('CODERBOT_VERIFICATION_STARTED', {
      task_id: 't1',
      pipeline_id: 'p1',
      bot_type: 'coderbot',
    });
    const notices = history.filter(
      (b) => b.kind === 'notice' && /verification/i.test(b.text),
    );
    expect(notices).toHaveLength(1);
    expect(notices[0].text).toContain('running');
  });

  it('ignores CODERBOT_VERIFICATION_STARTED for non-coderbot bot types', () => {
    ws.dispatch('CODERBOT_VERIFICATION_STARTED', {
      task_id: 't1',
      pipeline_id: 'p1',
      bot_type: 'docbot',
    });
    const notices = history.filter(
      (b) => b.kind === 'notice' && /verification/i.test(b.text),
    );
    expect(notices).toHaveLength(0);
  });
});

describe('CoderBotService session tracking / reconnect', () => {
  let ws: FakeWS;
  let service: CoderBotService;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    ({ service, ws } = makeService());
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          events: [
            { type: 'agent_start' },
            { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'hello' } },
          ],
        }),
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('tracks task/pipeline and persists the session on CODERBOT_STARTED', () => {
    expect(service.getCurrentSession()).toBeNull();
    ws.dispatch('CODERBOT_STARTED', { task_id: 't1', pipeline_id: 'p1' });
    expect(service.getCurrentSession()).toEqual({ pipelineId: 'p1', taskId: 't1', active: true });
    const stored = JSON.parse(localStorage.getItem('ajapopaja:coderbot:session')!);
    expect(stored).toEqual({ pipeline_id: 'p1', task_id: 't1', active: true });
  });

  it('reconnect replays history once and dedupes on repeat', async () => {
    ws.dispatch('CODERBOT_STARTED', { task_id: 't1', pipeline_id: 'p1' });

    await service.reconnect({ pipelineId: 'p1', taskId: 't1', active: true });
    const texts = () => service.getHistory().filter((b) => b.kind === 'text');
    expect(texts()).toHaveLength(1);
    expect(LAST(texts()).text).toBe('hello');

    // A subsequent reconnect for the same session must not replay duplicates.
    await service.reconnect({ pipelineId: 'p1', taskId: 't1', active: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(texts()).toHaveLength(1);
  });

  it('restores a persisted session on construction', () => {
    localStorage.setItem('ajapopaja:coderbot:session', JSON.stringify({ pipeline_id: 'p9', task_id: 't9', active: false }));
    const s = makeService();
    expect(s.service.getCurrentSession()).toEqual({ pipelineId: 'p9', taskId: 't9', active: false });
  });

  it('reconnect storms share a single history fetch', async () => {
    ws.dispatch('CODERBOT_STARTED', { task_id: 't1', pipeline_id: 'p1' });
    const a = service.reconnect({ pipelineId: 'p1', taskId: 't1', active: true });
    const b = service.reconnect({ pipelineId: 'p1', taskId: 't1', active: true });
    const c = service.reconnect({ pipelineId: 'p1', taskId: 't1', active: true });
    await Promise.all([a, b, c]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not notify session state listeners when active is unchanged', () => {
    const spy = vi.fn();
    service.onSessionStateChange(spy);
    ws.dispatch('CODERBOT_STARTED', { task_id: 't1', pipeline_id: 'p1' });
    expect(spy).toHaveBeenCalledTimes(1);
    // A second STARTED with the same task must not re-notify (avoids a reconnect loop).
    ws.dispatch('CODERBOT_STARTED', { task_id: 't1', pipeline_id: 'p1' });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('notifies session-change listeners on STARTED even when active is already true', () => {
    const spy = vi.fn();
    service.onSessionChange(spy);
    ws.dispatch('CODERBOT_STARTED', { task_id: 't0', pipeline_id: 'p0' });
    ws.dispatch('CODERBOT_STARTED', { task_id: 't1', pipeline_id: 'p1' });
    // A new session must still notify session-change listeners so the view can
    // mount the PiView even though the active value did not change.
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
