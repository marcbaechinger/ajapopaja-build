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
import { PipelineClient } from './PipelineClient.ts';
import { Pipeline, PipelineStatus } from '../domain.ts';

const mockPipelineResponse = (overrides = {}) => ({
  id: 'pipe-1',
  name: 'Test Pipeline',
  status: 'active',
  version: 1,
  workspace_path: '/workspace',
  doc_root: 'design',
  deleted: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

describe('PipelineClient', () => {
  let client: PipelineClient;
  let mockAuthService: any;
  const baseUrl = 'http://api.test';

  beforeEach(() => {
    mockAuthService = {
      getAccessToken: vi.fn().mockReturnValue('mock-token'),
      refreshToken: vi.fn().mockResolvedValue(null),
    };

    vi.stubGlobal('fetch', vi.fn());
    client = new PipelineClient(baseUrl, mockAuthService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('list', () => {
    it('should list pipelines without include_deleted query parameter by default', async () => {
      (fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([mockPipelineResponse()]),
      });

      const pipelines = await client.list();

      expect(pipelines).toHaveLength(1);
      expect(pipelines[0]).toBeInstanceOf(Pipeline);
      expect(pipelines[0].id).toBe('pipe-1');
      expect(pipelines[0].name).toBe('Test Pipeline');

      const url = new URL((fetch as any).mock.calls[0][0]);
      expect(url.pathname).toBe('/pipelines/');
      expect(url.searchParams.has('include_deleted')).toBe(false);
    });

    it('should list pipelines with include_deleted=true query parameter', async () => {
      (fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([mockPipelineResponse({ deleted: true })]),
      });

      const pipelines = await client.list(true);

      expect(pipelines).toHaveLength(1);
      expect(pipelines[0].deleted).toBe(true);

      const url = new URL((fetch as any).mock.calls[0][0]);
      expect(url.pathname).toBe('/pipelines/');
      expect(url.searchParams.get('include_deleted')).toBe('true');
    });

    it('should authenticate with Authorization header', async () => {
      (fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      });

      await client.list();

      const headers = (fetch as any).mock.calls[0][1].headers;
      expect(headers.get('Authorization')).toBe('Bearer mock-token');
    });

    it('should return an empty array when no pipelines exist', async () => {
      (fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      });

      const pipelines = await client.list();
      expect(pipelines).toHaveLength(0);
    });

    it('should map multiple pipelines correctly', async () => {
      (fetch as any).mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve([
            mockPipelineResponse({ id: 'pipe-1', name: 'First' }),
            mockPipelineResponse({ id: 'pipe-2', name: 'Second', status: 'paused' }),
          ]),
      });

      const pipelines = await client.list();
      expect(pipelines).toHaveLength(2);
      expect(pipelines[0].name).toBe('First');
      expect(pipelines[1].status).toBe(PipelineStatus.PAUSED);
    });
  });

  describe('get', () => {
    it('should get a single pipeline by id', async () => {
      (fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockPipelineResponse()),
      });

      const pipeline = await client.get('pipe-1');

      expect(pipeline).toBeInstanceOf(Pipeline);
      expect(pipeline.id).toBe('pipe-1');
      expect(pipeline.name).toBe('Test Pipeline');

      const url = new URL((fetch as any).mock.calls[0][0]);
      expect(url.pathname).toBe('/pipelines/pipe-1');
    });

    it('should include include_deleted=true when specified', async () => {
      (fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockPipelineResponse({ deleted: true })),
      });

      const pipeline = await client.get('pipe-1', true);

      expect(pipeline.deleted).toBe(true);

      const url = new URL((fetch as any).mock.calls[0][0]);
      expect(url.searchParams.get('include_deleted')).toBe('true');
    });

    it('should not include include_deleted by default', async () => {
      (fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockPipelineResponse()),
      });

      await client.get('pipe-1');

      const url = new URL((fetch as any).mock.calls[0][0]);
      expect(url.searchParams.has('include_deleted')).toBe(false);
    });

    it('should authenticate with Authorization header', async () => {
      (fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockPipelineResponse()),
      });

      await client.get('pipe-1');

      const headers = (fetch as any).mock.calls[0][1].headers;
      expect(headers.get('Authorization')).toBe('Bearer mock-token');
    });

    it('should handle 404 errors by throwing', async () => {
      (fetch as any).mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ detail: 'Not Found' }),
      });

      await expect(client.get('nonexistent')).rejects.toThrow('Not Found');
    });
  });

  describe('create', () => {
    it('should create a pipeline with name only', async () => {
      (fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockPipelineResponse({ name: 'New Pipeline' })),
      });

      const pipeline = await client.create('New Pipeline');

      expect(pipeline).toBeInstanceOf(Pipeline);
      expect(pipeline.name).toBe('New Pipeline');

      const [url, options] = (fetch as any).mock.calls[0];
      expect(url).toBe(`${baseUrl}/pipelines/`);
      expect(options.method).toBe('POST');
      expect(options.headers.get('Content-Type')).toBe('application/json');
      const body = JSON.parse(options.body);
      expect(body.name).toBe('New Pipeline');
      expect(body.workspace_path).toBe(undefined);
    });

    it('should create a pipeline with name and workspacePath', async () => {
      (fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockPipelineResponse({ name: 'New Pipeline', workspace_path: '/my/workspace' })),
      });

      const pipeline = await client.create('New Pipeline', '/my/workspace');

      expect(pipeline.workspace_path).toBe('/my/workspace');

      const body = JSON.parse((fetch as any).mock.calls[0][1].body);
      expect(body.name).toBe('New Pipeline');
      expect(body.workspace_path).toBe('/my/workspace');
    });

    it('should authenticate with Authorization header', async () => {
      (fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockPipelineResponse()),
      });

      await client.create('Test');

      const headers = (fetch as any).mock.calls[0][1].headers;
      expect(headers.get('Authorization')).toBe('Bearer mock-token');
    });

    it('should handle creation errors', async () => {
      (fetch as any).mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ detail: 'Bad Request: Duplicate name' }),
      });

      await expect(client.create('Existing')).rejects.toThrow('Bad Request: Duplicate name');
    });
  });

  describe('update', () => {
    it('should update a pipeline with version and partial changes', async () => {
      (fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockPipelineResponse({ name: 'Updated', version: 2 })),
      });

      const pipeline = await client.update('pipe-1', 2, { name: 'Updated' });

      expect(pipeline.name).toBe('Updated');
      expect(pipeline.version).toBe(2);

      const [url, options] = (fetch as any).mock.calls[0];
      expect(url).toBe(`${baseUrl}/pipelines/pipe-1`);
      expect(options.method).toBe('PATCH');
      expect(options.headers.get('Content-Type')).toBe('application/json');
      const body = JSON.parse(options.body);
      expect(body.version).toBe(2);
      expect(body.name).toBe('Updated');
    });

    it('should update pipeline status', async () => {
      (fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockPipelineResponse({ status: 'paused' })),
      });

      await client.update('pipe-1', 2, { status: PipelineStatus.PAUSED });

      const body = JSON.parse((fetch as any).mock.calls[0][1].body);
      expect(body.version).toBe(2);
      expect(body.status).toBe('paused');
    });

    it('should update multiple fields at once', async () => {
      (fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockPipelineResponse({ name: 'Renamed', status: 'completed' })),
      });

      await client.update('pipe-1', 3, {
        name: 'Renamed',
        status: PipelineStatus.COMPLETED,
        workspace_path: '/new/workspace',
        doc_root: 'docs',
      });

      const body = JSON.parse((fetch as any).mock.calls[0][1].body);
      expect(body.version).toBe(3);
      expect(body.name).toBe('Renamed');
      expect(body.status).toBe('completed');
      expect(body.workspace_path).toBe('/new/workspace');
      expect(body.doc_root).toBe('docs');
    });

    it('should update pipeline with null workspace_path', async () => {
      (fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockPipelineResponse({ workspace_path: null })),
      });

      await client.update('pipe-1', 2, { workspace_path: null });

      const body = JSON.parse((fetch as any).mock.calls[0][1].body);
      expect(body.workspace_path).toBe(null);
    });

    it('should authenticate with Authorization header', async () => {
      (fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockPipelineResponse()),
      });

      await client.update('pipe-1', 2, { name: 'Test' });

      const headers = (fetch as any).mock.calls[0][1].headers;
      expect(headers.get('Authorization')).toBe('Bearer mock-token');
    });

    it('should throw OCC_CONFLICT error on 409 response', async () => {
      (fetch as any).mockResolvedValue({
        ok: false,
        status: 409,
        json: () => Promise.resolve({ detail: 'OCC_CONFLICT' }),
      });

      await expect(client.update('pipe-1', 1, { name: 'Conflicting' })).rejects.toThrow('OCC_CONFLICT');
    });

    it('should throw OCC_CONFLICT error on error message containing 409', async () => {
      (fetch as any).mockRejectedValue(new Error('HTTP 409: Conflict'));

      await expect(client.update('pipe-1', 1, { name: 'Conflicting' })).rejects.toThrow('OCC_CONFLICT');
    });

    it('should throw OCC_CONFLICT error on error message containing OCC_CONFLICT', async () => {
      (fetch as any).mockRejectedValue(new Error('OCC_CONFLICT: version mismatch'));

      await expect(client.update('pipe-1', 1, { name: 'Conflicting' })).rejects.toThrow('OCC_CONFLICT');
    });

    it('should propagate non-OCC errors without transformation', async () => {
      (fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ detail: 'Internal Server Error' }),
      });

      await expect(client.update('pipe-1', 1, { name: 'Test' })).rejects.toThrow('Internal Server Error');
    });
  });

  describe('delete', () => {
    it('should delete a pipeline by id', async () => {
      (fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(null),
      });

      await client.delete('pipe-1');

      expect(fetch).toHaveBeenCalledWith(
        `${baseUrl}/pipelines/pipe-1`,
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });

    it('should authenticate with Authorization header', async () => {
      (fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(null),
      });

      await client.delete('pipe-1');

      const headers = (fetch as any).mock.calls[0][1].headers;
      expect(headers.get('Authorization')).toBe('Bearer mock-token');
    });

    it('should handle deletion errors', async () => {
      (fetch as any).mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ detail: 'Pipeline not found' }),
      });

      await expect(client.delete('nonexistent')).rejects.toThrow('Pipeline not found');
    });
  });

  describe('getDailyStats', () => {
    it('should get daily stats for a pipeline', async () => {
      const mockStats = [
        { date: '2026-01-01', task_count: 5, completed_count: 2 },
        { date: '2026-01-02', task_count: 8, completed_count: 5 },
      ];

      (fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockStats),
      });

      const stats = await client.getDailyStats('pipe-1');

      expect(stats).toEqual(mockStats);

      const url = new URL((fetch as any).mock.calls[0][0]);
      expect(url.pathname).toBe('/pipelines/pipe-1/stats/daily');
    });

    it('should authenticate with Authorization header', async () => {
      (fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      });

      await client.getDailyStats('pipe-1');

      const headers = (fetch as any).mock.calls[0][1].headers;
      expect(headers.get('Authorization')).toBe('Bearer mock-token');
    });

    it('should handle errors when fetching stats', async () => {
      (fetch as any).mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ detail: 'Pipeline not found' }),
      });

      await expect(client.getDailyStats('nonexistent')).rejects.toThrow('Pipeline not found');
    });

    it('should return empty array when no stats available', async () => {
      (fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([]),
      });

      const stats = await client.getDailyStats('pipe-1');
      expect(stats).toEqual([]);
    });
  });

  describe('response mapping', () => {
    it('should map pipeline response with all fields to Pipeline instance', async () => {
      const responseData = {
        _id: 'mongo-id-1',
        name: 'Full Pipeline',
        description: 'A test pipeline',
        status: 'active',
        workspace_path: '/full/workspace',
        doc_root: 'project/docs',
        version: 5,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
        deleted: true,
      };

      (fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(responseData),
      });

      const pipeline = await client.get('mongo-id-1');

      expect(pipeline.id).toBe('mongo-id-1');
      expect(pipeline.name).toBe('Full Pipeline');
      expect(pipeline.description).toBe('A test pipeline');
      expect(pipeline.status).toBe(PipelineStatus.ACTIVE);
      expect(pipeline.workspace_path).toBe('/full/workspace');
      expect(pipeline.doc_root).toBe('project/docs');
      expect(pipeline.version).toBe(5);
      expect(pipeline.created_at).toBe('2026-01-01T00:00:00Z');
      expect(pipeline.updated_at).toBe('2026-01-02T00:00:00Z');
      expect(pipeline.deleted).toBe(true);
    });

    it('should map response with id field (not _id)', async () => {
      (fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 'simple-id', name: 'Simple Pipeline' }),
      });

      const pipeline = await client.get('simple-id');
      expect(pipeline.id).toBe('simple-id');
    });

    it('should handle malformed pipeline data gracefully', async () => {
      (fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ name: 123, version: 'not-a-number' }),
      });

      const pipeline = await client.get('test');
      expect(pipeline.name).toBe('123');
      // Number('not-a-number') is NaN, so version becomes NaN
      expect(pipeline.version).toBeNaN();
    });

    it('should ignore invalid PipelineStatus and use default', async () => {
      (fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ name: 'Pipeline', status: 'invalid_status' }),
      });

      const pipeline = await client.get('test');
      expect(pipeline.status).toBe(PipelineStatus.ACTIVE); // Default
    });
  });

  describe('error handling', () => {
    it('should throw error with detail message on non-OK response', async () => {
      (fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ detail: 'Server Error' }),
      });

      await expect(client.list()).rejects.toThrow('Server Error');
    });

    it('should throw generic HTTP error when detail is missing', async () => {
      (fetch as any).mockResolvedValue({
        ok: false,
        status: 502,
        json: () => Promise.resolve({}),
      });

      await expect(client.list()).rejects.toThrow(/HTTP error/);
    });

    it('should propagate network errors', async () => {
      (fetch as any).mockRejectedValue(new Error('Network error'));

      await expect(client.get('pipe-1')).rejects.toThrow('Network error');
    });

    it('should use auth token from authService', async () => {
      mockAuthService.getAccessToken.mockReturnValue('different-token');

      (fetch as any).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([mockPipelineResponse()]),
      });

      await client.list();

      const headers = (fetch as any).mock.calls[0][1].headers;
      expect(headers.get('Authorization')).toBe('Bearer different-token');
    });
  });
});
