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
import { LogViewerDialog } from './LogViewerDialog.ts';
import { Icon } from './Icon.ts';

// Mock AuthService
const mockGetAccessToken = vi.fn().mockReturnValue('mock-token');
const mockAuthService = {
  getAccessToken: mockGetAccessToken
} as any;

// Mock Icon.render
vi.mock('./Icon.ts', () => ({
  Icon: {
    render: vi.fn().mockReturnValue('<svg icon="mock"></svg>')
  }
}));

// Mock fetch globally before any tests
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('LogViewerDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
    
    mockFetch.mockResolvedValue({
      ok: true,
      body: {
        getReader: () => ({
          read: async () => ({ done: true, value: undefined })
        })
      }
    });
    
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb: any) => {
      cb();
      return 1 as unknown as number;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Rendering', () => {
    it('should create a dialog with the correct title', () => {
      const dialog = new LogViewerDialog('/mock/stream/url', mockAuthService);
      const dialogElement = dialog['dialog'];
      
      expect(dialogElement).toBeTruthy();
      expect(dialogElement.tagName.toLowerCase()).toBe('dialog');
      
      const title = dialogElement.querySelector('h3');
      expect(title?.textContent).toContain('Gemini Engine Logs');
    });

    it('should render the log content container with correct structure', () => {
      const dialog = new LogViewerDialog('/mock/stream/url', mockAuthService);
      const dialogElement = dialog['dialog'];
      document.body.appendChild(dialogElement);

      const logContainer = dialogElement.querySelector('#log-content-container');
      expect(logContainer).toBeTruthy();
      expect(logContainer?.className).toContain('bg-black');
      expect(logContainer?.className).toContain('text-green-400');
      expect(logContainer?.className).toContain('font-mono');
      expect(logContainer?.className).toContain('custom-scrollbar');
      
      const logLines = dialogElement.querySelector('#log-lines');
      expect(logLines).toBeTruthy();
      expect(logLines?.className).toContain('whitespace-pre-wrap');
    });

    it('should render the footer with Follow Mode and Clear buttons', () => {
      const dialog = new LogViewerDialog('/mock/stream/url', mockAuthService);
      const dialogElement = dialog['dialog'];
      document.body.appendChild(dialogElement);

      const followBtn = dialogElement.querySelector('#follow-btn');
      expect(followBtn).toBeTruthy();
      expect(followBtn?.textContent).toContain('Follow Mode: ON');
      expect(followBtn?.getAttribute('data-action')).toBe('toggle-follow');

      const clearBtn = dialogElement.querySelector('[data-action="clear-logs"]');
      expect(clearBtn).toBeTruthy();
      expect(clearBtn?.textContent).toContain('Clear');

      const closeBtn = dialogElement.querySelector('#dialog-footer-close-btn');
      expect(closeBtn).toBeTruthy();
      expect(closeBtn?.textContent).toContain('Close');
    });

    it('should have icon in the dialog header', () => {
      const dialog = new LogViewerDialog('/mock/stream/url', mockAuthService);
      const dialogElement = dialog['dialog'];
      document.body.appendChild(dialogElement);

      const iconSvg = dialogElement.querySelector('.text-app-accent-2 svg');
      expect(iconSvg).toBeTruthy();
      expect(Icon.render).toHaveBeenCalledWith('documentation', { size: 20 });
    });

    it('should have log-lines container', () => {
      const dialog = new LogViewerDialog('/mock/stream/url', mockAuthService);
      const dialogElement = dialog['dialog'];
      document.body.appendChild(dialogElement);

      const logLines = dialogElement.querySelector('#log-lines');
      expect(logLines).toBeTruthy();
      expect(logLines?.className).toContain('whitespace-pre-wrap');
    });

    it('should have close button', () => {
      const dialog = new LogViewerDialog('/mock/stream/url', mockAuthService);
      const dialogElement = dialog['dialog'];
      document.body.appendChild(dialogElement);

      const closeBtn = dialogElement.querySelector('#dialog-footer-close-btn');
      expect(closeBtn).toBeTruthy();
      expect(closeBtn?.textContent).toContain('Close');
    });
  });

  describe('Button Interactions', () => {
    it('should toggle follow mode when clicked', () => {
      const dialog = new LogViewerDialog('/mock/stream/url', mockAuthService);
      const dialogElement = dialog['dialog'];
      document.body.appendChild(dialogElement);

      const followBtn = dialogElement.querySelector('#follow-btn') as HTMLElement;
      expect(followBtn?.textContent).toContain('Follow Mode: ON');

      // Click to toggle off
      followBtn?.click();
      expect(followBtn?.textContent).toContain('Follow Mode: OFF');
      expect(followBtn?.className).toContain('bg-app-surface');

      // Click to toggle on
      followBtn?.click();
      expect(followBtn?.textContent).toContain('Follow Mode: ON');
      expect(followBtn?.className).toContain('bg-app-accent-1');
    });

    it('should clear logs when clear button is clicked', () => {
      const dialog = new LogViewerDialog('/mock/stream/url', mockAuthService);
      const dialogElement = dialog['dialog'];
      document.body.appendChild(dialogElement);

      const logLines = dialogElement.querySelector('#log-lines');
      if (logLines) logLines.innerHTML = '<span>Test log line</span>';
      expect(logLines?.innerHTML).toBe('<span>Test log line</span>');

      const clearBtn = dialogElement.querySelector('[data-action="clear-logs"]');
      clearBtn?.click();

      expect(logLines?.innerHTML).toBe('');
    });

    it('should have close method', () => {
      const dialog = new LogViewerDialog('/mock/stream/url', mockAuthService);
      expect(dialog.close).toBeDefined();
      expect(typeof dialog.close).toBe('function');
    });
  });

  describe('Stream Integration', () => {
    it('should fetch the stream URL with authorization header', async () => {
      const mockResponse = {
        ok: true,
        body: {
          getReader: () => ({
            read: async () => ({ done: true, value: undefined })
          })
        }
      };
      
      mockFetch.mockResolvedValue(mockResponse);

      new LogViewerDialog('/mock/stream/url', mockAuthService);

      // Wait for fetch to be called
      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockFetch).toHaveBeenCalledWith('/mock/stream/url', expect.any(Object));

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[1].headers['Authorization']).toBe('Bearer mock-token');
    });

    it('should handle stream data and append to log container', async () => {
      const mockStreamData = new TextEncoder().encode('Test log entry\n');
      let readCallCount = 0;
      const mockReader = {
        read: vi.fn().mockImplementation(() => {
          readCallCount++;
          if (readCallCount === 1) {
            return Promise.resolve({ done: false, value: mockStreamData });
          }
          return Promise.resolve({ done: true, value: undefined });
        })
      };

      const mockResponse = {
        ok: true,
        body: {
          getReader: () => mockReader
        }
      };

      mockFetch.mockResolvedValue(mockResponse);

      const dialog = new LogViewerDialog('/mock/stream/url', mockAuthService);
      const dialogElement = dialog['dialog'];
      document.body.appendChild(dialogElement);

      // Force microtasks
      await new Promise(resolve => setTimeout(resolve, 10));

      const logLines = dialogElement.querySelector('#log-lines');
      expect(logLines?.textContent).toContain('Test log entry');
    });

    it('should handle streaming chunk by chunk', async () => {
      const chunks = [
        new TextEncoder().encode('Line 1\n'),
        new TextEncoder().encode('Line 2\n')
      ];
      let chunkIndex = 0;

      const mockReader = {
        read: vi.fn().mockImplementation(() => {
          if (chunkIndex < chunks.length) {
            const chunk = chunks[chunkIndex++];
            return Promise.resolve({ done: false, value: chunk });
          }
          return Promise.resolve({ done: true, value: undefined });
        })
      };

      const mockResponse = {
        ok: true,
        body: {
          getReader: () => mockReader
        }
      };

      mockFetch.mockResolvedValue(mockResponse);

      const dialog = new LogViewerDialog('/mock/stream/url', mockAuthService);
      const dialogElement = dialog['dialog'];
      document.body.appendChild(dialogElement);
      
      // Force microtasks
      await new Promise(resolve => setTimeout(resolve, 10));

      const logLines = dialogElement.querySelector('#log-lines');
      expect(logLines?.textContent).toContain('Line 1');
      expect(logLines?.textContent).toContain('Line 2');
    });

    it('should handle non-OK response', async () => {
      const mockResponse = {
        ok: false,
        statusText: 'Unauthorized'
      };

      mockFetch.mockResolvedValue(mockResponse);

      const dialog = new LogViewerDialog('/mock/stream/url', mockAuthService);
      const dialogElement = dialog['dialog'];
      document.body.appendChild(dialogElement);

      await new Promise(resolve => setTimeout(resolve, 10));

      const logLines = dialogElement.querySelector('#log-lines');
      expect(logLines?.innerHTML).toContain('Failed to connect to log stream: Unauthorized');
    });

    it('should handle missing response body', async () => {
      const mockResponse = {
        ok: true,
        body: null
      };

      mockFetch.mockResolvedValue(mockResponse);

      const dialog = new LogViewerDialog('/mock/stream/url', mockAuthService);
      const dialogElement = dialog['dialog'];
      document.body.appendChild(dialogElement);

      await new Promise(resolve => setTimeout(resolve, 10));

      const logLines = dialogElement.querySelector('#log-lines');
      expect(logLines?.innerHTML).toContain('Response body is not readable');
    });

    it('should handle AbortError gracefully', async () => {
      const abortError = { name: 'AbortError' };
      
      const mockReader = {
        read: vi.fn().mockRejectedValueOnce(abortError)
      };

      const mockResponse = {
        ok: true,
        body: {
          getReader: () => mockReader
        }
      };

      mockFetch.mockResolvedValue(mockResponse);
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      const dialog = new LogViewerDialog('/mock/stream/url', mockAuthService);
      await new Promise(resolve => setTimeout(resolve, 10));

      // AbortError should be caught and not logged as an error
      expect(consoleErrorSpy).not.toHaveBeenCalled();
      consoleErrorSpy.mockRestore();
    });
  });

  describe('Follow Mode', () => {
    it('should start with follow mode enabled', () => {
      const dialog = new LogViewerDialog('/mock/stream/url', mockAuthService);
      const dialogElement = dialog['dialog'];
      document.body.appendChild(dialogElement);

      const followBtn = dialogElement.querySelector('#follow-btn');
      expect(followBtn?.textContent).toContain('Follow Mode: ON');
    });

    it('should maintain follow mode state through toggle', () => {
      const dialog = new LogViewerDialog('/mock/stream/url', mockAuthService);
      const dialogElement = dialog['dialog'];
      document.body.appendChild(dialogElement);

      const followBtn = dialogElement.querySelector('#follow-btn');
      
      // Initial state
      expect(followBtn?.textContent).toContain('Follow Mode: ON');
      
      // Toggle off
      followBtn?.click();
      expect(followBtn?.textContent).toContain('Follow Mode: OFF');
      
      // Toggle back on
      followBtn?.click();
      expect(followBtn?.textContent).toContain('Follow Mode: ON');

      // Toggle off again
      followBtn?.click();
      expect(followBtn?.textContent).toContain('Follow Mode: OFF');
    });
  });

  describe('Dialog Structure', () => {
    it('should be a dialog element', () => {
      const dialog = new LogViewerDialog('/mock/stream/url', mockAuthService);
      const dialogElement = dialog['dialog'];
      
      expect(dialogElement.tagName.toLowerCase()).toBe('dialog');
    });

    it('should have content container', () => {
      const dialog = new LogViewerDialog('/mock/stream/url', mockAuthService);
      const dialogElement = dialog['dialog'];
      document.body.appendChild(dialogElement);

      const container = dialogElement.querySelector('#log-content-container');
      expect(container).toBeTruthy();
    });

    it('should have title and buttons', () => {
      const dialog = new LogViewerDialog('/mock/stream/url', mockAuthService);
      const dialogElement = dialog['dialog'];
      document.body.appendChild(dialogElement);

      const title = dialogElement.querySelector('h3');
      const followBtn = dialogElement.querySelector('#follow-btn');
      const clearBtn = dialogElement.querySelector('[data-action="clear-logs"]');

      expect(title).toBeTruthy();
      expect(followBtn).toBeTruthy();
      expect(clearBtn).toBeTruthy();
    });
  });

  describe('Error Handling', () => {
    it('should handle general errors in stream', async () => {
      const mockError = {
        name: 'NetworkError',
        message: 'Connection failed'
      };
      
      const mockReader = {
        read: vi.fn().mockRejectedValueOnce(mockError)
      };

      const mockResponse = {
        ok: true,
        body: {
          getReader: () => mockReader
        }
      };

      mockFetch.mockResolvedValue(mockResponse);
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      const dialog = new LogViewerDialog('/mock/stream/url', mockAuthService);
      const dialogElement = dialog['dialog'];
      document.body.appendChild(dialogElement);

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(consoleErrorSpy).toHaveBeenCalledWith('Log stream error:', mockError);
      
      const logLines = dialogElement.querySelector('#log-lines');
      expect(logLines?.textContent).toContain('Stream disconnected: Connection failed');
      
      consoleErrorSpy.mockRestore();
    });
  });

  describe('Dialog Integration', () => {
    it('should have show method', () => {
      const dialog = new LogViewerDialog('/mock/stream/url', mockAuthService);
      expect(dialog.show).toBeDefined();
      expect(typeof dialog.show).toBe('function');
    });

    it('should start streaming on mount', async () => {
      const mockResponse = {
        ok: true,
        body: {
          getReader: () => ({
            read: async () => ({ done: true, value: undefined })
          })
        }
      };
      
      mockFetch.mockResolvedValue(mockResponse);
      
      const dialog = new LogViewerDialog('/mock/stream/url', mockAuthService);
      const dialogElement = dialog['dialog'];
      document.body.appendChild(dialogElement);
      
      // Dialog should start streaming immediately on mount
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(mockFetch).toHaveBeenCalled();
    });

    it('should handle URL with query parameters', async () => {
      const mockResponse = {
        ok: true,
        body: {
          getReader: () => ({
            read: async () => ({ done: true, value: undefined })
          })
        }
      };
      
      mockFetch.mockResolvedValue(mockResponse);
      
      new LogViewerDialog('/mock/stream/url?task=t1&run=r1', mockAuthService);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(mockFetch).toHaveBeenCalledWith('/mock/stream/url?task=t1&run=r1', expect.any(Object));
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty stream', async () => {
      const mockResponse = {
        ok: true,
        body: {
          getReader: () => ({
            read: async () => ({ done: true, value: undefined })
          })
        }
      };
      
      mockFetch.mockResolvedValue(mockResponse);
      
      const dialog = new LogViewerDialog('/mock/stream/url', mockAuthService);
      const dialogElement = dialog['dialog'];
      document.body.appendChild(dialogElement);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const logLines = dialogElement.querySelector('#log-lines');
      // Empty stream should not crash
      expect(logLines).toBeTruthy();
    });

    it('should handle stream with single byte chunks', async () => {
      const chunks = [];
      for (let i = 0; i < 10; i++) {
        chunks.push(new TextEncoder().encode(`A`));
      }
      let chunkIndex = 0;
      
      const mockReader = {
        read: vi.fn().mockImplementation(() => {
          if (chunkIndex < chunks.length) {
            const chunk = chunks[chunkIndex++];
            return Promise.resolve({ done: chunkIndex === chunks.length, value: chunk });
          }
          return Promise.resolve({ done: true, value: undefined });
        })
      };

      const mockResponse = {
        ok: true,
        body: {
          getReader: () => mockReader
        }
      };

      mockFetch.mockResolvedValue(mockResponse);
      
      const dialog = new LogViewerDialog('/mock/stream/url', mockAuthService);
      const dialogElement = dialog['dialog'];
      document.body.appendChild(dialogElement);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const logLines = dialogElement.querySelector('#log-lines');
      expect(logLines?.textContent).toContain('A');
    });

    it('should handle stream with special characters', async () => {
      const mockStreamData = new TextEncoder().encode('Log entry with spaces   and\ttabs\nand\nnewlines');
      let readCallCount = 0;
      
      const mockReader = {
        read: vi.fn().mockImplementation(() => {
          readCallCount++;
          if (readCallCount === 1) {
            return Promise.resolve({ done: false, value: mockStreamData });
          }
          return Promise.resolve({ done: true, value: undefined });
        })
      };

      const mockResponse = {
        ok: true,
        body: {
          getReader: () => mockReader
        }
      };

      mockFetch.mockResolvedValue(mockResponse);
      
      const dialog = new LogViewerDialog('/mock/stream/url', mockAuthService);
      const dialogElement = dialog['dialog'];
      document.body.appendChild(dialogElement);
      
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const logLines = dialogElement.querySelector('#log-lines');
      expect(logLines?.textContent).toContain('Log entry with spaces');
      expect(logLines?.textContent).toContain('and');
    });
  });
});
