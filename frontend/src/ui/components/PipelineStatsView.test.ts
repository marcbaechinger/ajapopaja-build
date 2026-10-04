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

  it('calculates IN_PROGRESS time for task with design phase', () => {
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

    expect(PipelineStatsView.getInProgressTime(task)).toBe(5000);
  });

  it('calculates IN_PROGRESS time for task without design phase', () => {
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

    expect(PipelineStatsView.getInProgressTime(task)).toBe(4000);
  });

  it('handles multiple IN_PROGRESS cycles during implementation', () => {
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
        { to_status: TaskStatus.IMPLEMENTED, timestamp: new Date(now + 7000).toISOString(), by: 'mcp' }, // Worked 2s, done
        { to_status: TaskStatus.SCHEDULED, timestamp: new Date(now + 8000).toISOString(), by: 'user' },
        { to_status: TaskStatus.INPROGRESS, timestamp: new Date(now + 9000).toISOString(), by: 'mcp' },
        { to_status: TaskStatus.IMPLEMENTED, timestamp: new Date(now + 10000).toISOString(), by: 'mcp' } // Worked 2s, done
      ]
    } as Task;

    expect(PipelineStatsView.getInProgressTime(task)).toBe(1000 + 2000 + 1000);
  });

  it('handles multiple design phases correctly', () => {
    const task: Task = {
      id: '4',
      title: 'Canceled Task',
      status: TaskStatus.IMPLEMENTED,
      history: [
        { to_status: TaskStatus.SCHEDULED, timestamp: new Date(now).toISOString(), by: 'user' },
        { to_status: TaskStatus.INPROGRESS, timestamp: new Date(now + 1000).toISOString(), by: 'mcp' },
        { to_status: TaskStatus.PROPOSED, timestamp: new Date(now + 2000).toISOString(), by: 'mcp' },   // End design (1s)
        { to_status: TaskStatus.SCHEDULED, timestamp: new Date(now + 3000).toISOString(), by: 'user' },
        { to_status: TaskStatus.INPROGRESS, timestamp: new Date(now + 4000).toISOString(), by: 'mcp' },
        { to_status: TaskStatus.PROPOSED, timestamp: new Date(now + 5000).toISOString(), by: 'mcp' },   // End design (1s)
        { to_status: TaskStatus.SCHEDULED, timestamp: new Date(now + 6000).toISOString(), by: 'user' },
        { to_status: TaskStatus.INPROGRESS, timestamp: new Date(now + 7000).toISOString(), by: 'mcp' },
        { to_status: TaskStatus.IMPLEMENTED, timestamp: new Date(now + 10000).toISOString(), by: 'mcp' } // End impl (3s)
      ]
    } as Task;

    // Period 1: INPROGRESS (1000) -> PROPOSED (2000) = 1s design
    // Period 2: INPROGRESS (4000) -> PROPOSED (5000) = 1s design
    // Period 3: INPROGRESS (7000) -> IMPLEMENTED (10000) = 3s implementation
    expect(PipelineStatsView.getInProgressTime(task)).toBe(5000);
  });

  it('handles backward transitions (Cancel Progress) correctly', () => {
    const task: Task = {
      id: '4',
      title: 'Canceled Task',
      status: TaskStatus.IMPLEMENTED,
      history: [
        { to_status: TaskStatus.SCHEDULED, timestamp: new Date(now).toISOString(), by: 'user' },
        { to_status: TaskStatus.INPROGRESS, timestamp: new Date(now + 1000).toISOString(), by: 'mcp' },
        { to_status: TaskStatus.SCHEDULED, timestamp: new Date(now + 2000).toISOString(), by: 'user' }, // Canceled progress (1s)
        { to_status: TaskStatus.INPROGRESS, timestamp: new Date(now + 3000).toISOString(), by: 'mcp' },
        { to_status: TaskStatus.PROPOSED, timestamp: new Date(now + 5000).toISOString(), by: 'mcp' },   // End design (2s)
        { to_status: TaskStatus.SCHEDULED, timestamp: new Date(now + 6000).toISOString(), by: 'user' },
        { to_status: TaskStatus.INPROGRESS, timestamp: new Date(now + 7000).toISOString(), by: 'mcp' },
        { to_status: TaskStatus.IMPLEMENTED, timestamp: new Date(now + 10000).toISOString(), by: 'mcp' } // End impl (3s)
      ]
    } as Task;

    // Period 1: INPROGRESS (1000) -> SCHEDULED (2000) = 1s
    // Period 2: INPROGRESS (3000) -> PROPOSED (5000) = 2s
    // Period 3: INPROGRESS (7000) -> IMPLEMENTED (10000) = 3s
    expect(PipelineStatsView.getInProgressTime(task)).toBe(6000);
  });

  it('handles INPROGRESS -> SCHEDULED after PROPOSED', () => {
    const task: Task = {
      id: '5',
      title: 'Canceled Implementation',
      status: TaskStatus.IMPLEMENTED,
      history: [
        { to_status: TaskStatus.PROPOSED, timestamp: new Date(now).toISOString(), by: 'mcp' }, // Start in proposed
        { to_status: TaskStatus.SCHEDULED, timestamp: new Date(now + 1000).toISOString(), by: 'user' },
        { to_status: TaskStatus.INPROGRESS, timestamp: new Date(now + 2000).toISOString(), by: 'mcp' },
        { to_status: TaskStatus.SCHEDULED, timestamp: new Date(now + 3000).toISOString(), by: 'user' }, // Canceled impl (1s)
        { to_status: TaskStatus.INPROGRESS, timestamp: new Date(now + 4000).toISOString(), by: 'mcp' },
        { to_status: TaskStatus.IMPLEMENTED, timestamp: new Date(now + 6000).toISOString(), by: 'mcp' } // End impl (2s)
      ]
    } as Task;

    expect(PipelineStatsView.getInProgressTime(task)).toBe(1000 + 2000);
  });

  it('does not count a trailing open IN_PROGRESS interval', () => {
    const task: Task = {
      id: '6',
      title: 'Currently Running',
      status: TaskStatus.INPROGRESS,
      history: [
        { to_status: TaskStatus.SCHEDULED, timestamp: new Date(now).toISOString(), by: 'user' },
        { to_status: TaskStatus.INPROGRESS, timestamp: new Date(now + 1000).toISOString(), by: 'mcp' }, // still in progress
      ]
    } as Task;

    expect(PipelineStatsView.getInProgressTime(task)).toBe(0);
  });

  it('returns 0 for tasks without history', () => {
    expect(PipelineStatsView.getInProgressTime({ history: [] } as any)).toBe(0);
    expect(PipelineStatsView.getInProgressTime({} as any)).toBe(0);
  });

  it('formats durations correctly', () => {
    expect(PipelineStatsView.formatDuration(500)).toBe('< 1s');
    expect(PipelineStatsView.formatDuration(5000)).toBe('5s');
    expect(PipelineStatsView.formatDuration(65000)).toBe('1m 5s');
    expect(PipelineStatsView.formatDuration(3665000)).toBe('1h 1m');
    expect(PipelineStatsView.formatDuration(90000000)).toBe('1d 1h');
  });

  describe('calculateMetrics', () => {
    const makeDurationTask = (ms: number, status: TaskStatus = TaskStatus.IMPLEMENTED): Task => ({
      status,
      history: [
        { to_status: TaskStatus.INPROGRESS, timestamp: new Date(now).toISOString(), by: 'mcp' },
        { to_status: status, timestamp: new Date(now + ms).toISOString(), by: 'mcp' }
      ]
    } as unknown as Task);

    it('returns N/A for empty tasks', () => {
      expect(PipelineStatsView.calculateMetrics([])).toEqual({
        work: { avg: 'N/A', median: 'N/A', total: 'N/A' }
      });
    });

    it('computes avg, median and total IN_PROGRESS time for implemented tasks', () => {
      const makeTask = (history: any): Task => ({ status: TaskStatus.IMPLEMENTED, history } as unknown as Task);
      const tasks = [
        makeTask([
          { to_status: TaskStatus.INPROGRESS, timestamp: new Date(now).toISOString(), by: 'mcp' },
          { to_status: TaskStatus.IMPLEMENTED, timestamp: new Date(now + 4000).toISOString(), by: 'mcp' }
        ]),
        makeTask([
          { to_status: TaskStatus.INPROGRESS, timestamp: new Date(now).toISOString(), by: 'mcp' },
          { to_status: TaskStatus.IMPLEMENTED, timestamp: new Date(now + 6000).toISOString(), by: 'mcp' }
        ]),
      ] as Task[];

      const metrics = PipelineStatsView.calculateMetrics(tasks);
      expect(metrics.work.avg).toBe('5s');
      expect(metrics.work.median).toBe('5s');
      expect(metrics.work.total).toBe('10s');
    });

    it('computes the average from the time-in-progress values of all considered tasks', () => {
      // (2s + 4s + 9s) / 3 = 5s
      const metrics = PipelineStatsView.calculateMetrics([
        makeDurationTask(2000),
        makeDurationTask(4000),
        makeDurationTask(9000),
      ]);

      expect(metrics.work.avg).toBe('5s');
      expect(metrics.work.median).toBe('4s');
      expect(metrics.work.total).toBe('15s');
    });

    it('computes the median for an odd number of considered tasks as the middle value', () => {
      // Sorted: 1s, 3s, 5s -> middle value is 3s
      const metrics = PipelineStatsView.calculateMetrics([
        makeDurationTask(5000),
        makeDurationTask(1000),
        makeDurationTask(3000),
      ]);

      expect(metrics.work.median).toBe('3s');
      expect(metrics.work.avg).toBe('3s');
      expect(metrics.work.total).toBe('9s');
    });

    it('computes the median for an even number of considered tasks as the average of the two middle values', () => {
      // Sorted: 2s, 4s, 6s, 12s -> (4s + 6s) / 2 = 5s
      const metrics = PipelineStatsView.calculateMetrics([
        makeDurationTask(12000),
        makeDurationTask(2000),
        makeDurationTask(6000),
        makeDurationTask(4000),
      ]);

      expect(metrics.work.median).toBe('5s');
      expect(metrics.work.avg).toBe('6s');
      expect(metrics.work.total).toBe('24s');
    });
  });

  describe('render', () => {
    it('shows total tasks, avg, median and total IN_PROGRESS (no lead time)', () => {
      const html = PipelineStatsView.render([]);

      expect(html).toContain('Total Tasks');
      expect(html).toContain('Avg Time IN_PROGRESS');
      expect(html).toContain('Median Time IN_PROGRESS');
      expect(html).toContain('Total Time IN_PROGRESS');
      expect(html).not.toContain('Avg Lead Time');
    });

    it('includes DELETED in the task distribution', () => {
      const deleted = { id: 'd1', title: 'Deleted', deleted: true, status: TaskStatus.CREATED } as Task;
      const html = PipelineStatsView.render([deleted]);

      expect(html).toContain('DELETED');
    });

    it('sum of distribution counts equals the total for every task state', () => {
      const statuses = [
        TaskStatus.CREATED,
        TaskStatus.SCHEDULED,
        TaskStatus.PROPOSED,
        TaskStatus.INPROGRESS,
        TaskStatus.IMPLEMENTED,
        TaskStatus.PULL_REQUEST_AVAILABLE,
        TaskStatus.SUBMITTED,
        TaskStatus.FAILED,
        TaskStatus.DISCARDED,
      ];
      const tasks = [
        ...statuses.map((status, i) => ({ id: `t${i}`, title: status, status, deleted: false })),
        { id: 'del', title: 'Deleted', status: TaskStatus.CREATED, deleted: true },
      ] as Task[];

      const html = PipelineStatsView.render(tasks);

      // Total shown in the Total Tasks tile.
      const totalMatch = html.match(/Total Tasks<\/span>\s*<span[^>]*>([^<]+)<\/span>/);
      expect(totalMatch).not.toBeNull();
      const total = Number(totalMatch![1]);
      expect(total).toBe(tasks.length);

      // Sum the counts rendered inside each distribution bar.
      const counts = [...html.matchAll(/<span>([0-9]+) <span class="opacity-60[^"]*">\(([0-9.]+)%\)<\/span><\/span>/g)]
        .map(m => Number(m[1]));
      const sum = counts.reduce((acc, c) => acc + c, 0);
      expect(counts.length).toBe(statuses.length + 1); // all 9 states + DELETED
      expect(sum).toBe(total);
    });

    it('keeps the total task count correct when worked tasks are mixed with tasks that never started', () => {
      const worked = (id: string, status: TaskStatus, ms: number): Task => ({
        id,
        title: id,
        status,
        deleted: false,
        history: [
          { to_status: TaskStatus.INPROGRESS, timestamp: new Date(now).toISOString(), by: 'mcp' },
          { to_status: status, timestamp: new Date(now + ms).toISOString(), by: 'mcp' },
        ],
      } as unknown as Task);
      const tasks = [
        worked('a', TaskStatus.SUBMITTED, 4000),
        worked('b', TaskStatus.FAILED, 2000),
        { id: 'c', title: 'c', status: TaskStatus.CREATED, deleted: false, history: [] },
      ] as Task[];

      const html = PipelineStatsView.render(tasks);
      const totalMatch = html.match(/Total Tasks<\/span>\s*<span[^>]*>([^<]+)<\/span>/);
      expect(totalMatch).not.toBeNull();
      expect(Number(totalMatch![1])).toBe(3);
    });
  });

  describe('daily done counting', () => {
    const day = '2026-04-12';

    const doneTask = (status: TaskStatus): Task => ({
      id: status,
      title: status,
      status,
      deleted: false,
      history: [{
        to_status: status,
        timestamp: `${day}T10:00:00Z`,
        by: 'mcp'
      }]
    } as unknown as Task);

    it('counts both IMPLEMENTED and SUBMITTED tasks as done per day', () => {
      const tasks = [
        doneTask(TaskStatus.IMPLEMENTED),
        doneTask(TaskStatus.SUBMITTED),
      ];
      // Backend only reported the IMPLEMENTED task (the historical bug).
      const html = PipelineStatsView.render(tasks, [
        { date: day, created: 2, implemented: 1, work_ms: 0 }
      ]);

      const row = html.match(
        new RegExp(`<td class="py-3 font-medium text-app-text">${day}</td>\\s*<td[^>]*>2</td>\\s*<td[^>]*>(\\d+)</td>`)
      );
      expect(row).not.toBeNull();
      expect(row![1]).toBe('2');
    });

    it('derives the daily done count from task history', () => {
      const counts = PipelineStatsView.getDailyDoneCounts([
        doneTask(TaskStatus.IMPLEMENTED),
        doneTask(TaskStatus.SUBMITTED),
      ]);

      expect(counts[day]).toBe(2);
    });

    it('honours an explicit submitted count from the backend', () => {
      const html = PipelineStatsView.render([], [
        { date: day, created: 1, implemented: 0, submitted: 1, work_ms: 0 }
      ]);

      const row = html.match(
        new RegExp(`<td class="py-3 font-medium text-app-text">${day}</td>\\s*<td[^>]*>1</td>\\s*<td[^>]*>(\\d+)</td>`)
      );
      expect(row).not.toBeNull();
      expect(row![1]).toBe('1');
    });
  });

  describe('renderCompact', () => {
    it('renders the four compact metric chips with correct values', () => {
      const task: Task = {
        id: 'c1',
        title: 'Compact Task',
        status: TaskStatus.IMPLEMENTED,
        history: [
          { to_status: TaskStatus.SCHEDULED, timestamp: new Date(now).toISOString(), by: 'user' },
          { to_status: TaskStatus.INPROGRESS, timestamp: new Date(now + 1000).toISOString(), by: 'mcp' },
          { to_status: TaskStatus.PROPOSED, timestamp: new Date(now + 3000).toISOString(), by: 'mcp' },
          { to_status: TaskStatus.SCHEDULED, timestamp: new Date(now + 5000).toISOString(), by: 'user' },
          { to_status: TaskStatus.INPROGRESS, timestamp: new Date(now + 6000).toISOString(), by: 'mcp' },
          { to_status: TaskStatus.IMPLEMENTED, timestamp: new Date(now + 9000).toISOString(), by: 'mcp' }
        ]
      } as Task;

      const html = PipelineStatsView.renderCompact([task]);

      expect(html).toContain('Total');
      expect(html).toContain('1');
      expect(html).toContain('Avg Work');
      expect(html).toContain('5s');          // avg IN_PROGRESS time
      expect(html).toContain('Median Work');
      expect(html).toContain('5s');          // median IN_PROGRESS time
      expect(html).toContain('Total Work');
      expect(html).toContain('5s');          // total IN_PROGRESS time
      expect(html).not.toContain('Avg Lead');
    });

    it('returns valid markup for empty tasks with N/A metrics', () => {
      const html = PipelineStatsView.renderCompact([]);

      expect(html).toContain('Total');
      expect(html).toContain('0');
      expect(html).toContain('N/A');
      // still renders an inline flex container
      expect(html).toContain('flex flex-wrap');
    });
  });
});
