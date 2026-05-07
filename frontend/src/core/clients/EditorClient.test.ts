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
import { EditorClient } from './EditorClient.ts';

describe('EditorClient', () => {
  let client: EditorClient;
  let mockAuthService: any;
  const baseUrl = 'http://api.test';

  beforeEach(() => {
    mockAuthService = {
      getAccessToken: vi.fn().mockReturnValue('token123'),
      refreshToken: vi.fn(),
    };
    vi.stubGlobal('fetch', vi.fn());
    client = new EditorClient(baseUrl, mockAuthService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should store the base URL correctly', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      await client.quickfix('task-1');

      const callUrl = (fetch as any).mock.calls[0][0];
      expect(callUrl).toContain(baseUrl);
    });
  });

  describe('call', () => {
    it('should make a POST request to the correct endpoint', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      await client.call('test_command', { key: 'value' });

      expect(fetch).toHaveBeenCalledWith(
        `${baseUrl}/editor/call/test_command`,
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('should include Content-Type header as application/json', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      await client.call('test_command', { key: 'value' });

      const callHeaders = new Headers((fetch as any).mock.calls[0][1].headers);
      expect(callHeaders.get('Content-Type')).toBe('application/json');
    });

    it('should include Authorization header with Bearer token', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      await client.call('test_command', { key: 'value' });

      const callHeaders = new Headers((fetch as any).mock.calls[0][1].headers);
      expect(callHeaders.get('Authorization')).toBe('Bearer token123');
    });

    it('should stringify options as JSON body', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      const options = {
        key: 'value',
        nested: { a: 1, b: 2 },
        array: [1, 2, 3]
      };

      await client.call('test_command', options);

      const callBody = (fetch as any).mock.calls[0][1].body as string;
      expect(JSON.parse(callBody)).toEqual(options);
    });

    it('should handle empty options object', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      await client.call('test_command', {});

      const callBody = (fetch as any).mock.calls[0][1].body as string;
      expect(JSON.parse(callBody)).toEqual({});
    });

    it('should return undefined on success', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      const result = await client.call('test_command', { key: 'value' });

      expect(result).toBeUndefined();
    });

    it('should handle various command names', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      await client.call('quickfix', {});
      await client.call('diff_view_open', {});
      await client.call('save_file', {});

      expect((fetch as any).mock.calls.length).toBe(3);
      expect((fetch as any).mock.calls[0][0]).toContain('/editor/call/quickfix');
      expect((fetch as any).mock.calls[1][0]).toContain('/editor/call/diff_view_open');
      expect((fetch as any).mock.calls[2][0]).toContain('/editor/call/save_file');
    });
  });

  describe('quickfix', () => {
    it('should call quickfix command with correct task_id', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      await client.quickfix('task-123');

      expect(fetch).toHaveBeenCalledWith(
        `${baseUrl}/editor/call/quickfix`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ task_id: 'task-123' }),
        })
      );
    });

    it('should include Content-Type and Authorization headers', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      await client.quickfix('task-1');

      const callHeaders = new Headers((fetch as any).mock.calls[0][1].headers);
      expect(callHeaders.get('Content-Type')).toBe('application/json');
      expect(callHeaders.get('Authorization')).toBe('Bearer token123');
    });

    it('should handle complex task IDs', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      const taskId = 'task-with-dashes_123';
      await client.quickfix(taskId);

      const url = new URL((fetch as any).mock.calls[0][0]);
      expect(url.pathname).toBe('/editor/call/quickfix');

      const body = JSON.parse((fetch as any).mock.calls[0][1].body as string);
      expect(body.task_id).toBe(taskId);
    });

    it('should return undefined on success', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      const result = await client.quickfix('task-1');

      expect(result).toBeUndefined();
    });
  });

  describe('diffViewOpen', () => {
    it('should call diff_view_open with correct pipeline_id and commit_hash', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      await client.diffViewOpen('pipeline-1', 'abc123def');

      expect(fetch).toHaveBeenCalledWith(
        `${baseUrl}/editor/call/diff_view_open`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            pipeline_id: 'pipeline-1',
            commit_hash: 'abc123def',
          }),
        })
      );
    });

    it('should include Content-Type and Authorization headers', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      await client.diffViewOpen('p1', 'c1');

      const callHeaders = new Headers((fetch as any).mock.calls[0][1].headers);
      expect(callHeaders.get('Content-Type')).toBe('application/json');
      expect(callHeaders.get('Authorization')).toBe('Bearer token123');
    });

    it('should handle long commit hashes', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      const longHash = 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0';
      await client.diffViewOpen('pipe-1', longHash);

      const body = JSON.parse((fetch as any).mock.calls[0][1].body as string);
      expect(body.commit_hash).toBe(longHash);
      expect(body.pipeline_id).toBe('pipe-1');
    });

    it('should handle empty strings', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      await client.diffViewOpen('', '');

      const body = JSON.parse((fetch as any).mock.calls[0][1].body as string);
      expect(body.pipeline_id).toBe('');
      expect(body.commit_hash).toBe('');
    });

    it('should return undefined on success', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      const result = await client.diffViewOpen('p1', 'c1');

      expect(result).toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('should throw error for non-OK responses from call', async () => {
      (fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ detail: 'Internal server error' }),
      });

      await expect(client.call('test_command', {}))
        .rejects.toThrow('Internal server error');
    });

    it('should throw error for non-OK responses from quickfix', async () => {
      (fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ detail: 'Quickfix failed' }),
      });

      await expect(client.quickfix('task-1'))
        .rejects.toThrow('Quickfix failed');
    });

    it('should throw error for non-OK responses from diffViewOpen', async () => {
      (fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ detail: 'Diff view failed' }),
      });

      await expect(client.diffViewOpen('p1', 'c1'))
        .rejects.toThrow('Diff view failed');
    });

    it('should throw error with default message for malformed JSON', async () => {
      (fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('Parse error')),
      });

      await expect(client.call('test_command', {}))
        .rejects.toThrow('Unknown error');
    });

    it('should throw error for 404 not found', async () => {
      (fetch as any).mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ detail: 'Endpoint not found' }),
      });

      await expect(client.call('unknown_command', {}))
        .rejects.toThrow('Endpoint not found');
    });

    it('should throw error for 403 forbidden', async () => {
      (fetch as any).mockResolvedValue({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ detail: 'Forbidden' }),
      });

      await expect(client.quickfix('task-1'))
        .rejects.toThrow('Forbidden');
    });

    it('should throw error for 400 bad request', async () => {
      (fetch as any).mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ detail: 'Invalid parameters' }),
      });

      await expect(client.diffViewOpen('p1', 'c1'))
        .rejects.toThrow('Invalid parameters');
    });

    it('should handle all methods with error responses', async () => {
      const errorResponse = {
        ok: false,
        status: 400,
        json: () => Promise.resolve({ detail: 'Bad request' }),
      };

      (fetch as any).mockResolvedValue(errorResponse);
      await expect(client.call('test_cmd', {})).rejects.toThrow('Bad request');

      (fetch as any).mockResolvedValue(errorResponse);
      await expect(client.quickfix('t1')).rejects.toThrow('Bad request');

      (fetch as any).mockResolvedValue(errorResponse);
      await expect(client.diffViewOpen('p1', 'c1')).rejects.toThrow('Bad request');
    });
  });

  describe('token refresh on 401', () => {
    it('should handle 401 unauthorized and attempt token refresh for call', async () => {
      const newToken = 'new-token-456';
      mockAuthService.getAccessToken.mockReturnValue('token123');
      mockAuthService.refreshToken.mockResolvedValue(newToken);

      const errorResponse = { ok: false, status: 401 };
      const successResponse = { ok: true };

      (fetch as any) // @ts-ignore
        .mockImplementation(() => {
          if ((fetch as any).mock.calls.length === 1) {
            return Promise.resolve(errorResponse);
          }
          return Promise.resolve(successResponse);
        });

      await expect(client.call('test_command', {})).resolves.toBeUndefined();
      expect(mockAuthService.refreshToken).toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should handle 401 unauthorized and attempt token refresh for quickfix', async () => {
      const newToken = 'new-token-789';
      mockAuthService.refreshToken.mockResolvedValue(newToken);

      const errorResponse = { ok: false, status: 401 };
      const successResponse = { ok: true };

      (fetch as any) // @ts-ignore
        .mockImplementation(() => {
          if ((fetch as any).mock.calls.length === 1) {
            return Promise.resolve(errorResponse);
          }
          return Promise.resolve(successResponse);
        });

      await expect(client.quickfix('task-1')).resolves.toBeUndefined();
      expect(mockAuthService.refreshToken).toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should handle 401 unauthorized and attempt token refresh for diffViewOpen', async () => {
      const newToken = 'new-token-999';
      mockAuthService.refreshToken.mockResolvedValue(newToken);

      const errorResponse = { ok: false, status: 401 };
      const successResponse = { ok: true };

      (fetch as any) // @ts-ignore
        .mockImplementation(() => {
          if ((fetch as any).mock.calls.length === 1) {
            return Promise.resolve(errorResponse);
          }
          return Promise.resolve(successResponse);
        });

      await expect(client.diffViewOpen('p1', 'c1')).resolves.toBeUndefined();
      expect(mockAuthService.refreshToken).toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledTimes(2);

      // Verify the second call used the refreshed token
      const secondCallHeaders = new Headers((fetch as any).mock.calls[1][1].headers);
      expect(secondCallHeaders.get('Authorization')).toBe(`Bearer ${newToken}`);
    });
  });

  describe('authentication with null token', () => {
    it('should handle null access token gracefully for call', async () => {
      mockAuthService.getAccessToken.mockReturnValue(null);
      (fetch as any).mockResolvedValue({ ok: true });

      await client.call('test_command', {});

      // Verify fetch was called but without Authorization header
      const callHeaders = new Headers((fetch as any).mock.calls[0][1].headers);
      expect(callHeaders.get('Authorization')).toBeNull();
    });

    it('should handle null access token gracefully for quickfix', async () => {
      mockAuthService.getAccessToken.mockReturnValue(null);
      (fetch as any).mockResolvedValue({ ok: true });

      await client.quickfix('task-1');

      const callHeaders = new Headers((fetch as any).mock.calls[0][1].headers);
      expect(callHeaders.get('Authorization')).toBeNull();
    });

    it('should handle null access token gracefully for diffViewOpen', async () => {
      mockAuthService.getAccessToken.mockReturnValue(null);
      (fetch as any).mockResolvedValue({ ok: true });

      await client.diffViewOpen('p1', 'c1');

      const callHeaders = new Headers((fetch as any).mock.calls[0][1].headers);
      expect(callHeaders.get('Authorization')).toBeNull();
    });
  });

  describe('URL construction', () => {
    it('should construct correct URL for call method', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      await client.call('my_command', {});

      const url = new URL((fetch as any).mock.calls[0][0]);
      expect(url.pathname).toBe('/editor/call/my_command');
    });

    it('should construct correct URL for quickfix', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      await client.quickfix('task-123');

      const url = new URL((fetch as any).mock.calls[0][0]);
      expect(url.pathname).toBe('/editor/call/quickfix');
    });

    it('should construct correct URL for diffViewOpen', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      await client.diffViewOpen('pipeline-456', 'abc');

      const url = new URL((fetch as any).mock.calls[0][0]);
      expect(url.pathname).toBe('/editor/call/diff_view_open');
    });

    it('should use the provided base URL', async () => {
      const customBaseUrl = 'https://custom.example.com:8080';
      const customClient = new EditorClient(customBaseUrl, mockAuthService);
      (fetch as any).mockResolvedValue({ ok: true });

      await customClient.quickfix('task-1');

      const callUrl = (fetch as any).mock.calls[0][0];
      expect(callUrl).toContain(customBaseUrl);
    });
  });

  describe('HTTP method', () => {
    it('should use POST method for call', async () => {
      (fetch as any).mockResolvedValue({ ok: true });
      await client.call('test', {});

      expect((fetch as any).mock.calls[0][1].method).toBe('POST');
    });

    it('should use POST method for quickfix', async () => {
      (fetch as any).mockResolvedValue({ ok: true });
      await client.quickfix('task-1');

      expect((fetch as any).mock.calls[0][1].method).toBe('POST');
    });

    it('should use POST method for diffViewOpen', async () => {
      (fetch as any).mockResolvedValue({ ok: true });
      await client.diffViewOpen('p1', 'c1');

      expect((fetch as any).mock.calls[0][1].method).toBe('POST');
    });
  });
});
