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
import { FileContent } from '../../core/domain.ts';

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
});
