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
import type { Mock } from 'vitest';
import { InteractivePromptView } from './InteractivePromptView.ts';
import type { InteractivePromptViewOptions } from './InteractivePromptView.ts';

describe('InteractivePromptView', () => {
  let root: HTMLElement;
  let onSubmit: Mock<(text: string) => void | Promise<void>>;
  let actionHandlers: Record<string, Mock<() => void>>;

  beforeEach(() => {
    document.body.innerHTML = '';
    root = document.createElement('div');
    document.body.appendChild(root);
    onSubmit = vi.fn().mockResolvedValue(undefined);
    actionHandlers = { '/clear': vi.fn() };
    window.alert = vi.fn();
  });

  function mount(overrides: Partial<InteractivePromptViewOptions> = {}) {
    const view = new InteractivePromptView(root, {
      onSubmit,
      context: 'interactive',
      getPipelineId: () => 'p1',
      actionHandlers,
      ...overrides,
    });
    view.render();
    return view;
  }

  function inputEl(): HTMLTextAreaElement {
    return root.querySelector('#interactive-prompt-input') as HTMLTextAreaElement;
  }

  function sendEl(): HTMLButtonElement {
    return root.querySelector('#interactive-prompt-send') as HTMLButtonElement;
  }

  function options(): NodeListOf<HTMLElement> {
    return root.querySelectorAll('[role="option"]');
  }

  function type(value: string): void {
    const el = inputEl();
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function key(value: string, init: KeyboardEventInit = {}): void {
    inputEl().dispatchEvent(
      new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...init })
    );
  }

  async function flush(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it('renders the textarea and Send button', () => {
    mount();
    expect(inputEl()).toBeTruthy();
    expect(sendEl()).toBeTruthy();
  });

  it('opens the menu when the value starts with a slash', () => {
    mount();
    type('/');
    expect(options().length).toBeGreaterThan(1);
    expect(root.querySelector('[role="listbox"]')).toBeTruthy();
  });

  it('does not offer the menu once the value stops being a leading slash', () => {
    mount();
    type('/');
    expect(options().length).toBeGreaterThan(0);

    type('  /clear');
    expect(options()).toHaveLength(0);
  });

  it('narrows the matches as the user keeps typing', () => {
    mount();
    type('/cl');
    const text = root.textContent ?? '';
    expect(text).toContain('/clear');
    expect(text).not.toContain('/backlog');
  });

  it('expands a prompt command selected with ArrowDown + Enter without submitting', () => {
    mount();
    type('/b');
    key('ArrowDown');
    key('Enter');

    expect(onSubmit).not.toHaveBeenCalled();
    expect(inputEl().value).toBe('Show me the build commands to build the app of pipeline p1');
    expect(inputEl().selectionStart).toBe(inputEl().value.length);
    expect(options()).toHaveLength(0);
  });

  it('substitutes the pipeline id resolved through getPipelineId', () => {
    mount({ getPipelineId: () => 'xyz' });
    type('/pr');
    key('Enter');
    expect(inputEl().value).toBe('Show me the project structure of pipeline xyz');
  });

  it('expands the interactive-only /pipelines template', () => {
    mount();
    type('/pi');
    key('Enter');

    expect(onSubmit).not.toHaveBeenCalled();
    expect(inputEl().value).toBe('Show me the available pipelines');
  });

  it('expands the interactive-only /backlog template', () => {
    mount({ getPipelineId: () => 'p1' });
    type('/ba');
    key('Enter');

    expect(inputEl().value).toBe(
      'Show me the tasks in the backlog (state CREATED) of pipeline p1'
    );
  });

  it('does not offer interactive-only commands to another host', () => {
    mount({ context: 'assistant' });
    type('/');
    const text = root.textContent ?? '';
    expect(text).not.toContain('/backlog');
    expect(text).not.toContain('/pipelines');
  });

  it('executes an action command and clears the input', () => {
    mount();
    type('/clear');
    key('Enter');

    expect(actionHandlers['/clear']).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(inputEl().value).toBe('');
    expect(options()).toHaveLength(0);
  });

  it('closes the menu on ESC and preserves the typed text', () => {
    mount();
    type('/cl');
    key('Escape');

    expect(options()).toHaveLength(0);
    expect(inputEl().value).toBe('/cl');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits trimmed text with Enter when the menu is closed and clears on success', async () => {
    mount();
    type('  hello world  ');
    key('Enter');
    await flush();

    expect(onSubmit).toHaveBeenCalledWith('hello world');
    expect(inputEl().value).toBe('');
  });

  it('does not submit an empty value', async () => {
    mount();
    key('Enter');
    await flush();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('does not submit on Shift+Enter', () => {
    mount();
    type('hello');
    key('Enter', { shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(inputEl().value).toBe('hello');
  });

  it('keeps the text when onSubmit rejects', async () => {
    onSubmit.mockRejectedValueOnce(new Error('boom'));
    mount();
    type('hello');
    key('Enter');
    await flush();

    expect(inputEl().value).toBe('hello');
    expect(window.alert).toHaveBeenCalled();
  });

  it('submits when the Send button is clicked', async () => {
    mount();
    type('click me');
    sendEl().click();
    await flush();
    expect(onSubmit).toHaveBeenCalledWith('click me');
  });

  it('disables the textarea and Send button and closes the menu', () => {
    const view = mount();
    type('/');
    expect(options().length).toBeGreaterThan(0);

    view.setDisabled(true);
    expect(inputEl().disabled).toBe(true);
    expect(sendEl().disabled).toBe(true);
    expect(sendEl().classList.contains('opacity-50')).toBe(true);
    expect(sendEl().classList.contains('cursor-not-allowed')).toBe(true);
    expect(options()).toHaveLength(0);

    view.setDisabled(false);
    expect(inputEl().disabled).toBe(false);
    expect(sendEl().disabled).toBe(false);
  });

  it('updates the placeholder and exposes the value', () => {
    const view = mount();
    view.setPlaceholder('Waiting…');
    expect(inputEl().placeholder).toBe('Waiting…');

    type('some text');
    expect(view.getValue()).toBe('some text');
  });

  it('destroys the view', () => {
    const view = mount();
    view.destroy();
    expect(root.innerHTML).toBe('');
  });
});
