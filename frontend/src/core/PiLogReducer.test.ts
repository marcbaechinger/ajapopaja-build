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

import { describe, it, expect, vi } from 'vitest';
import { PiLogReducer } from './PiLogReducer.ts';
import type { RenderBlock } from './PiLogReducer.ts';

const LAST = (arr: RenderBlock[]) => arr[arr.length - 1];

describe('PiLogReducer', () => {
  it('streams text deltas into a single text block', () => {
    const reducer = new PiLogReducer();
    reducer.handleEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Hello ' },
    });
    reducer.handleEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'world' },
    });

    const texts = reducer.getBlocks().filter((b) => b.kind === 'text');
    expect(texts).toHaveLength(1);
    expect(LAST(texts).text).toBe('Hello world');
  });

  it('starts a new text block after message_start/message_end', () => {
    const reducer = new PiLogReducer();
    reducer.handleEvent({ type: 'message_start' });
    reducer.handleEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'first' },
    });
    reducer.handleEvent({ type: 'message_end' });
    reducer.handleEvent({ type: 'message_start' });
    reducer.handleEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'second' },
    });

    const texts = reducer.getBlocks().filter((b) => b.kind === 'text');
    expect(texts).toHaveLength(2);
    expect(texts[0].text).toBe('first');
    expect(texts[1].text).toBe('second');
  });

  it('reduces tool execution events into a tool block with the command preserved', () => {
    const reducer = new PiLogReducer();
    reducer.handleEvent({
      type: 'tool_execution_start',
      toolCallId: 'c1',
      toolName: 'bash',
      args: { command: 'ls -la' },
    });
    reducer.handleEvent({
      type: 'tool_execution_end',
      toolCallId: 'c1',
      toolName: 'bash',
      isError: false,
      result: { content: [{ type: 'text', text: 'total 48' }] },
    });

    const tools = reducer.getBlocks().filter((b) => b.kind === 'tool');
    expect(tools).toHaveLength(1);
    expect(LAST(tools).header).toContain('bash finished');
    expect(LAST(tools).command).toBe('ls -la');
  });

  it('notifies listeners with a snapshot on each update', () => {
    const reducer = new PiLogReducer();
    const listener = vi.fn();
    reducer.onBlocks(listener);
    reducer.handleEvent({ type: 'agent_start' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0]).toHaveLength(1);
  });

  it('clear resets the log and notifies listeners', () => {
    const reducer = new PiLogReducer();
    reducer.handleEvent({ type: 'agent_start' });
    const listener = vi.fn();
    reducer.onBlocks(listener);
    reducer.clear();
    expect(reducer.getBlocks()).toHaveLength(0);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('suspendEmits coalesces a replay into one consolidated snapshot', () => {
    const reducer = new PiLogReducer();
    const listener = vi.fn();
    reducer.onBlocks(listener);

    const release = reducer.suspendEmits();
    reducer.clear();
    for (let i = 0; i < 50; i++) {
      reducer.handleEvent({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'x' },
      });
    }
    release();

    expect(listener).toHaveBeenCalledTimes(1);
    const texts = (listener.mock.calls[0][0] as RenderBlock[]).filter((b) => b.kind === 'text');
    expect(texts[0].text).toBe('x'.repeat(50));
  });

  it('renders a verification block', () => {
    const reducer = new PiLogReducer();
    reducer.addVerificationBlock({
      passed: false,
      commands: [{ cmd: 'pytest', exit_code: 1, output_tail: 'FAIL', kind: 'test' }],
    });
    const verif = reducer.getBlocks().filter((b) => b.kind === 'verification');
    expect(verif).toHaveLength(1);
    expect(LAST(verif).text).toContain('FAILED');
    expect(LAST(verif).error).toBe(true);
    const sub = (LAST(verif).sub ?? []).join('\n');
    expect(sub).toContain('test verification:');
    expect(sub).toContain('FAIL');
  });

  it('groups verification commands by category', () => {
    const reducer = new PiLogReducer();
    reducer.addVerificationBlock({
      passed: false,
      commands: [
        { cmd: 'make build', exit_code: 1, output_tail: 'build fail', kind: 'build' },
        { cmd: 'make lint', exit_code: 0, kind: 'lint' },
        { cmd: 'make test', exit_code: 1, output_tail: 'test fail', kind: 'test' },
      ],
    });
    const verif = reducer.getBlocks().filter((b) => b.kind === 'verification');
    expect(verif).toHaveLength(1);
    const sub = (LAST(verif).sub ?? []).join('\n');
    // One block with the existing headline + error tint...
    expect(LAST(verif).text).toContain('FAILED');
    expect(LAST(verif).error).toBe(true);
    // ...whose body groups the commands by category and keeps failed tails.
    expect(sub).toContain('build verification:');
    expect(sub).toContain('lint verification:');
    expect(sub).toContain('test verification:');
    expect(sub).toContain('make build');
    expect(sub).toContain('make lint');
    expect(sub).toContain('make test');
    expect(sub).toContain('build fail');
    expect(sub).toContain('test fail');
  });

  it('renders a single-category block with its category header', () => {
    const reducer = new PiLogReducer();
    reducer.addVerificationBlock({
      passed: true,
      commands: [{ cmd: 'pytest', exit_code: 0, kind: 'test' }],
    });
    const verif = reducer.getBlocks().filter((b) => b.kind === 'verification');
    const sub = (LAST(verif).sub ?? []).join('\n');
    expect(sub).toBe('test verification:\n- pytest  → exit code 0');
  });

  it('renders command, category and total durations in a verification block', () => {
    const reducer = new PiLogReducer();
    reducer.addVerificationBlock({
      passed: true,
      duration_ms: 3500,
      durations: { build: 1000, test: 2500 },
      commands: [
        { cmd: 'make build', exit_code: 0, kind: 'build', duration_ms: 1000 },
        { cmd: 'make test', exit_code: 0, kind: 'test', duration_ms: 2500 },
      ],
    });
    const verif = reducer.getBlocks().filter((b) => b.kind === 'verification');
    expect(verif).toHaveLength(1);
    // Total duration appears in the headline...
    expect(LAST(verif).text).toContain('PASSED');
    expect(LAST(verif).text).toContain('3s');
    // ...and per-command/per-category durations appear in the body.
    const sub = (LAST(verif).sub ?? []).join('\n');
    expect(sub).toContain('build verification (1s):');
    expect(sub).toContain('test verification (2s):');
    expect(sub).toContain('make build  → exit code 0 (1s)');
    expect(sub).toContain('make test  → exit code 0 (2s)');
  });

  it('falls back to summing command durations when no aggregate is given', () => {
    const reducer = new PiLogReducer();
    reducer.addVerificationBlock({
      passed: true,
      commands: [
        { cmd: 'make build', exit_code: 0, kind: 'build', duration_ms: 1000 },
        { cmd: 'make test', exit_code: 0, kind: 'test', duration_ms: 2000 },
      ],
    });
    const verif = reducer.getBlocks().filter((b) => b.kind === 'verification');
    expect(LAST(verif).text).toContain('3s');
  });

  it('marks a streamed block complete on message_end and emits once per boundary', () => {
    const reducer = new PiLogReducer();
    reducer.handleEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'hi' },
    });
    expect(LAST(reducer.getBlocks()).complete).toBeFalsy();

    const listener = vi.fn();
    reducer.onBlocks(listener);

    // Closing the text buffer flips `complete` and emits exactly once.
    reducer.handleEvent({ type: 'message_end' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(LAST(reducer.getBlocks()).complete).toBe(true);

    // A following boundary with no open streaming block must not emit again.
    reducer.handleEvent({ type: 'message_start' });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(LAST(reducer.getBlocks()).complete).toBe(true);
  });

  it('marks thinking blocks complete when their stream closes', () => {
    const reducer = new PiLogReducer();
    reducer.handleEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: 'hmm' },
    });
    expect(LAST(reducer.getBlocks()).complete).toBeFalsy();
    reducer.handleEvent({ type: 'message_end' });
    expect(LAST(reducer.getBlocks()).complete).toBe(true);
  });

  it('defers the completion emit while emits are suspended', () => {
    const reducer = new PiLogReducer();
    reducer.handleEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'x' },
    });
    const listener = vi.fn();
    reducer.onBlocks(listener);

    const release = reducer.suspendEmits();
    reducer.handleEvent({ type: 'message_end' });
    // Suspended: no notification yet, but the flag is already applied.
    expect(listener).not.toHaveBeenCalled();
    expect(LAST(reducer.getBlocks()).complete).toBe(true);

    release();
    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0][0] as RenderBlock[])[0].complete).toBe(true);
  });
});
