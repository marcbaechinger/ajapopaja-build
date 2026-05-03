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
import { formatMs, calculateDuration, calculateDesignDuration } from './duration.ts';
import { TaskStatus } from '../../../core/domain.ts';

describe('duration utils', () => {
  describe('formatMs', () => {
    it('should format milliseconds to readable string', () => {
      expect(formatMs(1000)).toBe('1s');
      expect(formatMs(60000)).toBe('1m');
      expect(formatMs(3600000)).toBe('1h');
      expect(formatMs(3661000)).toBe('1h 1m 1s');
      expect(formatMs(0)).toBe('0s');
      expect(formatMs(-100)).toBeNull();
    });
  });

  describe('calculateDuration', () => {
    it('should calculate implementation duration', () => {
      const task = {
        history: [
          { to_status: TaskStatus.INPROGRESS, timestamp: '2026-04-12T10:00:00Z' },
          { to_status: TaskStatus.IMPLEMENTED, timestamp: '2026-04-12T10:05:30Z' }
        ]
      };
      expect(calculateDuration(task as any)).toBe('5m 30s');
    });

    it('should use the last INPROGRESS entry', () => {
      const task = {
        history: [
          { to_status: TaskStatus.INPROGRESS, timestamp: '2026-04-12T09:00:00Z' },
          { to_status: TaskStatus.FAILED, timestamp: '2026-04-12T09:30:00Z' },
          { to_status: TaskStatus.INPROGRESS, timestamp: '2026-04-12T10:00:00Z' },
          { to_status: TaskStatus.IMPLEMENTED, timestamp: '2026-04-12T10:05:30Z' }
        ]
      };
      expect(calculateDuration(task as any)).toBe('5m 30s');
    });

    it('should return null if entries are missing', () => {
      expect(calculateDuration({ history: [] } as any)).toBeNull();
      expect(calculateDuration({ history: [{ to_status: TaskStatus.INPROGRESS }] } as any)).toBeNull();
    });
  });

  describe('calculateDesignDuration', () => {
    it('should calculate design duration', () => {
      const task = {
        history: [
          { to_status: TaskStatus.INPROGRESS, timestamp: '2026-04-12T10:00:00Z' },
          { to_status: TaskStatus.PROPOSED, timestamp: '2026-04-12T10:05:30Z' }
        ]
      };
      expect(calculateDesignDuration(task as any)).toBe('5m 30s');
    });

    it('should use the first INPROGRESS before PROPOSED', () => {
      const task = {
        history: [
          { to_status: TaskStatus.INPROGRESS, timestamp: '2026-04-12T10:00:00Z' },
          { to_status: TaskStatus.INPROGRESS, timestamp: '2026-04-12T10:02:00Z' },
          { to_status: TaskStatus.PROPOSED, timestamp: '2026-04-12T10:05:30Z' }
        ]
      };
      expect(calculateDesignDuration(task as any)).toBe('5m 30s');
    });

    it('should return null if entries are missing', () => {
      expect(calculateDesignDuration({ history: [] } as any)).toBeNull();
      expect(calculateDesignDuration({ history: [{ to_status: TaskStatus.PROPOSED }] } as any)).toBeNull();
    });
  });
});
