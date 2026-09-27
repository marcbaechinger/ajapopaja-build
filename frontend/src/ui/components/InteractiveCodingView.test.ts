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

const { piViewInstances, promptViewInstances } = vi.hoisted(() => ({
  piViewInstances: [] as any[],
  promptViewInstances: [] as any[],
}));

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

vi.mock('./InteractivePromptView.ts', () => {
  class InteractivePromptView {
    root: any;
    options: any;
    rendered = false;
    destroyed = false;
    disabled = false;
    placeholder = '';
    focused = false;
    constructor(root: any, options: any) {
      this.root = root;
      this.options = options;
      promptViewInstances.push(this);
    }
    render() {
      this.rendered = true;
    }
    destroy() {
      this.destroyed = true;
    }
    setDisabled(disabled: boolean) {
      this.disabled = disabled;
    }
    setPlaceholder(text: string) {
      this.placeholder = text;
    }
    focus() {
      this.focused = true;
    }
    getValue() {
      return '';
    }
    submit() {
      return Promise.resolve();
    }
  }
  return { InteractivePromptView };
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
    promptViewInstances.length = 0;
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

  it('mounts the InteractivePromptView into the composer slot', () => {
    view.render();
    expect(promptViewInstances).toHaveLength(1);
    expect(promptViewInstances[0].rendered).toBe(true);
    expect(promptViewInstances[0].root.id).toBe('interactive-prompt-mount');
    expect(promptViewInstances[0].focused).toBe(true);
  });

  it('wires the prompt onSubmit to the service and the /clear action handler', async () => {
    view.render();
    const prompt = promptViewInstances[0];

    await prompt.options.onSubmit('hello');
    expect(service.sendMessage).toHaveBeenCalledWith('hello');

    prompt.options.actionHandlers['/clear']();
    expect(service.clearHistory).toHaveBeenCalled();
  });

  it('resolves the pipeline id for prompt templates', () => {
    view.render();
    expect(promptViewInstances[0].options.getPipelineId()).toBe('p1');
  });

  it('sendMessage delegates to the prompt view submit', async () => {
    view.render();
    const prompt = promptViewInstances[0];
    const submitSpy = vi.spyOn(prompt, 'submit');
    await view.sendMessage();
    expect(submitSpy).toHaveBeenCalled();
  });

  it('disables the prompt view while a turn is in flight', () => {
    view.render();
    expect(promptViewInstances[0].disabled).toBe(false);

    service.isBusy.mockReturnValue(true);
    service._fire();

    expect(promptViewInstances[0].disabled).toBe(true);
    expect(promptViewInstances[0].placeholder).toContain('working');
  });

  it('disables the prompt view when the session is not active', () => {
    service.isActive.mockReturnValue(false);
    view.render();
    expect(promptViewInstances[0].disabled).toBe(true);
    expect(promptViewInstances[0].placeholder).toBe('Session stopped.');
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

  it('destroy tears down the inner PiView and prompt view', () => {
    view.render();
    const innerPi = piViewInstances[0];
    const innerPrompt = promptViewInstances[0];
    view.destroy();
    expect(innerPi.destroyed).toBe(true);
    expect(innerPrompt.destroyed).toBe(true);
    expect(root.innerHTML).toBe('');
  });
});
