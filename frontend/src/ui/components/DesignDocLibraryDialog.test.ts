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
import { DesignDocLibraryDialog } from './DesignDocLibraryDialog.ts';

describe('DesignDocLibraryDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  const docAlpha = {
    path: 'dd_alpha.md',
    title: 'Alpha Architecture',
    size: 42,
    modified_at: '2026-04-12T10:00:00Z',
    snippet: null,
  };
  const docBeta = {
    path: 'backend/dd_beta.md',
    title: 'Beta Design',
    size: 10,
    modified_at: '2026-04-12T10:00:00Z',
    snippet: '…mentions widget internals…',
  };

  function makeClient(overrides: Record<string, any> = {}) {
    return {
      list: vi.fn().mockResolvedValue({
        documents: [docAlpha, docBeta],
        total: 2,
        query: null,
      }),
      getContent: vi.fn().mockResolvedValue({
        path: 'dd_alpha.md',
        title: 'Alpha Architecture',
        content: '# Alpha Architecture\n\nHello **world**.',
        size: 42,
      }),
      ...overrides,
    } as any;
  }

  const dialogOf = (client: any = makeClient()) =>
    new DesignDocLibraryDialog('p1', client);
  const bodyOf = (dialog: DesignDocLibraryDialog) =>
    dialog['dialog'].querySelector('#dialog-body-container') as HTMLElement;

  it('renders the search panel and an empty reading state', () => {
    const dialog = dialogOf();
    const body = bodyOf(dialog);

    expect(body.querySelector('#dd-search-input')).not.toBeNull();
    expect(body.querySelector('#dd-tabs')?.textContent).toContain(
      'Open a document'
    );
    expect(body.querySelector('#dd-content')?.textContent).toContain(
      'Select a design document'
    );
  });

  it('lists documents returned by the client', async () => {
    const client = makeClient();
    const dialog = dialogOf(client);

    await dialog['performSearch']();

    expect(client.list).toHaveBeenCalledWith('p1', undefined);
    const list = bodyOf(dialog).querySelector('#dd-list') as HTMLElement;
    expect(list.textContent).toContain('Alpha Architecture');
    expect(list.textContent).toContain('Beta Design');
    expect(list.textContent).toContain('backend/dd_beta.md');
    expect(list.textContent).toContain('mentions widget internals');
  });

  it('forwards a search query to the backend', async () => {
    const client = makeClient();
    const dialog = dialogOf(client);
    dialog['query'] = 'widget';

    await dialog['performSearch']();

    expect(client.list).toHaveBeenCalledWith('p1', 'widget');
  });

  it('shows a clear error when listing fails', async () => {
    const client = makeClient({
      list: vi.fn().mockRejectedValue(new Error('list boom')),
    });
    const dialog = dialogOf(client);

    await dialog['performSearch']();

    expect(bodyOf(dialog).querySelector('#dd-list')?.textContent).toContain(
      'list boom'
    );
  });

  it('shows an empty state when no documents match', async () => {
    const client = makeClient({
      list: vi.fn().mockResolvedValue({ documents: [], total: 0, query: 'x' }),
    });
    const dialog = dialogOf(client);
    dialog['query'] = 'x';

    await dialog['performSearch']();

    expect(bodyOf(dialog).querySelector('#dd-list')?.textContent).toContain(
      'No documents match'
    );
  });

  it('opens a document as a tab and renders its markdown', async () => {
    const client = makeClient();
    const dialog = dialogOf(client);
    await dialog['performSearch']();

    await dialog['openDoc']('dd_alpha.md');

    expect(client.getContent).toHaveBeenCalledWith('p1', 'dd_alpha.md');
    const body = bodyOf(dialog);
    expect(body.querySelector('#dd-tabs')?.textContent).toContain(
      'Alpha Architecture'
    );
    const content = body.querySelector('#dd-content') as HTMLElement;
    expect(content.textContent).toContain('Alpha Architecture');
    // Markdown is rendered (not shown as raw markdown).
    expect(content.querySelector('strong')?.textContent).toBe('world');
  });

  it('caches the document content and does not refetch on tab switch', async () => {
    const client = makeClient();
    const dialog = dialogOf(client);
    await dialog['openDoc']('dd_alpha.md');
    await dialog['openDoc']('dd_alpha.md');

    expect(client.getContent).toHaveBeenCalledTimes(1);
  });

  it('shows a clear error when loading document content fails', async () => {
    const client = makeClient({
      getContent: vi.fn().mockRejectedValue(new Error('content boom')),
    });
    const dialog = dialogOf(client);

    await dialog['openDoc']('dd_alpha.md');

    expect(bodyOf(dialog).querySelector('#dd-content')?.textContent).toContain(
      'content boom'
    );
  });

  it('closes a tab and returns to the empty reading state', async () => {
    const client = makeClient();
    const dialog = dialogOf(client);
    await dialog['openDoc']('dd_alpha.md');

    dialog['closeTab']('dd_alpha.md');

    expect(dialog['tabs'].length).toBe(0);
    expect(bodyOf(dialog).querySelector('#dd-content')?.textContent).toContain(
      'Select a design document'
    );
  });

  it('activates the neighbouring tab when the active tab is closed', async () => {
    const client = makeClient({
      getContent: vi.fn().mockImplementation((_pipelineId, path) =>
        Promise.resolve({
          path,
          title: path,
          content: `# ${path}`,
          size: 1,
        })
      ),
    });
    const dialog = dialogOf(client);
    await dialog['openDoc']('dd_alpha.md');
    await dialog['openDoc']('backend/dd_beta.md');

    dialog['closeTab']('backend/dd_beta.md');

    expect(dialog['activePath']).toBe('dd_alpha.md');
  });

  it('collapses and expands the search panel', () => {
    const dialog = dialogOf();
    const body = bodyOf(dialog);
    const searchBody = body.querySelector('#dd-search-body') as HTMLElement;

    dialog['toggleSearch']();
    expect(searchBody.classList.contains('hidden')).toBe(true);

    dialog['toggleSearch']();
    expect(searchBody.classList.contains('hidden')).toBe(false);
  });

  it('clears the search input and reloads the list', async () => {
    const client = makeClient();
    const dialog = dialogOf(client);
    dialog['query'] = 'something';

    dialog['clearSearch']();

    expect(dialog['query']).toBe('');
    expect((bodyOf(dialog).querySelector('#dd-search-input') as HTMLInputElement).value).toBe('');
    // The clear triggers an asynchronous refresh.
    await Promise.resolve();
    expect(client.list).toHaveBeenCalledWith('p1', undefined);
  });

  it('does not open an empty tab for a missing path', async () => {
    const client = makeClient();
    const dialog = dialogOf(client);

    await dialog['openDoc']('');

    expect(dialog['tabs'].length).toBe(0);
    expect(client.getContent).not.toHaveBeenCalled();
  });
});
