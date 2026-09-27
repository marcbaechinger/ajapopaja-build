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
import { InteractiveCodingView } from './InteractiveCodingView.ts';
import type { InteractiveCodingService } from '../../core/InteractiveCodingService.ts';

const { piViewInstances } = vi.hoisted(() => ({ piViewInstances: [] as any[] }));

vi.mock('./PiView.ts', () => {
  class PiView {
    service: any;
    root: any;
    options: any;
    rendered = false;
    destroyed = false;
    constructor(service: any, root: any, options: any) {
      this.service = service;
      this.root = root;
      this.options = options;
      piViewInstances.push(this);
    }
    render() {
      this.rendered = true;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  return { PiView };
});

function makeService() {
  const listeners = new Set<() => void>();
  const stateListeners = new Set<() => void>();
  return {
    isBusy: vi.fn(() => false),
    isActive: vi.fn(() => true),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    stopSession: vi.fn().mockResolvedValue(undefined),
    getHistory: vi.fn(() => []),
    getCurrentTaskId: vi.fn(() => 'p1'),
    getSessionStartTime: vi.fn(() => null),
    clearHistory: vi.fn(),
    onBlocks: vi.fn(() => () => {}),
    onMessage: vi.fn(() => () => {}),
    onSessionStateChange: vi.fn((l: () => void) => {
      stateListeners.add(l);
      return () => stateListeners.delete(l);
    }),
    onSessionStartTimeChange: vi.fn(() => () => {}),
    onSessionChange: vi.fn((l: () => void) => {
      listeners.add(l);
      return () => listeners.delete(l);
    }),
    _fire: () => {
      listeners.forEach((l) => l());
      stateListeners.forEach((l) => l());
    },
  };
}

describe('InteractiveCodingView', () => {
  let service: ReturnType<typeof makeService>;
  let root: HTMLElement;
  let view: InteractiveCodingView;

  beforeEach(() => {
    piViewInstances.length = 0;
    document.body.innerHTML = '';
    root = document.createElement('div');
    document.body.appendChild(root);
    service = makeService();
    view = new InteractiveCodingView(
      service as unknown as InteractiveCodingService,
      root,
      { pipelineId: 'p1' }
    );
  });

  it('mounts the reused PiView with showFooter disabled', () => {
    view.render();
    expect(piViewInstances).toHaveLength(1);
    expect(piViewInstances[0].rendered).toBe(true);
    expect(piViewInstances[0].options.showFooter).toBe(false);
    expect(piViewInstances[0].root.id).toBe('interactive-piview-mount');
  });

  it('sendMessage sends the composer text and clears it', async () => {
    view.render();
    const textarea = root.querySelector('#interactive-message-input') as HTMLTextAreaElement;
    textarea.value = '  please fix it  ';
    await view.sendMessage();
    expect(service.sendMessage).toHaveBeenCalledWith('please fix it');
    expect(textarea.value).toBe('');
  });

  it('does not send an empty message', async () => {
    view.render();
    await view.sendMessage();
    expect(service.sendMessage).not.toHaveBeenCalled();
  });

  it('disables the composer while a turn is in flight', () => {
    view.render();
    service.isBusy.mockReturnValue(true);
    service._fire();
    const sendBtn = root.querySelector('#interactive-send-btn') as HTMLButtonElement;
    const textarea = root.querySelector('#interactive-message-input') as HTMLTextAreaElement;
    expect(sendBtn.disabled).toBe(true);
    expect(textarea.disabled).toBe(true);
  });

  it('clicking Send invokes the service', async () => {
    view.render();
    const textarea = root.querySelector('#interactive-message-input') as HTMLTextAreaElement;
    textarea.value = 'hello';
    (root.querySelector('#interactive-send-btn') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(service.sendMessage).toHaveBeenCalledWith('hello');
  });

  it('stopSession calls the service by default', async () => {
    view.render();
    await view.stopSession();
    expect(service.stopSession).toHaveBeenCalledWith('p1');
  });

  it('stopSession delegates to the onStop callback when provided', async () => {
    const onStop = vi.fn();
    const custom = new InteractiveCodingView(
      service as unknown as InteractiveCodingService,
      root,
      { pipelineId: 'p1', onStop }
    );
    custom.render();
    await custom.stopSession();
    expect(onStop).toHaveBeenCalled();
    expect(service.stopSession).not.toHaveBeenCalled();
  });

  it('destroy tears down the inner PiView', () => {
    view.render();
    const inner = piViewInstances[0];
    view.destroy();
    expect(inner.destroyed).toBe(true);
    expect(root.innerHTML).toBe('');
  });
});
