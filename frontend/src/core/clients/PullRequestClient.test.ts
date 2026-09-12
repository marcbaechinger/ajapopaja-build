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
import { PullRequestClient } from './PullRequestClient.ts';

describe('PullRequestClient', () => {
  let client: PullRequestClient;
  let mockAuthService: any;

  beforeEach(() => {
    mockAuthService = {
      getAccessToken: vi.fn().mockReturnValue('token123'),
      refreshToken: vi.fn(),
    };
    vi.stubGlobal('fetch', vi.fn());
    client = new PullRequestClient(mockAuthService);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('acceptPullRequest', () => {
    it('sends the user-edited commit message as commit_message in the payload', async () => {
      (fetch as any).mockResolvedValue({ ok: true, status: 200 });

      await client.acceptPullRequest('pr_123', 'Add new feature', 'revert');

      const [, options] = (fetch as any).mock.calls[0];
      expect(options.method).toBe('POST');
      expect((fetch as any).mock.calls[0][0]).toBe('/api/pull_requests/pr_123/accept');

      const body = JSON.parse(options.body);
      expect(body.commit_message).toBe('Add new feature');
      expect(body.failure_strategy).toBe('revert');
    });

    it('falls back to the original summary when no commit message is edited', async () => {
      (fetch as any).mockResolvedValue({ ok: true, status: 200 });

      await client.acceptPullRequest('pr_123', 'Original summary');

      const body = JSON.parse((fetch as any).mock.calls[0][1].body);
      expect(body.commit_message).toBe('Original summary');
    });

    it('includes the Authorization header with the Bearer token', async () => {
      (fetch as any).mockResolvedValue({ ok: true, status: 200 });

      await client.acceptPullRequest('pr_123', 'Add new feature');

      const callHeaders = new Headers((fetch as any).mock.calls[0][1].headers);
      expect(callHeaders.get('Authorization')).toBe('Bearer token123');
    });

    it('throws on non-OK responses', async () => {
      (fetch as any).mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ detail: 'Apply failed' }),
      });

      await expect(client.acceptPullRequest('pr_123', 'Add new feature'))
        .rejects.toThrow('Apply failed');
    });
  });
});
