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
import { ActionRegistry } from './ActionRegistry';

describe('ActionRegistry', () => {
  it('should register and execute a handler', async () => {
    const registry = new ActionRegistry();
    const handler = vi.fn();

    registry.register('test_action', handler);

    const event = new MouseEvent('click');
    const element = document.createElement('button');

    await registry.execute('test_action', event, element);

    expect(handler).toHaveBeenCalledWith(event, element);
  });

  it('should trigger handler on body click with data-action-click', async () => {
    const registry = new ActionRegistry();
    const handler = vi.fn();
    registry.register('test_body_click', handler);

    const button = document.createElement('button');
    button.setAttribute('data-action-click', 'test_body_click');
    document.body.appendChild(button);

    button.click();

    // Small delay for event loop
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(handler).toHaveBeenCalled();
    document.body.removeChild(button);
  });

  it('should not activate a clickable row when an inline editable control is clicked', async () => {
    const registry = new ActionRegistry();
    const handler = vi.fn();
    registry.register('test_nested_control_click', handler);

    const row = document.createElement('div');
    row.setAttribute('data-action-click', 'test_nested_control_click');
    const input = document.createElement('input');
    input.type = 'number';
    row.appendChild(input);
    document.body.appendChild(row);

    input.click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(handler).not.toHaveBeenCalled();
    document.body.removeChild(row);
  });

  it('should execute a click action declared on an editable control itself', async () => {
    const registry = new ActionRegistry();
    const handler = vi.fn();
    registry.register('test_control_click', handler);

    const input = document.createElement('input');
    input.setAttribute('data-action-click', 'test_control_click');
    document.body.appendChild(input);

    input.click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(handler).toHaveBeenCalled();
    document.body.removeChild(input);
  });

  it('should trigger handler on form submit with data-action-submit', async () => {
    const registry = new ActionRegistry();
    const handler = vi.fn();
    registry.register('test_form_submit', handler);

    const form = document.createElement('form');
    form.setAttribute('data-action-submit', 'test_form_submit');
    document.body.appendChild(form);

    const event = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(event);

    // Small delay for event loop
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(handler).toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    document.body.removeChild(form);
  });
});
