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

import type { FileContent } from '../../core/domain.ts';
import { Icon } from './Icon.ts';
import {
  escapeHtml,
  formatFileSize,
  formatTimestamp,
  gitStatusPresentation,
} from './utils/fileBrowser.ts';

/**
 * Main-panel view for a single file: metadata header plus a read-only code
 * block. Binary and truncated files render a clear message instead of content.
 */
export class FileView {
  static render(file: FileContent): string {
    return `
      <div class="flex flex-col h-full min-h-0">
        ${this.renderHeader(file)}
        <div class="flex-1 min-h-0 overflow-auto bg-app-bg/60 rounded-b-xl">
          ${this.renderBody(file)}
        </div>
      </div>
    `;
  }

  private static renderHeader(file: FileContent): string {
    const status = gitStatusPresentation(file.gitStatus);
    const badge = status
      ? `<span class="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold ${status.badgeClass}">${status.label}</span>`
      : '';

    return `
      <div class="flex flex-col gap-2 px-3 py-3 border-b border-app-border/40">
        <div class="flex items-center gap-2 min-w-0">
          <span class="shrink-0 text-app-muted" aria-hidden="true">${Icon.render('file', { size: 16 })}</span>
          <h3 class="text-sm font-bold text-app-text truncate" title="${escapeHtml(file.path)}">${escapeHtml(file.name)}</h3>
          ${badge}
        </div>
        <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px] text-app-muted">
          <dt class="font-semibold uppercase tracking-wider text-[9px]">Path</dt>
          <dd class="truncate" title="${escapeHtml(file.path)}">${escapeHtml(file.path)}</dd>
          <dt class="font-semibold uppercase tracking-wider text-[9px]">Size</dt>
          <dd>${escapeHtml(formatFileSize(file.size))}</dd>
          <dt class="font-semibold uppercase tracking-wider text-[9px]">Created</dt>
          <dd>${escapeHtml(formatTimestamp(file.createdAt))}</dd>
          <dt class="font-semibold uppercase tracking-wider text-[9px]">Modified</dt>
          <dd>${escapeHtml(formatTimestamp(file.modifiedAt))}</dd>
        </dl>
      </div>
    `;
  }

  private static renderBody(file: FileContent): string {
    if (file.isBinary) {
      return `
        <div class="flex flex-col items-center justify-center gap-2 py-16 px-4 text-center">
          <span class="text-app-muted/60">${Icon.render('file', { size: 32 })}</span>
          <p class="text-xs text-app-muted italic">This is a binary file and cannot be displayed.</p>
        </div>
      `;
    }

    const truncated = file.truncated
      ? `<p class="px-3 py-2 text-[11px] text-amber-400 bg-amber-500/10 border-b border-amber-500/20">Showing the first 1&nbsp;MiB of this file.</p>`
      : '';

    const content = file.content ?? '';
    return `
      ${truncated}
      <pre class="p-3 text-[11px] leading-relaxed text-app-text whitespace-pre overflow-x-auto"><code>${escapeHtml(content)}</code></pre>
    `;
  }
}
