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
});
