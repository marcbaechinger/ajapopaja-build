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

import type { FileEntry } from '../../core/domain.ts';
import { Icon } from './Icon.ts';
import { escapeHtml, gitStatusPresentation } from './utils/fileBrowser.ts';

export interface DirectoryListingItemOptions {
  /** Marks the row as the currently selected entry. */
  active?: boolean;
  /** Compact rendering (used when the sidebar is collapsed). */
  collapsed?: boolean;
}

/**
 * A single sidebar row for a directory entry. Directories navigate, files open
 * in the main panel. Rendered as a pre-computed HTML string so the coordinator
 * can replace the sidebar contents in one pass.
 */
export class DirectoryListingItemView {
  static render(entry: FileEntry, opts: DirectoryListingItemOptions = {}): string {
    const { active = false, collapsed = false } = opts;
    const action = entry.isDir ? 'file_browser_navigate' : 'file_browser_open_file';
    const status = gitStatusPresentation(entry.gitStatus);

    const base =
      'group flex items-center gap-2 w-full text-left rounded-md transition-colors cursor-pointer';
    const size = collapsed ? 'px-1.5 py-1' : 'px-2 py-1.5';
    const state = active
      ? 'bg-app-accent-1/15 text-app-accent-1'
      : 'text-app-muted hover:text-app-text hover:bg-app-surface/60';

    const dot =
      status && !collapsed
        ? `<span class="w-2 h-2 rounded-full shrink-0 ${status.dotClass}" title="${status.label}" aria-label="${status.label}"></span>`
        : '';

    return `
      <button type="button"
        data-action-click="${action}"
        data-path="${escapeHtml(entry.path)}"
        data-view-id="${escapeHtml(entry.path)}"
        title="${escapeHtml(entry.path)}"
        aria-current="${active ? 'true' : 'false'}"
        class="${base} ${size} ${state}">
        <span class="shrink-0 ${entry.isDir ? 'text-app-accent-2' : 'text-app-muted'}" aria-hidden="true">
          ${Icon.render(entry.isDir ? 'folder' : 'file', { size: 14 })}
        </span>
        <span class="truncate flex-1 text-xs font-medium">${escapeHtml(entry.name)}</span>
        ${dot}
      </button>
    `;
  }
}
