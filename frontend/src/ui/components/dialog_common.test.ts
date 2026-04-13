import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BaseDialog } from './dialog_common.ts';

class TestDialog extends BaseDialog<string> {
  constructor() {
    super({ title: 'Test Dialog' });
  }
  protected renderBody() {
    return '<div id="test-body">Body</div>';
  }
  protected renderFooter() {
    return '<button id="test-btn">Submit</button>';
  }
}

describe('BaseDialog', () => {
  let dialog: TestDialog;

  beforeEach(() => {
    document.body.innerHTML = '';
    dialog = new TestDialog();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should render title and body', () => {
    const dialogElement = dialog['dialog'];
    expect(dialogElement.querySelector('h3')?.textContent).toContain('Test Dialog');
    expect(dialogElement.querySelector('#test-body')?.textContent).toBe('Body');
    expect(dialogElement.querySelector('#test-btn')?.textContent).toBe('Submit');
  });

  it('should append to body on show', async () => {
    // Mock showModal since JSDOM doesn't implement it
    const showModalSpy = vi.fn();
    dialog['dialog'].showModal = showModalSpy;
    
    const showPromise = dialog.show();
    
    expect(document.body.contains(dialog['dialog'])).toBe(true);
    expect(showModalSpy).toHaveBeenCalled();
    
    // Cleanup
    dialog['close']('result');
    await showPromise;
  });

  it('should resolve promise on close', async () => {
    const showModalSpy = vi.fn();
    dialog['dialog'].showModal = showModalSpy;
    dialog['dialog'].close = vi.fn();
    
    const showPromise = dialog.show();
    dialog['close']('success');
    
    const result = await showPromise;
    expect(result).toBe('success');
  });

  it('should remove from body after cleanup', async () => {
    vi.useFakeTimers();
    const showModalSpy = vi.fn();
    dialog['dialog'].showModal = showModalSpy;
    dialog['dialog'].close = vi.fn();
    
    const showPromise = dialog.show();
    dialog['close'](null);
    
    await showPromise;
    
    expect(document.body.contains(dialog['dialog'])).toBe(true);
    
    vi.advanceTimersByTime(350);
    
    expect(document.body.contains(dialog['dialog'])).toBe(false);
  });

  it('should close existing dialog of same type when showing new one', async () => {
    const dialog1 = new TestDialog();
    const dialog2 = new TestDialog();
    
    dialog1['dialog'].showModal = vi.fn();
    dialog1['dialog'].close = vi.fn();
    dialog2['dialog'].showModal = vi.fn();
    dialog2['dialog'].close = vi.fn();
    
    const showPromise1 = dialog1.show();
    expect(document.body.contains(dialog1['dialog'])).toBe(true);
    
    const showPromise2 = dialog2.show();
    expect(document.body.contains(dialog2['dialog'])).toBe(true);
    
    // dialog1 should have been closed
    const result1 = await showPromise1;
    expect(result1).toBe(null);
    
    // Cleanup dialog2
    dialog2['close']('done');
    await showPromise2;
  });
});
