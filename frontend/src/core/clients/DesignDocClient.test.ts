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
import { DesignDocClient } from './DesignDocClient.ts';

describe('DesignDocClient', () => {
  let client: DesignDocClient;
  let mockAuthService: any;
  const baseUrl = 'http://api.test';

  beforeEach(() => {
    mockAuthService = {
      getAccessToken: vi.fn().mockReturnValue('mock-token'),
      refreshToken: vi.fn().mockResolvedValue(null),
    };
    vi.stubGlobal('fetch', vi.fn());
    client = new DesignDocClient(baseUrl, mockAuthService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('lists design documents without a query parameter by default', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ documents: [], total: 0, query: null }),
    });

    const result = await client.list('p1');

    expect(fetch).toHaveBeenCalledTimes(1);
    expect((fetch as any).mock.calls[0][0]).toBe(
      'http://api.test/pipelines/p1/design-docs'
    );
    expect(result.total).toBe(0);
  });

  it('appends the trimmed search query', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ documents: [], total: 0, query: 'arch' }),
    });

    await client.list('p1', '  arch  ');

    expect((fetch as any).mock.calls[0][0]).toContain('q=arch');
  });

  it('ignores a blank search query', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ documents: [], total: 0, query: null }),
    });

    await client.list('p1', '   ');

    expect((fetch as any).mock.calls[0][0]).not.toContain('q=');
  });

  it('fetches a document content by relative path', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          path: 'sub/dd_a.md',
          title: 'A',
          content: '# A',
          size: 3,
        }),
    });

    const doc = await client.getContent('p1', 'sub/dd_a.md');

    const url = (fetch as any).mock.calls[0][0] as string;
    expect(url).toContain('/pipelines/p1/design-docs/content');
    expect(url).toContain('path=sub%2Fdd_a.md');
    expect(doc.content).toBe('# A');
  });

  it('sends the bearer token with requests', async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ documents: [], total: 0 }),
    });

    await client.list('p1');

    const options = (fetch as any).mock.calls[0][1] as RequestInit;
    const headers = options.headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer mock-token');
  });

  it('surfaces the server error detail', async () => {
    (fetch as any).mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ detail: 'boom' }),
    });

    await expect(client.getContent('p1', 'a.md')).rejects.toThrow('boom');
  });
});
