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
import { FileBrowseView } from './FileBrowseView.ts';
import { DirectoryListing, FileContent } from '../../core/domain.ts';
import { LocalStorageManager } from '../../core/LocalStorageManager.ts';

function listing(path: string, names: Array<[string, boolean]>): DirectoryListing {
  return new DirectoryListing({
    path,
    parent: path ? path.split('/').slice(0, -1).join('/') : null,
    entries: names.map(([name, isDir]) => ({
      name,
      path: path ? `${path}/${name}` : name,
      is_dir: isDir,
      size: isDir ? null : 12,
      git_status: isDir ? null : 'clean',
      has_children: isDir ? true : null,
    })),
  });
}

class FakeRegistry {
  handlers = new Map<string, (event: Event, element: HTMLElement) => void>();
  register(name: string, handler: (event: Event, element: HTMLElement) => void): void {
    this.handlers.set(name, handler);
  }
  get(name: string) {
    const handler = this.handlers.get(name);
    if (!handler) throw new Error(`No handler for ${name}`);
    return handler;
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function elementWithPath(path: string): HTMLElement {
  const el = document.createElement('button');
  el.setAttribute('data-path', path);
  return el;
}

describe('FileBrowseView', () => {
  let root: HTMLElement;
  let registry: FakeRegistry;
  let client: any;
  let view: FileBrowseView;

  beforeEach(() => {
    document.body.innerHTML = '';
    root = document.createElement('div');
    document.body.appendChild(root);
    window.localStorage.clear();
    LocalStorageManager.resetInstances();

    registry = new FakeRegistry();
    client = {
      listDirectory: vi.fn().mockResolvedValue(listing('', [['src', true], ['README.md', false]])),
      readFile: vi.fn().mockResolvedValue(
        new FileContent({ name: 'README.md', path: 'README.md', size: 5, content: '# hi\n' })
      ),
      getMeta: vi.fn(),
    };

    view = new FileBrowseView(root, {
      pipelineId: 'p1',
      client,
      actionRegistry: registry as any,
    });
  });

  afterEach(() => {
    view.destroy();
  });

  it('lists the repository root and renders the sidebar and main panel', async () => {
    view.render();
    await flush();

    expect(client.listDirectory).toHaveBeenCalledWith('p1', '');
    const sidebar = root.querySelector('#file-browser-sidebar') as HTMLElement;
    expect(sidebar.textContent).toContain('src');
    expect(sidebar.textContent).toContain('README.md');
    expect(root.querySelector('#file-browser-main')!.textContent).toContain('README.md');
    expect(root.querySelector('#file-browser-breadcrumb')!.textContent).toContain('repo');
  });

  it('navigates into a directory and updates the breadcrumb', async () => {
    client.listDirectory.mockImplementation((_pipeline: string, path: string) =>
      Promise.resolve(listing(path, [['App.ts', false]]))
    );
    view.render();
    await flush();

    registry.get('file_browser_navigate')(new Event('click'), elementWithPath('src'));
    await flush();

    expect(client.listDirectory).toHaveBeenLastCalledWith('p1', 'src');
    const breadcrumb = root.querySelector('#file-browser-breadcrumb') as HTMLElement;
    expect(breadcrumb.textContent).toContain('src');
    expect(root.querySelector('#file-browser-main')!.textContent).toContain('App.ts');
  });

  it('opens a file and renders its content, marking the sidebar row active', async () => {
    view.render();
    await flush();

    registry.get('file_browser_open_file')(new Event('click'), elementWithPath('README.md'));
    await flush();

    expect(client.readFile).toHaveBeenCalledWith('p1', 'README.md');
    const main = root.querySelector('#file-browser-main') as HTMLElement;
    expect(main.textContent).toContain('# hi');
    const activeRow = root.querySelector('[data-path="README.md"]');
    expect(activeRow?.getAttribute('aria-current')).toBe('true');
  });

  it('navigates via a breadcrumb segment', async () => {
    client.listDirectory.mockImplementation((_pipeline: string, path: string) =>
      Promise.resolve(listing(path, []))
    );
    view.render();
    await flush();

    registry.get('file_browser_navigate')(new Event('click'), elementWithPath('a/b'));
    await flush();
    registry.get('file_browser_breadcrumb')(new Event('click'), elementWithPath('a'));
    await flush();

    expect(client.listDirectory).toHaveBeenLastCalledWith('p1', 'a');
  });

  it('toggles and persists the sidebar collapse state', async () => {
    view.render();
    await flush();

    registry.get('file_browser_toggle_sidebar')(new Event('click'), document.createElement('button'));

    const sidebar = root.querySelector('#file-browser-sidebar') as HTMLElement;
    expect(sidebar.classList.contains('hidden')).toBe(true);
    expect(window.localStorage.getItem('file-browser:sidebar_collapsed:p1')).toBe('true');

    registry.get('file_browser_toggle_sidebar')(new Event('click'), document.createElement('button'));
    expect(sidebar.classList.contains('hidden')).toBe(false);
  });

  it('restores the last visited directory on render', async () => {
    window.localStorage.setItem('file-browser:lastPath:p1', JSON.stringify('src'));
    LocalStorageManager.resetInstances();
    client.listDirectory.mockResolvedValue(listing('src', [['App.ts', false]]));

    view.render();
    await flush();

    expect(client.listDirectory).toHaveBeenCalledWith('p1', 'src');
    expect(root.querySelector('#file-browser-breadcrumb')!.textContent).toContain('src');
  });

  it('discards a stale directory response from fast navigation', async () => {
    view.render();
    await flush();

    let resolveFirst: (value: DirectoryListing) => void = () => {};
    const first = new Promise<DirectoryListing>((resolve) => {
      resolveFirst = resolve;
    });
    client.listDirectory
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(() => Promise.resolve(listing('b', [['B.ts', false]])));

    // Start 'a' (slow) then immediately navigate to 'b' (fast).
    void view.loadDirectory('a');
    void view.loadDirectory('b');
    await flush();

    expect(root.querySelector('#file-browser-main')!.textContent).toContain('B.ts');

    // The late 'a' response must be ignored.
    resolveFirst(listing('a', [['A.ts', false]]));
    await flush();
    expect(root.querySelector('#file-browser-main')!.textContent).toContain('B.ts');
    expect(root.querySelector('#file-browser-main')!.textContent).not.toContain('A.ts');
  });

  it('shows an error state when a directory cannot be loaded', async () => {
    client.listDirectory.mockRejectedValue(new Error('Path not found'));
    view.render();
    await flush();

    const main = root.querySelector('#file-browser-main') as HTMLElement;
    expect(main.textContent).toContain('Path not found');
  });

  it('refreshes the current directory and re-reads the selected file', async () => {
    view.render();
    await flush();
    registry.get('file_browser_open_file')(new Event('click'), elementWithPath('README.md'));
    await flush();

    client.listDirectory.mockClear();
    client.readFile.mockClear();

    registry.get('file_browser_refresh')(new Event('click'), document.createElement('button'));
    await flush();
    await flush();

    expect(client.listDirectory).toHaveBeenCalledWith('p1', '');
    expect(client.readFile).toHaveBeenCalledWith('p1', 'README.md');
  });
});
