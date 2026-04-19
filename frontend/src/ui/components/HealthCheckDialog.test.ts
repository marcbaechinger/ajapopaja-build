import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HealthCheckDialog } from './HealthCheckDialog.ts';
import type { AppContext } from '../../core/AppContext.ts';
import type { SystemClient, HealthCheckResponse } from '../../core/clients/SystemClient.ts';

describe('HealthCheckDialog', () => {
  let mockAppContext: unknown;
  let mockGetHealth: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Reset DOM
    document.body.innerHTML = '';
    
    // Mock HTMLDialogElement methods that jsdom might not support
    HTMLDialogElement.prototype.showModal = vi.fn();
    HTMLDialogElement.prototype.close = vi.fn();
    
    // Mock requestAnimationFrame because jsdom might not trigger it properly
    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    };
    
    mockGetHealth = vi.fn().mockResolvedValue({
      mongodb: { status: 'ok', details: 'MongoDB Connected' },
      ollama: { status: 'ok', details: 'Ollama Connected' },
      nvim: { status: 'error', details: 'Socket not found' }
    } as HealthCheckResponse);

    mockAppContext = {
      systemClient: {
        getHealth: mockGetHealth
      } as unknown as SystemClient
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should instantiate without throwing errors (preventing the undefined appContext bug)', () => {
    // Before the fix, this line would throw:
    // TypeError: Cannot read properties of undefined (reading 'systemClient')
    expect(() => new HealthCheckDialog(mockAppContext as AppContext)).not.toThrow();
  });

  it('should call getHealth and render results when shown', async () => {
    const dialog = new HealthCheckDialog(mockAppContext as AppContext);
    
    // show() attaches the dialog to the DOM and calls loadHealthCheck.
    // It returns a promise that resolves when the dialog closes, so we don't await it here.
    dialog.show();
    
    // The dialog animations/rendering rely on requestAnimationFrame, so we mock it or just wait
    // Wait for the show method's internal promises and timeouts (like setTimeout(..., 0))
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(mockGetHealth).toHaveBeenCalledTimes(1);

    // Check if the results are rendered in the DOM
    const dialogEl = document.querySelector('dialog');
    expect(dialogEl).not.toBeNull();
    
    // Assert that the text from the mock response is in the DOM
    const textContent = dialogEl!.textContent || '';
    expect(textContent).toContain('MongoDB');
    expect(textContent).toContain('Ollama');
    expect(textContent).toContain('Neovim Socket');
    
    // Check specific details from our mock
    expect(textContent).toContain('MongoDB Connected');
    expect(textContent).toContain('Ollama Connected');
    expect(textContent).toContain('Socket not found'); // From our mock nvim error
  });
});
