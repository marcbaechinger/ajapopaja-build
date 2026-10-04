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

import type { FileGitStatus } from '../../../core/domain.ts';

/** Human readable file size (e.g. "1.5 KB"). */
export function formatFileSize(bytes?: number | null): string {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[index]}`;
}

/** Locale date/time for an ISO timestamp, or an em dash when unavailable. */
export function formatTimestamp(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString();
}

export interface GitStatusPresentation {
  label: string;
  /** Tailwind classes for a text/background badge. */
  badgeClass: string;
  /** Tailwind classes for a small status dot. */
  dotClass: string;
}

/** Map a git status to display strings. Returns null for clean/unknown. */
export function gitStatusPresentation(
  status?: FileGitStatus | null
): GitStatusPresentation | null {
  switch (status) {
    case 'modified':
      return { label: 'Modified', badgeClass: 'bg-amber-500/15 text-amber-400', dotClass: 'bg-amber-400' };
    case 'added':
      return { label: 'Added', badgeClass: 'bg-green-500/15 text-green-400', dotClass: 'bg-green-400' };
    case 'deleted':
      return { label: 'Deleted', badgeClass: 'bg-red-500/15 text-red-400', dotClass: 'bg-red-400' };
    case 'untracked':
      return { label: 'Untracked', badgeClass: 'bg-sky-500/15 text-sky-400', dotClass: 'bg-sky-400' };
    case 'ignored':
      return { label: 'Ignored', badgeClass: 'bg-app-surface text-app-muted', dotClass: 'bg-app-muted' };
    case 'conflicted':
      return { label: 'Conflicted', badgeClass: 'bg-purple-500/15 text-purple-400', dotClass: 'bg-purple-400' };
    default:
      return null;
  }
}

/** Escape a string for safe interpolation into an HTML attribute/text node. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
