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

import { vi } from 'vitest';
import dashboardHtml from '../../../public/getting-started/dashboard.html?raw';
import pipelineHtml from '../../../public/getting-started/pipeline.html?raw';

/**
 * The real static guide markup, keyed by the URL the loader requests. Tests use
 * this to keep asserting against the shipped content while still stubbing the
 * network.
 */
export const GETTING_STARTED_FIXTURES: Record<string, string> = {
  '/getting-started/dashboard.html': dashboardHtml,
  '/getting-started/pipeline.html': pipelineHtml,
};

/**
 * Installs a `fetch` stub that serves the static getting-started files. Returns
 * the mock so callers can assert how often it was called.
 */
export function installGettingStartedFetchMock() {
  const fetchMock = vi.fn((url: string) =>
    Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(GETTING_STARTED_FIXTURES[url] ?? ''),
    })
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** Lets pending loader microtasks settle before assertions. */
export function flushPromises(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
