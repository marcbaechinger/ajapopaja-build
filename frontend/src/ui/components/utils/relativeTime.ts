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

/**
 * Formatting helpers for session timestamps.
 *
 * The session manager renders “2m ago” style relative timestamps for the last
 * activity of a session. Absolute timestamps are exposed through the `title`
 * attribute so hovering a row still reveals the exact time.
 */

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/**
 * Parse an ISO timestamp, treating a timezone-less date-time string as UTC.
 *
 * Python/BSON can serialize aware-UTC datetimes without an offset
 * (`2026-10-04T12:27:00`). ECMAScript parses such a string as *local* time,
 * shifting every derived timestamp by the browser's UTC offset and making a
 * just-created session render as `2h ago` in a UTC+2 timezone. Append `Z` only
 * when the string has a time component but no explicit zone/offset, so
 * date-only strings (`2026-10-04`, already UTC per spec) are left untouched.
 */
export function parseTimestamp(iso: string): number {
  const hasTime = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(iso);
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(iso);
  const normalized = hasTime && !hasZone ? `${iso}Z` : iso;
  return new Date(normalized).getTime();
}

/**
 * Render a compact relative timestamp such as `just now`, `30s ago`, `2m ago`,
 * `1h ago`, `3d ago` or `Oct 3`. Returns `—` for missing or invalid input.
 *
 * `now` is injectable so tests are deterministic.
 */
export function formatRelativeTime(
  iso: string | null | undefined,
  now: number = Date.now()
): string {
  if (!iso) return '—';
  const then = parseTimestamp(iso);
  if (Number.isNaN(then)) return '—';

  const diffSeconds = Math.floor((now - then) / 1000);

  // Future timestamps (clock skew) are clamped to the present.
  if (diffSeconds < 60) return `${Math.max(0, diffSeconds)}s ago`;

  const minutes = Math.floor(diffSeconds / MINUTE);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(diffSeconds / HOUR);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(diffSeconds / DAY);
  if (days < 7) return `${days}d ago`;

  const weeks = Math.floor(diffSeconds / WEEK);
  if (days < 30) return `${weeks}w ago`;

  return formatAbsoluteTime(iso);
}

/**
 * Render an absolute, human readable timestamp (e.g. `Oct 3, 14:02`). Returns
 * `—` for missing or invalid input.
 */
export function formatAbsoluteTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(parseTimestamp(iso));
  if (Number.isNaN(date.getTime())) return '—';

  try {
    return date.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return date.toISOString();
  }
}

/** Resolve the most meaningful timestamp of a session record. */
export function sessionTimestamp(session: {
  last_active_at?: string | null;
  updated_at?: string;
  created_at?: string;
}): string | null {
  return session.last_active_at || session.updated_at || session.created_at || null;
}
