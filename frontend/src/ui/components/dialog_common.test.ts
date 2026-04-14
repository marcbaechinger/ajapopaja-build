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

  it('should not show new dialog of same type when one is already showing', async () => {
    const dialog1 = new TestDialog();
    const dialog2 = new TestDialog();
    
    dialog1['dialog'].showModal = vi.fn();
    dialog1['dialog'].close = vi.fn();
    dialog2['dialog'].showModal = vi.fn();
    dialog2['dialog'].close = vi.fn();
    
    const showPromise1 = dialog1.show();
    expect(document.body.contains(dialog1['dialog'])).toBe(true);
    
    const showPromise2 = dialog2.show();
    // dialog2 should NOT be in the body
    expect(document.body.contains(dialog2['dialog'])).toBe(false);
    expect(dialog2['dialog'].showModal).not.toHaveBeenCalled();
    
    // dialog1 should still be open
    expect(dialog1['dialog'].close).not.toHaveBeenCalled();
    
    // showPromise2 should have resolved with null
    const result2 = await showPromise2;
    expect(result2).toBe(null);
    
    // Cleanup dialog1
    dialog1['close']('done');
    await showPromise1;
  });

  it('should apply shake animation when duplicate dialog is attempted', async () => {
    const dialog1 = new TestDialog();
    const dialog2 = new TestDialog();
    
    dialog1['dialog'].showModal = vi.fn();
    dialog1['dialog'].close = vi.fn();
    dialog2['dialog'].showModal = vi.fn();
    dialog2['dialog'].close = vi.fn();
    
    const showPromise1 = dialog1.show();
    const content1 = dialog1['dialog'].querySelector('.dialog-content');
    expect(content1?.classList.contains('animate-dialog-shake')).toBe(false);
    
    const showPromise2 = dialog2.show();
    expect(content1?.classList.contains('animate-dialog-shake')).toBe(true);
    
    // Cleanup
    dialog1['close'](null);
    await showPromise1;
    await showPromise2;
  });
});
