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
import { WebSocketClient } from './WebSocketClient.ts';

class MockWebSocket {
  static readonly OPEN = 1;
  static instances: MockWebSocket[] = [];

  readyState = 0;
  url: string;
  onopen: ((event: any) => void) | null = null;
  onmessage: ((event: any) => void) | null = null;
  onclose: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send = vi.fn();
  close = vi.fn();
}

function makeAuthService() {
  return {
    ensureValidToken: vi.fn().mockResolvedValue('valid_token'),
    getAccessToken: vi.fn().mockReturnValue('valid_token'),
    refreshToken: vi.fn().mockResolvedValue('new_token'),
  };
}

describe('WebSocketClient', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket as any);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('ensures a fresh token before connecting', async () => {
    const auth = makeAuthService();
    auth.ensureValidToken.mockResolvedValue('fresh_token');
    const client = new WebSocketClient('http://localhost:8000/api', auth as any);

    await client.connect();

    expect(auth.ensureValidToken).toHaveBeenCalledTimes(1);
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(MockWebSocket.instances[0].url).toContain('token=fresh_token');
  });

  it('refreshes and reconnects once after a policy-violation close (1008)', async () => {
    const auth = makeAuthService();
    const client = new WebSocketClient('http://localhost:8000/api', auth as any);

    await client.connect();
    const first = MockWebSocket.instances[0];
    first.readyState = 3; // CLOSED

    first.onclose?.({ code: 1008 });

    await vi.waitFor(() => expect(auth.refreshToken).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(MockWebSocket.instances).toHaveLength(2));
  });
});
