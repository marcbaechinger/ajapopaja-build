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

import { parsePatch } from 'diff';
import type { StructuredPatch, StructuredPatchHunk } from 'diff';
import { Icon } from './Icon.ts';
import { escapeHtml } from '../utils/html.ts';
import { DiffHeaderView } from './DiffHeaderView.ts';
import type { DiffMetadata } from './DiffHeaderView.ts';

export type {
  DiffMetadata,
  DiffHeaderViewOptions,
  DiffHeaderStats,
  DiffHeaderFile,
  DiffHeaderAction,
} from './DiffHeaderView.ts';
export { DiffHeaderView } from './DiffHeaderView.ts';

export interface DiffViewOptions {
  /** The git patch (unified diff) to render. */
  patch: string;
  /** Optional metadata rendered in the collapsible header. */
  metadata?: DiffMetadata;
  /** Header starts expanded. Default true. */
  initiallyExpanded?: boolean;
  /** Per-file bodies start expanded. Default true. */
  filesInitiallyExpanded?: boolean;
  /** Tailwind height class for the scroll area. Default 'max-h-none'. */
  heightClass?: string;
}

/** A single rendered line of a hunk. */
export interface ParsedHunkLine {
  type: 'add' | 'remove' | 'context';
  /** Line content without the leading +/-/space marker. */
  content: string;
  /** Old-file line number, or null for added lines. */
  oldNumber: number | null;
  /** New-file line number, or null for removed lines. */
  newNumber: number | null;
}

/** A single hunk (its header plus its lines). */
export interface ParsedHunk {
  header: string;
  lines: ParsedHunkLine[];
}

/** A parsed file entry of the patch. */
export interface ParsedFileDiff {
  /** Display path (a/ and b/ prefixes stripped). */
  path: string;
  /** Original path (a/ prefix stripped). */
  oldPath: string;
  added: number;
  removed: number;
  binary: boolean;
  hunks: ParsedHunk[];
}

/** Strips a leading `a/` or `b/` git prefix from a path. */
function stripGitPrefix(path: string | undefined): string {
  if (!path) return '';
  return path.replace(/^[ab]\//, '');
}

/**
 * Splits a git patch into per-file sections, each beginning with a
 * `diff --git` line. Preamble text before the first section is returned as its
 * own section so `parsePatch` can decide whether it is usable.
 */
export function splitPatchSections(patch: string): string[] {
  const sections: string[] = [];
  let current: string[] = [];
  const flush = () => {
    if (current.length === 0) return;
    const text = current.join('\n');
    if (text.trim()) sections.push(text);
    current = [];
  };
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      flush();
      current = [line];
    } else {
      current.push(line);
    }
  }
  flush();
  return sections;
}

function formatHunkHeader(hunk: StructuredPatchHunk): string {
  return `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
}

/** Converts a `diff` package hunk into rows carrying resolved line numbers. */
function buildHunkLines(hunk: StructuredPatchHunk): ParsedHunkLine[] {
  const lines: ParsedHunkLine[] = [];
  let oldNumber = hunk.oldStart;
  let newNumber = hunk.newStart;
  for (const raw of hunk.lines) {
    const marker = raw.charAt(0);
    if (marker === '+') {
      lines.push({ type: 'add', content: raw.slice(1), oldNumber: null, newNumber: newNumber++ });
    } else if (marker === '-') {
      lines.push({ type: 'remove', content: raw.slice(1), oldNumber: oldNumber++, newNumber: null });
    } else if (marker === '\\') {
      // "\ No newline at end of file" marker: no line-number advance.
      lines.push({ type: 'context', content: raw, oldNumber: null, newNumber: null });
    } else {
      const content = marker === ' ' ? raw.slice(1) : raw;
      lines.push({
        type: 'context',
        content,
        oldNumber: oldNumber++,
        newNumber: newNumber++,
      });
    }
  }
  return lines;
}

function parseFileSection(section: string): ParsedFileDiff | null {
  let parsed: StructuredPatch | undefined;
  try {
    parsed = parsePatch(section)[0];
  } catch {
    parsed = undefined;
  }
  if (!parsed) return null;

  const oldPath = stripGitPrefix(parsed.oldFileName);
  const newPath = stripGitPrefix(parsed.newFileName);
  const path = newPath && newPath !== '/dev/null' ? newPath : oldPath || newPath || 'unknown';

  // Hunk headers may carry a trailing section context (`@@ ... @@ fn foo()`) that
  // `parsePatch` does not expose; recover the original header lines when present.
  const rawHunkHeaders = section.split('\n').filter((line) => line.startsWith('@@'));

  let added = 0;
  let removed = 0;
  const hunks: ParsedHunk[] = parsed.hunks.map((hunk, index) => {
    const lines = buildHunkLines(hunk);
    for (const line of lines) {
      if (line.type === 'add') added++;
      else if (line.type === 'remove') removed++;
    }
    return { header: rawHunkHeaders[index] ?? formatHunkHeader(hunk), lines };
  });

  const runtimeBinary = parsed.isBinary === true;
  const binary =
    runtimeBinary ||
    parsed.hunks.length === 0 &&
      /(^|\n)(Binary files .* differ|GIT binary patch)(\n|$)/.test(section);

  return { path, oldPath, added, removed, binary, hunks };
}

/**
 * Parses a git patch into a list of file diffs. Never throws: unparseable
 * sections are skipped so a partially corrupt patch still renders.
 */
export function parsePatchFiles(patch: string): ParsedFileDiff[] {
  const files: ParsedFileDiff[] = [];
  for (const section of splitPatchSections(patch)) {
    const file = parseFileSection(section);
    if (file) files.push(file);
  }
  return files;
}

/**
 * A self-contained, reusable DOM view that renders a git patch like a patch
 * viewer: a collapsible metadata header (subject / author / branch / dates and
 * aggregate stats), a per-file summary with `+N`/`-M` stats, and colored
 * unified hunks with a two-column line-number gutter.
 *
 * It owns its root element and exposes `render()` / `destroy()`, mirroring
 * `PiView`, so it can be embedded in any dialog or component without assuming
 * dialog framing.
 */
export class DiffView {
  private mount: HTMLElement;
  private options: DiffViewOptions;
  private root: HTMLElement | null = null;
  private listeners: Array<{ el: HTMLElement; type: string; handler: EventListener }> = [];

  constructor(mount: HTMLElement, options: DiffViewOptions) {
    this.mount = mount;
    this.options = options;
  }

  /** The element the DiffView was mounted into. */
  getRoot(): HTMLElement | null {
    return this.root;
  }

  /** Parses the patch and builds the header + body into `mount`. */
  render(): void {
    // Tear down any previous render so `render()` is idempotent.
    this.destroy();

    const patch = this.options.patch ?? '';
    const root = document.createElement('div');
    root.className = 'diff-view flex flex-col min-h-0';
    root.setAttribute('data-role', 'diff-view');
    this.root = root;

    if (!patch.trim()) {
      root.innerHTML =
        '<div class="p-10 text-center text-app-muted italic" data-role="diff-empty">No changes</div>';
      this.mount.appendChild(root);
      return;
    }

    const files = parsePatchFiles(patch);
    if (files.length === 0) {
      // Non-empty but not a recognizable patch: fall back to escaped raw text.
      root.innerHTML =
        '<div class="p-4 text-app-muted italic" data-role="diff-unparsed">Unable to parse patch.</div>' +
        `<pre class="diff-view-raw font-mono text-[11px] leading-relaxed whitespace-pre p-4 overflow-auto text-app-text/80" data-role="diff-raw">${escapeHtml(
          patch
        )}</pre>`;
      this.mount.appendChild(root);
      return;
    }

    root.innerHTML = this.renderHeader(files) + this.renderFiles(files);
    this.mount.appendChild(root);
    this.attachCollapseListeners();
  }

  /** Removes the rendered DOM and detaches any listeners. */
  destroy(): void {
    for (const { el, type, handler } of this.listeners) {
      el.removeEventListener(type, handler);
    }
    this.listeners = [];
    if (this.root && this.root.parentNode) {
      this.root.parentNode.removeChild(this.root);
    }
    this.root = null;
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  private renderHeader(files: ParsedFileDiff[]): string {
    return DiffHeaderView.render({
      metadata: this.options.metadata,
      files,
      initiallyExpanded: this.options.initiallyExpanded ?? true,
    });
  }

  private renderFiles(files: ParsedFileDiff[]): string {
    const expanded = this.options.filesInitiallyExpanded ?? true;
    const heightClass = this.options.heightClass ?? 'max-h-none';
    const body = files.map((file, index) => this.renderFile(file, index, expanded)).join('');
    return `<div class="diff-view-files flex flex-col min-h-0 overflow-auto custom-scrollbar ${heightClass}" data-role="files">${body}</div>`;
  }

  private renderFile(file: ParsedFileDiff, index: number, expanded: boolean): string {
    const hasHunks = file.hunks.length > 0;
    const open = expanded && hasHunks;
    const chevron = Icon.render('chevronRight', {
      size: 14,
      className: 'transition-transform group-open/file:rotate-90',
    });
    return `
      <details class="diff-view-file group/file border-b border-app-border/60 last:border-b-0" ${
        open ? 'open' : ''
      } data-role="file" data-file-index="${index}" data-file-path="${escapeHtml(file.path)}">
        <summary class="diff-view-file-header sticky top-0 z-10 flex items-center gap-2 px-4 py-2 bg-app-bg/95 backdrop-blur cursor-pointer select-none list-none hover:bg-app-surface/60 transition-colors" data-role="file-toggle">
          <span class="text-app-muted shrink-0" data-role="file-chevron">${chevron}</span>
          <button type="button" data-action-click="copy_file_path" data-path="${escapeHtml(file.path)}"
            class="shrink-0 p-1 rounded text-app-muted hover:text-app-text hover:bg-app-surface/60 transition-colors cursor-pointer"
            title="Copy path" aria-label="Copy path">${Icon.render('copy', { size: 14 })}</button>
          <span class="diff-view-file-path font-mono text-xs text-app-text truncate" data-role="file-path">${escapeHtml(
            file.path
          )}</span>
          <span class="diff-view-file-stat ml-auto flex items-center gap-2 font-mono text-[11px] whitespace-nowrap" data-role="file-stat">
            <span class="text-green-400" data-role="file-added">+${file.added}</span>
            <span class="text-red-400" data-role="file-removed">-${file.removed}</span>
          </span>
        </summary>
        <div class="diff-view-file-body${
          open ? '' : ' hidden'
        }" data-role="file-body">
          ${file.binary ? this.renderBinaryNote() : this.renderHunks(file)}
        </div>
      </details>
    `;
  }

  private renderBinaryNote(): string {
    return `<div class="px-4 py-3 text-xs italic text-app-muted flex items-center gap-2" data-role="binary-note">${Icon.render(
      'documentation',
      { size: 14 }
    )}<span>Binary file</span></div>`;
  }

  private renderHunks(file: ParsedFileDiff): string {
    const rows = file.hunks
      .map((hunk) => {
        const header = `<div class="diff-line diff-line-hunk px-4 py-0.5 text-app-accent-2 bg-app-accent-2/5 select-none" data-role="hunk-header" data-type="hunk">${escapeHtml(
          hunk.header
        )}</div>`;
        const lines = hunk.lines.map((line) => this.renderLine(line)).join('');
        return header + lines;
      })
      .join('');
    return `<pre class="diff-view-pre font-mono text-[11px] leading-relaxed whitespace-pre p-0 m-0" data-role="diff-pre">${rows}</pre>`;
  }

  private renderLine(line: ParsedHunkLine): string {
    let rowClass = 'diff-line diff-line-context text-app-text/80';
    let marker = ' ';
    let type: ParsedHunkLine['type'] = 'context';
    if (line.type === 'add') {
      rowClass = 'diff-line diff-line-add bg-green-500/10 text-green-300';
      marker = '+';
      type = 'add';
    } else if (line.type === 'remove') {
      rowClass = 'diff-line diff-line-remove bg-red-500/10 text-red-300';
      marker = '-';
      type = 'remove';
    }
    const isMarker = line.type === 'context' && line.content.startsWith('\\');
    const code = isMarker ? line.content : `${marker}${line.content}`;
    const oldNumber = line.oldNumber === null ? '' : String(line.oldNumber);
    const newNumber = line.newNumber === null ? '' : String(line.newNumber);
    return (
      `<div class="${rowClass}" data-role="diff-line" data-type="${type}">` +
      `<span class="diff-gutter inline-block w-10 shrink-0 pr-2 text-right text-app-muted/60 select-none" data-role="line-number-old">${oldNumber}</span>` +
      `<span class="diff-gutter inline-block w-10 shrink-0 pr-2 text-right text-app-muted/60 select-none" data-role="line-number-new">${newNumber}</span>` +
      `<span class="diff-code inline-block pl-1" data-role="line-code">${escapeHtml(code)}</span>` +
      `</div>`
    );
  }

  // ---------------------------------------------------------------------------
  // Collapse handling
  // ---------------------------------------------------------------------------

  /**
   * `<details>`/`<summary>` provide native collapse behavior, but we manage it
   * explicitly so the collapse state is reflected on the body element (via the
   * `hidden` class) consistently across browsers and jsdom, and so the view can
   * detach cleanly in `destroy()`.
   */
  private attachCollapseListeners(): void {
    if (!this.root) return;
    const summaries = this.root.querySelectorAll<HTMLElement>('summary[data-role]');
    summaries.forEach((summary) => {
      const handler: EventListener = (event) => {
        // Interactive children (e.g. the copy-path button) must not toggle the
        // section. Prevent the native <details> toggle and let the global
        // action registry handle the click.
        if ((event.target as HTMLElement).closest('[data-action-click]')) {
          event.preventDefault();
          return;
        }
        event.preventDefault();
        const details = summary.closest('details') as HTMLDetailsElement | null;
        if (!details) return;
        const willOpen = !details.open;
        details.open = willOpen;
        const body = details.querySelector<HTMLElement>(
          '[data-role="metadata-body"], [data-role="file-body"]'
        );
        if (body) body.classList.toggle('hidden', !willOpen);
      };
      summary.addEventListener('click', handler);
      this.listeners.push({ el: summary, type: 'click', handler });
    });
  }
}
