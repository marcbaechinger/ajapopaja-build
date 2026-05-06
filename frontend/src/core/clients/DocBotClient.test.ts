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
import { DocBotClient } from './DocBotClient.ts';

describe('DocBotClient', () => {
  let client: DocBotClient;
  let mockAuthService: any;
  const baseUrl = 'http://api.test';

  beforeEach(() => {
    mockAuthService = {
      getAccessToken: vi.fn().mockReturnValue('token123'),
      refreshToken: vi.fn(),
    };
    vi.stubGlobal('fetch', vi.fn());
    client = new DocBotClient(baseUrl, mockAuthService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should remove trailing slash from apiBaseUrl', async () => {
      const clientWithSlash = new DocBotClient('http://api.test/', mockAuthService);
      (fetch as any).mockResolvedValue({ ok: true });
      
      await clientWithSlash.triggerDocBot('pipe-1', 'task-1');
      const url = new URL((fetch as any).mock.calls[0][0]);
      expect(url.toString()).toBe('http://api.test/pipelines/pipe-1/docbot/trigger/task-1');
    });

    it('should keep apiBaseUrl without trailing slash', async () => {
      const clientNoSlash = new DocBotClient('http://api.test', mockAuthService);
      (fetch as any).mockResolvedValue({ ok: true });
      
      await clientNoSlash.triggerDocBot('pipe-1', 'task-1');
      const url = new URL((fetch as any).mock.calls[0][0]);
      expect(url.toString()).toBe('http://api.test/pipelines/pipe-1/docbot/trigger/task-1');
    });
  });

  describe('triggerDocBot', () => {
    it('should trigger DocBot for a task with correct URL', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      await client.triggerDocBot('pipe-1', 'task-1');

      expect(fetch).toHaveBeenCalledWith(
        'http://api.test/pipelines/pipe-1/docbot/trigger/task-1',
        expect.objectContaining({
          method: 'POST',
        })
      );
      expect(mockAuthService.getAccessToken).toHaveBeenCalled();
    });

    it('should include Authorization header with Bearer token', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      await client.triggerDocBot('pipe-1', 'task-1');

      const callHeaders = new Headers((fetch as any).mock.calls[0][1].headers);
      expect(callHeaders.get('Authorization')).toBe('Bearer token123');
    });

    it('should handle successful response', async () => {
      (fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
      });

      await expect(client.triggerDocBot('pipe-1', 'task-1')).resolves.toBeUndefined();
    });
  });

  describe('commitChanges', () => {
    it('should commit changes with correct URL and body', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      await client.commitChanges('pipe-1', 'task-1', 'Fix bug in module');

      const callArgs = (fetch as any).mock.calls[0];
      const callHeaders = new Headers(callArgs[1].headers);
      
      expect(callArgs[0]).toBe('http://api.test/pipelines/pipe-1/docbot/review/commit/task-1');
      expect(callArgs[1].method).toBe('POST');
      expect(callHeaders.get('Content-Type')).toBe('application/json');
      expect(callHeaders.get('Authorization')).toBe('Bearer token123');
      expect(JSON.parse(callArgs[1].body as string)).toEqual({ commit_msg: 'Fix bug in module' });
    });

    it('should handle empty commit message', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      await client.commitChanges('pipe-1', 'task-1', '');

      const callArgs = (fetch as any).mock.calls[0];
      expect(JSON.parse(callArgs[1].body as string)).toEqual({ commit_msg: '' });
    });

    it('should handle special characters in commit message', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      await client.commitChanges('pipe-1', 'task-1', 'Fix: "bug" & features');

      const callArgs = (fetch as any).mock.calls[0];
      expect(JSON.parse(callArgs[1].body as string)).toEqual({ commit_msg: 'Fix: "bug" & features' });
    });
  });

  describe('revertChanges', () => {
    it('should revert changes with correct URL', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      await client.revertChanges('pipe-1', 'task-1');

      expect(fetch).toHaveBeenCalledWith(
        'http://api.test/pipelines/pipe-1/docbot/review/revert/task-1',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('should include Authorization header', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      await client.revertChanges('pipe-1', 'task-1');

      const callHeaders = new Headers((fetch as any).mock.calls[0][1].headers);
      expect(callHeaders.get('Authorization')).toBe('Bearer token123');
    });

    it('should not send a body for revert request', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      await client.revertChanges('pipe-1', 'task-1');

      // Check that body is undefined or not present
      const requestBody = (fetch as any).mock.calls[0][1].body;
      expect(requestBody).toBeUndefined();
    });
  });

  describe('cancelReview', () => {
    it('should cancel review with correct URL', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      await client.cancelReview('pipe-1', 'task-1');

      expect(fetch).toHaveBeenCalledWith(
        'http://api.test/pipelines/pipe-1/docbot/review/cancel/task-1',
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('should include Authorization header', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      await client.cancelReview('pipe-1', 'task-1');

      const callHeaders = new Headers((fetch as any).mock.calls[0][1].headers);
      expect(callHeaders.get('Authorization')).toBe('Bearer token123');
    });

    it('should not send a body for cancel request', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      await client.cancelReview('pipe-1', 'task-1');

      const requestBody = (fetch as any).mock.calls[0][1].body;
      expect(requestBody).toBeUndefined();
    });
  });

  describe('error handling', () => {
    it('should throw error for non-OK responses', async () => {
      (fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ detail: 'Internal server error' }),
      });

      await expect(client.triggerDocBot('pipe-1', 'task-1'))
        .rejects.toThrow('Internal server error');
    });

    it('should throw error with default message for malformed JSON', async () => {
      (fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('Parse error')),
      });

      await expect(client.triggerDocBot('pipe-1', 'task-1'))
        .rejects.toThrow('Unknown error');
    });

    it('should throw error for 404 not found', async () => {
      (fetch as any).mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ detail: 'Task not found' }),
      });

      await expect(commitChanges(client, 'pipe-1', 'task-1', 'test'))
        .rejects.toThrow('Task not found');
    });

    it('should handle all methods with error responses', async () => {
      const errorResponse = {
        ok: false,
        status: 400,
        json: () => Promise.resolve({ detail: 'Bad request' }),
      };

      // Each test needs its own mock setup since they run sequentially
      (fetch as any).mockResolvedValue(errorResponse);
      await expect(client.triggerDocBot('pipe-1', 'task-1')).rejects.toThrow('Bad request');

      (fetch as any).mockResolvedValue(errorResponse);
      await expect(client.commitChanges('pipe-1', 'task-1', 'test')).rejects.toThrow('Bad request');

      (fetch as any).mockResolvedValue(errorResponse);
      await expect(client.revertChanges('pipe-1', 'task-1')).rejects.toThrow('Bad request');

      (fetch as any).mockResolvedValue(errorResponse);
      await expect(client.cancelReview('pipe-1', 'task-1')).rejects.toThrow('Bad request');
    });

    it('should handle 401 unauthorized and attempt token refresh', async () => {
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

      await expect(client.triggerDocBot('pipe-1', 'task-1')).resolves.toBeUndefined();
      expect(mockAuthService.refreshToken).toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('URL construction', () => {
    it('should construct URLs with pipelineId in path', async () => {
      (fetch as any).mockResolvedValue({ ok: true });
      await client.triggerDocBot('pipeline-abc-123', 'task-xyz');
      
      const url = new URL((fetch as any).mock.calls[0][0]);
      expect(url.pathname).toBe('/pipelines/pipeline-abc-123/docbot/trigger/task-xyz');
    });

    it('should construct URLs with taskId in path', async () => {
      (fetch as any).mockResolvedValue({ ok: true });
      await client.commitChanges('pipe-1', 'task-999', 'test');
      
      const url = new URL((fetch as any).mock.calls[0][0]);
      expect(url.pathname).toBe('/pipelines/pipe-1/docbot/review/commit/task-999');
    });

    it('should have different endpoints for different actions', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      await client.triggerDocBot('pipe-1', 'task-1');
      await client.commitChanges('pipe-1', 'task-1', 'test');
      await client.revertChanges('pipe-1', 'task-1');
      await client.cancelReview('pipe-1', 'task-1');

      expect((fetch as any).mock.calls[0][0]).toContain('/docbot/trigger/task-1');
      expect((fetch as any).mock.calls[1][0]).toContain('/docbot/review/commit/task-1');
      expect((fetch as any).mock.calls[2][0]).toContain('/docbot/review/revert/task-1');
      expect((fetch as any).mock.calls[3][0]).toContain('/docbot/review/cancel/task-1');
    });
  });
});

function commitChanges(client: DocBotClient, pipelineId: string, taskId: string, commitMsg: string) {
  return client.commitChanges(pipelineId, taskId, commitMsg);
}
