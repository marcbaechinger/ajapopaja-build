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
import { DiffView } from './DiffView.ts';
import { FileView } from './FileView.ts';
import { ActionRegistry } from '../../core/ActionRegistry.ts';

const SIMPLE_PATCH = `diff --git a/src/foo.ts b/src/foo.ts
index 1234567..89abcde 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,3 +1,4 @@ function foo() {
 context line
-removed line
+added line
+another added
 more context
diff --git a/src/bar.ts b/src/bar.ts
index 2234567..99abcde 100644
--- a/src/bar.ts
+++ b/src/bar.ts
@@ -10,2 +10,3 @@
 old one
+new one
 old two
`;

const BINARY_PATCH = `diff --git a/image.png b/image.png
new file mode 100644
index 0000000..abc1234
Binary files /dev/null and b/image.png differ
`;

describe('DiffView', () => {
  let mount: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    mount = document.createElement('div');
    document.body.appendChild(mount);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders one file section per diff --git entry with path and stats', () => {
    const view = new DiffView(mount, { patch: SIMPLE_PATCH });
    view.render();

    const files = mount.querySelectorAll('[data-role="file"]');
    expect(files.length).toBe(2);

    const paths = Array.from(mount.querySelectorAll('[data-role="file-path"]')).map(
      (el) => el.textContent
    );
    expect(paths).toEqual(['src/foo.ts', 'src/bar.ts']);

    const foo = files[0] as HTMLElement;
    expect(foo.querySelector('[data-role="file-added"]')?.textContent).toBe('+2');
    expect(foo.querySelector('[data-role="file-removed"]')?.textContent).toBe('-1');

    const bar = files[1] as HTMLElement;
    expect(bar.querySelector('[data-role="file-added"]')?.textContent).toBe('+1');
    expect(bar.querySelector('[data-role="file-removed"]')?.textContent).toBe('-0');
  });

  it('renders hunk headers and colored added/removed/context rows', () => {
    const view = new DiffView(mount, { patch: SIMPLE_PATCH });
    view.render();

    const hunkHeaders = mount.querySelectorAll('[data-role="hunk-header"]');
    expect(hunkHeaders.length).toBe(2);
    expect(hunkHeaders[0].textContent).toContain('@@ -1,3 +1,4 @@');
    expect(hunkHeaders[0].textContent).toContain('function foo()');

    const added = mount.querySelectorAll('[data-type="add"]');
    expect(added.length).toBe(3);
    expect(added[0].classList.contains('text-green-300')).toBe(true);
    expect(added[0].textContent).toContain('added line');

    const removed = mount.querySelectorAll('[data-type="remove"]');
    expect(removed.length).toBe(1);
    expect(removed[0].classList.contains('text-red-300')).toBe(true);
    expect(removed[0].textContent).toContain('removed line');

    const context = mount.querySelectorAll('[data-type="context"]');
    expect(context.length).toBeGreaterThan(0);
    expect(context[0].classList.contains('text-app-text/80')).toBe(true);
  });

  it('renders a line-number gutter derived from the hunk range', () => {
    const patch = `diff --git a/a.txt b/a.txt
--- a/a.txt
+++ b/a.txt
@@ -5,2 +7,2 @@
 ctx
-old
+new
`;
    const view = new DiffView(mount, { patch });
    view.render();

    const rows = mount.querySelectorAll('[data-role="diff-line"]');
    // row 0: context line old=5 new=7
    expect(rows[0].querySelector('[data-role="line-number-old"]')?.textContent).toBe('5');
    expect(rows[0].querySelector('[data-role="line-number-new"]')?.textContent).toBe('7');
    // row 1: removed old=6 no new
    expect(rows[1].querySelector('[data-role="line-number-old"]')?.textContent).toBe('6');
    expect(rows[1].querySelector('[data-role="line-number-new"]')?.textContent).toBe('');
    // row 2: added no old, new=8
    expect(rows[2].querySelector('[data-role="line-number-old"]')?.textContent).toBe('');
    expect(rows[2].querySelector('[data-role="line-number-new"]')?.textContent).toBe('8');
  });

  it('escapes HTML in patch content', () => {
    const patch = `diff --git a/evil.html b/evil.html
--- a/evil.html
+++ b/evil.html
@@ -1,1 +1,2 @@
 <div>
+<img src=x onerror=alert(1)>
`;
    const view = new DiffView(mount, { patch });
    view.render();

    expect(mount.querySelector('img')).toBeNull();
    const added = mount.querySelector('[data-type="add"]');
    expect(added?.textContent).toContain('<img src=x onerror=alert(1)>');
  });

  it('shows metadata and collapses/expands it via the header toggle', () => {
    const view = new DiffView(mount, {
      patch: SIMPLE_PATCH,
      metadata: {
        subject: 'My subject',
        author: 'Alice',
        branch: 'feature/x',
        createdAt: '2026-05-01T12:00:00Z',
        updatedAt: '2026-05-02T12:00:00Z',
      },
    });
    view.render();

    const details = mount.querySelector('[data-role="metadata-header"]') as HTMLDetailsElement;
    const body = mount.querySelector('[data-role="metadata-body"]') as HTMLElement;
    expect(details.open).toBe(true);
    expect(body.textContent).toContain('My subject');
    expect(body.textContent).toContain('Alice');
    expect(body.textContent).toContain('feature/x');

    const toggle = mount.querySelector('[data-role="metadata-toggle"]') as HTMLElement;
    toggle.click();
    expect(details.open).toBe(false);
    expect(body.classList.contains('hidden')).toBe(true);

    toggle.click();
    expect(details.open).toBe(true);
    expect(body.classList.contains('hidden')).toBe(false);
  });

  it('renders a collapsed header when initiallyExpanded is false', () => {
    const view = new DiffView(mount, { patch: SIMPLE_PATCH, initiallyExpanded: false });
    view.render();
    const details = mount.querySelector('[data-role="metadata-header"]') as HTMLDetailsElement;
    const body = mount.querySelector('[data-role="metadata-body"]') as HTMLElement;
    expect(details.open).toBe(false);
    expect(body.classList.contains('hidden')).toBe(true);
  });

  it('folds and unfolds a file body via the per-file toggle', () => {
    const view = new DiffView(mount, { patch: SIMPLE_PATCH });
    view.render();

    const file = mount.querySelector('[data-role="file"]') as HTMLDetailsElement;
    const body = file.querySelector('[data-role="file-body"]') as HTMLElement;
    expect(file.open).toBe(true);

    const toggle = file.querySelector('[data-role="file-toggle"]') as HTMLElement;
    toggle.click();
    expect(file.open).toBe(false);
    expect(body.classList.contains('hidden')).toBe(true);

    toggle.click();
    expect(file.open).toBe(true);
    expect(body.classList.contains('hidden')).toBe(false);
  });

  it('starts file bodies collapsed when filesInitiallyExpanded is false', () => {
    const view = new DiffView(mount, { patch: SIMPLE_PATCH, filesInitiallyExpanded: false });
    view.render();
    const file = mount.querySelector('[data-role="file"]') as HTMLDetailsElement;
    expect(file.open).toBe(false);
  });

  it('renders a placeholder for an empty patch', () => {
    const view = new DiffView(mount, { patch: '   \n  ' });
    view.render();
    expect(mount.querySelector('[data-role="diff-empty"]')?.textContent).toContain('No changes');
  });

  it('renders a Binary file note for binary hunks', () => {
    const view = new DiffView(mount, { patch: BINARY_PATCH });
    view.render();
    const note = mount.querySelector('[data-role="binary-note"]');
    expect(note).not.toBeNull();
    expect(note?.textContent).toContain('Binary file');
    expect(mount.querySelector('[data-role="diff-pre"]')).toBeNull();
  });

  it('renders a copy-path button immediately before the file path for every file', () => {
    const view = new DiffView(mount, { patch: SIMPLE_PATCH });
    view.render();

    const files = Array.from(mount.querySelectorAll('[data-role="file"]')) as HTMLElement[];
    expect(files.length).toBe(2);

    files.forEach((file, index) => {
      const path = file.querySelector('[data-role="file-path"]') as HTMLElement;
      const button = path.previousElementSibling as HTMLElement;
      expect(button?.tagName).toBe('BUTTON');
      expect(button.getAttribute('data-action-click')).toBe('copy_file_path');
      expect(button.getAttribute('data-path')).toBe(index === 0 ? 'src/foo.ts' : 'src/bar.ts');
    });
  });

  it('renders the copy-path button with the required attributes, icon and classes', () => {
    const view = new DiffView(mount, { patch: SIMPLE_PATCH });
    view.render();

    const button = mount.querySelector(
      '[data-role="file"] [data-action-click="copy_file_path"]'
    ) as HTMLButtonElement;
    expect(button).not.toBeNull();
    expect(button.getAttribute('type')).toBe('button');
    expect(button.getAttribute('data-action-click')).toBe('copy_file_path');
    expect(button.getAttribute('data-path')).toBe('src/foo.ts');
    expect(button.getAttribute('title')).toBe('Copy path');
    expect(button.getAttribute('aria-label')).toBe('Copy path');
    expect(button.className).toBe(
      'shrink-0 p-1 rounded text-app-muted hover:text-app-text hover:bg-app-surface/60 transition-colors cursor-pointer'
    );
    expect(button.querySelector('svg use')?.getAttribute('href')).toBe('/icons.svg#copy-icon');
  });

  it('copies the exact file path to the clipboard and restores the icon after 1.5s', async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    // Register the shared action exactly as the app does via FileView.
    const registry = new ActionRegistry();
    FileView.registerActions(registry);

    const view = new DiffView(mount, { patch: SIMPLE_PATCH });
    view.render();

    const buttons = mount.querySelectorAll(
      '[data-action-click="copy_file_path"]'
    ) as NodeListOf<HTMLButtonElement>;
    const button = buttons[0];
    expect(button.querySelector('svg use')?.getAttribute('href')).toBe('/icons.svg#copy-icon');

    await registry.execute('copy_file_path', new Event('click'), button);
    expect(writeText).toHaveBeenCalledWith('src/foo.ts');
    // Feedback swaps the icon for a check mark.
    expect(button.querySelector('svg use')?.getAttribute('href')).toBe('/icons.svg#check-icon');

    vi.advanceTimersByTime(1500);
    expect(button.querySelector('svg use')?.getAttribute('href')).toBe('/icons.svg#copy-icon');
  });

  it('does not change the file header layout classes when adding the copy button', () => {
    const view = new DiffView(mount, { patch: SIMPLE_PATCH });
    view.render();

    const summary = mount.querySelector('[data-role="file-toggle"]') as HTMLElement;
    // The header keeps its own vertical rhythm; the button is a small flex
    // child (p-1 + 14px icon) that fits within the existing py-2 header.
    expect(summary.className).toContain('py-2');
    expect(summary.className).toContain('items-center');
    expect(summary.className).toContain('gap-2');

    const button = summary.querySelector('[data-action-click="copy_file_path"]') as HTMLElement;
    expect(button.className).toContain('p-1');
    expect(button.className).toContain('shrink-0');

    const svg = button.querySelector('svg') as SVGElement;
    expect(svg.getAttribute('class')).toContain('w-3.5');
    expect(svg.getAttribute('class')).toContain('h-3.5');
  });

  it('does not toggle the file section when the copy-path button is clicked', () => {
    const view = new DiffView(mount, { patch: SIMPLE_PATCH });
    view.render();

    const file = mount.querySelector('[data-role="file"]') as HTMLDetailsElement;
    const button = file.querySelector(
      '[data-action-click="copy_file_path"]'
    ) as HTMLButtonElement;
    expect(file.open).toBe(true);

    button.click();

    expect(file.open).toBe(true);
  });

  it('removes its DOM and listeners from the mount on destroy', () => {
    const view = new DiffView(mount, { patch: SIMPLE_PATCH });
    view.render();
    expect(mount.querySelector('[data-role="diff-view"]')).not.toBeNull();

    view.destroy();
    expect(mount.querySelector('[data-role="diff-view"]')).toBeNull();
  });

  it('re-renders cleanly without duplicating content', () => {
    const view = new DiffView(mount, { patch: SIMPLE_PATCH });
    view.render();
    view.render();
    expect(mount.querySelectorAll('[data-role="file"]').length).toBe(2);
  });
});
