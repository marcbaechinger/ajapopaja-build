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
import { FileSearchInputView } from './FileSearchInputView.ts';
import { FileSearchResponse, FileSearchResult } from '../../../core/domain.ts';

function response(results: Array<Partial<FileSearchResult>>, truncated = false): FileSearchResponse {
  return new FileSearchResponse({
    query: 'q',
    results,
    truncated,
    index_ready: true,
  });
}

describe('FileSearchInputView', () => {
  let root: HTMLElement;
  let search: any;
  let onSelect: any;
  let view: FileSearchInputView | null = null;

  const results = [
    { path: 'src/ui/FileBrowseView.ts', name: 'FileBrowseView.ts', is_dir: false },
    { path: 'src/ui/components', name: 'components', is_dir: true },
  ];

  const build = (opts: Record<string, any> = {}) => {
    view = new FileSearchInputView(root, { search, onSelect, ...opts });
    view.render();
    return view;
  };

  const input = () => root.querySelector<HTMLInputElement>('input[type="text"]')!;
  const panel = () => root.querySelector<HTMLElement>('[role="listbox"]')!;

  const type = (value: string) => {
    const el = input();
    el.value = value;
    el.dispatchEvent(new Event('input'));
  };

  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    root = document.createElement('div');
    document.body.appendChild(root);
    search = vi.fn().mockResolvedValue(response(results));
    onSelect = vi.fn();
  });

  afterEach(() => {
    view?.destroy();
    view = null;
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('renders a compact fixed-height input without a button by default', () => {
    build();

    const el = input();
    expect(el).not.toBeNull();
    expect(el.className).toContain('h-7');
    expect(el.className).toContain('text-xs');
    expect(root.querySelector('button')).toBeNull();
    // No vertical padding/height is added to the host, so the header is stable.
    expect(root.className).not.toContain('py-');
  });

  it('renders the optional submit button when showButton is true', () => {
    build({ showButton: true });
    const button = root.querySelector('button');
    expect(button).not.toBeNull();
    expect(button!.className).toContain('h-7');
  });

  it('uses the provided placeholder and initial value', () => {
    build({ placeholder: 'Find…', initialValue: 'abc' });
    expect(input().getAttribute('placeholder')).toBe('Find…');
    expect(input().value).toBe('abc');
  });

  it('debounces as-you-type input before issuing the search', async () => {
    build();
    type('FileBrowse');

    expect(search).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(149);
    expect(search).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(search).toHaveBeenCalledTimes(1);
    expect(search.mock.calls[0][0]).toBe('FileBrowse');
  });

  it('shows matching results in the listbox', async () => {
    build();
    type('File');
    await vi.advanceTimersByTimeAsync(150);
    await vi.runOnlyPendingTimersAsync();

    expect(panel().hidden).toBe(false);
    expect(panel().textContent).toContain('FileBrowseView.ts');
    expect(panel().textContent).toContain('components');
    expect(input().getAttribute('aria-expanded')).toBe('true');
  });

  it('searches immediately on Enter, bypassing the debounce', async () => {
    build();
    type('abc');
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(search).toHaveBeenCalledTimes(1);
    // The pending debounce must not fire a second search.
    await vi.advanceTimersByTimeAsync(200);
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('searches immediately when the submit button is clicked', async () => {
    build({ showButton: true });
    type('abc');
    root.querySelector('button')!.dispatchEvent(new MouseEvent('click'));

    expect(search).toHaveBeenCalledTimes(1);
  });

  it('selects the highlighted result on Enter', async () => {
    build();
    type('File');
    await vi.advanceTimersByTimeAsync(150);
    await vi.runOnlyPendingTimersAsync();

    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ path: 'src/ui/FileBrowseView.ts' }));
    expect(panel().hidden).toBe(true);
  });

  it('moves the highlight with the arrow keys and wraps around', async () => {
    build();
    type('File');
    await vi.advanceTimersByTimeAsync(150);
    await vi.runOnlyPendingTimersAsync();

    let options = Array.from(panel().querySelectorAll('[role="option"]')) as HTMLElement[];
    expect(options[0].getAttribute('aria-selected')).toBe('true');

    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    options = Array.from(panel().querySelectorAll('[role="option"]')) as HTMLElement[];
    expect(options[1].getAttribute('aria-selected')).toBe('true');

    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    options = Array.from(panel().querySelectorAll('[role="option"]')) as HTMLElement[];
    expect(options[0].getAttribute('aria-selected')).toBe('true');

    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
    options = Array.from(panel().querySelectorAll('[role="option"]')) as HTMLElement[];
    expect(options[1].getAttribute('aria-selected')).toBe('true');
  });

  it('selects a result on click', async () => {
    build();
    type('File');
    await vi.advanceTimersByTimeAsync(150);
    await vi.runOnlyPendingTimersAsync();

    const second = panel().querySelectorAll<HTMLElement>('[role="option"]')[1];
    second.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ path: 'src/ui/components' }));
  });

  it('closes the results on Escape', async () => {
    build();
    type('File');
    await vi.advanceTimersByTimeAsync(150);
    await vi.runOnlyPendingTimersAsync();
    expect(panel().hidden).toBe(false);

    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(panel().hidden).toBe(true);
    expect(input().getAttribute('aria-expanded')).toBe('false');
  });

  it('closes the results when clicking outside', async () => {
    build();
    type('File');
    await vi.advanceTimersByTimeAsync(150);
    await vi.runOnlyPendingTimersAsync();
    expect(panel().hidden).toBe(false);

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(panel().hidden).toBe(true);
  });

  it('aborts the previous in-flight request when a new search starts', async () => {
    const signals: AbortSignal[] = [];
    search.mockImplementation((_query: string, signal: AbortSignal) => {
      signals.push(signal);
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () =>
          reject(new DOMException('aborted', 'AbortError'))
        );
      });
    });

    build();
    type('first');
    await vi.advanceTimersByTimeAsync(150);
    await vi.runOnlyPendingTimersAsync();

    type('second');
    await vi.advanceTimersByTimeAsync(150);
    await vi.runOnlyPendingTimersAsync();

    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });

  it('does not search for a blank query', async () => {
    build();
    type('   ');
    await vi.advanceTimersByTimeAsync(200);
    expect(search).not.toHaveBeenCalled();
  });

  it('shows a refine hint when the backend truncates the result set', async () => {
    search.mockResolvedValue(response(results, true));
    build();
    type('File');
    await vi.advanceTimersByTimeAsync(150);
    await vi.runOnlyPendingTimersAsync();

    expect(panel().textContent).toContain('Refine your search');
    expect(panel().querySelector('[data-role="search-result"]')).not.toBeNull();
  });

  it('destroys cleanly and removes the markup', () => {
    build();
    view!.destroy();
    expect(root.innerHTML).toBe('');
    view = null;
  });
});
