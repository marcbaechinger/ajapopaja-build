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
import { marked } from 'marked';
import { PiView, type PiSessionService } from './PiView.ts';
import type { RenderBlock } from '../../core/CoderBotService.ts';
// Raw CSS source, used by the vertical-rhythm guard tests below. jsdom has no
// layout engine and the app stylesheet is not loaded in the test environment,
// so the declared gap values are asserted against the source instead.
import styleCss from '../../style.css?raw';

// PiView coalesces block reconciliations onto the next animation frame. Tests
// drive that frame manually via flushRaf() so DOM assertions stay synchronous.
let rafCallbacks: Map<number, FrameRequestCallback>;
let rafNextId: number;

function flushRaf() {
  // Move the callbacks out before running them so a callback that schedules
  // another frame is handled on the next flush rather than looping forever.
  const pending = Array.from(rafCallbacks.values());
  rafCallbacks.clear();
  for (const cb of pending) cb(0);
}

// Installed for every test in this file (both describes).
beforeEach(() => {
  rafCallbacks = new Map();
  rafNextId = 0;
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
    const id = ++rafNextId;
    rafCallbacks.set(id, cb);
    return id;
  });
  vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id: number) => {
    rafCallbacks.delete(id);
  });
});

function createStubService(overrides: Partial<PiSessionService> = {}) {
  const listeners: {
    blocks: Set<(blocks: RenderBlock[]) => void>;
    message: Set<(content: string) => void>;
    state: Set<(active: boolean) => void>;
  } = {
    blocks: new Set(),
    message: new Set(),
    state: new Set(),
  };

  const emitBlocks = (blocks: RenderBlock[]) => {
    listeners.blocks.forEach((l) => l(blocks));
    // Reconciles are scheduled on the next animation frame; flush it so the
    // caller observes the resulting DOM synchronously.
    flushRaf();
  };

  const service: PiSessionService = {
    getHistory: vi.fn(() => []),
    getCurrentTaskId: vi.fn(() => null),
    isActive: vi.fn(() => false),
    getSessionStartTime: vi.fn(() => null),
    onSessionStartTimeChange: vi.fn(() => () => { }),
    clearHistory: vi.fn(),
    stopSession: vi.fn(async () => { }),
    onBlocks: vi.fn((l) => {
      listeners.blocks.add(l);
      return () => listeners.blocks.delete(l);
    }),
    onMessage: vi.fn((l) => {
      listeners.message.add(l);
      return () => listeners.message.delete(l);
    }),
    onSessionStateChange: vi.fn((l) => {
      listeners.state.add(l);
      return () => listeners.state.delete(l);
    }),
    ...overrides,
  };

  return { service, listeners, emitBlocks };
}

describe('PiView', () => {
  let mount: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders log container + footer into mount', () => {
    const { service } = createStubService();
    const view = new PiView(service, mount);
    view.render();

    const logContainer = mount.querySelector('#log-content-container');
    const blocksContainer = mount.querySelector('#log-blocks');
    const followBtn = mount.querySelector('#follow-btn');
    const stopBtn = mount.querySelector('#stop-bot-btn');

    expect(logContainer).not.toBeNull();
    expect(logContainer?.classList.contains('bg-black')).toBe(true);
    expect(blocksContainer).not.toBeNull();
    expect(followBtn).not.toBeNull();
    expect(stopBtn).not.toBeNull();
  });

  it('uses the default h-[60vh] log height and honors logHeightClass', () => {
    const { service } = createStubService();

    const defaultMount = document.createElement('div');
    const defaultView = new PiView(service, defaultMount);
    defaultView.render();
    expect(defaultMount.querySelector('#log-content-container')?.className).toContain('h-[60vh]');
    defaultView.destroy();

    const compactMount = document.createElement('div');
    const view = new PiView(service, compactMount, { logHeightClass: 'h-[38vh]' });
    view.render();
    expect(compactMount.querySelector('#log-content-container')?.className).toContain('h-[38vh]');
  });

  it('keeps the log a fixed height by default and supports vertical resize when enabled', () => {
    const { service } = createStubService();

    const defaultMount = document.createElement('div');
    const defaultView = new PiView(service, defaultMount);
    defaultView.render();
    const defaultLog = defaultMount.querySelector('#log-content-container') as HTMLElement;
    expect(defaultLog.className).not.toContain('resize-y');
    defaultView.destroy();

    const resizeMount = document.createElement('div');
    const resizeView = new PiView(service, resizeMount, {
      logHeightClass: 'h-[69vh]',
      resizable: true,
    });
    resizeView.render();
    const resizeLog = resizeMount.querySelector('#log-content-container') as HTMLElement;
    // The fixed height still applies until the user drags the handle…
    expect(resizeLog.className).toContain('h-[69vh]');
    // …and `resize-y` restricts the drag to the height (never the width).
    expect(resizeLog.className).toContain('resize-y');
    expect(resizeLog.className).not.toContain('resize-x');
    expect(resizeLog.className).not.toContain('resize ');
  });

  it('separates adjacent log sections by about one line height', () => {
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();

    const blocksContainer = mount.querySelector('#log-blocks') as HTMLElement;
    // Log body is `text-[11px] leading-tight` (~14px per line), so `space-y-3.5`
    // (0.875rem = 14px) leaves roughly one blank line between sections.
    expect(blocksContainer.classList.contains('space-y-3.5')).toBe(true);

    emitBlocks([
      { id: 'think', kind: 'thinking', text: 'hmm' },
      { id: 'tool', kind: 'tool', header: '→ run', text: 'out' },
      { id: 'text', kind: 'text', text: 'answer' },
    ]);

    // Inter-block spacing is owned by the container; no individual block may
    // reintroduce a small external `my-*` that would override `space-y-*`.
    mount.querySelectorAll('#log-blocks > [data-block-id]').forEach((el) => {
      const cls = (el as HTMLElement).className;
      expect(cls).not.toMatch(/\bmy-0\.5\b/);
      expect(cls).not.toMatch(/\bmy-1\b/);
    });
  });

  it('reconciles a block list: new blocks appended, removed blocks detached', () => {
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();

    const blockA: RenderBlock = { id: 'a', kind: 'text', text: 'hello' };
    const blockB: RenderBlock = { id: 'b', kind: 'text', text: 'world' };
    emitBlocks([blockA, blockB]);

    const blocks = mount.querySelectorAll('#log-blocks > div');
    expect(blocks.length).toBe(2);
    expect(blocks[0].textContent).toContain('hello');
    expect(blocks[1].textContent).toContain('world');

    // Drop blockB
    emitBlocks([blockA]);
    const blocksAfter = mount.querySelectorAll('#log-blocks > div');
    expect(blocksAfter.length).toBe(1);
    expect(blocksAfter[0].textContent).toContain('hello');
  });

  it('coalesces multiple block snapshots into a single reconciliation per frame', () => {
    const { service, listeners } = createStubService();
    const view = new PiView(service, mount);
    view.render();

    // Notify directly (bypassing the auto-flushing emitBlocks helper) so several
    // snapshots can land before the frame is driven.
    const notify = (blocks: RenderBlock[]) => listeners.blocks.forEach((l) => l(blocks));
    notify([{ id: 'a', kind: 'text', text: 'one' }]);
    notify([{ id: 'a', kind: 'text', text: 'two' }]);
    notify([{ id: 'a', kind: 'text', text: 'three' }]);

    // Nothing rendered yet: the three snapshots were coalesced into one frame.
    expect(mount.querySelectorAll('#log-blocks > div').length).toBe(0);
    // All three notify() calls scheduled exactly one frame, not three.
    expect(rafCallbacks.size).toBe(1);

    flushRaf();

    const blocks = mount.querySelectorAll('#log-blocks > div');
    expect(blocks.length).toBe(1);
    expect(blocks[0].textContent).toContain('three');
  });

  it('renders every accumulated block when snapshots coalesce', () => {
    const { service, listeners } = createStubService();
    const view = new PiView(service, mount);
    view.render();

    // Three full snapshots that accumulate distinct blocks. Coalescing must keep
    // the final snapshot's complete state, not just the latest single block.
    const notify = (blocks: RenderBlock[]) => listeners.blocks.forEach((l) => l(blocks));
    notify([{ id: 'a', kind: 'text', text: 'one' }]);
    notify([
      { id: 'a', kind: 'text', text: 'one' },
      { id: 'b', kind: 'text', text: 'two' },
    ]);
    notify([
      { id: 'a', kind: 'text', text: 'one' },
      { id: 'b', kind: 'text', text: 'two' },
      { id: 'c', kind: 'text', text: 'three' },
    ]);

    // Coalesced: nothing is rendered until the frame is driven.
    expect(mount.querySelectorAll('#log-blocks > div').length).toBe(0);
    // All three notify() calls scheduled exactly one frame, not three.
    expect(rafCallbacks.size).toBe(1);

    flushRaf();

    const blocks = Array.from(mount.querySelectorAll<HTMLElement>('#log-blocks > div'));
    expect(blocks.length).toBe(3);
    expect(blocks.map((b) => b.textContent?.trim())).toEqual(['one', 'two', 'three']);

    // Every coalesced block must have been fully badged, not just the last one:
    // each carries its block id and its per-block copy + "Format as markup" badges.
    expect(blocks.map((b) => b.getAttribute('data-block-id'))).toEqual(['a', 'b', 'c']);
    expect(mount.querySelectorAll('#log-blocks .piview-copy').length).toBe(3);
    expect(mount.querySelectorAll('#log-blocks .piview-format').length).toBe(3);
    blocks.forEach((block) => {
      expect(block.getAttribute('data-block-id')).not.toBeNull();
      expect(block.querySelector('.piview-copy')).not.toBeNull();
      expect(block.querySelector('.piview-format')).not.toBeNull();
    });
  });

  it('renders each RenderBlock kind with expected DOM', () => {
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();

    const blocks: RenderBlock[] = [
      { id: 'tool', kind: 'tool', header: '→ Calling write', text: 'const x = 1' },
      { id: 'bash', kind: 'bash', text: '$ cmd' },
      { id: 'think', kind: 'thinking', text: 'hmm' },
      { id: 'notice', kind: 'notice', text: '● started' },
      { id: 'err', kind: 'error', text: 'boom' },
      { id: 'verify-ok', kind: 'verification', text: '● PASS', sub: ['- cmd  1'] },
      { id: 'divider', kind: 'divider', text: '— turn —' },
      { id: 'text', kind: 'text', text: 'plain' },
    ];
    emitBlocks(blocks);

    const container = mount.querySelector('#log-blocks')!;

    // tool wrapper with header + body
    const tool = container.querySelector('[data-role="header"]')!;
    expect(tool.textContent).toContain('→ Calling write');
    const toolBody = container.querySelector('[data-role="body"]')!;
    expect(toolBody.textContent).toContain('const x = 1');

    // bash is a <pre>
    const bashEls = Array.from(container.querySelectorAll('pre'));
    expect(bashEls.some((p) => p.textContent === '$ cmd')).toBe(true);

    // thinking / notice / error classes
    expect(Array.from(container.querySelectorAll('.italic.opacity-70')).some((el) => el.textContent === 'hmm')).toBe(true);
    expect(Array.from(container.querySelectorAll('.text-app-accent-2')).some((el) => el.textContent === '● started')).toBe(true);
    expect(Array.from(container.querySelectorAll('.text-red-400')).some((el) => el.textContent === 'boom')).toBe(true);

    // verification wrapper w/ error tint on failed variant
    const okVerify = Array.from(container.querySelectorAll('.border-green-500\\/60')).filter((el) => el.textContent?.includes('PASS'));
    expect(okVerify.length).toBeGreaterThan(0);
    const verifyHeader = okVerify[0].querySelector('[data-role="header"]');
    expect(verifyHeader?.textContent).toContain('● PASS');

    // divider
    expect(Array.from(container.querySelectorAll('.text-app-text\\/40')).some((el) => el.textContent === '— turn —')).toBe(true);

    // plain text
    expect(Array.from(container.querySelectorAll('div')).some((el) => el.textContent === 'plain')).toBe(true);
  });

  it('prepends the executed command before the output for a finished tool block', () => {
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();

    // Tool streamed from "running" (command shown) to finished (result arrived).
    // The block preserves the command so it stays visible after completion.
    const running: RenderBlock = {
      id: 'bash1',
      kind: 'tool',
      header: '→ Running bash…',
      text: 'ls -la',
      command: 'ls -la',
    };
    emitBlocks([running]);
    let body = mount.querySelector('[data-role="body"]') as HTMLElement;
    // Running state: body already leads with the command -> no duplication.
    expect(body.textContent).toBe('ls -la');

    const finished: RenderBlock = {
      id: 'bash1',
      kind: 'tool',
      header: '✓ bash finished',
      text: 'total 48\ndrwx------',
      command: 'ls -la',
    };
    emitBlocks([finished]);
    body = mount.querySelector('[data-role="body"]') as HTMLElement;
    // Tab/header still changed to "bash finished".
    expect(mount.querySelector('[data-role="header"]')?.textContent).toContain('bash finished');
    // The command is preserved and prepended before the output.
    expect(body.textContent).toBe('ls -la\n\ntotal 48\ndrwx------');
  });

  it('leaves tool block body unchanged when no command is stored', () => {
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();

    emitBlocks([{ id: 't', kind: 'tool', header: '✓ write finished', text: 'file written' }]);
    const body = mount.querySelector('[data-role="body"]') as HTMLElement;
    expect(body.textContent).toBe('file written');
  });

  it('updateBlockEl updates header/body text on change', () => {
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();

    const block: RenderBlock = { id: 't', kind: 'tool', header: '→ Running…', text: 'delta1' };
    emitBlocks([block]);
    emitBlocks([{ ...block, header: '✓ done', text: 'delta2' }]);

    const header = mount.querySelector('[data-role="header"]')!;
    const body = mount.querySelector('[data-role="body"]')!;
    expect(header.textContent).toContain('✓ done');
    expect(body.textContent).toContain('delta2');
    // Should not have duplicated the element
    expect(mount.querySelectorAll('#log-blocks > div').length).toBe(1);
  });

  it('follow mode toggles ON/OFF and controls scrollTop behavior', () => {
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();

    const log = mount.querySelector('#log-content-container') as HTMLElement;
    let scrollTopValue = 0;
    Object.defineProperty(log, 'scrollTop', {
      configurable: true,
      get: () => scrollTopValue,
      set: (v: number) => { scrollTopValue = v; },
    });
    Object.defineProperty(log, 'scrollHeight', { value: 1000, configurable: true });

    // Follow mode ON by default -> emitting a block scrolls to bottom.
    emitBlocks([{ id: 'a', kind: 'text', text: 'scroll me' }]);
    expect(scrollTopValue).toBeGreaterThan(0);

    // Toggle OFF -> subsequent reconciles should not scroll.
    const followBtn = mount.querySelector('#follow-btn') as HTMLButtonElement;
    followBtn.click();
    expect(followBtn.textContent).toContain('OFF');
    scrollTopValue = 0;
    emitBlocks([{ id: 'a', kind: 'text', text: 'no scroll' }]);
    expect(scrollTopValue).toBe(0);
  });

  it('exposes follow mode via isFollowing()/toggleFollow() for embedding hosts', () => {
    const { service } = createStubService();
    const view = new PiView(service, mount, { showFooter: false });
    view.render();

    // No footer button, but the public API still reflects and toggles the state.
    expect(mount.querySelector('#follow-btn')).toBeNull();
    expect(view.isFollowing()).toBe(true);

    view.toggleFollow();
    expect(view.isFollowing()).toBe(false);

    view.toggleFollow();
    expect(view.isFollowing()).toBe(true);
  });

  it('stop button appears when isActive() true and stopSession called on click; spinner on failure', async () => {
    const failOnce = vi.fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValueOnce({});
    const { service } = createStubService({
      isActive: vi.fn(() => true),
      getCurrentTaskId: vi.fn(() => 'task-1'),
      stopSession: failOnce,
    });
    const view = new PiView(service, mount);
    view.render();

    const stopBtn = mount.querySelector('#stop-bot-btn') as HTMLButtonElement;
    expect(stopBtn.classList.contains('hidden')).toBe(false);

    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => { });
    stopBtn.click();
    await Promise.resolve();
    expect(service.stopSession).toHaveBeenCalledWith('task-1');
    expect(stopBtn.disabled).toBe(false);
    expect(stopBtn.textContent).toContain('Stop Bot');
    expect(alertSpy).toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it('clear button calls clearHistory', () => {
    const { service } = createStubService();
    const view = new PiView(service, mount);
    view.render();

    const clearBtn = Array.from(mount.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Clear')
    )!;
    clearBtn.click();
    expect(service.clearHistory).toHaveBeenCalled();
  });

  it('thinking blocks are expanded by default and toggle button collapses them', () => {
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();

    emitBlocks([{ id: 'think', kind: 'thinking', text: 'hmm' }]);

    const thinkingEl = mount.querySelector('.piview-thinking') as HTMLElement;
    const body = thinkingEl.querySelector('[data-role="body"]') as HTMLElement;
    // Expanded by default.
    expect(body.classList.contains('hidden')).toBe(false);
    // Header still shows a label.
    expect(thinkingEl.querySelector('[data-role="header"]')?.textContent).toContain('Thinking');

    const toggleBtn = mount.querySelector('#thinking-toggle-btn') as HTMLButtonElement;
    expect(toggleBtn.getAttribute('aria-pressed')).toBe('true');
    expect(toggleBtn.getAttribute('aria-label')).toContain('Collapse');

    // Collapse all via the toggle button.
    toggleBtn.click();
    expect(body.classList.contains('hidden')).toBe(true);
    expect(toggleBtn.getAttribute('aria-pressed')).toBe('false');
    expect(toggleBtn.getAttribute('aria-label')).toContain('Expand');

    // New thinking blocks follow the collapsed mode.
    emitBlocks([{ id: 'think', kind: 'thinking', text: 'hmm' }, { id: 'think2', kind: 'thinking', text: 'more' }]);
    const body1 = mount.querySelectorAll('.piview-thinking')[0].querySelector('[data-role="body"]') as HTMLElement;
    const body2 = mount.querySelectorAll('.piview-thinking')[1].querySelector('[data-role="body"]') as HTMLElement;
    expect(body1.classList.contains('hidden')).toBe(true);
    expect(body2.classList.contains('hidden')).toBe(true);

    // Expand again via the toggle.
    toggleBtn.click();
    expect(body2.classList.contains('hidden')).toBe(false);
  });

  it('individual thinking header click toggles that block only', () => {
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();

    emitBlocks([{ id: 't1', kind: 'thinking', text: 'a' }, { id: 't2', kind: 'thinking', text: 'b' }]);

    const t1 = mount.querySelector('.piview-thinking') as HTMLElement;
    const b1 = t1.querySelector('[data-role="body"]') as HTMLElement;
    const b2 = (mount.querySelectorAll('.piview-thinking')[1]).querySelector('[data-role="body"]') as HTMLElement;

    // Both expanded by default.
    expect(b1.classList.contains('hidden')).toBe(false);
    expect(b2.classList.contains('hidden')).toBe(false);

    // Collapse the first block via its header.
    const header = t1.querySelector('[data-role="header"]') as HTMLElement;
    header.click();
    expect(b1.classList.contains('hidden')).toBe(true);
    expect(b2.classList.contains('hidden')).toBe(false);

    // Re-expand via header.
    header.click();
    expect(b1.classList.contains('hidden')).toBe(false);
  });

  it('destroy() unsubscribes from all service listeners', () => {
    const { service } = createStubService();
    const view = new PiView(service, mount);
    view.render();

    view.destroy();

    const onBlocks = service.onBlocks as unknown as ReturnType<typeof vi.fn>;
    const onState = service.onSessionStateChange as unknown as ReturnType<typeof vi.fn>;

    // Each subscription returned a cleanup that we can't spy directly; instead
    // verify the service subscribed once per listener and the view tracked them.
    expect(onBlocks).toHaveBeenCalledTimes(1);
    expect(onState).toHaveBeenCalledTimes(1);
  });

  it('destroy() runs the unsubscribe callbacks returned by the service', () => {
    const unsubBlocks = vi.fn();
    const unsubState = vi.fn();
    const onBlocks = vi.fn(() => unsubBlocks);
    const onSessionStateChange = vi.fn(() => unsubState);

    const { service } = createStubService({
      onBlocks,
      onSessionStateChange,
    });

    const view = new PiView(service, mount);
    view.render();
    view.destroy();

    expect(unsubBlocks).toHaveBeenCalledTimes(1);
    expect(unsubState).toHaveBeenCalledTimes(1);
  });

  it('showFooter: false omits the action bar', () => {
    const { service } = createStubService();
    const view = new PiView(service, mount, { showFooter: false });
    view.render();

    expect(mount.querySelector('#log-content-container')).not.toBeNull();
    expect(mount.querySelector('#follow-btn')).toBeNull();
    expect(mount.querySelector('#stop-bot-btn')).toBeNull();
    expect(mount.querySelector('#log-blocks')).not.toBeNull();
  });

  it('showFooter: false still wires up per-block header, copy and format actions', () => {
    const writeText = vi.fn(async (_text: string) => { });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount, { showFooter: false });
    view.render();

    emitBlocks([
      { id: 'think', kind: 'thinking', text: 'hmm' },
      { id: 'm1', kind: 'text', text: '**bold** and *italic*' },
    ]);

    // Header collapse: the delegated click handler must fire even without a footer.
    const thinkingEl = mount.querySelector('.piview-thinking') as HTMLElement;
    const body = thinkingEl.querySelector('[data-role="body"]') as HTMLElement;
    expect(body.classList.contains('hidden')).toBe(false);
    (thinkingEl.querySelector('[data-role="header"]') as HTMLElement).click();
    expect(body.classList.contains('hidden')).toBe(true);

    // Per-block copy: the delegated click handler must fire even without a footer.
    const blockEl = mount.querySelectorAll<HTMLElement>('#log-blocks > div')[1];
    (blockEl.querySelector('.piview-copy') as HTMLButtonElement).click();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toContain('**bold** and *italic*');

    // Format as markup: the delegated click handler must fire even without a footer.
    (blockEl.querySelector('.piview-format') as HTMLButtonElement).click();
    const formatted = blockEl.querySelector('.piview-formatted') as HTMLElement;
    expect(formatted).not.toBeNull();
    expect(formatted.querySelector('strong')?.textContent).toBe('bold');
    expect(formatted.querySelector('em')?.textContent).toBe('italic');

    view.destroy();
  });

  it('updateStopButtonVisibility hides/shows the stop button via state changes', () => {
    const { service, listeners } = createStubService({ isActive: vi.fn(() => false) });
    const view = new PiView(service, mount);
    view.render();

    const stopBtn = mount.querySelector('#stop-bot-btn') as HTMLButtonElement;
    expect(stopBtn.classList.contains('hidden')).toBe(true);

    // Simulate session becoming active
    listeners.state.forEach((l) => l(true));
    expect(stopBtn.classList.contains('hidden')).toBe(false);

    // And inactive again
    listeners.state.forEach((l) => l(false));
    expect(stopBtn.classList.contains('hidden')).toBe(true);
  });

  it('shows idle status and a non-pulsing dot when the session is inactive', () => {
    const { service } = createStubService();
    const view = new PiView(service, mount);
    view.render();

    const text = mount.querySelector('#piview-status-text') as HTMLElement;
    const dot = mount.querySelector('#piview-status-dot') as HTMLElement;
    expect(text.textContent).toContain('Session idle');
    expect(dot.className).not.toContain('animate-pulse');
  });

  it('shows running status + pulsing dot, persists across log entries, and ends on stop', () => {
    const { service, emitBlocks, listeners } = createStubService();
    const view = new PiView(service, mount);
    view.render();

    // Become active.
    listeners.state.forEach((l) => l(true));
    let text = mount.querySelector('#piview-status-text') as HTMLElement;
    const dot = mount.querySelector('#piview-status-dot') as HTMLElement;
    expect(text.textContent).toContain('Running since');
    expect(dot.className).toContain('animate-pulse');

    // A new log entry does not reset the running status/timer.
    emitBlocks([{ id: 'a', kind: 'text', text: 'x' }]);
    text = mount.querySelector('#piview-status-text') as HTMLElement;
    expect(text.textContent).toContain('Running since');

    // Session ends.
    listeners.state.forEach((l) => l(false));
    text = mount.querySelector('#piview-status-text') as HTMLElement;
    expect(text.textContent).toContain('Session ended');
    expect(dot.className).not.toContain('animate-pulse');

    view.destroy();
  });

  it('elapsed timer updates every second while running', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const { service, listeners } = createStubService();
    const view = new PiView(service, mount);
    view.render();

    listeners.state.forEach((l) => l(true));
    const text = mount.querySelector('#piview-status-text') as HTMLElement;
    expect(text.textContent).toContain('00:00:00');

    vi.advanceTimersByTime(2000);
    expect(text.textContent).toContain('00:00:02');

    view.destroy();
    vi.useRealTimers();
  });

  it('resumes the running timer from the server-reported session start time', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-02-03T04:05:10Z'));
    const startMs = Date.parse('2026-02-03T04:05:00Z'); // 10s before "now".
    const { service } = createStubService({
      isActive: vi.fn(() => true),
      getSessionStartTime: vi.fn(() => startMs),
    });
    const view = new PiView(service, mount);
    view.render();

    const text = mount.querySelector('#piview-status-text') as HTMLElement;
    expect(text.textContent).toContain('00:00:10');

    view.destroy();
    vi.useRealTimers();
  });

  it('adopts the session start time once the server reports it after history loads', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(new Date('2026-02-03T04:05:10Z'));
    const { service } = createStubService({
      isActive: vi.fn(() => true),
      getSessionStartTime: vi.fn(() => null),
    });
    const view = new PiView(service, mount);
    view.render();

    // Before the server start time arrives the timer is anchored at creation time.
    let text = mount.querySelector('#piview-status-text') as HTMLElement;
    expect(text.textContent).toContain('00:00:00');

    // The asynchronous history load reports the real session start (10s ago).
    const startMs = Date.parse('2026-02-03T04:05:00Z');
    const startListeners = (service.onSessionStartTimeChange as any).mock.calls.map(
      (c: any) => c[0]
    );
    startListeners.forEach((l: any) => l(startMs));

    text = mount.querySelector('#piview-status-text') as HTMLElement;
    expect(text.textContent).toContain('00:00:10');

    view.destroy();
    vi.useRealTimers();
  });

  it('adds a copy button to each block that copies block content with a timestamp', () => {
    const writeText = vi.fn(async (_text: string) => { });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();
    emitBlocks([{ id: 't1', kind: 'tool', header: '→ write', text: 'const x = 1' }]);

    const blockEl = mount.querySelector('#log-blocks > div') as HTMLElement;
    const copyBtn = blockEl.querySelector('.piview-copy') as HTMLButtonElement;
    expect(copyBtn).not.toBeNull();
    expect(copyBtn.getAttribute('aria-label')).toBe('Copy block');

    copyBtn.click();
    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain('→ write');
    expect(copied).toContain('const x = 1');
    // Includes a timestamp line.
    expect(copied).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  });

  it('copy-all button and c key copy the whole log', () => {
    const writeText = vi.fn(async (_text: string) => { });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();
    emitBlocks([{ id: 'a', kind: 'text', text: 'first' }, { id: 'b', kind: 'error', text: 'boom' }]);

    const copyAll = mount.querySelector('#copy-all-btn') as HTMLButtonElement;
    copyAll.click();
    expect(writeText).toHaveBeenCalledTimes(1);
    let copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain('first');
    expect(copied).toContain('boom');

    // Keyboard shortcut: focused within the PiView, press 'c'.
    writeText.mockClear();
    const keyEvt = new KeyboardEvent('keydown', { key: 'c', bubbles: true });
    mount.querySelector('#log-content-container')!.dispatchEvent(keyEvt);
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it('shows a transient toast after copying a block', async () => {
    const writeText = vi.fn(async (_text: string) => { });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();
    emitBlocks([{ id: 'a', kind: 'text', text: 'hi' }]);

    (mount.querySelector('#log-blocks .piview-copy') as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    const toast = mount.querySelector('#piview-toast') as HTMLElement;
    expect(toast.textContent).toBe('Block copied');
    expect(toast.classList.contains('opacity-100')).toBe(true);

    view.destroy();
  });

  it('tool and verification blocks are expanded by default; toggle collapses them', () => {
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();
    emitBlocks([
      { id: 't1', kind: 'tool', header: '→ write', text: 'body1' },
      { id: 'v1', kind: 'verification', text: '● PASS', sub: ['- ok'] },
    ]);

    const toolBody = mount.querySelectorAll('.piview-toolverify')[0].querySelector(
      '[data-role="body"]'
    ) as HTMLElement;
    const verifyBody = mount.querySelectorAll('.piview-toolverify')[1].querySelector(
      '[data-role="body"]'
    ) as HTMLElement;
    expect(toolBody.classList.contains('hidden')).toBe(false);
    expect(verifyBody.classList.contains('hidden')).toBe(false);

    const collapseBtn = mount.querySelector('#collapse-blocks-btn') as HTMLButtonElement;
    expect(collapseBtn.getAttribute('aria-pressed')).toBe('false');
    expect(collapseBtn.getAttribute('aria-label')).toContain('Collapse');

    collapseBtn.click();
    expect(toolBody.classList.contains('hidden')).toBe(true);
    expect(verifyBody.classList.contains('hidden')).toBe(true);
    expect(collapseBtn.getAttribute('aria-pressed')).toBe('true');
    expect(collapseBtn.getAttribute('aria-label')).toContain('Expand');

    // Expand again.
    collapseBtn.click();
    expect(toolBody.classList.contains('hidden')).toBe(false);
  });

  it('blocksCollapsedInitially starts tool/verification blocks collapsed', () => {
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount, { blocksCollapsedInitially: true });
    view.render();
    emitBlocks([
      { id: 't1', kind: 'tool', header: '→ write', text: 'body1' },
      { id: 'v1', kind: 'verification', text: '● PASS', sub: ['- ok'] },
    ]);

    const bodies = mount.querySelectorAll('.piview-toolverify [data-role="body"]');
    expect(bodies.length).toBe(2);
    bodies.forEach((body) => expect(body.classList.contains('hidden')).toBe(true));

    const collapseBtn = mount.querySelector('#collapse-blocks-btn') as HTMLButtonElement;
    expect(collapseBtn.getAttribute('aria-pressed')).toBe('true');
    expect(collapseBtn.getAttribute('aria-label')).toContain('Expand');

    collapseBtn.click();
    expect(bodies[0].classList.contains('hidden')).toBe(false);
  });

  it('new tool/verification blocks follow the collapsed state', () => {
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();
    emitBlocks([{ id: 't1', kind: 'tool', header: '→ x', text: 'b1' }]);

    (mount.querySelector('#collapse-blocks-btn') as HTMLButtonElement).click();

    emitBlocks([
      { id: 't1', kind: 'tool', header: '→ x', text: 'b1' },
      { id: 't2', kind: 'tool', header: '→ y', text: 'b2' },
    ]);
    const newBody = mount.querySelectorAll('.piview-toolverify')[1].querySelector(
      '[data-role="body"]'
    ) as HTMLElement;
    expect(newBody.classList.contains('hidden')).toBe(true);
  });

  it('individual tool header click toggles its own body', () => {
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();
    emitBlocks([
      { id: 't1', kind: 'tool', header: '→ a', text: 'x' },
      { id: 't2', kind: 'verification', text: '● OK', sub: ['z'] },
    ]);

    const tool = mount.querySelector('.piview-toolverify') as HTMLElement;
    const toolBody = tool.querySelector('[data-role="body"]') as HTMLElement;
    expect(toolBody.classList.contains('hidden')).toBe(false);

    (tool.querySelector('[data-role="header"]') as HTMLElement).click();
    expect(toolBody.classList.contains('hidden')).toBe(true);
  });

  it('error blocks are visible by default; toggle hides all error blocks', () => {
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();
    emitBlocks([
      { id: 'e1', kind: 'error', text: 'boom1' },
      { id: 'e2', kind: 'error', text: 'boom2' },
      { id: 't1', kind: 'text', text: 'normal' },
    ]);

    const errors = mount.querySelectorAll('.piview-error');
    expect(errors.length).toBe(2);
    expect(errors[0].classList.contains('hidden')).toBe(false);
    expect(errors[1].classList.contains('hidden')).toBe(false);

    const toggle = mount.querySelector('#error-toggle-btn') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toContain('Hide');

    toggle.click();
    expect(errors[0].classList.contains('hidden')).toBe(true);
    expect(errors[1].classList.contains('hidden')).toBe(true);
    // Non-error blocks are unaffected.
    const nonError = Array.from(mount.querySelectorAll('#log-blocks > div')).find(
      (d) => !d.classList.contains('piview-error')
    );
    expect(nonError?.classList.contains('hidden')).toBe(false);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.getAttribute('aria-label')).toContain('Show');

    // Show again.
    toggle.click();
    expect(errors[0].classList.contains('hidden')).toBe(false);
    expect(errors[1].classList.contains('hidden')).toBe(false);
  });

  it('new error blocks follow the hidden state', () => {
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();

    (mount.querySelector('#error-toggle-btn') as HTMLButtonElement).click(); // hide
    emitBlocks([{ id: 'e1', kind: 'error', text: 'a' }, { id: 'e2', kind: 'error', text: 'b' }]);

    const errors = mount.querySelectorAll('.piview-error');
    expect(errors[0].classList.contains('hidden')).toBe(true);
    expect(errors[1].classList.contains('hidden')).toBe(true);
  });

  it('shows the "No active session…" empty state when no logs and no session', () => {
    const { service } = createStubService({ isActive: vi.fn(() => false) });
    const view = new PiView(service, mount);
    view.render();

    const emptyState = mount.querySelector('#piview-empty-state') as HTMLElement;
    expect(emptyState).not.toBeNull();
    expect(emptyState.style.display).not.toBe('none');
    expect(mount.querySelector('#piview-empty-title')?.textContent).toContain('No active session');
    // Accessible ARIA role.
    expect(emptyState.getAttribute('role')).toBe('status');
    // Contains an icon (svg) and no session-ended line.
    expect(emptyState.querySelector('svg')).not.toBeNull();
    expect((mount.querySelector('#piview-session-ended') as HTMLElement).style.display).toBe('none');
  });

  it('empty state hides when a session starts and reappears after logs are removed', () => {
    const { service, listeners, emitBlocks } = createStubService({
      isActive: vi.fn(() => false),
    });
    const view = new PiView(service, mount);
    view.render();

    const emptyState = mount.querySelector('#piview-empty-state') as HTMLElement;
    expect(emptyState.style.display).not.toBe('none');

    // Session starts -> placeholder hides automatically.
    listeners.state.forEach((l) => l(true));
    expect(emptyState.style.display).toBe('none');

    // Logs arrive -> still hidden (session active).
    emitBlocks([{ id: 'a', kind: 'text', text: 'x' }]);
    expect(emptyState.style.display).toBe('none');

    // Session ends WITH logs -> no empty-state, but a Session-ended line.
    listeners.state.forEach((l) => l(false));
    expect(emptyState.style.display).toBe('none');

    // Clear the log -> placeholder returns.
    service.clearHistory();
    emitBlocks([]);
    expect(emptyState.style.display).not.toBe('none');

    view.destroy();
  });

  it('shows a distinct "Session ended" line once a session completes with logs', () => {
    const { service, listeners, emitBlocks } = createStubService({
      isActive: vi.fn(() => false),
    });
    const view = new PiView(service, mount);
    view.render();

    const sessionEnded = mount.querySelector('#piview-session-ended') as HTMLElement;
    const emptyState = mount.querySelector('#piview-empty-state') as HTMLElement;
    expect(sessionEnded.style.display).toBe('none');

    // Run a session and produce logs.
    listeners.state.forEach((l) => l(true));
    emitBlocks([{ id: 'a', kind: 'text', text: 'result' }]);
    expect(sessionEnded.style.display).toBe('none');

    // Completion: line appears and empty-state stays hidden.
    listeners.state.forEach((l) => l(false));
    expect(sessionEnded.style.display).not.toBe('none');
    expect(sessionEnded.getAttribute('role')).toBe('status');
    expect(sessionEnded.querySelector('svg')).not.toBeNull();
    expect(sessionEnded.textContent).toContain('Session ended');
    expect(emptyState.style.display).toBe('none');

    view.destroy();
  });

  it('renders an optional action button in the empty state and fires onClick', () => {
    const onClick = vi.fn();
    const { service } = createStubService({ isActive: vi.fn(() => false) });
    const view = new PiView(service, mount, {
      emptyStateAction: { label: 'Start a task', onClick },
    });
    view.render();

    const action = mount.querySelector('#piview-empty-state-action') as HTMLButtonElement;
    expect(action).not.toBeNull();
    expect(action.textContent).toContain('Start a task');
    action.click();
    expect(onClick).toHaveBeenCalledTimes(1);

    view.destroy();
  });

  it('does not render an action button when emptyStateAction is omitted', () => {
    const { service } = createStubService({ isActive: vi.fn(() => false) });
    const view = new PiView(service, mount);
    view.render();
    expect(mount.querySelector('#piview-empty-state-action')).toBeNull();
  });

  it('search bar is collapsed by default and toggled by the right-aligned search icon', () => {
    const { service } = createStubService();
    const view = new PiView(service, mount);
    view.render();

    const bar = mount.querySelector('#piview-search-bar') as HTMLElement;
    expect(bar).not.toBeNull();
    // Collapsed by default.
    expect(bar.classList.contains('hidden')).toBe(true);

    const toggleBtn = mount.querySelector('#search-toggle-btn') as HTMLButtonElement;
    expect(toggleBtn).not.toBeNull();
    // Search icon present and button reflects the collapsed state.
    expect(toggleBtn.getAttribute('aria-label')).toContain('Show search bar');
    expect(toggleBtn.getAttribute('aria-pressed')).toBe('false');

    // Toggle -> search bar becomes visible.
    toggleBtn.click();
    expect(bar.classList.contains('hidden')).toBe(false);
    expect(toggleBtn.getAttribute('aria-label')).toContain('Hide search bar');
    expect(toggleBtn.getAttribute('aria-pressed')).toBe('true');

    // Toggle again -> collapsed.
    toggleBtn.click();
    expect(bar.classList.contains('hidden')).toBe(true);
    expect(toggleBtn.getAttribute('aria-label')).toContain('Show search bar');

    view.destroy();
  });

  // -------------------------------------------------------------------------
  // In-log search / find
  // -------------------------------------------------------------------------

  it('renders a search input, prev/next buttons, and an accessible live counter', () => {
    const { service } = createStubService();
    const view = new PiView(service, mount);
    view.render();

    const bar = mount.querySelector('#piview-search-bar') as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar.getAttribute('role')).toBe('search');

    const input = mount.querySelector('#piview-search-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.getAttribute('aria-label')).toBe('Search log');
    expect(input.placeholder).toContain('Search');

    const next = mount.querySelector('#piview-search-next') as HTMLButtonElement;
    const prev = mount.querySelector('#piview-search-prev') as HTMLButtonElement;
    expect(next.getAttribute('aria-label')).toBe('Next match');
    expect(prev.getAttribute('aria-label')).toBe('Previous match');

    const counter = mount.querySelector('#piview-search-count') as HTMLElement;
    expect(counter.getAttribute('role')).toBe('status');
    expect(counter.getAttribute('aria-live')).toBe('polite');
    expect(counter.textContent).toBe('0 / 0');
  });

  it('does not hijack the copy shortcut (c) while typing in the search input', () => {
    const writeText = vi.fn(async (_t: string) => { });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();
    emitBlocks([{ id: 'a', kind: 'text', text: 'hello c world' }]);

    const input = mount.querySelector('#piview-search-input') as HTMLInputElement;
    const keyEvt = new KeyboardEvent('keydown', { key: 'c', bubbles: true });
    input.dispatchEvent(keyEvt);
    expect(writeText).not.toHaveBeenCalled();
  });

  it('debounces live search and highlights matches after the debounce delay', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();
    emitBlocks([
      { id: 'a', kind: 'text', text: 'alpha beta alpha' },
      { id: 'b', kind: 'text', text: 'Gamma' },
    ]);

    const input = mount.querySelector('#piview-search-input') as HTMLInputElement;
    input.value = 'alpha';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    // Not yet applied (debounced).
    expect(mount.querySelectorAll('mark.piview-search-match').length).toBe(0);

    vi.advanceTimersByTime(200);
    const marks = mount.querySelectorAll('mark.piview-search-match');
    expect(marks.length).toBe(2);
    // Case-insensitive: 'Gamma' would match 'gamma' but not 'alpha'.

    const counter = mount.querySelector('#piview-search-count') as HTMLElement;
    expect(counter.textContent).toBe('1 / 2');
    const first = marks[0] as HTMLElement;
    expect(first.classList.contains('piview-search-current')).toBe(true);
    expect(marks[1].classList.contains('piview-search-current')).toBe(false);

    view.destroy();
    vi.useRealTimers();
  });

  it('clearing the search input removes all highlights and resets the counter', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();
    emitBlocks([{ id: 'a', kind: 'text', text: 'foo bar foo' }]);

    const input = mount.querySelector('#piview-search-input') as HTMLInputElement;
    input.value = 'foo';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(200);
    expect(mount.querySelectorAll('mark.piview-search-match').length).toBe(2);

    // Clearing the input triggers the debounced handler with an empty query.
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(200);

    expect(mount.querySelectorAll('mark.piview-search-match').length).toBe(0);
    expect((mount.querySelector('#piview-search-count') as HTMLElement).textContent).toBe('0 / 0');
    // Original text is preserved after unwrapping.
    expect(mount.querySelector('#log-blocks')!.textContent).toContain('foo bar foo');

    view.destroy();
    vi.useRealTimers();
  });

  it('next/prev buttons navigate between matches, wrapping around, and scroll into view', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();
    emitBlocks([
      { id: 'a', kind: 'text', text: 'target one' },
      { id: 'b', kind: 'text', text: 'target two target' },
    ]);

    const input = mount.querySelector('#piview-search-input') as HTMLInputElement;
    input.value = 'target';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(200);

    const marks = mount.querySelectorAll('mark.piview-search-match');
    expect(marks.length).toBe(3);
    const counter = mount.querySelector('#piview-search-count') as HTMLElement;
    expect(counter.textContent).toBe('1 / 3');

    const scrollSpy = vi.spyOn(view as unknown as { ensureVisible: () => void }, 'ensureVisible').mockImplementation(() => { });
    const container = mount.querySelector('#log-content-container') as HTMLElement;
    Object.defineProperty(container, 'scrollTop', {
      configurable: true,
      writable: true,
      value: 0,
    });

    (mount.querySelector('#piview-search-next') as HTMLButtonElement).click();
    expect(counter.textContent).toBe('2 / 3');
    expect(marks[1].classList.contains('piview-search-current')).toBe(true);
    expect(scrollSpy).toHaveBeenCalledTimes(1);

    (mount.querySelector('#piview-search-next') as HTMLButtonElement).click();
    expect(counter.textContent).toBe('3 / 3');

    // Wrap around forward.
    (mount.querySelector('#piview-search-next') as HTMLButtonElement).click();
    expect(counter.textContent).toBe('1 / 3');

    // Prev wraps backward.
    (mount.querySelector('#piview-search-prev') as HTMLButtonElement).click();
    expect(counter.textContent).toBe('3 / 3');

    view.destroy();
    vi.useRealTimers();
  });

  it('Enter and Shift+Enter in the search input navigate next/prev', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();
    emitBlocks([{ id: 'a', kind: 'text', text: 'x x x' }]);

    const input = mount.querySelector('#piview-search-input') as HTMLInputElement;
    input.value = 'x';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(200);

    const counter = mount.querySelector('#piview-search-count') as HTMLElement;
    expect(counter.textContent).toBe('1 / 3');

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(counter.textContent).toBe('2 / 3');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(counter.textContent).toBe('3 / 3');
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, shiftKey: true })
    );
    expect(counter.textContent).toBe('2 / 3');

    view.destroy();
    vi.useRealTimers();
  });

  it('does not change match on next/prev when there are no matches', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();
    emitBlocks([{ id: 'a', kind: 'text', text: 'hello' }]);

    (mount.querySelector('#piview-search-next') as HTMLButtonElement).click();
    (mount.querySelector('#piview-search-prev') as HTMLButtonElement).click();

    const counter = mount.querySelector('#piview-search-count') as HTMLElement;
    expect(counter.textContent).toBe('0 / 0');

    view.destroy();
    vi.useRealTimers();
  });

  it('updates highlights and counter when new log entries arrive during a search', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();
    emitBlocks([{ id: 'a', kind: 'text', text: 'match first' }]);

    const input = mount.querySelector('#piview-search-input') as HTMLInputElement;
    input.value = 'match';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(200);

    expect(mount.querySelectorAll('mark.piview-search-match').length).toBe(1);
    const counter = mount.querySelector('#piview-search-count') as HTMLElement;
    expect(counter.textContent).toBe('1 / 1');

    // New log entries arrive -> UI updates to reflect new matches.
    emitBlocks([
      { id: 'a', kind: 'text', text: 'match first' },
      { id: 'b', kind: 'text', text: 'another match here' },
    ]);
    expect(mount.querySelectorAll('mark.piview-search-match').length).toBe(2);
    expect(counter.textContent).toBe('1 / 2');

    view.destroy();
    vi.useRealTimers();
  });

  it('removes highlights when a searched-for block is dropped from the log', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();
    emitBlocks([{ id: 'a', kind: 'text', text: 'match a' }, { id: 'b', kind: 'text', text: 'match b' }]);

    const input = mount.querySelector('#piview-search-input') as HTMLInputElement;
    input.value = 'match';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(200);
    expect(mount.querySelectorAll('mark.piview-search-match').length).toBe(2);

    // Remove block 'b' (e.g. after a clear/partial reconcile).
    emitBlocks([{ id: 'a', kind: 'text', text: 'match a' }]);
    expect(mount.querySelectorAll('mark.piview-search-match').length).toBe(1);
    expect((mount.querySelector('#piview-search-count') as HTMLElement).textContent).toBe('1 / 1');

    view.destroy();
    vi.useRealTimers();
  });

  it('ensureVisible scrolls the container so the current match lands in view', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();
    emitBlocks([{ id: 'a', kind: 'text', text: 'foo bar foo' }]);

    const input = mount.querySelector('#piview-search-input') as HTMLInputElement;
    input.value = 'foo';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(200);

    const container = mount.querySelector('#log-content-container') as HTMLElement;
    let scrollTopValue = 500;
    Object.defineProperty(container, 'scrollTop', {
      configurable: true,
      get: () => scrollTopValue,
      set: (v: number) => { scrollTopValue = v; },
    });
    Object.defineProperty(container, 'clientHeight', { configurable: true, value: 200 });

    // Second mark sits below the visible area -> scrolling should advance.
    const marks = mount.querySelectorAll('mark.piview-search-match') as unknown as HTMLElement[];
    const containerRect = { top: 0, bottom: 200, height: 200 } as DOMRect;
    const belowRect = { top: 600, bottom: 620, height: 20 } as DOMRect;
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(containerRect as DOMRect);
    vi.spyOn(marks[1], 'getBoundingClientRect').mockReturnValue(belowRect as DOMRect);

    (view as unknown as { goToMatch: (i: number) => void }).goToMatch(1);
    // relBottom = 620 - 0 = 620 > 200-8 => scroll += 620 - 192 = 428
    expect(scrollTopValue).toBeGreaterThan(500);

    view.destroy();
    vi.useRealTimers();
  });

  it('Escape clears the search, removes highlights, and resets the counter', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();
    emitBlocks([{ id: 'a', kind: 'text', text: 'hello target world' }]);

    const input = mount.querySelector('#piview-search-input') as HTMLInputElement;
    input.value = 'target';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    vi.advanceTimersByTime(200);
    expect(mount.querySelectorAll('mark.piview-search-match').length).toBe(1);

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(mount.querySelectorAll('mark.piview-search-match').length).toBe(0);
    expect((mount.querySelector('#piview-search-count') as HTMLElement).textContent).toBe('0 / 0');

    view.destroy();
    vi.useRealTimers();
  });

  // -------------------------------------------------------------------------
  // Next/Prev error navigation
  // -------------------------------------------------------------------------

  it('renders prev/next error buttons with icons/ARIA labels, disabled when no errors', () => {
    const { service } = createStubService();
    const view = new PiView(service, mount);
    view.render();

    const prev = mount.querySelector('#prev-error-btn') as HTMLButtonElement;
    const next = mount.querySelector('#next-error-btn') as HTMLButtonElement;
    expect(prev).not.toBeNull();
    expect(next).not.toBeNull();
    expect(prev.getAttribute('aria-label')).toContain('Previous error');
    expect(next.getAttribute('aria-label')).toContain('Next error');
    // Icons present and initially disabled with no log content.
    expect(prev.querySelector('svg')).not.toBeNull();
    expect(next.querySelector('svg')).not.toBeNull();
    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(true);

    view.destroy();
  });

  it('next/prev error buttons navigate blocks, scroll into view, and disable at boundaries', () => {
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();
    emitBlocks([
      { id: 'e1', kind: 'error', text: 'err one' },
      { id: 't1', kind: 'text', text: 'normal' },
      { id: 'e2', kind: 'error', text: 'err two' },
    ]);

    const prev = mount.querySelector('#prev-error-btn') as HTMLButtonElement;
    const next = mount.querySelector('#next-error-btn') as HTMLButtonElement;

    // Two errors -> no selection yet: next enabled, prev disabled.
    expect(next.disabled).toBe(false);
    expect(prev.disabled).toBe(true);

    const scrollSpy = vi
      .spyOn(view as unknown as { ensureVisible: () => void }, 'ensureVisible')
      .mockImplementation(() => { });

    next.click();
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(prev.disabled).toBe(true); // still at first error
    expect(next.disabled).toBe(false);

    next.click();
    expect(scrollSpy).toHaveBeenCalledTimes(2);
    expect(next.disabled).toBe(true); // at last error
    expect(prev.disabled).toBe(false);

    prev.click();
    expect(scrollSpy).toHaveBeenCalledTimes(3);
    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(false);

    view.destroy();
  });

  it('n / Shift+N keyboard shortcuts jump to next/prev error', () => {
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();
    emitBlocks([
      { id: 'e1', kind: 'error', text: 'a' },
      { id: 'e2', kind: 'error', text: 'b' },
      { id: 'e3', kind: 'error', text: 'c' },
    ]);

    const log = mount.querySelector('#log-content-container') as HTMLElement;
    const scrollSpy = vi
      .spyOn(view as unknown as { ensureVisible: () => void }, 'ensureVisible')
      .mockImplementation(() => { });

    // n -> next error(s).
    log.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    log.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));
    expect(scrollSpy).toHaveBeenCalledTimes(2);

    // Shift+n (key 'N') -> previous error.
    log.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'N', bubbles: true, shiftKey: true })
    );
    expect(scrollSpy).toHaveBeenCalledTimes(3);

    // At the first error, Shift+n does not wrap to the end.
    log.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'N', bubbles: true, shiftKey: true })
    );
    expect(scrollSpy).toHaveBeenCalledTimes(3);

    view.destroy();
  });

  it('does not hijack n/N while typing in the search input', () => {
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();
    emitBlocks([{ id: 'e1', kind: 'error', text: 'a' }, { id: 't1', kind: 'text', text: 'x' }]);

    const scrollSpy = vi
      .spyOn(view as unknown as { ensureVisible: () => void }, 'ensureVisible')
      .mockImplementation(() => { });
    const input = mount.querySelector('#piview-search-input') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));
    expect(scrollSpy).not.toHaveBeenCalled();

    view.destroy();
  });

  it('error nav button state stays in sync when errors are added or dropped', () => {
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();

    const next = mount.querySelector('#next-error-btn') as HTMLButtonElement;
    const prev = mount.querySelector('#prev-error-btn') as HTMLButtonElement;
    expect(next.disabled).toBe(true);

    emitBlocks([{ id: 'e1', kind: 'error', text: 'a' }, { id: 't1', kind: 'text', text: 'x' }]);
    expect(next.disabled).toBe(false);

    next.click(); // select the only error -> both boundaries.
    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(true);

    // A new error appended -> next enabled again.
    emitBlocks([
      { id: 'e1', kind: 'error', text: 'a' },
      { id: 'e2', kind: 'error', text: 'b' },
      { id: 't1', kind: 'text', text: 'x' },
    ]);
    expect(next.disabled).toBe(false);

    // Drop back to a single error -> both boundaries become disabled.
    emitBlocks([{ id: 'e2', kind: 'error', text: 'b' }]);
    expect(prev.disabled).toBe(true);
    expect(next.disabled).toBe(true);

    view.destroy();
  });
});

describe('PiView keyboard tooltips', () => {
  let mount: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('annotates each toolbar button with a title and aria-label containing its default shortcut', () => {
    const { service } = createStubService();
    const view = new PiView(service, mount);
    view.render();

    const expectations: Array<[string, string]> = [
      ['toggle-follow', 'Follow Mode: ON (f)'],
      ['clear-logs', 'Clear (x)'],
      ['stop-bot', 'Stop Bot (s)'],
      ['toggle-thinking', 'Collapse all thinking blocks (t)'],
      ['toggle-block-collapse', 'Collapse all blocks (b)'],
      ['toggle-error-visibility', 'Hide error blocks (e)'],
      ['prev-error', 'Previous error (N)'],
      ['next-error', 'Next error (n)'],
      ['copy-all-log', 'Copy entire log (c)'],
      ['toggle-search', 'Show search bar (k)'],
    ];

    for (const [action, expected] of expectations) {
      const btn = mount.querySelector(`[data-action="${action}"]`) as HTMLButtonElement;
      expect(btn).not.toBeNull();
      expect(btn.title).toBe(expected);
      expect(btn.getAttribute('aria-label')).toBe(expected);
      expect(btn.getAttribute('data-action')).toBe(action);
    }

    view.destroy();
  });

  it('uses custom keyboardBindings in the tooltips when provided', () => {
    const { service } = createStubService();
    const view = new PiView(service, mount, {
      keyboardBindings: { 'clear-logs': 'q', 'next-error': 'Shift+B' },
    });
    view.render();

    expect((mount.querySelector('[data-action="clear-logs"]') as HTMLButtonElement).title).toBe(
      'Clear (q)'
    );
    expect((mount.querySelector('[data-action="next-error"]') as HTMLButtonElement).title).toBe(
      'Next error (Shift+B)'
    );
    // Untouched defaults still show their default key.
    expect((mount.querySelector('[data-action="toggle-follow"]') as HTMLButtonElement).title).toBe(
      'Follow Mode: ON (f)'
    );

    view.destroy();
  });

  it('keeps the shortcut in the tooltip when button state toggles', () => {
    const { service } = createStubService();
    const view = new PiView(service, mount);
    view.render();

    // Follow button label flips to OFF but must retain the (f) shortcut.
    (mount.querySelector('#follow-btn') as HTMLButtonElement).click();
    const follow = mount.querySelector('[data-action="toggle-follow"]') as HTMLButtonElement;
    expect(follow.title).toBe('Follow Mode: OFF (f)');

    // Thinking toggle flips its label while keeping the shortcut.
    (mount.querySelector('#thinking-toggle-btn') as HTMLButtonElement).click();
    const thinking = mount.querySelector('[data-action="toggle-thinking"]') as HTMLButtonElement;
    expect(thinking.title).toBe('Expand all thinking blocks (t)');
    expect(thinking.getAttribute('aria-label')).toBe('Expand all thinking blocks (t)');

    view.destroy();
  });

  it('refreshTooltips() rebuilds the mapping and updates existing titles', () => {
    const { service } = createStubService();
    const view = new PiView(service, mount);
    view.render();

    (view as unknown as { keyboardBindings: Record<string, string> }).keyboardBindings = {
      'clear-logs': 'q',
    };
    view.refreshTooltips();

    expect((mount.querySelector('[data-action="clear-logs"]') as HTMLButtonElement).title).toBe(
      'Clear (q)'
    );

    view.destroy();
  });

  it('adds a "Format as markup" button to each block that renders Markdown HTML', () => {
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();
    emitBlocks([{ id: 'm1', kind: 'text', text: '**bold** and *italic*' }]);

    const blockEl = mount.querySelector('#log-blocks > div') as HTMLElement;
    const formatBtn = blockEl.querySelector('.piview-format') as HTMLButtonElement;
    expect(formatBtn).not.toBeNull();
    expect(formatBtn.getAttribute('aria-label')).toBe('Format as markup');

    formatBtn.click();
    const formatted = blockEl.querySelector('.piview-formatted') as HTMLElement;
    expect(formatted).not.toBeNull();
    expect(formatted.querySelector('strong')?.textContent).toBe('bold');
    expect(formatted.querySelector('em')?.textContent).toBe('italic');
  });

  it('renders the formatted agent response in a non-monospace (sans-serif) font', () => {
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();
    emitBlocks([{ id: 'font1', kind: 'text', text: 'Readable **prose**', complete: true }]);
    view.flushAutoFormat();

    const formatted = mount.querySelector('.piview-formatted') as HTMLElement;
    expect(formatted).not.toBeNull();
    // The terminal-style log container is `font-mono`; the rendered answer must
    // override that with the app's sans-serif font for readability.
    expect(formatted.classList.contains('font-sans')).toBe(true);
    expect(mount.querySelector('#log-content-container')?.classList.contains('font-mono')).toBe(
      true
    );

    view.destroy();
  });

  it('declares a slightly larger, tunable vertical rhythm for rendered Markdown', () => {
    // The effective rhythm is owned by the unlayered `.piview-formatted` rules
    // in style.css (they beat Tailwind's layered `prose-*` utilities). jsdom has
    // no layout engine and the stylesheet is not applied in tests, so guard the
    // declared values directly: they must stay larger than the old `0.2em`
    // block gap and `0` list-item gap.
    expect(styleCss).toMatch(/--piview-gap-block:\s*0\.4em/);
    expect(styleCss).toMatch(/--piview-gap-li:\s*0\.2em/);
    expect(styleCss).toMatch(/--piview-gap-heading-top:\s*0\.6em/);
    expect(styleCss).toMatch(/--piview-gap-pre:\s*0\.4em/);

    // The block/list/heading rules must reference those shared properties so
    // there is a single source of truth for the rhythm.
    expect(styleCss).toMatch(
      /\.piview-formatted :where\(p, ul, ol, dl, blockquote, figure, table\)\s*\{[^}]*var\(--piview-gap-block\)/
    );
    expect(styleCss).toMatch(/\.piview-formatted :where\(li\)\s*\{[^}]*var\(--piview-gap-li\)/);
    expect(styleCss).toMatch(
      /\.piview-formatted :where\(h1, h2, h3, h4, h5, h6\)\s*\{[^}]*var\(--piview-gap-heading-top\)/
    );
  });

  it('owns the vertical rhythm in CSS instead of inert prose-* utilities', () => {
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();
    emitBlocks([{ id: 'g1', kind: 'text', text: 'Intro.\n\n- one\n- two', complete: true }]);
    view.flushAutoFormat();

    const formatted = mount.querySelector('.piview-formatted') as HTMLElement;
    expect(formatted).not.toBeNull();
    expect(formatted.classList.contains('prose-theme')).toBe(true);
    // The old `prose-p:my-*` / `prose-li:my-*` utilities were silently
    // overridden by style.css; pin their removal to keep one source of truth.
    expect(formatted.className).not.toMatch(/prose-[a-z]+:my-/);

    view.destroy();
  });

  it('toggles the block back to raw text when clicking the format button again', () => {
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();
    emitBlocks([{ id: 'm2', kind: 'text', text: '# Heading\n\n**bold**' }]);

    const blockEl = mount.querySelector('#log-blocks > div') as HTMLElement;
    const formatBtn = blockEl.querySelector('.piview-format') as HTMLButtonElement;

    formatBtn.click();
    expect(blockEl.querySelector('.piview-formatted')).not.toBeNull();
    expect(blockEl.querySelector('h1')?.textContent).toBe('Heading');

    formatBtn.click();
    expect(blockEl.querySelector('.piview-formatted')).toBeNull();
    expect(blockEl.textContent).toContain('# Heading');
  });

  it('sanitizes Markdown HTML so unsafe scripts are not executed', () => {
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();
    emitBlocks([{ id: 'm3', kind: 'text', text: 'hello <script>alert(1)</script> world' }]);

    const blockEl = mount.querySelector('#log-blocks > div') as HTMLElement;
    (blockEl.querySelector('.piview-format') as HTMLButtonElement).click();

    const formatted = blockEl.querySelector('.piview-formatted') as HTMLElement;
    expect(formatted).not.toBeNull();
    expect(formatted.querySelector('script')).toBeNull();
    expect(blockEl.textContent).toContain('hello');
  });

  it('keeps a formatted block in sync with newly streamed content', () => {
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();
    emitBlocks([{ id: 'm4', kind: 'text', text: '**one**' }]);

    const blockEl = mount.querySelector('#log-blocks > div') as HTMLElement;
    (blockEl.querySelector('.piview-format') as HTMLButtonElement).click();
    expect(blockEl.querySelector('.piview-formatted')?.textContent).toContain('one');

    // Stream in a new delta and ensure the Markdown rendering updates.
    emitBlocks([{ id: 'm4', kind: 'text', text: '**one** and **two**' }]);
    expect(blockEl.querySelector('.piview-formatted')?.textContent).toContain('two');
  });

  it('copying a formatted block still returns the raw Markdown', async () => {
    const writeText = vi.fn(async (_text: string) => { });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();
    emitBlocks([{ id: 'm5', kind: 'text', text: '# Title\n\n**bold**' }]);

    const blockEl = mount.querySelector('#log-blocks > div') as HTMLElement;
    (blockEl.querySelector('.piview-format') as HTMLButtonElement).click();
    (blockEl.querySelector('.piview-copy') as HTMLButtonElement).click();
    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain('# Title');
    expect(copied).toContain('**bold**');

    view.destroy();
  });

  it('renders an "Open in Dialog" button only when onOpenDialog is provided', () => {
    const { service } = createStubService();

    const plain = new PiView(service, mount);
    plain.render();
    expect(mount.querySelector('#open-dialog-btn')).toBeNull();
    plain.destroy();

    const withCb = new PiView(service, mount, { onOpenDialog: () => { } });
    withCb.render();
    const btn = mount.querySelector('#open-dialog-btn') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    // The button is icon-only: its visible (non-svg) text does not show the label.
    expect(btn.textContent).not.toContain('Open in Dialog');
    expect(btn.getAttribute('data-action')).toBe('open-dialog');
    withCb.destroy();
  });

  it('fires onOpenDialog when the "Open in Dialog" button is clicked', () => {
    const onOpenDialog = vi.fn();
    const { service } = createStubService();
    const view = new PiView(service, mount, { onOpenDialog });
    view.render();

    (mount.querySelector('#open-dialog-btn') as HTMLButtonElement).click();
    expect(onOpenDialog).toHaveBeenCalledTimes(1);

    view.destroy();
  });

  it('annotates the "Open in Dialog" button with its keyboard shortcut', () => {
    const { service } = createStubService();
    const view = new PiView(service, mount, { onOpenDialog: () => { } });
    view.render();

    const btn = mount.querySelector('[data-action="open-dialog"]') as HTMLButtonElement;
    expect(btn.title).toBe('Open in Dialog (o)');
    expect(btn.getAttribute('aria-label')).toBe('Open in Dialog (o)');

    view.destroy();
  });

  it('o keyboard shortcut opens the dialog', () => {
    const onOpenDialog = vi.fn();
    const { service } = createStubService();
    const view = new PiView(service, mount, { onOpenDialog });
    view.render();

    mount.querySelector('#log-content-container')!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'o', bubbles: true })
    );
    expect(onOpenDialog).toHaveBeenCalledTimes(1);

    view.destroy();
  });
});

describe('PiView automatic Markdown rendering', () => {
  let mount: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders a streaming text block as raw text (no formatted HTML)', () => {
    const parseSpy = vi.spyOn(marked, 'parse');
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();

    emitBlocks([{ id: 't1', kind: 'text', text: '**bo', complete: false }]);

    const blockEl = mount.querySelector('#log-blocks > div') as HTMLElement;
    expect(blockEl.querySelector('.piview-formatted')).toBeNull();
    expect(blockEl.querySelector('[data-role="raw"]')?.textContent).toBe('**bo');
    expect(parseSpy).not.toHaveBeenCalled();

    view.destroy();
  });

  it('auto-renders a completed text block as sanitized Markdown', () => {
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();

    emitBlocks([{ id: 't2', kind: 'text', text: '# Head\n\n**bold** and *italic*', complete: true }]);
    // Completed on first sight (history replay): formatted on the queued drain.
    expect(mount.querySelector('.piview-formatted')).toBeNull();
    view.flushAutoFormat();

    const formatted = mount.querySelector('.piview-formatted') as HTMLElement;
    expect(formatted).not.toBeNull();
    expect(formatted.querySelector('h1')?.textContent).toBe('Head');
    expect(formatted.querySelector('strong')?.textContent).toBe('bold');
    expect(formatted.querySelector('em')?.textContent).toBe('italic');
    // The raw pre-wrap child is replaced, not nested next to the formatted div.
    expect(mount.querySelector('[data-role="raw"]')).toBeNull();

    view.destroy();
  });

  it('auto-formats a block when it transitions from streaming to complete', () => {
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();

    emitBlocks([{ id: 't3', kind: 'text', text: '**bo', complete: false }]);
    const blockEl = mount.querySelector('#log-blocks > div') as HTMLElement;
    expect(blockEl.querySelector('.piview-formatted')).toBeNull();

    emitBlocks([{ id: 't3', kind: 'text', text: '**bold**', complete: true }]);
    expect(blockEl.querySelector('.piview-formatted')).not.toBeNull();
    expect(blockEl.querySelector('.piview-formatted strong')?.textContent).toBe('bold');

    view.destroy();
  });

  it('only auto-formats text blocks; other kinds stay raw until manually formatted', () => {
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();

    emitBlocks([
      { id: 'th', kind: 'thinking', text: '**think**', complete: true },
      { id: 'tl', kind: 'tool', header: '→ write', text: '**tool**', complete: true },
      { id: 'tx', kind: 'text', text: '**text**', complete: true },
    ]);
    view.flushAutoFormat();

    const byId = (id: string) =>
      Array.from(mount.querySelectorAll<HTMLElement>('#log-blocks > div')).find(
        (e) => e.getAttribute('data-block-id') === id
      )!;
    expect(byId('th').querySelector('.piview-formatted')).toBeNull();
    expect(byId('tl').querySelector('.piview-formatted')).toBeNull();
    expect(byId('tx').querySelector('.piview-formatted')).not.toBeNull();

    // Non-text blocks keep the manual toggle.
    (byId('th').querySelector('.piview-format') as HTMLButtonElement).click();
    expect(byId('th').querySelector('.piview-formatted')).not.toBeNull();

    view.destroy();
  });

  it('honours autoFormatText: false', () => {
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount, { autoFormatText: false });
    view.render();

    emitBlocks([{ id: 'off', kind: 'text', text: '**bold**', complete: true }]);
    view.flushAutoFormat();
    expect(mount.querySelector('.piview-formatted')).toBeNull();
    expect(mount.querySelector('[data-role="raw"]')?.textContent).toBe('**bold**');

    view.destroy();
  });

  it('sanitizes auto-rendered Markdown so unsafe scripts are removed', () => {
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();

    emitBlocks([
      { id: 's1', kind: 'text', text: 'hi <script>alert(1)</script> there', complete: true },
    ]);
    view.flushAutoFormat();

    const formatted = mount.querySelector('.piview-formatted') as HTMLElement;
    expect(formatted).not.toBeNull();
    expect(formatted.querySelector('script')).toBeNull();
    expect(mount.textContent).toContain('hi');

    view.destroy();
  });

  it('parses Markdown once per completed block, not on every streamed delta', () => {
    const parseSpy = vi.spyOn(marked, 'parse');
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();

    emitBlocks([{ id: 'p1', kind: 'text', text: 'a', complete: false }]);
    emitBlocks([{ id: 'p1', kind: 'text', text: 'ab', complete: false }]);
    emitBlocks([{ id: 'p1', kind: 'text', text: 'abc', complete: false }]);
    expect(parseSpy).not.toHaveBeenCalled();

    emitBlocks([{ id: 'p1', kind: 'text', text: 'abcd', complete: true }]);
    view.flushAutoFormat();
    expect(parseSpy).toHaveBeenCalledTimes(1);

    // A later snapshot with the same source does not re-parse.
    emitBlocks([{ id: 'p1', kind: 'text', text: 'abcd', complete: true }]);
    view.flushAutoFormat();
    expect(parseSpy).toHaveBeenCalledTimes(1);

    view.destroy();
  });

  it('stays raw after the user reverts an auto-formatted text block', () => {
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();

    emitBlocks([{ id: 'r1', kind: 'text', text: '**bold**', complete: true }]);
    view.flushAutoFormat();
    const blockEl = mount.querySelector('#log-blocks > div') as HTMLElement;
    const formatBtn = blockEl.querySelector('.piview-format') as HTMLButtonElement;
    expect(blockEl.querySelector('.piview-formatted')).not.toBeNull();

    formatBtn.click();
    expect(blockEl.querySelector('.piview-formatted')).toBeNull();
    expect(blockEl.textContent).toContain('**bold**');

    // A later complete snapshot must not silently re-format it.
    emitBlocks([{ id: 'r1', kind: 'text', text: '**bold**', complete: true }]);
    view.flushAutoFormat();
    expect(blockEl.querySelector('.piview-formatted')).toBeNull();

    // Re-formatting explicitly clears the override.
    formatBtn.click();
    expect(blockEl.querySelector('.piview-formatted')).not.toBeNull();

    view.destroy();
  });

  it('stays raw when reverted before completion, then the block completes', () => {
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();

    emitBlocks([{ id: 'r2', kind: 'text', text: '**bo', complete: false }]);
    const blockEl = mount.querySelector('#log-blocks > div') as HTMLElement;
    const formatBtn = blockEl.querySelector('.piview-format') as HTMLButtonElement;
    formatBtn.click();
    expect(blockEl.querySelector('.piview-formatted')).not.toBeNull();
    formatBtn.click();
    expect(blockEl.querySelector('.piview-formatted')).toBeNull();

    emitBlocks([{ id: 'r2', kind: 'text', text: '**bold**', complete: true }]);
    view.flushAutoFormat();
    expect(blockEl.querySelector('.piview-formatted')).toBeNull();
    expect(blockEl.textContent).toContain('**bold**');

    view.destroy();
  });

  it('copying an auto-formatted block still returns the raw Markdown', async () => {
    const writeText = vi.fn(async (_text: string) => { });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();

    emitBlocks([{ id: 'c1', kind: 'text', text: '# Title\n\n**bold**', complete: true }]);
    view.flushAutoFormat();
    const blockEl = mount.querySelector('#log-blocks > div') as HTMLElement;
    (blockEl.querySelector('.piview-copy') as HTMLButtonElement).click();

    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain('# Title');
    expect(copied).toContain('**bold**');

    view.destroy();
  });

  it('does not format a replayed history synchronously and flushes identically', () => {
    const parseSpy = vi.spyOn(marked, 'parse');
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();

    const history: RenderBlock[] = [];
    for (let i = 0; i < 12; i++) {
      history.push({ id: `h${i}`, kind: 'text', text: `# Head ${i}`, complete: true });
    }
    emitBlocks(history);

    // The reconcile pass only queued the blocks; nothing was parsed yet.
    expect(parseSpy).not.toHaveBeenCalled();
    expect(mount.querySelectorAll('.piview-formatted').length).toBe(0);

    view.flushAutoFormat();
    expect(mount.querySelectorAll('.piview-formatted').length).toBe(12);

    view.destroy();
  });

  it('clears auto-format state when a block is removed', () => {
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();

    emitBlocks([{ id: 'x1', kind: 'text', text: '**bold**', complete: true }]);
    view.flushAutoFormat();

    const internals = view as unknown as {
      formattedBlocks: Set<string>;
      rawTextOverride: Set<string>;
      formattedContent: Map<string, Node[]>;
      formattedRawText: Map<string, string>;
      pendingAutoFormat: string[];
    };
    expect(internals.formattedBlocks.has('x1')).toBe(true);

    // Simulate a queued id that then vanishes in the same/next reconcile.
    internals.pendingAutoFormat.push('x1');
    emitBlocks([]);

    expect(internals.formattedBlocks.has('x1')).toBe(false);
    expect(internals.formattedContent.has('x1')).toBe(false);
    expect(internals.formattedRawText.has('x1')).toBe(false);
    expect(internals.rawTextOverride.has('x1')).toBe(false);
    expect(internals.pendingAutoFormat).not.toContain('x1');

    view.destroy();
  });

  it('flips the format button label/icon between raw and formatted', () => {
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();

    emitBlocks([{ id: 'l1', kind: 'text', text: '**bold**', complete: true }]);
    const blockEl = mount.querySelector('#log-blocks > div') as HTMLElement;
    const formatBtn = blockEl.querySelector('.piview-format') as HTMLButtonElement;
    expect(formatBtn.getAttribute('aria-label')).toBe('Format as markup');

    view.flushAutoFormat();
    expect(formatBtn.getAttribute('aria-label')).toBe('Show raw text');
    expect(formatBtn.getAttribute('title')).toBe('Show raw text');

    formatBtn.click();
    expect(formatBtn.getAttribute('aria-label')).toBe('Format as markup');

    view.destroy();
  });
});

