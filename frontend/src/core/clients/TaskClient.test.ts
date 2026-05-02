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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TaskClient } from './TaskClient.ts';
import { TaskStatus } from '../domain.ts';

describe('TaskClient', () => {
  let client: TaskClient;
  let mockAuthService: any;
  const baseUrl = 'http://api.test';

  beforeEach(() => {
    mockAuthService = {
      getAccessToken: vi.fn().mockReturnValue('token123'),
      refreshToken: vi.fn(),
    };
    vi.stubGlobal('fetch', vi.fn());
    client = new TaskClient(baseUrl, mockAuthService);
  });

  it('should list tasks by pipeline with correct URL', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{ id: 'task-1', title: 'Task 1' }])
    });

    const tasks = await client.listByPipeline('pipe-1', true);

    expect(tasks).toHaveLength(1);
    expect(tasks[0].title).toBe('Task 1');
    
    const url = new URL((fetch as any).mock.calls[0][0]);
    expect(url.pathname).toBe('/pipelines/pipe-1/tasks/');
    expect(url.searchParams.get('include_deleted')).toBe('true');
  });

  it('should search tasks with multiple parameters', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ tasks: [{ id: '1' }], total_count: 1 })
    });

    await client.search({
      keywords: 'test',
      statuses: [TaskStatus.CREATED, TaskStatus.INPROGRESS],
      page: 1,
      limit: 10
    });

    const url = new URL((fetch as any).mock.calls[0][0]);
    expect(url.pathname).toBe('/tasks/search');
    expect(url.searchParams.get('keywords')).toBe('test');
    expect(url.searchParams.getAll('statuses')).toEqual(['created', 'inprogress']);
    expect(url.searchParams.get('page')).toBe('1');
    expect(url.searchParams.get('limit')).toBe('10');
  });

  it('should handle POST requests for task creation', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'new-id', title: 'New Task' })
    });

    const task = await client.create('pipe-1', 'New Task', 'Doc', 'Spec', true);

    expect(task.id).toBe('new-id');
    expect(fetch).toHaveBeenCalledWith(
      `${baseUrl}/pipelines/pipe-1/tasks/`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          title: 'New Task',
          pipeline_id: 'pipe-1',
          design_doc: 'Doc',
          spec: 'Spec',
          want_design_doc: true
        })
      })
    );
  });

  it('should handle PATCH requests for status updates', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: '1', status: 'inprogress' })
    });

    await client.updateStatus('1', TaskStatus.INPROGRESS, 5);

    expect(fetch).toHaveBeenCalledWith(
      `${baseUrl}/tasks/1/status`,
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'inprogress', version: 5 })
      })
    );
  });

  it('should map OCC conflict errors correctly', async () => {
    (fetch as any).mockResolvedValue({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ detail: 'OCC_CONFLICT' })
    });

    await expect(client.updateStatus('1', TaskStatus.INPROGRESS, 1))
      .rejects.toThrow('OCC_CONFLICT');
  });

  it('should handle malformed JSON safely using Task constructor', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ 
        id: '1', 
        title: 123, // Should be stringified
        status: 'INVALID_STATUS', // Should be ignored/default
        want_design_doc: 'true' // Should be cast to boolean
      })
    });

    const task = await client.get('1');

    expect(task.title).toBe('123');
    expect(task.status).toBe(TaskStatus.CREATED); // Default since INVALID_STATUS is not a TaskStatus
    expect(task.want_design_doc).toBe(true);
  });

  it('should get history for a task', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([{ task_id: '1', version: 1, design_doc: 'D1' }])
    });

    const history = await client.getHistory('1');

    expect(history).toHaveLength(1);
    expect(history[0].task_id).toBe('1');
    expect(history[0].design_doc).toBe('D1');
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/tasks/1/history`, expect.anything());
  });

  it('should handle next task retrieval', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'next-1', title: 'Next' })
    });

    const next = await client.getNextTask('pipe-1');

    expect(next?.id).toBe('next-1');
    expect(fetch).toHaveBeenCalledWith(`${baseUrl}/pipelines/pipe-1/tasks/next`, expect.objectContaining({ method: 'POST' }));
  });

  it('should return null if no next task is available', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(null)
    });

    const next = await client.getNextTask('pipe-1');
    expect(next).toBe(null);
  });
});
