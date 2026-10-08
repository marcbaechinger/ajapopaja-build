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
import { renderMarkdown } from './markdown.ts';

/**
 * jsdom has no layout engine, so these tests guard the *declared* width
 * behaviour of the shared Markdown table renderer rather than measuring pixels:
 * the wrapper must shrink to the table's content (`inline-block`, no `w-full`)
 * while still being scrollable (`overflow-x-auto`), and the table itself must
 * not force full width anymore.
 */
describe('renderMarkdown table width', () => {
  const table = [
    '| Name | Value |',
    '| --- | --- |',
    '| alpha | 1 |',
  ].join('\n');

  function parseTable(markdown: string): { wrapper: HTMLElement; table: HTMLTableElement } {
    const host = document.createElement('div');
    host.innerHTML = renderMarkdown(markdown);
    const wrapper = host.querySelector('div') as HTMLElement;
    const el = host.querySelector('table') as HTMLTableElement;
    expect(wrapper).not.toBeNull();
    expect(el).not.toBeNull();
    return { wrapper, table: el };
  }

  it('wraps the table in a shrink-to-fit, horizontally scrollable container', () => {
    const { wrapper } = parseTable(table);
    expect(wrapper.classList.contains('inline-block')).toBe(true);
    expect(wrapper.classList.contains('overflow-x-auto')).toBe(true);
    // The wrapper should not default to full width.
    expect(wrapper.classList.contains('w-full')).toBe(false);
  });

  it('keeps the existing wrapper surface styling', () => {
    const { wrapper } = parseTable(table);
    expect(wrapper.classList.contains('my-4')).toBe(true);
    expect(wrapper.classList.contains('border')).toBe(true);
    expect(wrapper.classList.contains('border-app-border')).toBe(true);
    expect(wrapper.classList.contains('rounded-lg')).toBe(true);
  });

  it('does not force the table to full width but keeps its typography', () => {
    const { table: el } = parseTable(table);
    expect(el.classList.contains('w-full')).toBe(false);
    expect(el.classList.contains('text-sm')).toBe(true);
    expect(el.classList.contains('text-left')).toBe(true);
    expect(el.classList.contains('bg-app-bg')).toBe(true);
    // The inline margins that keep the wrapper in charge of spacing stay.
    expect(el.getAttribute('style')).toContain('margin-top: 0');
    expect(el.getAttribute('style')).toContain('margin-bottom: 0');
  });

  it('still renders the table content unchanged', () => {
    const { table: el } = parseTable(table);
    const headers = Array.from(el.querySelectorAll('thead th')).map((th) => th.textContent);
    expect(headers).toEqual(['Name', 'Value']);
    const cells = Array.from(el.querySelectorAll('tbody td')).map((td) => td.textContent);
    expect(cells).toEqual(['alpha', '1']);
  });
});
