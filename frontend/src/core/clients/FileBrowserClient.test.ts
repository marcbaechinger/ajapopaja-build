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
import { FileBrowserClient } from './FileBrowserClient.ts';

function jsonResponse(body: any): any {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  };
}

describe('FileBrowserClient', () => {
  let client: FileBrowserClient;
  let mockAuthService: any;

  beforeEach(() => {
    mockAuthService = {
      getAccessToken: vi.fn().mockReturnValue('token123'),
      refreshToken: vi.fn(),
    };
    vi.stubGlobal('fetch', vi.fn());
    client = new FileBrowserClient('http://test/api', mockAuthService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('builds the list URL with an encoded path and maps the response', async () => {
    (fetch as any).mockResolvedValue(
      jsonResponse({
        path: 'src/ui',
        parent: 'src',
        entries: [
          { name: 'App.ts', path: 'src/ui/App.ts', is_dir: false, size: 10, git_status: 'modified' },
          { name: 'nested', path: 'src/ui/nested', is_dir: true, has_children: true, git_status: null },
        ],
      })
    );

    const listing = await client.listDirectory('p1', 'src/ui');

    expect((fetch as any).mock.calls[0][0]).toBe(
      'http://test/api/pipelines/p1/files/?path=src%2Fui'
    );
    expect(listing.path).toBe('src/ui');
    expect(listing.parent).toBe('src');
    expect(listing.entries).toHaveLength(2);
    expect(listing.entries[0].isDir).toBe(false);
    expect(listing.entries[0].gitStatus).toBe('modified');
    expect(listing.entries[1].isDir).toBe(true);
    expect(listing.entries[1].hasChildren).toBe(true);
    expect(listing.entries[1].gitStatus).toBeNull();
  });

  it('requests the repository root with an empty path', async () => {
    (fetch as any).mockResolvedValue(jsonResponse({ path: '', parent: null, entries: [] }));

    await client.listDirectory('p1');

    expect((fetch as any).mock.calls[0][0]).toBe(
      'http://test/api/pipelines/p1/files/?path='
    );
  });

  it('reads a file and maps camelCase fields', async () => {
    (fetch as any).mockResolvedValue(
      jsonResponse({
        path: 'README.md',
        name: 'README.md',
        size: 42,
        created_at: '2026-01-01T00:00:00Z',
        modified_at: '2026-01-02T00:00:00Z',
        git_status: 'clean',
        is_binary: false,
        truncated: false,
        encoding: 'utf-8',
        content: '# hi',
      })
    );

    const file = await client.readFile('p1', 'README.md');

    expect((fetch as any).mock.calls[0][0]).toBe(
      'http://test/api/pipelines/p1/files/content?path=README.md'
    );
    expect(file.name).toBe('README.md');
    expect(file.size).toBe(42);
    expect(file.createdAt).toBe('2026-01-01T00:00:00Z');
    expect(file.modifiedAt).toBe('2026-01-02T00:00:00Z');
    expect(file.gitStatus).toBe('clean');
    expect(file.isBinary).toBe(false);
    expect(file.content).toBe('# hi');
  });

  it('maps a binary file response with no content', async () => {
    (fetch as any).mockResolvedValue(
      jsonResponse({
        path: 'a.bin',
        name: 'a.bin',
        size: 3,
        is_binary: true,
        truncated: false,
        encoding: null,
        content: null,
      })
    );

    const file = await client.readFile('p1', 'a.bin');

    expect(file.isBinary).toBe(true);
    expect(file.content).toBeNull();
    expect(file.encoding).toBeNull();
  });

  it('fetches metadata for a single entry', async () => {
    (fetch as any).mockResolvedValue(
      jsonResponse({ name: 'a.txt', path: 'a.txt', is_dir: false, git_status: 'untracked' })
    );

    const entry = await client.getMeta('p1', 'a.txt');

    expect((fetch as any).mock.calls[0][0]).toBe(
      'http://test/api/pipelines/p1/files/meta?path=a.txt'
    );
    expect(entry.gitStatus).toBe('untracked');
  });

  it('mints a raw file token via an authenticated POST', async () => {
    (fetch as any).mockResolvedValue(jsonResponse({ token: 'raw.jwt.token', expires_in: 60 }));

    const result = await client.createRawFileToken('p1', 'src/ui/App.ts');

    expect((fetch as any).mock.calls[0][0]).toBe(
      'http://test/api/pipelines/p1/files/raw-url?path=src%2Fui%2FApp.ts'
    );
    expect((fetch as any).mock.calls[0][1].method).toBe('POST');
    const headers = new Headers((fetch as any).mock.calls[0][1].headers);
    expect(headers.get('Authorization')).toBe('Bearer token123');
    expect(result.token).toBe('raw.jwt.token');
    expect(result.expiresIn).toBe(60);
  });

  it('builds the raw file URL with an encoded token', () => {
    expect(client.rawFileUrl('p1', 'a/b+c=d')).toBe(
      'http://test/api/pipelines/p1/files/raw?token=a%2Fb%2Bc%3Dd'
    );
  });

  it('includes the Authorization header', async () => {
    (fetch as any).mockResolvedValue(jsonResponse({ path: '', entries: [] }));

    await client.listDirectory('p1');

    const headers = new Headers((fetch as any).mock.calls[0][1].headers);
    expect(headers.get('Authorization')).toBe('Bearer token123');
  });

  it('throws the server detail on error responses', async () => {
    (fetch as any).mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ detail: 'Path not found' }),
    });

    await expect(client.readFile('p1', 'missing.txt')).rejects.toThrow('Path not found');
  });

  it('builds the search URL with an encoded query and maps the response', async () => {
    (fetch as any).mockResolvedValue(
      jsonResponse({
        query: 'File Browse',
        results: [
          { path: 'src/ui/FileBrowseView.ts', name: 'FileBrowseView.ts', is_dir: false },
          { path: 'src/ui', name: 'ui', is_dir: true },
        ],
        truncated: true,
        index_ready: true,
      })
    );

    const result = await client.searchFiles('p1', 'File Browse');

    expect((fetch as any).mock.calls[0][0]).toBe(
      'http://test/api/pipelines/p1/files/search?q=File+Browse'
    );
    expect(result.query).toBe('File Browse');
    expect(result.truncated).toBe(true);
    expect(result.indexReady).toBe(true);
    expect(result.results[0].path).toBe('src/ui/FileBrowseView.ts');
    expect(result.results[0].isDir).toBe(false);
    expect(result.results[1].isDir).toBe(true);
  });

  it('forwards an abort signal to the search request', async () => {
    (fetch as any).mockResolvedValue(jsonResponse({ query: 'x', results: [] }));
    const controller = new AbortController();

    await client.searchFiles('p1', 'x', controller.signal);

    const options = (fetch as any).mock.calls[0][1];
    expect(options.signal).toBe(controller.signal);
  });

  it('adds an explicit result limit to the search URL', async () => {
    (fetch as any).mockResolvedValue(jsonResponse({ query: 'x', results: [] }));

    await client.searchFiles('p1', 'x', undefined, 5);

    expect((fetch as any).mock.calls[0][0]).toBe(
      'http://test/api/pipelines/p1/files/search?q=x&limit=5'
    );
  });
});
