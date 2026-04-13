import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConfirmationDialog } from './ConfirmationDialog.ts';

describe('ConfirmationDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('should render title and message', () => {
    const dialog = new ConfirmationDialog('Confirm Action', 'Are you sure?');
    const dialogElement = dialog['dialog'];
    
    expect(dialogElement.querySelector('h3')?.textContent).toContain('Confirm Action');
    expect(dialogElement.querySelector('p')?.textContent).toBe('Are you sure?');
  });

  it('should render custom labels', () => {
    const dialog = new ConfirmationDialog('Title', 'Message', 'Yes', 'No');
    const dialogElement = dialog['dialog'];
    
    expect(dialogElement.querySelector('#dialog-confirm')?.textContent).toContain('Yes');
    expect(dialogElement.querySelector('#dialog-cancel')?.textContent).toContain('No');
  });

  it('should resolve true on confirm', async () => {
    const dialog = new ConfirmationDialog('Title', 'Message');
    const dialogElement = dialog['dialog'];
    dialogElement.showModal = vi.fn();
    dialogElement.close = vi.fn();
    
    const showPromise = dialog.show();
    
    const confirmBtn = dialogElement.querySelector('#dialog-confirm') as HTMLButtonElement;
    confirmBtn.click();
    
    const result = await showPromise;
    expect(result).toBe(true);
  });

  it('should resolve false on cancel', async () => {
    const dialog = new ConfirmationDialog('Title', 'Message');
    const dialogElement = dialog['dialog'];
    dialogElement.showModal = vi.fn();
    dialogElement.close = vi.fn();
    
    const showPromise = dialog.show();
    
    const cancelBtn = dialogElement.querySelector('#dialog-cancel') as HTMLButtonElement;
    cancelBtn.click();
    
    const result = await showPromise;
    expect(result).toBe(false);
  });
});
