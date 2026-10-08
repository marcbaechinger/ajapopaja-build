import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HealthCheckDialog } from './HealthCheckDialog.ts';
import type { AppContext } from '../../../core/AppContext.ts';
import type {
  SystemClient,
  HealthCheckResponse,
  ConfigProperty
} from '../../../core/clients/SystemClient.ts';

describe('HealthCheckDialog', () => {
  let mockAppContext: unknown;
  let mockGetHealth: ReturnType<typeof vi.fn>;
  let mockGetConfig: ReturnType<typeof vi.fn>;

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
      nvim: { status: 'error', details: 'Socket not found' },
      pi: { status: 'ok', details: 'pi is installed' }
    } as HealthCheckResponse);

    mockGetConfig = vi.fn().mockResolvedValue([
      { key: 'OLLAMA_MODEL', value: 'gpt-oss:20b', confidential: false },
      { key: 'BASEBOT_LOG_ENABLED', value: 'true', confidential: false },
      { key: 'OLLAMA_API_KEY', value: '(stored)', confidential: true },
      { key: 'GIT_PUSH_TOKEN', value: '(not available)', confidential: true }
    ] as ConfigProperty[]);

    mockAppContext = {
      systemClient: {
        getHealth: mockGetHealth,
        getConfigProperties: mockGetConfig
      } as unknown as SystemClient
    };
  });

  afterEach(() => {
    // BaseDialog keeps a static reference to the currently open dialog. Tests
    // must close it so the next test can open a fresh dialog.
    document
      .querySelectorAll<HTMLButtonElement>('#dialog-close-btn')
      .forEach((btn) => btn.click());
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
    expect(textContent).toContain('PI');

    // Check specific details from our mock
    expect(textContent).toContain('MongoDB Connected');
    expect(textContent).toContain('Ollama Connected');
    expect(textContent).toContain('Socket not found'); // From our mock nvim error
    expect(textContent).toContain('pi is installed'); // From our mock pi status
  });

  it('loads configuration properties when shown', async () => {
    const dialog = new HealthCheckDialog(mockAppContext as AppContext);
    dialog.show();
    await new Promise(resolve => setTimeout(resolve, 100));

    expect(mockGetConfig).toHaveBeenCalledTimes(1);
  });

  it('renders the configuration tab with keys, values and redacted secrets', async () => {
    const dialog = new HealthCheckDialog(mockAppContext as AppContext);
    dialog.show();
    await new Promise(resolve => setTimeout(resolve, 100));

    const configTab = document.querySelector(
      '[data-health-tab="config"]'
    ) as HTMLButtonElement;
    expect(configTab).not.toBeNull();
    configTab.click();

    const textContent = document.querySelector('dialog')!.textContent || '';
    expect(textContent).toContain('OLLAMA_MODEL');
    expect(textContent).toContain('gpt-oss:20b');
    expect(textContent).toContain('BASEBOT_LOG_ENABLED');
    expect(textContent).toContain('OLLAMA_API_KEY');
    expect(textContent).toContain('(stored)');
    expect(textContent).toContain('GIT_PUSH_TOKEN');
    expect(textContent).toContain('(not available)');

    // Secret values must never be rendered verbatim.
    expect(textContent).not.toContain('super-secret-api-key-value');
  });

  it('filters configuration properties by the search box', async () => {
    const dialog = new HealthCheckDialog(mockAppContext as AppContext);
    dialog.show();
    await new Promise(resolve => setTimeout(resolve, 100));

    (document.querySelector('[data-health-tab="config"]') as HTMLButtonElement).click();

    const filterInput = document.querySelector(
      '#hc-config-filter'
    ) as HTMLInputElement;
    expect(filterInput).not.toBeNull();
    filterInput.value = 'OLLAMA';
    filterInput.dispatchEvent(new Event('input'));

    const list = document.querySelector('#hc-config-list')!.textContent || '';
    expect(list).toContain('OLLAMA_MODEL');
    expect(list).not.toContain('BASEBOT_LOG_ENABLED');
  });

  it('renders a config error state when loading configuration fails', async () => {
    mockGetConfig.mockRejectedValueOnce(new Error('backend offline'));
    const dialog = new HealthCheckDialog(mockAppContext as AppContext);
    dialog.show();
    await new Promise(resolve => setTimeout(resolve, 100));

    (document.querySelector('[data-health-tab="config"]') as HTMLButtonElement).click();

    const textContent = document.querySelector('dialog')!.textContent || '';
    expect(textContent).toContain('Failed to load configuration');
  });
});
