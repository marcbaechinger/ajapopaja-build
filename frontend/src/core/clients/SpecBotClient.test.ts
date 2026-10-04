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
import { SpecBotClient } from './SpecBotClient.ts';

describe('SpecBotClient', () => {
  let client: SpecBotClient;
  let mockAuthService: any;
  const baseUrl = 'http://api.test';

  beforeEach(() => {
    mockAuthService = {
      getAccessToken: vi.fn().mockReturnValue('token123'),
      refreshToken: vi.fn(),
    };
    vi.stubGlobal('fetch', vi.fn());
    client = new SpecBotClient(baseUrl, mockAuthService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('triggers the SpecAgent with the correct URL and POST method', async () => {
    (fetch as any).mockResolvedValue({ ok: true });

    await client.trigger('pipe-1', 'task-1');

    const url = new URL((fetch as any).mock.calls[0][0]);
    expect(url.pathname).toBe('/pipelines/pipe-1/specagent/trigger/task-1');
    expect((fetch as any).mock.calls[0][1].method).toBe('POST');
  });

  it('fetches a proposal with the correct URL and parses the body', async () => {
    const proposal = {
      task_id: 'task-1',
      pipeline_id: 'pipe-1',
      spec_md: '# Spec',
      rationale: 'r',
    };
    (fetch as any).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(proposal),
    });

    const result = await client.getProposal('pipe-1', 'task-1');

    const url = new URL((fetch as any).mock.calls[0][0]);
    expect(url.pathname).toBe('/pipelines/pipe-1/specagent/proposal/task-1');
    expect(result).toEqual(proposal);
  });

  it('clears a proposal with DELETE', async () => {
    (fetch as any).mockResolvedValue({ ok: true });

    await client.rejectProposal('pipe-1', 'task-1');

    const url = new URL((fetch as any).mock.calls[0][0]);
    expect(url.pathname).toBe('/pipelines/pipe-1/specagent/proposal/task-1');
    expect((fetch as any).mock.calls[0][1].method).toBe('DELETE');
  });

  it('sends the bearer token', async () => {
    (fetch as any).mockResolvedValue({ ok: true });

    await client.trigger('pipe-1', 'task-1');

    const callHeaders = new Headers((fetch as any).mock.calls[0][1].headers);
    expect(callHeaders.get('Authorization')).toBe('Bearer token123');
  });

  it('throws for non-OK responses', async () => {
    (fetch as any).mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ detail: 'Task must have a specification' }),
    });

    await expect(client.trigger('pipe-1', 'task-1')).rejects.toThrow(
      'Task must have a specification'
    );
  });
});
