import { describe, it, expect, vi } from 'vitest';
import { ActionRegistry } from '../ActionRegistry';

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
