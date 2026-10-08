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
import { KeybindingManager } from './KeybindingManager.ts';

// PiView coalesces block reconciliations onto the next animation frame. Tests
// drive that frame manually via flushRaf() so DOM assertions stay synchronous.
let rafCallbacks: Map<number, FrameRequestCallback>;
let rafNextId: number;

function flushRaf() {
  const pending = Array.from(rafCallbacks.values());
  rafCallbacks.clear();
  for (const cb of pending) cb(0);
}

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
    blocks: Set<(blocks: unknown[]) => void>;
    message: Set<(content: string) => void>;
    state: Set<(active: boolean) => void>;
  } = {
    blocks: new Set(),
    message: new Set(),
    state: new Set(),
  };

  const service: PiSessionService = {
    getHistory: vi.fn(() => []),
    getCurrentTaskId: vi.fn(() => null),
    isActive: vi.fn(() => false),
    getSessionStartTime: vi.fn(() => null),
    onSessionStartTimeChange: vi.fn(() => () => {}),
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

  return { service, listeners };
}

/** Dispatch a keydown that bubbles up to the PiView root (as a user keystroke would). */
function press(mount: HTMLElement, init: KeyboardEventInit) {
  mount.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));
}

describe('PiView keyboard shortcuts', () => {
  let mount: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('f toggles follow mode and flashes the follow button', () => {
    const { service } = createStubService();
    const view = new PiView(service, mount);
    view.render();

    const followBtn = mount.querySelector('#follow-btn') as HTMLButtonElement;
    expect(followBtn.textContent).toContain('ON');

    // Enable fake timers so the transient flash can be advanced deterministically.
    vi.useFakeTimers();
    press(mount, { key: 'f' });
    expect(followBtn.textContent).toContain('OFF');
    expect(followBtn.classList.contains('shortcut-active')).toBe(true);

    // Flash is transient.
    vi.advanceTimersByTime(200);
    expect(followBtn.classList.contains('shortcut-active')).toBe(false);

    view.destroy();
  });

  it('c copies the entire log', () => {
    const writeText = vi.fn(async (_t: string) => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { service, listeners } = createStubService();
    const view = new PiView(service, mount);
    view.render();
    listeners.blocks.forEach((l) =>
      l([
        { id: 'a', kind: 'text', text: 'first' },
        { id: 'b', kind: 'error', text: 'boom' },
      ] as never)
    );
    flushRaf();

    press(mount, { key: 'c' });
    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0][0] as string;
    expect(copied).toContain('first');
    expect(copied).toContain('boom');

    view.destroy();
  });

  it('/ focuses the search input (expanding the search bar first)', () => {
    const { service } = createStubService();
    const view = new PiView(service, mount);
    view.render();

    const bar = mount.querySelector('#piview-search-bar') as HTMLElement;
    expect(bar.classList.contains('hidden')).toBe(true);

    press(mount, { key: '/' });
    expect(bar.classList.contains('hidden')).toBe(false);
    const input = mount.querySelector('#piview-search-input') as HTMLInputElement;
    expect(document.activeElement).toBe(input);

    view.destroy();
  });

  it('n / N jump to next / previous error', () => {
    const { service, listeners } = createStubService();
    const view = new PiView(service, mount);
    view.render();
    listeners.blocks.forEach((l) =>
      l([
        { id: 'e1', kind: 'error', text: 'a' },
        { id: 'e2', kind: 'error', text: 'b' },
        { id: 'e3', kind: 'error', text: 'c' },
      ] as never)
    );
    flushRaf();

    const scrollSpy = vi
      .spyOn(view as unknown as { ensureVisible: () => void }, 'ensureVisible')
      .mockImplementation(() => {});

    press(mount, { key: 'n' }); // next
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    press(mount, { key: 'n' }); // next
    expect(scrollSpy).toHaveBeenCalledTimes(2);

    press(mount, { key: 'N', shiftKey: true }); // prev
    expect(scrollSpy).toHaveBeenCalledTimes(3);

    // At the first error, prev does not wrap.
    press(mount, { key: 'N', shiftKey: true });
    expect(scrollSpy).toHaveBeenCalledTimes(3);

    view.destroy();
  });

  it('x clears the log', () => {
    const { service } = createStubService();
    const view = new PiView(service, mount);
    view.render();

    press(mount, { key: 'x' });
    expect(service.clearHistory).toHaveBeenCalledTimes(1);

    view.destroy();
  });

  it('custom keyboardBindings override the defaults', () => {
    const { service } = createStubService();
    const view = new PiView(service, mount, { keyboardBindings: { 'clear-logs': 'q' } });
    view.render();

    // Default 'x' no longer clears.
    press(mount, { key: 'x' });
    expect(service.clearHistory).not.toHaveBeenCalled();

    // Custom 'q' clears instead.
    press(mount, { key: 'q' });
    expect(service.clearHistory).toHaveBeenCalledTimes(1);

    view.destroy();
  });

  it('does not trigger when extra (undeclared) modifiers are held', () => {
    const { service } = createStubService();
    const view = new PiView(service, mount);
    view.render();

    press(mount, { key: 'f', ctrlKey: true });
    const followBtn = mount.querySelector('#follow-btn') as HTMLButtonElement;
    expect(followBtn.textContent).toContain('ON');

    view.destroy();
  });
});

describe('KeybindingManager', () => {
  let host: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('dispatches to the handler on a matching key', () => {
    const handler = vi.fn();
    const kb = new KeybindingManager(host);
    kb.register({ key: 'f', action: 'toggle-follow', handler });
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
    expect(handler).toHaveBeenCalledTimes(1);
    kb.destroy();
  });

  it('ignores non-matching keys', () => {
    const handler = vi.fn();
    const kb = new KeybindingManager(host);
    kb.register({ key: 'f', action: 'toggle-follow', handler });
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'q', bubbles: true }));
    expect(handler).not.toHaveBeenCalled();
    kb.destroy();
  });

  it('does not dispatch while typing inside an editable field', () => {
    const handler = vi.fn();
    const kb = new KeybindingManager(host);
    kb.register({ key: 'c', action: 'copy', handler });
    const input = document.createElement('input');
    host.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }));
    expect(handler).not.toHaveBeenCalled();
    kb.destroy();
  });

  it('supports modifier combos like ctrl+c', () => {
    const handler = vi.fn();
    const kb = new KeybindingManager(host);
    kb.register({ key: 'ctrl+c', action: 'copy', handler });
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }));
    expect(handler).toHaveBeenCalledTimes(1);
    // Plain c does not match a ctrl+c binding.
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', bubbles: true }));
    expect(handler).toHaveBeenCalledTimes(1);
    kb.destroy();
  });

  it('destroy() removes the listener', () => {
    const handler = vi.fn();
    const kb = new KeybindingManager(host);
    kb.register({ key: 'f', action: 'toggle-follow', handler });
    kb.destroy();
    host.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', bubbles: true }));
    expect(handler).not.toHaveBeenCalled();
  });
});
