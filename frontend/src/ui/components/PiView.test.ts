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
import { PiView, type PiSessionService } from './PiView.ts';
import type { RenderBlock } from '../../core/CoderBotService.ts';

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

  const emitBlocks = (blocks: RenderBlock[]) => listeners.blocks.forEach((l) => l(blocks));

  const service: PiSessionService = {
    getHistory: vi.fn(() => []),
    getCurrentTaskId: vi.fn(() => null),
    isActive: vi.fn(() => false),
    clearHistory: vi.fn(),
    stopSession: vi.fn(async () => {}),
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

    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});
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

  it('thinking blocks are collapsed by default and toggle button expands them', () => {
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();

    emitBlocks([{ id: 'think', kind: 'thinking', text: 'hmm' }]);

    const thinkingEl = mount.querySelector('.piview-thinking') as HTMLElement;
    const body = thinkingEl.querySelector('[data-role="body"]') as HTMLElement;
    // Collapsed by default.
    expect(body.classList.contains('hidden')).toBe(true);
    // Header still shows a label.
    expect(thinkingEl.querySelector('[data-role="header"]')?.textContent).toContain('Thinking');

    const toggleBtn = mount.querySelector('#thinking-toggle-btn') as HTMLButtonElement;
    expect(toggleBtn.getAttribute('aria-pressed')).toBe('false');
    expect(toggleBtn.getAttribute('aria-label')).toContain('Expand');

    // Expand all via the toggle button.
    toggleBtn.click();
    expect(body.classList.contains('hidden')).toBe(false);
    expect(toggleBtn.getAttribute('aria-pressed')).toBe('true');
    expect(toggleBtn.getAttribute('aria-label')).toContain('Collapse');

    // New thinking blocks follow the expanded mode.
    emitBlocks([{ id: 'think', kind: 'thinking', text: 'hmm' }, { id: 'think2', kind: 'thinking', text: 'more' }]);
    const body1 = mount.querySelectorAll('.piview-thinking')[0].querySelector('[data-role="body"]') as HTMLElement;
    const body2 = mount.querySelectorAll('.piview-thinking')[1].querySelector('[data-role="body"]') as HTMLElement;
    expect(body1.classList.contains('hidden')).toBe(false);
    expect(body2.classList.contains('hidden')).toBe(false);

    // Collapse again via the toggle.
    toggleBtn.click();
    expect(body2.classList.contains('hidden')).toBe(true);
  });

  it('individual thinking header click toggles that block only', () => {
    const { service, emitBlocks } = createStubService();
    const view = new PiView(service, mount);
    view.render();

    emitBlocks([{ id: 't1', kind: 'thinking', text: 'a' }, { id: 't2', kind: 'thinking', text: 'b' }]);

    const t1 = mount.querySelector('.piview-thinking') as HTMLElement;
    const b1 = t1.querySelector('[data-role="body"]') as HTMLElement;
    const b2 = (mount.querySelectorAll('.piview-thinking')[1]).querySelector('[data-role="body"]') as HTMLElement;

    // Both collapsed by default.
    expect(b1.classList.contains('hidden')).toBe(true);
    expect(b2.classList.contains('hidden')).toBe(true);

    // Expand the first block via its header.
    const header = t1.querySelector('[data-role="header"]') as HTMLElement;
    header.click();
    expect(b1.classList.contains('hidden')).toBe(false);
    expect(b2.classList.contains('hidden')).toBe(true);

    // Re-collapse via header.
    header.click();
    expect(b1.classList.contains('hidden')).toBe(true);
  });

  it('destroy() unsubscribes from all service listeners', () => {
    const { service } = createStubService();
    const view = new PiView(service, mount);
    view.render();

    view.destroy();

    const onBlocks = service.onBlocks as unknown as ReturnType<typeof vi.fn>;
    const onMessage = service.onMessage as unknown as ReturnType<typeof vi.fn>;
    const onState = service.onSessionStateChange as unknown as ReturnType<typeof vi.fn>;

    // Each subscription returned a cleanup that we can't spy directly; instead
    // verify the service subscribed 3 times and the view tracked them.
    expect(onBlocks).toHaveBeenCalledTimes(1);
    expect(onMessage).toHaveBeenCalledTimes(1);
    expect(onState).toHaveBeenCalledTimes(1);
  });

  it('destroy() runs the unsubscribe callbacks returned by the service', () => {
    const unsubBlocks = vi.fn();
    const unsubMessage = vi.fn();
    const unsubState = vi.fn();
    const onBlocks = vi.fn(() => unsubBlocks);
    const onMessage = vi.fn(() => unsubMessage);
    const onSessionStateChange = vi.fn(() => unsubState);

    const { service } = createStubService({
      onBlocks,
      onMessage,
      onSessionStateChange,
    });

    const view = new PiView(service, mount);
    view.render();
    view.destroy();

    expect(unsubBlocks).toHaveBeenCalledTimes(1);
    expect(unsubMessage).toHaveBeenCalledTimes(1);
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
    vi.useFakeTimers();
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

  it('adds a copy button to each block that copies block content with a timestamp', () => {
    const writeText = vi.fn(async (_text: string) => {});
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
    const writeText = vi.fn(async (_text: string) => {});
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
    const writeText = vi.fn(async (_text: string) => {});
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
    const writeText = vi.fn(async (_t: string) => {});
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
    vi.useFakeTimers();
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
    vi.useFakeTimers();
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
    vi.useFakeTimers();
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

    const scrollSpy = vi.spyOn(view as unknown as { ensureVisible: () => void }, 'ensureVisible').mockImplementation(() => {});
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
    vi.useFakeTimers();
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
    vi.useFakeTimers();
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
    vi.useFakeTimers();
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
    vi.useFakeTimers();
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
    vi.useFakeTimers();
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
    vi.useFakeTimers();
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
});
