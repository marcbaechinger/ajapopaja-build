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
    thinkingExpanded = true;
    blocksCollapsed = false;
    errorVisible = true;
    following = true;
    constructor(service: any, root: any, options: any) {
      this.service = service;
      this.root = root;
      this.options = options;
      this.blocksCollapsed = options?.blocksCollapsedInitially ?? false;
      piViewInstances.push(this);
    }
    render() {
      this.rendered = true;
    }
    destroy() {
      this.destroyed = true;
    }
    toggleThinking() {
      this.thinkingExpanded = !this.thinkingExpanded;
    }
    toggleBlocksCollapse() {
      this.blocksCollapsed = !this.blocksCollapsed;
    }
    toggleErrorVisibility() {
      this.errorVisible = !this.errorVisible;
    }
    toggleFollow() {
      this.following = !this.following;
    }
    isThinkingExpanded() {
      return this.thinkingExpanded;
    }
    areBlocksCollapsed() {
      return this.blocksCollapsed;
    }
    isErrorVisible() {
      return this.errorVisible;
    }
    isFollowing() {
      return this.following;
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
    pauseSession: vi.fn().mockResolvedValue(undefined),
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

  it('lets the embedded PiView fill the available vertical space', () => {
    view.render();
    // The log grows to fill the tab panel instead of using a fixed height.
    expect(piViewInstances[0].options.fillHeight).toBe(true);
    const mount = root.querySelector('#interactive-piview-mount') as HTMLElement;
    expect(mount.classList.contains('flex-1')).toBe(true);
    expect(mount.classList.contains('min-h-0')).toBe(true);
    // The view shell fills its host mount (the tab panel).
    const shell = root.firstElementChild as HTMLElement;
    expect(shell.classList.contains('flex-1')).toBe(true);
    expect(shell.classList.contains('min-h-0')).toBe(true);
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
    expect(promptViewInstances[0].placeholder).toBe(
      'Session paused — resume it from the session manager.'
    );
  });

  it('renders only the Pause control in the header', () => {
    view.render();
    expect(root.querySelector('#interactive-pause-btn')).not.toBeNull();
    expect(root.querySelector('#interactive-stop-btn')).toBeNull();
    expect(root.querySelector('#interactive-switch-session-btn')).toBeNull();
  });

  it('clicking Pause calls service.pauseSession', async () => {
    view.render();
    (root.querySelector('#interactive-pause-btn') as HTMLButtonElement).click();
    await Promise.resolve();
    expect(service.pauseSession).toHaveBeenCalled();
  });

  it('pauseSession delegates to the onPause callback when provided', async () => {
    const onPause = vi.fn();
    const custom = new InteractiveCodingView(
      service as unknown as InteractiveCodingService,
      root,
      { pipelineId: 'p1', onPause }
    );
    custom.render();
    await custom.pauseSession();
    expect(onPause).toHaveBeenCalled();
    expect(service.pauseSession).not.toHaveBeenCalled();
  });

  it('disables the Pause button while the session is not active', () => {
    service.isActive.mockReturnValue(false);
    view.render();
    const pauseBtn = root.querySelector('#interactive-pause-btn') as HTMLButtonElement;
    expect(pauseBtn.disabled).toBe(true);

    service.isActive.mockReturnValue(true);
    service._fire();
    expect(pauseBtn.disabled).toBe(false);
  });

  it('reflects active / working / paused status and placeholder', () => {
    view.render();
    const status = root.querySelector('#interactive-status') as HTMLElement;
    expect(status.textContent).toBe('Session active');
    expect(promptViewInstances[0].placeholder).toContain('Describe the change');

    service.isBusy.mockReturnValue(true);
    service._fire();
    expect(status.textContent).toBe('Agent working…');
    expect(promptViewInstances[0].placeholder).toContain('working');

    service.isBusy.mockReturnValue(false);
    service.isActive.mockReturnValue(false);
    service._fire();
    expect(status.textContent).toBe('Paused');
    expect(promptViewInstances[0].placeholder).toContain('Session paused');
  });

  it('renders the four display toggle buttons in the header', () => {
    view.render();
    expect(root.querySelector('#interactive-follow-toggle-btn')).not.toBeNull();
    expect(root.querySelector('#interactive-thinking-toggle-btn')).not.toBeNull();
    expect(root.querySelector('#interactive-collapse-blocks-btn')).not.toBeNull();
    expect(root.querySelector('#interactive-error-toggle-btn')).not.toBeNull();
  });

  it('renders the follow toggle as pressed by default', () => {
    view.render();
    const followBtn = root.querySelector('#interactive-follow-toggle-btn') as HTMLButtonElement;
    expect(followBtn.getAttribute('aria-pressed')).toBe('true');
    expect(followBtn.getAttribute('aria-label')).toBe('Disable follow mode');
    expect(piViewInstances[0].following).toBe(true);
  });

  it('wires the header follow button to the PiView follow toggle', () => {
    view.render();
    const pi = piViewInstances[0];
    const followBtn = root.querySelector('#interactive-follow-toggle-btn') as HTMLButtonElement;

    followBtn.click();
    expect(pi.following).toBe(false);
    expect(followBtn.getAttribute('aria-pressed')).toBe('false');
    expect(followBtn.getAttribute('aria-label')).toBe('Enable follow mode');

    followBtn.click();
    expect(pi.following).toBe(true);
    expect(followBtn.getAttribute('aria-pressed')).toBe('true');
    expect(followBtn.getAttribute('aria-label')).toBe('Disable follow mode');
  });

  it('collapses tool blocks by default in the embedded PiView', () => {
    view.render();
    expect(piViewInstances[0].options.blocksCollapsedInitially).toBe(true);
    expect(piViewInstances[0].blocksCollapsed).toBe(true);

    const collapseBtn = root.querySelector('#interactive-collapse-blocks-btn') as HTMLButtonElement;
    expect(collapseBtn.getAttribute('aria-pressed')).toBe('true');
    expect(collapseBtn.getAttribute('aria-label')).toBe('Expand all blocks');
  });

  it('wires the header display buttons to the PiView toggles', () => {
    view.render();
    const pi = piViewInstances[0];

    const thinkingBtn = root.querySelector('#interactive-thinking-toggle-btn') as HTMLButtonElement;
    const collapseBtn = root.querySelector('#interactive-collapse-blocks-btn') as HTMLButtonElement;
    const errorBtn = root.querySelector('#interactive-error-toggle-btn') as HTMLButtonElement;

    thinkingBtn.click();
    expect(pi.thinkingExpanded).toBe(false);
    expect(thinkingBtn.getAttribute('aria-pressed')).toBe('false');

    collapseBtn.click();
    expect(pi.blocksCollapsed).toBe(false);
    expect(collapseBtn.getAttribute('aria-pressed')).toBe('false');

    collapseBtn.click();
    expect(pi.blocksCollapsed).toBe(true);
    expect(collapseBtn.getAttribute('aria-pressed')).toBe('true');

    errorBtn.click();
    expect(pi.errorVisible).toBe(false);
    expect(errorBtn.getAttribute('aria-pressed')).toBe('false');
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
