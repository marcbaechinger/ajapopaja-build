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

import type { FileSearchResponse, FileSearchResult } from '../../core/domain.ts';
import { Icon } from './Icon.ts';
import { escapeHtml } from './utils/fileBrowser.ts';

export interface FileSearchInputViewOptions {
  /** Performs the search; must honour the abort signal. */
  search: (query: string, signal: AbortSignal) => Promise<FileSearchResponse>;
  /** Result activation. */
  onSelect: (result: FileSearchResult) => void;
  /** Render the optional submit button. Default false. */
  showButton?: boolean;
  /** Optional placeholder / initial value. */
  placeholder?: string;
  initialValue?: string;
  /** Debounce for as-you-type input. Default 150 ms. */
  debounceMs?: number;
}

/**
 * Compact, reusable file search input.
 *
 * Renders a fixed-height (`h-7`) text field with an optional submit button and
 * an anchored results listbox. As-you-type input is debounced, Enter and the
 * button search immediately, and the previous in-flight request is aborted
 * with an `AbortController`. It is self-contained so it can be embedded in any
 * header, not just the File Browser.
 */
export class FileSearchInputView {
  private static nextId = 0;

  private root: HTMLElement;
  private options: FileSearchInputViewOptions & { debounceMs: number };
  private idPrefix: string;
  private input!: HTMLInputElement;
  private panel!: HTMLElement;

  private results: FileSearchResult[] = [];
  private highlightIndex = -1;
  private truncated = false;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private controller: AbortController | null = null;
  private searchToken = 0;
  private destroyed = false;
  private listenerCleanups: Array<() => void> = [];

  constructor(root: HTMLElement, options: FileSearchInputViewOptions) {
    this.root = root;
    this.options = { debounceMs: 150, ...options };
    this.idPrefix = `file-search-${FileSearchInputView.nextId++}`;
    this.root.classList.add('relative');
  }

  render(): void {
    if (this.destroyed) return;
    const showButton = this.options.showButton ?? false;
    const placeholder = this.options.placeholder ?? 'Search files…';
    const initialValue = this.options.initialValue ?? '';

    this.root.innerHTML = `
      <div class="flex items-center gap-1">
        <input id="${this.idPrefix}-input" type="text" role="combobox"
          autocomplete="off" spellcheck="false"
          aria-expanded="false" aria-autocomplete="list"
          aria-controls="${this.idPrefix}-listbox"
          placeholder="${escapeHtml(placeholder)}"
          value="${escapeHtml(initialValue)}"
          class="h-7 w-40 sm:w-48 px-2 rounded text-xs bg-app-surface border border-app-border text-app-text placeholder:text-app-muted/60 focus:outline-none focus:border-app-accent-1 transition-colors" />
        ${
          showButton
            ? `<button type="button" id="${this.idPrefix}-submit"
                class="h-7 w-7 shrink-0 rounded bg-app-surface border border-app-border text-app-text hover:bg-app-bg transition-colors flex items-center justify-center cursor-pointer"
                title="Search" aria-label="Search">${Icon.render('search', { size: 14 })}</button>`
            : ''
        }
        <div id="${this.idPrefix}-listbox" role="listbox"
          class="absolute right-0 top-full mt-1 w-72 max-h-64 overflow-y-auto custom-scrollbar rounded-xl border border-app-border bg-app-surface shadow-2xl z-40 py-1"
          hidden></div>
      </div>
    `;

    this.input = this.root.querySelector<HTMLInputElement>(`#${this.idPrefix}-input`)!;
    this.panel = this.root.querySelector<HTMLElement>(`#${this.idPrefix}-listbox`)!;
    this.wireEvents();
  }

  destroy(): void {
    this.destroyed = true;
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    this.controller?.abort();
    this.controller = null;
    for (const cleanup of this.listenerCleanups) cleanup();
    this.listenerCleanups = [];
    this.root.innerHTML = '';
  }

  /** The currently highlighted result, if any. */
  highlighted(): FileSearchResult | null {
    if (this.highlightIndex < 0 || this.highlightIndex >= this.results.length) return null;
    return this.results[this.highlightIndex];
  }

  /** Whether the results listbox currently shows matches. */
  isOpen(): boolean {
    return !this.panel.hidden && this.results.length > 0;
  }

  // --- events -------------------------------------------------------------

  private wireEvents(): void {
    const on = (target: HTMLElement | Document, type: string, handler: EventListener) => {
      target.addEventListener(type, handler);
      this.listenerCleanups.push(() => target.removeEventListener(type, handler));
    };

    on(this.input, 'input', () => this.scheduleSearch());
    on(this.input, 'keydown', (event) => this.onKeydown(event as KeyboardEvent));
    on(this.panel, 'mousedown', (event) => {
      // Prevent the input from losing focus before the click resolves.
      event.preventDefault();
      const option = (event.target as HTMLElement).closest<HTMLElement>(
        '[data-role="search-result"]'
      );
      if (!option) return;
      const index = Number(option.getAttribute('data-index'));
      const result = this.results[index];
      if (result) this.select(result);
    });

    const submit = this.root.querySelector<HTMLButtonElement>(
      `#${this.idPrefix}-submit`
    );
    if (submit) on(submit, 'click', () => this.runSearch(this.input.value));

    on(document, 'click', (event) => {
      if (!this.root.contains(event.target as Node)) this.closeResults();
    });
  }

  private onKeydown(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.moveHighlight(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.moveHighlight(-1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const highlighted = this.highlighted();
      if (highlighted) {
        this.select(highlighted);
      } else {
        this.runSearch(this.input.value);
      }
      return;
    }
    if (event.key === 'Escape') {
      this.closeResults();
    }
  }

  // --- searching ----------------------------------------------------------

  private scheduleSearch(): void {
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.runSearch(this.input.value);
    }, this.options.debounceMs);
  }

  /** Exposed for Enter/button so they can bypass the debounce. */
  private runSearch(query: string): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    void this.performSearch(query);
  }

  private async performSearch(query: string): Promise<void> {
    const trimmed = query.trim();
    if (!trimmed) {
      this.closeResults();
      return;
    }

    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const token = ++this.searchToken;

    try {
      const response = await this.options.search(trimmed, controller.signal);
      if (this.destroyed || token !== this.searchToken) return;
      this.results = response.results;
      this.truncated = response.truncated;
      this.highlightIndex = this.results.length > 0 ? 0 : -1;
      this.renderResults();
    } catch (error) {
      if (controller.signal.aborted || this.destroyed || token !== this.searchToken) return;
      this.results = [];
      this.highlightIndex = -1;
      this.renderResults(true);
    }
  }

  private select(result: FileSearchResult): void {
    this.closeResults();
    this.options.onSelect(result);
  }

  private moveHighlight(delta: number): void {
    if (this.results.length === 0) return;
    this.highlightIndex =
      (((this.highlightIndex + delta) % this.results.length) + this.results.length) %
      this.results.length;
    this.renderResults();
  }

  private closeResults(): void {
    this.results = [];
    this.highlightIndex = -1;
    this.truncated = false;
    if (!this.panel) return;
    this.panel.hidden = true;
    this.panel.innerHTML = '';
    this.input?.setAttribute('aria-expanded', 'false');
    this.input?.removeAttribute('aria-activedescendant');
  }

  // --- rendering ----------------------------------------------------------

  private renderResults(error = false): void {
    if (!this.panel) return;
    if (error) {
      this.panel.hidden = false;
      this.panel.innerHTML = `<div class="px-3 py-2 text-xs text-red-400">Search failed</div>`;
      this.input.setAttribute('aria-expanded', 'true');
      return;
    }
    if (this.results.length === 0) {
      this.closeResults();
      return;
    }

    const rows = this.results
      .map((result, index) => {
        const selected = index === this.highlightIndex;
        const rowClass = selected
          ? 'bg-app-accent-2/15 text-app-text'
          : 'text-app-muted';
        const dir = this.parentOf(result.path);
        return `
          <div id="${this.optionId(index)}" role="option" aria-selected="${selected}"
            data-index="${index}" data-role="search-result"
            class="flex items-center gap-2 px-3 py-1.5 cursor-pointer text-xs ${rowClass} hover:bg-app-accent-2/10 transition-colors">
            <span class="shrink-0 ${result.isDir ? 'text-app-accent-2' : 'text-app-muted'}" aria-hidden="true">
              ${Icon.render(result.isDir ? 'folder' : 'file', { size: 12 })}
            </span>
            <span class="truncate">${escapeHtml(result.name)}</span>
            <span class="ml-auto shrink-0 max-w-[55%] truncate text-[10px] text-app-muted/70">${escapeHtml(dir)}</span>
          </div>
        `;
      })
      .join('');

    const footer = this.truncated
      ? `<div class="px-3 py-1.5 text-[10px] italic text-app-muted/70 border-t border-app-border/40">Refine your search for more results…</div>`
      : '';

    this.panel.hidden = false;
    this.panel.innerHTML = rows + footer;
    this.input.setAttribute('aria-expanded', 'true');
    this.input.setAttribute('aria-activedescendant', this.optionId(this.highlightIndex));
  }

  private optionId(index: number): string {
    return `${this.idPrefix}-option-${index}`;
  }

  private parentOf(path: string): string {
    const index = path.lastIndexOf('/');
    return index === -1 ? '' : path.slice(0, index);
  }
}
