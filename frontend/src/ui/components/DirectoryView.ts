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

import type { DirectoryListing, FileEntry } from '../../core/domain.ts';
import { Icon } from './Icon.ts';
import {
  escapeHtml,
  formatFileSize,
  formatTimestamp,
  gitStatusPresentation,
} from './utils/fileBrowser.ts';

/**
 * Main-panel directory listing. Shows name, size, modified date and git status
 * for each entry. Folders navigate on click; files open in the FileView.
 */
export class DirectoryView {
  static render(listing: DirectoryListing): string {
    const rows = listing.entries.map((entry) => this.renderRow(entry)).join('');
    const body = rows || this.renderEmpty();

    return `
      <div class="flex flex-col h-full min-h-0">
        <div class="grid grid-cols-[minmax(0,1fr)_5rem_10rem_6rem] gap-2 px-3 py-2 border-b border-app-border/40 text-[10px] font-bold uppercase tracking-widest text-app-muted/70">
          <span>Name</span>
          <span class="text-right">Size</span>
          <span>Modified</span>
          <span>Status</span>
        </div>
        <div class="flex-1 min-h-0 overflow-y-auto py-1" data-role="file-browser-scroll">${body}</div>
      </div>
    `;
  }

  private static renderRow(entry: FileEntry): string {
    const action = entry.isDir ? 'file_browser_navigate' : 'file_browser_open_file';
    const status = gitStatusPresentation(entry.gitStatus);
    const statusCell = status
      ? `<span class="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold ${status.badgeClass}">${status.label}</span>`
      : '<span class="text-app-muted/40 text-[10px]">—</span>';

    return `
      <button type="button"
        data-action-click="${action}"
        data-path="${escapeHtml(entry.path)}"
        data-view-id="${escapeHtml(entry.path)}"
        class="grid grid-cols-[minmax(0,1fr)_5rem_10rem_6rem] gap-2 items-center w-full text-left px-3 py-1.5 hover:bg-app-surface/60 rounded transition-colors cursor-pointer">
        <span class="flex items-center gap-2 min-w-0">
          <span class="shrink-0 ${entry.isDir ? 'text-app-accent-2' : 'text-app-muted'}" aria-hidden="true">
            ${Icon.render(entry.isDir ? 'folder' : 'file', { size: 14 })}
          </span>
          <span class="truncate text-xs font-medium text-app-text">${escapeHtml(entry.name)}</span>
        </span>
        <span class="text-right text-[11px] text-app-muted tabular-nums">${
          entry.isDir ? '—' : escapeHtml(formatFileSize(entry.size))
        }</span>
        <span class="text-[11px] text-app-muted truncate">${escapeHtml(
          formatTimestamp(entry.modifiedAt)
        )}</span>
        <span>${statusCell}</span>
      </button>
    `;
  }

  private static renderEmpty(): string {
    return `<p class="text-app-muted/60 text-xs italic text-center border border-dashed border-app-border/40 rounded-xl py-8 px-3 m-3">This directory is empty.</p>`;
  }
}
