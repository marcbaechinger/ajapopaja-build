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
import { ReviewBotClient } from './ReviewBotClient.ts';

describe('ReviewBotClient', () => {
  let client: ReviewBotClient;
  let mockAuthService: any;
  const baseUrl = 'http://api.test';

  beforeEach(() => {
    mockAuthService = {
      getAccessToken: vi.fn().mockReturnValue('token123'),
      refreshToken: vi.fn(),
    };
    vi.stubGlobal('fetch', vi.fn());
    client = new ReviewBotClient(baseUrl, mockAuthService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should remove trailing slash from apiBaseUrl', async () => {
      const clientWithSlash = new ReviewBotClient('http://api.test/', mockAuthService);
      (fetch as any).mockResolvedValue({ ok: true });

      await clientWithSlash.trigger('pipe-1', 'task-1');
      const url = new URL((fetch as any).mock.calls[0][0]);
      expect(url.toString()).toBe('http://api.test/pipelines/pipe-1/reviewbot/trigger/task-1');
    });

    it('should keep apiBaseUrl without trailing slash', async () => {
      const clientNoSlash = new ReviewBotClient('http://api.test', mockAuthService);
      (fetch as any).mockResolvedValue({ ok: true });

      await clientNoSlash.trigger('pipe-1', 'task-1');
      const url = new URL((fetch as any).mock.calls[0][0]);
      expect(url.toString()).toBe('http://api.test/pipelines/pipe-1/reviewbot/trigger/task-1');
    });
  });

  describe('trigger', () => {
    it('should trigger ReviewBot for a task with correct URL', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      await client.trigger('pipe-1', 'task-1');

      expect(fetch).toHaveBeenCalledWith(
        'http://api.test/pipelines/pipe-1/reviewbot/trigger/task-1',
        expect.objectContaining({
          method: 'POST',
        })
      );
      expect(mockAuthService.getAccessToken).toHaveBeenCalled();
    });

    it('should include Authorization header with Bearer token', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      await client.trigger('pipe-1', 'task-1');

      const callHeaders = new Headers((fetch as any).mock.calls[0][1].headers);
      expect(callHeaders.get('Authorization')).toBe('Bearer token123');
    });

    it('should handle successful response', async () => {
      (fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
      });

      await expect(client.trigger('pipe-1', 'task-1')).resolves.toBeUndefined();
    });

    it('should construct URL with correct pipeline and task IDs', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      await client.trigger('pipeline-abc-123', 'task-xyz-789');

      const url = new URL((fetch as any).mock.calls[0][0]);
      expect(url.pathname).toBe('/pipelines/pipeline-abc-123/reviewbot/trigger/task-xyz-789');
    });

    it('should not send a body for trigger request', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      await client.trigger('pipe-1', 'task-1');

      const requestBody = (fetch as any).mock.calls[0][1].body;
      expect(requestBody).toBeUndefined();
    });
  });

  describe('deleteReview', () => {
    it('should delete review with correct URL', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      await client.deleteReview('pipe-1', 'task-1');

      expect(fetch).toHaveBeenCalledWith(
        'http://api.test/pipelines/pipe-1/reviewbot/review/task-1',
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });

    it('should include Authorization header with Bearer token', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      await client.deleteReview('pipe-1', 'task-1');

      const callHeaders = new Headers((fetch as any).mock.calls[0][1].headers);
      expect(callHeaders.get('Authorization')).toBe('Bearer token123');
    });

    it('should handle successful response', async () => {
      (fetch as any).mockResolvedValue({
        ok: true,
        status: 200,
      });

      await expect(client.deleteReview('pipe-1', 'task-1')).resolves.toBeUndefined();
    });

    it('should construct URL with correct pipeline and task IDs', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      await client.deleteReview('pipeline-abc-123', 'task-xyz-789');

      const url = new URL((fetch as any).mock.calls[0][0]);
      expect(url.pathname).toBe('/pipelines/pipeline-abc-123/reviewbot/review/task-xyz-789');
    });

    it('should not send a body for delete request', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      await client.deleteReview('pipe-1', 'task-1');

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

      await expect(client.trigger('pipe-1', 'task-1'))
        .rejects.toThrow('Internal server error');
    });

    it('should throw error for non-OK delete responses', async () => {
      (fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ detail: 'Delete failed' }),
      });

      await expect(client.deleteReview('pipe-1', 'task-1'))
        .rejects.toThrow('Delete failed');
    });

    it('should throw error with default message for malformed JSON', async () => {
      (fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error('Parse error')),
      });

      await expect(client.trigger('pipe-1', 'task-1'))
        .rejects.toThrow('Unknown error');
    });

    it('should throw error for 404 not found', async () => {
      (fetch as any).mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ detail: 'Task not found' }),
      });

      await expect(client.trigger('pipe-1', 'task-1'))
        .rejects.toThrow('Task not found');
    });

    it('should throw error for 403 forbidden', async () => {
      (fetch as any).mockResolvedValue({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ detail: 'Forbidden' }),
      });

      await expect(client.deleteReview('pipe-1', 'task-1'))
        .rejects.toThrow('Forbidden');
    });

    it('should handle all methods with error responses', async () => {
      const errorResponse = {
        ok: false,
        status: 400,
        json: () => Promise.resolve({ detail: 'Bad request' }),
      };

      // Each test needs its own mock setup since they run sequentially
      (fetch as any).mockResolvedValue(errorResponse);
      await expect(client.trigger('pipe-1', 'task-1')).rejects.toThrow('Bad request');

      (fetch as any).mockResolvedValue(errorResponse);
      await expect(client.deleteReview('pipe-1', 'task-1')).rejects.toThrow('Bad request');
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

      await expect(client.trigger('pipe-1', 'task-1')).resolves.toBeUndefined();
      expect(mockAuthService.refreshToken).toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('should handle 401 and token refresh for deleteReview', async () => {
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

      await expect(client.deleteReview('pipe-1', 'task-1')).resolves.toBeUndefined();
      expect(mockAuthService.refreshToken).toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledTimes(2);

      // Verify the second call used the refreshed token
      const secondCallHeaders = new Headers((fetch as any).mock.calls[1][1].headers);
      expect(secondCallHeaders.get('Authorization')).toBe(`Bearer ${newToken}`);
    });
  });

  describe('URL construction', () => {
    it('should have different endpoints for trigger and deleteReview', async () => {
      (fetch as any).mockResolvedValue({ ok: true });

      await client.trigger('pipe-1', 'task-1');
      await client.deleteReview('pipe-1', 'task-1');

      expect((fetch as any).mock.calls[0][0]).toContain('/reviewbot/trigger/task-1');
      expect((fetch as any).mock.calls[1][0]).toContain('/reviewbot/review/task-1');
    });

    it('should construct trigger URL with pipelineId in path', async () => {
      (fetch as any).mockResolvedValue({ ok: true });
      await client.trigger('pipeline-abc-123', 'task-xyz');

      const url = new URL((fetch as any).mock.calls[0][0]);
      expect(url.pathname).toBe('/pipelines/pipeline-abc-123/reviewbot/trigger/task-xyz');
    });

    it('should construct deleteReview URL with pipelineId in path', async () => {
      (fetch as any).mockResolvedValue({ ok: true });
      await client.deleteReview('pipeline-abc-123', 'task-xyz');

      const url = new URL((fetch as any).mock.calls[0][0]);
      expect(url.pathname).toBe('/pipelines/pipeline-abc-123/reviewbot/review/task-xyz');
    });

    it('should handle special characters in IDs', async () => {
      (fetch as any).mockResolvedValue({ ok: true });
      const pipelineId = 'pipeline_with-dashes.123';
      const taskId = 'task_with_underscores';

      await client.trigger(pipelineId, taskId);

      const url = new URL((fetch as any).mock.calls[0][0]);
      expect(url.pathname).toBe(`/pipelines/${pipelineId}/reviewbot/trigger/${taskId}`);
    });
  });

  describe('HTTP method', () => {
    it('should use POST method for trigger', async () => {
      (fetch as any).mockResolvedValue({ ok: true });
      await client.trigger('pipe-1', 'task-1');

      expect((fetch as any).mock.calls[0][1].method).toBe('POST');
    });

    it('should use DELETE method for deleteReview', async () => {
      (fetch as any).mockResolvedValue({ ok: true });
      await client.deleteReview('pipe-1', 'task-1');

      expect((fetch as any).mock.calls[0][1].method).toBe('DELETE');
    });
  });

  describe('authentication with null token', () => {
    it('should handle null access token gracefully', async () => {
      mockAuthService.getAccessToken.mockReturnValue(null);
      (fetch as any).mockResolvedValue({ ok: true });

      await client.trigger('pipe-1', 'task-1');

      // Verify fetch was called but without Authorization header
      const callHeaders = new Headers((fetch as any).mock.calls[0][1].headers);
      expect(callHeaders.get('Authorization')).toBeNull();
    });
  });
});
