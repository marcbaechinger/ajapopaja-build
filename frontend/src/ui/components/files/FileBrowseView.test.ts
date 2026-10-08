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
import { DirectoryListing, FileContent, FileSearchResponse } from '../../../core/domain.ts';
import { LocalStorageManager } from '../../../core/LocalStorageManager.ts';

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

  it('lists the repository root and renders the directory listing in the main panel', async () => {
    view.render();
    await flush();

    expect(client.listDirectory).toHaveBeenCalledWith('p1', '');
    expect(root.querySelector('#file-browser-sidebar')).toBeNull();
    const main = root.querySelector('#file-browser-main') as HTMLElement;
    expect(main.textContent).toContain('src');
    expect(main.textContent).toContain('README.md');
    expect(root.querySelector('#file-browser-breadcrumb')!.textContent).toContain('repo');
  });

  it('keeps the main panel non-resizable by default', async () => {
    view.render();
    await flush();

    const main = root.querySelector('#file-browser-main') as HTMLElement;
    expect(main.className).toBe('flex-1 min-w-0 flex flex-col overflow-hidden');
    expect(main.classList.contains('resize-y')).toBe(false);
  });

  it('makes the main panel vertically resizable when enabled', async () => {
    view.destroy();
    view = new FileBrowseView(root, {
      pipelineId: 'p1',
      client,
      actionRegistry: registry as any,
      resizable: true,
    });
    view.render();
    await flush();

    const main = root.querySelector('#file-browser-main') as HTMLElement;
    expect(main.className).toBe('resize-y overflow-x-hidden h-[70vh]');
    // Vertical resize only: never the width.
    expect(main.classList.contains('resize-y')).toBe(true);
    expect(main.classList.contains('resize-x')).toBe(false);
    // The listing still renders inside the resizable panel.
    expect(main.textContent).toContain('README.md');
  });

  it('lets the shell grow with the resizable panel instead of fixing its height', async () => {
    view.destroy();
    view = new FileBrowseView(root, {
      pipelineId: 'p1',
      client,
      actionRegistry: registry as any,
      resizable: true,
    });
    view.render();
    await flush();

    const shell = root.firstElementChild as HTMLElement;
    // A fixed height would clamp the resizable panel; a min height lets it grow.
    expect(shell.classList.contains('h-[70vh]')).toBe(false);
    expect(shell.classList.contains('min-h-[70vh]')).toBe(true);
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

  it('opens a file and renders its content', async () => {
    view.render();
    await flush();

    registry.get('file_browser_open_file')(new Event('click'), elementWithPath('README.md'));
    await flush();

    expect(client.readFile).toHaveBeenCalledWith('p1', 'README.md');
    const main = root.querySelector('#file-browser-main') as HTMLElement;
    expect(main.textContent).toContain('# hi');
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

  it('renders the current root directory as a breadcrumb link back to the listing', async () => {
    view.render();
    await flush();

    registry.get('file_browser_open_file')(new Event('click'), elementWithPath('README.md'));
    await flush();
    expect(root.querySelector('#file-browser-main')!.textContent).toContain('# hi');

    const rootCrumb = root.querySelector(
      '#file-browser-breadcrumb button[data-action-click="file_browser_breadcrumb"][data-path=""]'
    ) as HTMLButtonElement | null;
    expect(rootCrumb).not.toBeNull();

    registry.get('file_browser_breadcrumb')(new Event('click'), rootCrumb!);
    await flush();

    expect(client.listDirectory).toHaveBeenLastCalledWith('p1', '');
    expect(root.querySelector('#file-browser-main')!.textContent).toContain('README.md');
  });

  it('renders the current nested directory as a link that leaves an open file', async () => {
    client.listDirectory.mockImplementation((_pipeline: string, path: string) =>
      Promise.resolve(listing(path, [['App.ts', false]]))
    );
    view.render();
    await flush();

    registry.get('file_browser_navigate')(new Event('click'), elementWithPath('src'));
    await flush();
    client.readFile.mockResolvedValue(
      new FileContent({ name: 'App.ts', path: 'src/App.ts', size: 5, content: 'app\n' })
    );
    registry.get('file_browser_open_file')(new Event('click'), elementWithPath('src/App.ts'));
    await flush();
    expect(root.querySelector('#file-browser-main')!.textContent).toContain('app');

    const currentCrumb = root.querySelector(
      '#file-browser-breadcrumb button[data-action-click="file_browser_breadcrumb"][data-path="src"]'
    ) as HTMLButtonElement | null;
    expect(currentCrumb).not.toBeNull();

    registry.get('file_browser_breadcrumb')(new Event('click'), currentCrumb!);
    await flush();

    expect(client.listDirectory).toHaveBeenLastCalledWith('p1', 'src');
    expect(root.querySelector('#file-browser-main')!.textContent).toContain('App.ts');
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

  it('copies the selected file path to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    view.render();
    await flush();
    client.readFile.mockResolvedValue(
      new FileContent({
        name: 'foo_bar.py',
        path: 'backend/core/foo_bar.py',
        size: 2,
        content: 'x\n',
      })
    );
    registry.get('file_browser_open_file')(
      new Event('click'),
      elementWithPath('backend/core/foo_bar.py')
    );
    await flush();

    const button = root.querySelector(
      '[data-action-click="copy_file_path"]'
    ) as HTMLButtonElement;
    expect(button).not.toBeNull();

    await registry.get('copy_file_path')(new Event('click'), button);

    expect(writeText).toHaveBeenCalledWith('backend/core/foo_bar.py');
  });

  it('renders a copy-path button for every directory entry', async () => {
    view.render();
    await flush();

    const copyButtons = Array.from(
      root.querySelectorAll('[data-action-click="copy_file_path"]')
    ) as HTMLButtonElement[];
    expect(copyButtons.length).toBe(2);
    const paths = copyButtons.map((button) => button.getAttribute('data-path'));
    expect(paths).toContain('src');
    expect(paths).toContain('README.md');
    copyButtons.forEach((button) => {
      expect(button.getAttribute('title')).toBe('Copy path');
      expect(button.getAttribute('aria-label')).toBe('Copy path');
    });
  });

  it('copies a directory path without navigating into it', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    view.render();
    await flush();
    client.listDirectory.mockClear();

    const copyButton = root.querySelector(
      '[data-action-click="copy_file_path"][data-path="src"]'
    ) as HTMLButtonElement;
    expect(copyButton).not.toBeNull();

    await registry.get('copy_file_path')(new Event('click'), copyButton);

    expect(writeText).toHaveBeenCalledWith('src');
    expect(client.listDirectory).not.toHaveBeenCalled();
  });

  it('opens the raw file in a synchronously-opened new tab', async () => {
    const fakeWindow = { location: { href: '' }, opener: {}, close: vi.fn() };
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(fakeWindow as any);
    client.createRawFileToken = vi
      .fn()
      .mockResolvedValue({ token: 'raw.jwt', expiresIn: 60 });
    client.rawFileUrl = vi.fn().mockReturnValue('http://test/raw?token=raw.jwt');

    view.render();
    await flush();
    client.readFile.mockResolvedValue(
      new FileContent({ name: 'README.md', path: 'README.md', size: 5, content: '# hi\n' })
    );
    registry.get('file_browser_open_file')(new Event('click'), elementWithPath('README.md'));
    await flush();

    const button = root.querySelector(
      '[data-action-click="open_file_raw"]'
    ) as HTMLButtonElement;
    expect(button).not.toBeNull();

    await registry.get('open_file_raw')(new Event('click'), button);
    await flush();

    expect(openSpy).toHaveBeenCalledWith('', '_blank');
    expect(fakeWindow.opener).toBeNull();
    expect(client.createRawFileToken).toHaveBeenCalledWith('p1', 'README.md');
    expect(client.rawFileUrl).toHaveBeenCalledWith('p1', 'raw.jwt');
    expect(fakeWindow.location.href).toBe('http://test/raw?token=raw.jwt');

    openSpy.mockRestore();
  });

  it('closes the opened tab when minting the raw token fails', async () => {
    const fakeWindow = { location: { href: '' }, opener: {}, close: vi.fn() };
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(fakeWindow as any);
    client.createRawFileToken = vi.fn().mockRejectedValue(new Error('boom'));
    client.rawFileUrl = vi.fn();

    view.render();
    await flush();
    client.readFile.mockResolvedValue(
      new FileContent({ name: 'README.md', path: 'README.md', size: 5, content: '# hi\n' })
    );
    registry.get('file_browser_open_file')(new Event('click'), elementWithPath('README.md'));
    await flush();

    const button = root.querySelector(
      '[data-action-click="open_file_raw"]'
    ) as HTMLButtonElement;
    await registry.get('open_file_raw')(new Event('click'), button);
    await flush();

    expect(fakeWindow.close).toHaveBeenCalled();
    expect(client.rawFileUrl).not.toHaveBeenCalled();

    openSpy.mockRestore();
  });

  it('downloads the selected file through the File System Access API', async () => {
    const writable = { write: vi.fn(), close: vi.fn() };
    const handle = { createWritable: vi.fn().mockResolvedValue(writable) };
    const picker = vi.fn().mockResolvedValue(handle);
    (window as any).showSaveFilePicker = picker;
    const pipeTo = vi.fn().mockResolvedValue(undefined);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: true, body: { pipeTo } } as any);
    client.createRawFileToken = vi
      .fn()
      .mockResolvedValue({ token: 'raw.jwt', expiresIn: 60 });
    client.rawFileUrl = vi
      .fn()
      .mockReturnValue('http://test/raw?token=raw.jwt&download=1');

    view.render();
    await flush();
    client.readFile.mockResolvedValue(
      new FileContent({ name: 'README.md', path: 'README.md', size: 5, content: '# hi\n' })
    );
    registry.get('file_browser_open_file')(new Event('click'), elementWithPath('README.md'));
    await flush();

    const button = root.querySelector(
      '[data-action-click="download_file"]'
    ) as HTMLButtonElement;
    expect(button).not.toBeNull();

    await registry.get('download_file')(new Event('click'), button);
    await flush();

    expect(client.createRawFileToken).toHaveBeenCalledWith('p1', 'README.md');
    expect(client.rawFileUrl).toHaveBeenCalledWith('p1', 'raw.jwt', { download: true });
    expect(picker).toHaveBeenCalledWith({ suggestedName: 'README.md' });
    expect(handle.createWritable).toHaveBeenCalled();
    expect(pipeTo).toHaveBeenCalledWith(writable);
    expect(fetchSpy).toHaveBeenCalledWith('http://test/raw?token=raw.jwt&download=1');

    fetchSpy.mockRestore();
    delete (window as any).showSaveFilePicker;
  });

  it('falls back to an <a download> when the picker API is unavailable', async () => {
    delete (window as any).showSaveFilePicker;
    const blob = new Blob(['hello']);
    const createObjectURL = vi.fn().mockReturnValue('blob:test');
    const revokeObjectURL = vi.fn();
    (URL as any).createObjectURL = createObjectURL;
    (URL as any).revokeObjectURL = revokeObjectURL;
    let clicked: HTMLAnchorElement | null = null;
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicked = this;
      });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: true, blob: vi.fn().mockResolvedValue(blob) } as any);
    client.createRawFileToken = vi
      .fn()
      .mockResolvedValue({ token: 'raw.jwt', expiresIn: 60 });
    client.rawFileUrl = vi
      .fn()
      .mockReturnValue('http://test/raw?token=raw.jwt&download=1');

    view.render();
    await flush();
    client.readFile.mockResolvedValue(
      new FileContent({ name: 'README.md', path: 'README.md', size: 5, content: '# hi\n' })
    );
    registry.get('file_browser_open_file')(new Event('click'), elementWithPath('README.md'));
    await flush();

    const button = root.querySelector(
      '[data-action-click="download_file"]'
    ) as HTMLButtonElement;
    await registry.get('download_file')(new Event('click'), button);
    await flush();

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(clicked!.download).toBe('README.md');
    expect(clicked!.href).toContain('blob:test');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test');

    clickSpy.mockRestore();
    fetchSpy.mockRestore();
    delete (URL as any).createObjectURL;
    delete (URL as any).revokeObjectURL;
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

  it('renders the same breadcrumb at the bottom as at the top', async () => {
    view.render();
    await flush();

    const top = root.querySelector('#file-browser-breadcrumb') as HTMLElement;
    const bottom = root.querySelector('#file-browser-breadcrumb-bottom') as HTMLElement;
    expect(bottom).not.toBeNull();
    expect(bottom.textContent).toContain('repo');
    expect(bottom.innerHTML).toBe(top.innerHTML);
  });

  it('shows a to-top control at the bottom that scrolls the content to the top', async () => {
    view.render();
    await flush();

    const toTop = root.querySelector(
      '[data-action-click="file_browser_to_top"]'
    ) as HTMLButtonElement | null;
    expect(toTop).not.toBeNull();
    // The refresh action stays in the header only.
    expect(root.querySelectorAll('[data-action-click="file_browser_refresh"]').length).toBe(1);
    expect(root.querySelector('#file-browser-breadcrumb-bottom')!.parentElement).toBe(
      toTop!.parentElement!.parentElement
    );

    const scroller = root.querySelector(
      '[data-role="file-browser-scroll"]'
    ) as HTMLElement;
    scroller.scrollTop = 100;
    const main = root.querySelector('#file-browser-main') as HTMLElement;
    main.scrollTop = 100;

    registry.get('file_browser_to_top')(new Event('click'), toTop!);

    expect(scroller.scrollTop).toBe(0);
    expect(main.scrollTop).toBe(0);
  });
});

describe('FileBrowseView route wiring', () => {
  let root: HTMLElement;
  let registry: FakeRegistry;
  let client: any;
  let view: FileBrowseView | null = null;

  const makeListing = (path: string) => listing(path, [['App.ts', false]]);
  const makeFile = (path: string) =>
    new FileContent({ name: 'App.ts', path, size: 4, content: 'app\n' });

  beforeEach(() => {
    document.body.innerHTML = '';
    root = document.createElement('div');
    document.body.appendChild(root);
    window.localStorage.clear();
    LocalStorageManager.resetInstances();

    registry = new FakeRegistry();
    client = {
      listDirectory: vi.fn((_pipeline: string, path: string) =>
        Promise.resolve(makeListing(path))
      ),
      readFile: vi.fn((_pipeline: string, path: string) => Promise.resolve(makeFile(path))),
      getMeta: vi.fn(),
    };
  });

  afterEach(() => {
    view?.destroy();
    view = null;
  });

  const build = (options: { initialPath?: string | null; onNavigate?: any } = {}) => {
    view = new FileBrowseView(root, {
      pipelineId: 'p1',
      client,
      actionRegistry: registry as any,
      ...options,
    });
    return view;
  };

  it('lets an explicit initialPath beat the persisted lastPath', async () => {
    window.localStorage.setItem('file-browser:lastPath:p1', JSON.stringify('persisted'));
    LocalStorageManager.resetInstances();
    client.getMeta.mockResolvedValue({ isDir: true });

    build({ initialPath: 'src' }).render();
    await flush();

    expect(client.getMeta).toHaveBeenCalledWith('p1', 'src');
    expect(client.listDirectory).toHaveBeenCalledWith('p1', 'src');
  });

  it('falls back to the persisted lastPath when no explicit path is given', async () => {
    window.localStorage.setItem('file-browser:lastPath:p1', JSON.stringify('persisted'));
    LocalStorageManager.resetInstances();

    build().render();
    await flush();

    expect(client.listDirectory).toHaveBeenCalledWith('p1', 'persisted');
  });

  it('resolves a directory deep link via getMeta', async () => {
    client.getMeta.mockResolvedValue({ isDir: true });

    const v = build({ initialPath: 'src' });
    await v.navigateTo('src');

    expect(client.getMeta).toHaveBeenCalledWith('p1', 'src');
    expect(client.listDirectory).toHaveBeenLastCalledWith('p1', 'src');
  });

  it('resolves a file deep link via getMeta', async () => {
    client.getMeta.mockResolvedValue({ isDir: false });

    const v = build();
    await v.navigateTo('src/App.ts');

    expect(client.getMeta).toHaveBeenCalledWith('p1', 'src/App.ts');
    expect(client.readFile).toHaveBeenCalledWith('p1', 'src/App.ts');
  });

  it('updates the breadcrumb to the file directory for a file deep link', async () => {
    client.getMeta.mockResolvedValue({ isDir: false });

    const v = build();
    v.render();
    await flush();
    await v.navigateTo('src/App.ts');

    expect(v.getCurrentPath()).toEqual({ dir: 'src', file: 'src/App.ts' });
    expect(root.querySelector('#file-browser-breadcrumb')!.textContent).toContain('src');
  });

  it('defaults to a directory when getMeta is missing or rejects', async () => {
    const missing = build();
    await missing.navigateTo('src');
    expect(client.listDirectory).toHaveBeenLastCalledWith('p1', 'src');

    client.getMeta.mockReset();
    client.getMeta.mockRejectedValue(new Error('boom'));
    await missing.navigateTo('other');
    expect(client.listDirectory).toHaveBeenLastCalledWith('p1', 'other');
  });

  it('treats the empty path as the repository root', async () => {
    const v = build();
    await v.navigateTo('');
    expect(client.getMeta).not.toHaveBeenCalled();
    expect(client.listDirectory).toHaveBeenLastCalledWith('p1', '');
  });

  it('reports getCurrentPath for directories and files', async () => {
    client.getMeta.mockResolvedValue({ isDir: true });
    const v = build();
    await v.navigateTo('src');
    expect(v.getCurrentPath()).toEqual({ dir: 'src', file: null });

    await v.openFile('src/App.ts');
    expect(v.getCurrentPath()).toEqual({ dir: 'src', file: 'src/App.ts' });
  });

  it('emits onNavigate for user navigation but never for silent loads', async () => {
    const onNavigate = vi.fn();
    client.getMeta.mockResolvedValue({ isDir: true });

    const v = build({ initialPath: 'src', onNavigate });
    v.render();
    await flush();
    // render() / route-driven loads are silent.
    expect(onNavigate).not.toHaveBeenCalled();

    // Entry click.
    registry.get('file_browser_navigate')(new Event('click'), elementWithPath('src/lib'));
    await flush();
    expect(onNavigate).toHaveBeenLastCalledWith({ dir: 'src/lib', file: null });

    // Breadcrumb.
    registry.get('file_browser_breadcrumb')(new Event('click'), elementWithPath('src'));
    await flush();
    expect(onNavigate).toHaveBeenLastCalledWith({ dir: 'src', file: null });

    // File open.
    registry.get('file_browser_open_file')(
      new Event('click'),
      elementWithPath('src/App.ts')
    );
    await flush();
    expect(onNavigate).toHaveBeenLastCalledWith({ dir: 'src', file: 'src/App.ts' });

    // Explicit silent navigation is not reported.
    const before = onNavigate.mock.calls.length;
    await v.navigateTo('other', { silent: true });
    expect(onNavigate.mock.calls.length).toBe(before);

    // Refresh is not reported either.
    await v.refresh();
    expect(onNavigate.mock.calls.length).toBe(before);
  });
});

describe('FileBrowseView file search', () => {
  let root: HTMLElement;
  let registry: FakeRegistry;
  let client: any;
  let view: FileBrowseView | null = null;

  const flushAsync = async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    root = document.createElement('div');
    document.body.appendChild(root);
    window.localStorage.clear();
    LocalStorageManager.resetInstances();

    registry = new FakeRegistry();
    client = {
      listDirectory: vi.fn((_pipeline: string, path: string) =>
        Promise.resolve(listing(path, [['App.ts', false]]))
      ),
      readFile: vi.fn((_pipeline: string, path: string) =>
        Promise.resolve(new FileContent({ name: 'App.ts', path, size: 4, content: 'app\n' }))
      ),
      getMeta: vi.fn(),
      searchFiles: vi.fn().mockResolvedValue(
        new FileSearchResponse({
          query: 'App',
          results: [{ path: 'src/App.ts', name: 'App.ts', is_dir: false }],
          truncated: false,
          index_ready: true,
        })
      ),
    };
  });

  afterEach(() => {
    view?.destroy();
    view = null;
    vi.useRealTimers();
  });

  const build = () => {
    view = new FileBrowseView(root, {
      pipelineId: 'p1',
      client,
      actionRegistry: registry as any,
    });
    return view;
  };

  it('renders the search input in the header, left of the refresh button, with a delimiter', async () => {
    build().render();
    await flushAsync();

    const searchMount = root.querySelector('#file-browser-search-mount') as HTMLElement;
    const refresh = root.querySelector('#file-browser-refresh-btn') as HTMLElement;
    expect(searchMount).not.toBeNull();
    expect(refresh).not.toBeNull();

    // The delimiter sits between the search control group and refresh.
    const delimiter = refresh.previousElementSibling as HTMLElement;
    expect(delimiter.tagName).toBe('SPAN');
    expect(delimiter.className).toContain('w-px');
    expect(searchMount.compareDocumentPosition(refresh) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // The search field itself is compact (fixed height).
    const input = searchMount.querySelector('input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.className).toContain('h-7');
  });

  it('searches the backend and navigates to the selected file', async () => {
    client.getMeta.mockResolvedValue({ isDir: false });
    build().render();
    await flushAsync();

    const input = root.querySelector('#file-browser-search-mount input') as HTMLInputElement;
    input.value = 'App';
    input.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(150);
    await flushAsync();

    expect(client.searchFiles).toHaveBeenCalledWith('p1', 'App', expect.any(AbortSignal));

    const option = root.querySelector('[data-role="search-result"]') as HTMLElement;
    expect(option).not.toBeNull();
    option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await flushAsync();

    expect(client.getMeta).toHaveBeenCalledWith('p1', 'src/App.ts');
    expect(client.readFile).toHaveBeenCalledWith('p1', 'src/App.ts');
  });

  it('adjusts the breadcrumb and stored path to the file directory when selecting a search result', async () => {
    client.getMeta.mockResolvedValue({ isDir: false });
    build().render();
    await flushAsync();

    await view!.loadDirectory('design');
    await flushAsync();
    expect(root.querySelector('#file-browser-breadcrumb')!.textContent).toContain('design');

    const input = root.querySelector('#file-browser-search-mount input') as HTMLInputElement;
    input.value = 'App';
    input.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(150);
    await flushAsync();

    const option = root.querySelector('[data-role="search-result"]') as HTMLElement;
    option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await flushAsync();

    expect(client.readFile).toHaveBeenCalledWith('p1', 'src/App.ts');
    expect(view!.getCurrentPath()).toEqual({ dir: 'src', file: 'src/App.ts' });
    const breadcrumb = root.querySelector('#file-browser-breadcrumb') as HTMLElement;
    expect(breadcrumb.textContent).toContain('src');
    expect(breadcrumb.textContent).not.toContain('design');
    // The file's directory is persisted so a re-mount restores it.
    expect(JSON.parse(window.localStorage.getItem('file-browser:lastPath:p1')!)).toBe('src');
  });

  it('destroys the mounted search input with the view', async () => {
    build().render();
    await flushAsync();
    view!.destroy();
    expect(root.innerHTML).toBe('');
    view = null;
  });
});
