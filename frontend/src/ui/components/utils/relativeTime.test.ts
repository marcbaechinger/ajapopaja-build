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
import {
  formatRelativeTime,
  formatAbsoluteTime,
  parseTimestamp,
  sessionTimestamp,
} from './relativeTime.ts';

const NOW = Date.parse('2026-01-10T12:00:00Z');
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

describe('relativeTime utils', () => {
  describe('formatRelativeTime', () => {
    it('formats seconds', () => {
      expect(formatRelativeTime(ago(5), NOW)).toBe('5s ago');
      expect(formatRelativeTime(ago(59), NOW)).toBe('59s ago');
    });

    it('formats minutes', () => {
      expect(formatRelativeTime(ago(60), NOW)).toBe('1m ago');
      expect(formatRelativeTime(ago(2 * 60), NOW)).toBe('2m ago');
    });

    it('formats hours', () => {
      expect(formatRelativeTime(ago(3600), NOW)).toBe('1h ago');
      expect(formatRelativeTime(ago(3 * 3600), NOW)).toBe('3h ago');
    });

    it('formats days', () => {
      expect(formatRelativeTime(ago(24 * 3600), NOW)).toBe('1d ago');
      expect(formatRelativeTime(ago(3 * 24 * 3600), NOW)).toBe('3d ago');
    });

    it('falls back to — for missing or invalid input', () => {
      expect(formatRelativeTime(null, NOW)).toBe('—');
      expect(formatRelativeTime(undefined, NOW)).toBe('—');
      expect(formatRelativeTime('not-a-date', NOW)).toBe('—');
    });

    it('treats timezone-less date-time strings as UTC', () => {
      // Python/BSON can emit aware-UTC datetimes without an offset. JS would
      // otherwise parse these as local time and shift the delta by the
      // browser's UTC offset (the reported "2h ago" bug).
      expect(formatRelativeTime('2026-01-10T11:58:00', NOW)).toBe('2m ago');
      expect(formatRelativeTime('2026-01-10 11:58:00', NOW)).toBe('2m ago');
    });

    it('leaves already-zoned date-time strings unchanged', () => {
      expect(formatRelativeTime('2026-01-10T11:58:00Z', NOW)).toBe('2m ago');
      expect(formatRelativeTime('2026-01-10T11:58:00+00:00', NOW)).toBe('2m ago');
    });

    it('does not append Z to date-only strings', () => {
      expect(parseTimestamp('2026-01-10')).toBe(Date.parse('2026-01-10'));
    });
  });

  describe('parseTimestamp', () => {
    it('normalizes offset-less strings but preserves explicit zones', () => {
      expect(parseTimestamp('2026-01-10T12:00:00')).toBe(
        Date.parse('2026-01-10T12:00:00Z')
      );
      expect(parseTimestamp('2026-01-10T12:00:00.500')).toBe(
        Date.parse('2026-01-10T12:00:00.500Z')
      );
      expect(parseTimestamp('2026-01-10T12:00:00+02:00')).toBe(
        Date.parse('2026-01-10T12:00:00+02:00')
      );
      expect(parseTimestamp('2026-01-10')).toBe(Date.parse('2026-01-10'));
    });
  });

  describe('formatAbsoluteTime', () => {
    it('returns — for invalid input', () => {
      expect(formatAbsoluteTime(null)).toBe('—');
      expect(formatAbsoluteTime('nope')).toBe('—');
    });

    it('formats a valid timestamp', () => {
      const formatted = formatAbsoluteTime('2026-10-03T14:02:00Z');
      expect(formatted).not.toBe('—');
      expect(formatted).toMatch(/Oct/);
    });

    it('agrees with the UTC interpretation of offset-less input', () => {
      // The tooltip and the relative label must derive from the same instant.
      expect(formatAbsoluteTime('2026-10-03T14:02:00')).toBe(
        formatAbsoluteTime(new Date('2026-10-03T14:02:00Z').toISOString())
      );
    });
  });

  describe('sessionTimestamp', () => {
    it('prefers last_active_at, then updated_at, then created_at', () => {
      expect(
        sessionTimestamp({
          last_active_at: '2026-01-03T00:00:00Z',
          updated_at: '2026-01-02T00:00:00Z',
          created_at: '2026-01-01T00:00:00Z',
        })
      ).toBe('2026-01-03T00:00:00Z');
      expect(sessionTimestamp({ updated_at: '2026-01-02T00:00:00Z' })).toBe(
        '2026-01-02T00:00:00Z'
      );
      expect(sessionTimestamp({ created_at: '2026-01-01T00:00:00Z' })).toBe(
        '2026-01-01T00:00:00Z'
      );
    });
  });
});
