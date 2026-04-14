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
import { PipelineStatsView } from './PipelineStatsView';
import { Task, TaskStatus } from '../../core/domain';

describe('PipelineStatsView', () => {
  const now = new Date('2026-04-14T12:00:00Z').getTime();

  it('calculates granular durations correctly for task with design phase', () => {
    const task: Task = {
      id: '1',
      title: 'Test Task',
      status: TaskStatus.IMPLEMENTED,
      history: [
        { to_status: TaskStatus.SCHEDULED, timestamp: new Date(now).toISOString(), by: 'user' },
        { to_status: TaskStatus.INPROGRESS, timestamp: new Date(now + 1000).toISOString(), by: 'mcp' }, // Start design
        { to_status: TaskStatus.PROPOSED, timestamp: new Date(now + 3000).toISOString(), by: 'mcp' },   // End design (2s)
        { to_status: TaskStatus.SCHEDULED, timestamp: new Date(now + 5000).toISOString(), by: 'user' },
        { to_status: TaskStatus.INPROGRESS, timestamp: new Date(now + 6000).toISOString(), by: 'mcp' }, // Start impl
        { to_status: TaskStatus.IMPLEMENTED, timestamp: new Date(now + 9000).toISOString(), by: 'mcp' } // End impl (3s)
      ]
    } as Task;

    const durations = PipelineStatsView.getTaskDurations(task);
    
    expect(durations.designTime).toBe(2000);
    expect(durations.implementationTime).toBe(3000);
    expect(durations.totalWorkTime).toBe(5000);
    expect(durations.leadTime).toBe(9000); // from first scheduled to implemented
  });

  it('calculates durations correctly for task without design phase', () => {
    const task: Task = {
      id: '2',
      title: 'Simple Task',
      status: TaskStatus.IMPLEMENTED,
      history: [
        { to_status: TaskStatus.SCHEDULED, timestamp: new Date(now).toISOString(), by: 'user' },
        { to_status: TaskStatus.INPROGRESS, timestamp: new Date(now + 1000).toISOString(), by: 'mcp' }, // Start work
        { to_status: TaskStatus.IMPLEMENTED, timestamp: new Date(now + 5000).toISOString(), by: 'mcp' } // End work (4s)
      ]
    } as Task;

    const durations = PipelineStatsView.getTaskDurations(task);
    
    expect(durations.designTime).toBe(4000); // everything before proposed is design (or just "work")
    expect(durations.implementationTime).toBe(0);
    expect(durations.totalWorkTime).toBe(4000);
    expect(durations.leadTime).toBe(5000);
  });

  it('handles multiple inprogress cycles during implementation', () => {
    const task: Task = {
      id: '3',
      title: 'Complex Task',
      status: TaskStatus.IMPLEMENTED,
      history: [
        { to_status: TaskStatus.PROPOSED, timestamp: new Date(now).toISOString(), by: 'mcp' }, // Already proposed
        { to_status: TaskStatus.SCHEDULED, timestamp: new Date(now + 1000).toISOString(), by: 'user' },
        { to_status: TaskStatus.INPROGRESS, timestamp: new Date(now + 2000).toISOString(), by: 'mcp' },
        { to_status: TaskStatus.FAILED, timestamp: new Date(now + 3000).toISOString(), by: 'mcp' },     // Worked 1s, failed
        { to_status: TaskStatus.SCHEDULED, timestamp: new Date(now + 4000).toISOString(), by: 'user' },
        { to_status: TaskStatus.INPROGRESS, timestamp: new Date(now + 5000).toISOString(), by: 'mcp' },
        { to_status: TaskStatus.IMPLEMENTED, timestamp: new Date(now + 7000).toISOString(), by: 'mcp' } // Worked 2s, done
      ]
    } as Task;

    const durations = PipelineStatsView.getTaskDurations(task);
    
    expect(durations.designTime).toBe(0);
    expect(durations.implementationTime).toBe(3000); // 1s + 2s
    expect(durations.totalWorkTime).toBe(3000);
  });

  it('formats durations correctly', () => {
    expect(PipelineStatsView.formatDuration(500)).toBe('< 1s');
    expect(PipelineStatsView.formatDuration(5000)).toBe('5s');
    expect(PipelineStatsView.formatDuration(65000)).toBe('1m 5s');
    expect(PipelineStatsView.formatDuration(3665000)).toBe('1h 1m');
    expect(PipelineStatsView.formatDuration(90000000)).toBe('1d 1h');
  });
});
