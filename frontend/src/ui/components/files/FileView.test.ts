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

import { describe, it, expect } from 'vitest';
import { FileView } from './FileView.ts';
import { FileContent } from '../../../core/domain.ts';

function file(overrides: Record<string, unknown>): FileContent {
  return new FileContent({ name: 'file', path: 'file', size: 0, ...overrides });
}

/** Parse a rendered view without executing scripts. */
function renderIntoDom(file: FileContent): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = FileView.render(file);
  document.body.appendChild(host);
  return host;
}

describe('FileView', () => {
  it('prepends line numbers without including them in the selectable code', () => {
    const host = renderIntoDom(
      file({ name: 'app.py', path: 'app.py', content: 'print(1)\nprint(2)\n' })
    );

    const gutter = host.querySelector('[aria-hidden="true"].select-none');
    expect(gutter).not.toBeNull();
    expect(gutter!.textContent).toContain('1');
    expect(gutter!.textContent).toContain('3');

    // Line numbers live outside the <code> element, so selecting/copying the
    // source code never picks them up.
    const code = host.querySelector('code.hljs')!;
    expect(code.textContent).not.toContain('\n1');
    expect(code.textContent).not.toContain('\n3');
  });

  it('syntax-highlights content based on the file extension', () => {
    const host = renderIntoDom(
      file({ name: 'app.ts', path: 'src/app.ts', content: 'const answer: number = 42;\n' })
    );

    const code = host.querySelector('code.hljs');
    expect(code).not.toBeNull();
    // highlight.js wraps tokens in spans carrying its theme classes.
    expect(code!.querySelector('.hljs-keyword')).not.toBeNull();
    expect(code!.textContent).toContain('const answer');
  });

  it('highlights markup files', () => {
    const host = renderIntoDom(
      file({ name: 'index.html', path: 'index.html', content: '<div class="x">hi</div>' })
    );

    const code = host.querySelector('code.hljs')!;
    expect(code.querySelector('.hljs-tag')).not.toBeNull();
  });

  it('falls back to the path extension when the name carries none', () => {
    // highlightAuto leaves a bare Markdown heading as plain text, so only the
    // path-derived `.md` mapping can produce the section highlight.
    const host = renderIntoDom(
      file({ name: 'readme', path: 'docs/readme.md', content: '## Heading\n' })
    );

    const code = host.querySelector('code.hljs')!;
    expect(code.querySelector('.hljs-section')).not.toBeNull();
  });

  it('escapes content when no language can be determined', () => {
    const host = renderIntoDom(
      file({ name: 'notes.unknownext', path: 'notes.unknownext', content: '<script>alert(1)</script>' })
    );

    // The raw markup must never survive as an element.
    expect(host.querySelector('script')).toBeNull();
    expect(host.textContent).toContain('<script>alert(1)</script>');
  });

  it('renders a message instead of content for binary files', () => {
    const host = renderIntoDom(file({ name: 'logo.png', is_binary: true }));

    expect(host.querySelector('code.hljs')).toBeNull();
    expect(host.textContent).toContain('binary file');
  });

  it('renders a copy-path action carrying the repository-relative path', () => {
    const host = renderIntoDom(
      file({ name: 'foo_bar.py', path: 'backend/core/foo_bar.py', content: '' })
    );

    const button = host.querySelector(
      '[data-action-click="copy_file_path"]'
    ) as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    expect(button!.getAttribute('data-path')).toBe('backend/core/foo_bar.py');
    expect(button!.getAttribute('title')).toBe('Copy path');
  });

  it('renders a raw action next to the copy action carrying the path', () => {
    const host = renderIntoDom(
      file({ name: 'foo_bar.py', path: 'backend/core/foo_bar.py', content: '' })
    );

    const button = host.querySelector(
      '[data-action-click="open_file_raw"]'
    ) as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    expect(button!.getAttribute('data-path')).toBe('backend/core/foo_bar.py');
    expect(button!.getAttribute('title')).toBe('Open raw file');
    expect(button!.getAttribute('aria-label')).toBe('Open raw file');
    expect(button!.textContent!.trim().toLowerCase()).toBe('raw');

    // The raw button sits after the copy/download icon buttons.
    const download = host.querySelector('[data-action-click="download_file"]');
    expect(download!.nextElementSibling).toBe(button);
  });

  it('renders the raw action for binary files too', () => {
    const host = renderIntoDom(
      file({ name: 'logo.png', path: 'assets/logo.png', is_binary: true })
    );

    const button = host.querySelector(
      '[data-action-click="open_file_raw"]'
    ) as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    expect(button!.getAttribute('data-path')).toBe('assets/logo.png');
  });

  it('renders a download action next to the copy action carrying the path', () => {
    const host = renderIntoDom(
      file({ name: 'foo_bar.py', path: 'backend/core/foo_bar.py', content: '' })
    );

    const button = host.querySelector(
      '[data-action-click="download_file"]'
    ) as HTMLButtonElement | null;
    expect(button).not.toBeNull();
    expect(button!.getAttribute('data-path')).toBe('backend/core/foo_bar.py');
    expect(button!.getAttribute('title')).toBe('Download file');
    expect(button!.getAttribute('aria-label')).toBe('Download file');
    expect(button!.querySelector('use')!.getAttribute('href')).toBe(
      '/icons.svg#download-icon'
    );

    // The download button sits immediately after the copy-path button.
    const copy = host.querySelector('[data-action-click="copy_file_path"]');
    expect(copy!.nextElementSibling).toBe(button);
  });

  it('renders the download action for binary and truncated files too', () => {
    const binary = renderIntoDom(
      file({ name: 'logo.png', path: 'assets/logo.png', is_binary: true })
    );
    const truncated = renderIntoDom(
      file({
        name: 'big.log',
        path: 'logs/big.log',
        truncated: true,
        content: 'partial',
      })
    );

    for (const host of [binary, truncated]) {
      const button = host.querySelector(
        '[data-action-click="download_file"]'
      ) as HTMLButtonElement | null;
      expect(button).not.toBeNull();
      expect(button!.getAttribute('data-action-click')).toBe('download_file');
    }
  });
});
