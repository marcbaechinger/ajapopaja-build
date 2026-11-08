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

import { Icon } from './Icon.ts';
import { escapeHtml } from '../utils/html.ts';

/** Metadata shown in the collapsible header. All optional so the view is reusable. */
export interface DiffMetadata {
  /** PR subject / commit subject. */
  subject?: string;
  /** Author name. */
  author?: string;
  /** Source branch. */
  branch?: string;
  /** ISO date the patch was created. */
  createdAt?: string;
  /** ISO date the patch was last updated. */
  updatedAt?: string;
  /** Heading shown in the header summary, e.g. "Patch". */
  label?: string;
}

/** Aggregate change counts displayed in the header summary. */
export interface DiffHeaderStats {
  /** Number of changed files. */
  files: number;
  /** Number of added lines. */
  added: number;
  /** Number of removed lines. */
  removed: number;
}

/** A lightweight file summary accepted by the header without importing DiffView. */
export interface DiffHeaderFile {
  added: number;
  removed: number;
}

/** Optional action button rendered inside the header summary. */
export interface DiffHeaderAction {
  /** Visible button label. */
  label: string;
  /** ActionRegistry action name, e.g. `open_diff_view`. */
  action: string;
  /** Optional icon name from {@link Icon}. */
  icon?: string;
  /** Optional title/aria-label. Defaults to {@link label}. */
  title?: string;
  /** Extra data attributes copied onto the button. */
  attributes?: Record<string, string | number | boolean | null | undefined>;
  /** Extra classes appended to the button classes. */
  className?: string;
}

export interface DiffHeaderViewOptions {
  /** Metadata rendered in the collapsible header. */
  metadata?: DiffMetadata;
  /** Aggregate change counts. Takes precedence over {@link files}. */
  stats?: DiffHeaderStats | string | null;
  /** Per-file summaries used to derive the aggregate counts. */
  files?: DiffHeaderFile[] | null;
  /** Pre-formatted stats text. Overrides the values derived from stats/files. */
  statsText?: string;
  /** Header starts expanded. Default true. */
  initiallyExpanded?: boolean;
  /**
   * Optional action button shown next to the stats. The History view uses this
   * to open the full diff in a {@link DiffDialog}.
   */
  action?: DiffHeaderAction | null;
  /** Optional additional markup appended to the summary. */
  summarySuffixHtml?: string;
  /** Extra classes added to the outer header wrapper. */
  className?: string;
}

function formatTimestamp(value?: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function resolveStats(
  options: DiffHeaderViewOptions
): { stats: DiffHeaderStats; text: string } | null {
  if (typeof options.stats === 'string') {
    return { stats: { files: 0, added: 0, removed: 0 }, text: options.stats };
  }
  const suppliedText = options.statsText;
  if (suppliedText !== undefined) {
    return {
      stats: options.stats ?? { files: 0, added: 0, removed: 0 },
      text: suppliedText,
    };
  }

  let stats: DiffHeaderStats | null | undefined = options.stats;
  if (!stats && options.files) {
    stats = options.files.reduce<DiffHeaderStats>(
      (acc, file) => ({
        files: acc.files + 1,
        added: acc.added + file.added,
        removed: acc.removed + file.removed,
      }),
      { files: 0, added: 0, removed: 0 }
    );
  }
  if (!stats) return null;

  const count = stats.files;
  return {
    stats,
    text: `${count} file${count === 1 ? '' : 's'} changed, +${stats.added}, -${stats.removed}`,
  };
}

/**
 * The collapsible metadata header used by {@link DiffView} and embedded directly
 * in the repository-history list. It owns only the header DOM; callers provide
 * either aggregate stats, per-file summaries, or pre-formatted stats text.
 *
 * The component can be used as a static renderer (`DiffHeaderView.render`) or
 * mounted with `render()`/`destroy()` when its collapse interaction is needed.
 */
export class DiffHeaderView {
  private mount: HTMLElement | null;
  private options: DiffHeaderViewOptions;
  private root: HTMLElement | null = null;
  private listeners: Array<{ el: HTMLElement; type: string; handler: EventListener }> = [];

  constructor(
    mountOrOptions: HTMLElement | DiffHeaderViewOptions,
    optionsOrFiles?: DiffHeaderViewOptions | DiffHeaderFile[],
    metadata?: DiffMetadata
  ) {
    if (mountOrOptions instanceof HTMLElement) {
      this.mount = mountOrOptions;
      this.options = Array.isArray(optionsOrFiles)
        ? { files: optionsOrFiles, metadata }
        : optionsOrFiles ?? {};
    } else {
      this.mount = null;
      this.options = mountOrOptions ?? {};
    }
  }

  /** Renders the header into the configured mount (or just returns the markup). */
  render(): string {
    const html = DiffHeaderView.render(this.options);
    if (!this.mount) return html;

    this.destroy();
    const holder = document.createElement('div');
    holder.innerHTML = html;
    const root = (holder.firstElementChild as HTMLElement | null) ?? holder;
    this.root = root;
    this.mount.appendChild(root);
    this.attachCollapseListeners();
    return html;
  }

  /** Removes rendered DOM and detaches collapse listeners. */
  destroy(): void {
    for (const { el, type, handler } of this.listeners) {
      el.removeEventListener(type, handler);
    }
    this.listeners = [];
    if (this.root?.parentNode) this.root.parentNode.removeChild(this.root);
    this.root = null;
  }

  /** Static renderer for callers that compose the header into a larger string. */
  static render(
    optionsOrFiles: DiffHeaderViewOptions | DiffHeaderFile[] = {},
    metadataOrOptions?: DiffMetadata | DiffHeaderViewOptions,
    initiallyExpanded?: boolean
  ): string {
    const options: DiffHeaderViewOptions = Array.isArray(optionsOrFiles)
      ? {
          files: optionsOrFiles,
          metadata: metadataOrOptions as DiffMetadata | undefined,
          initiallyExpanded,
        }
      : optionsOrFiles;
    const metadata = options.metadata ?? {};
    const expanded = options.initiallyExpanded ?? true;
    const label = metadata.label ?? 'Patch';
    const subject = metadata.subject ?? '';
    const resolved = resolveStats(options);
    const statsText = resolved?.text ?? '';
    const chevron = Icon.render('chevronRight', {
      size: 14,
      className: 'transition-transform group-open/diff:rotate-90',
    });
    const statsHtml = statsText
      ? `<span class="ml-auto font-mono text-[11px] text-app-muted whitespace-nowrap" data-role="diff-stats">${escapeHtml(
          statsText
        )}</span>`
      : '<span class="ml-auto"></span>';

    return `
      <div class="diff-header-view ${escapeHtml(options.className ?? '')}" data-role="diff-header" data-component="DiffHeaderView">
      <details class="diff-view-header diff-header group/diff border-b border-app-border bg-app-surface/30" ${
        expanded ? 'open' : ''
      } data-role="metadata-header">
        <summary class="diff-view-header-summary flex items-center gap-3 px-4 py-3 cursor-pointer select-none list-none hover:bg-app-surface/50 transition-colors" data-role="metadata-toggle">
          <span class="text-app-muted shrink-0" data-role="metadata-chevron">${chevron}</span>
          <span class="text-[10px] font-black uppercase tracking-widest text-app-accent-2 shrink-0">${escapeHtml(
            label
          )}</span>
          <span class="text-sm font-bold text-app-text truncate" data-role="metadata-subject">${escapeHtml(
            subject
          )}</span>
          ${statsHtml}
          ${renderAction(options.action)}
          ${options.summarySuffixHtml ?? ''}
        </summary>
        <div class="diff-view-metadata px-4 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-2${
          expanded ? '' : ' hidden'
        }" data-role="metadata-body">
          ${renderMetaRow('Subject', subject)}
          ${renderMetaRow('Author', metadata.author)}
          ${renderMetaRow('Branch', metadata.branch)}
          ${renderMetaRow('Created', formatTimestamp(metadata.createdAt), metadata.createdAt)}
          ${renderMetaRow('Updated', formatTimestamp(metadata.updatedAt), metadata.updatedAt)}
          ${renderMetaRow('Changes', statsText)}
        </div>
      </details>
      </div>
    `;
  }

  /**
   * Mirrors the collapse behaviour used by DiffView: the `<details>` element is
   * toggled explicitly so its body's `hidden` class stays consistent in every
   * browser/jsdom, and interactive children never toggle the section.
   */
  private attachCollapseListeners(): void {
    if (!this.root) return;
    const summaries = this.root.querySelectorAll<HTMLElement>('summary[data-role]');
    summaries.forEach((summary) => {
      const handler: EventListener = (event) => {
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

function renderAction(action?: DiffHeaderAction | null): string {
  if (!action) return '';
  const title = action.title ?? action.label;
  const icon = action.icon ? Icon.render(action.icon, { size: 12 }) : '';
  const attributes = Object.entries(action.attributes ?? {})
    .filter(([, value]) => value !== undefined && value !== null && value !== false)
    .map(([key, value]) => {
      const dataKey = key.startsWith('data-')
        ? key.slice('data-'.length)
        : key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
      return ` data-${escapeHtml(dataKey)}="${escapeHtml(String(value))}"`;
    })
    .join('');
  return `
    <button type="button" data-action-click="${escapeHtml(action.action)}"${attributes}
      class="shrink-0 inline-flex items-center gap-1 rounded border border-app-border bg-app-surface px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-app-text hover:border-app-accent-1 hover:bg-app-bg transition-colors cursor-pointer ${escapeHtml(
        action.className ?? ''
      )}"
      title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}">
      ${icon}<span>${escapeHtml(action.label)}</span>
    </button>
  `;
}

function renderMetaRow(label: string, value?: string, title?: string): string {
  const display = value && value.trim() ? value : '—';
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
  return `
    <div class="flex items-baseline gap-2 text-xs min-w-0" data-role="meta-row" data-meta="${escapeHtml(
      label.toLowerCase()
    )}">
      <span class="w-16 shrink-0 text-[10px] font-bold uppercase tracking-widest text-app-muted">${escapeHtml(
        label
      )}</span>
      <span class="text-app-text/90 truncate" data-role="meta-value"${titleAttr}>${escapeHtml(
        display
      )}</span>
    </div>
  `;
}
