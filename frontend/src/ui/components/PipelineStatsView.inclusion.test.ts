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

/**
 * Regression tests covering which tasks contribute to the IN_PROGRESS
 * work-time statistics. Inclusion is decided by a task's history, not by its
 * current status: every task that completed at least one IN_PROGRESS interval
 * contributed work time and must affect the average and median, regardless of
 * whether it is currently IMPLEMENTED, PULL_REQUEST_AVAILABLE, SUBMITTED,
 * DISCARDED, FAILED or IN_PROGRESS.
 */
describe('PipelineStatsView work-time task inclusion', () => {
  const now = new Date('2026-04-14T12:00:00Z').getTime();

  const makeTask = (status: TaskStatus, history: any): Task =>
    ({ status, history } as unknown as Task);

  it('includes PULL_REQUEST_AVAILABLE tasks whose work has finished', () => {
    const tasks = [
      makeTask(TaskStatus.IMPLEMENTED, [
        { to_status: TaskStatus.INPROGRESS, timestamp: new Date(now).toISOString(), by: 'mcp' },
        { to_status: TaskStatus.IMPLEMENTED, timestamp: new Date(now + 4000).toISOString(), by: 'mcp' }
      ]),
      makeTask(TaskStatus.PULL_REQUEST_AVAILABLE, [
        { to_status: TaskStatus.INPROGRESS, timestamp: new Date(now).toISOString(), by: 'mcp' },
        { to_status: TaskStatus.PULL_REQUEST_AVAILABLE, timestamp: new Date(now + 8000).toISOString(), by: 'coderbot' }
      ]),
    ];

    const metrics = PipelineStatsView.calculateMetrics(tasks);
    expect(metrics.work.avg).toBe('6s');
    expect(metrics.work.median).toBe('6s');
    expect(metrics.work.total).toBe('12s');
  });

  it('computes metrics when only PULL_REQUEST_AVAILABLE tasks exist', () => {
    const tasks = [
      makeTask(TaskStatus.PULL_REQUEST_AVAILABLE, [
        { to_status: TaskStatus.INPROGRESS, timestamp: new Date(now).toISOString(), by: 'mcp' },
        { to_status: TaskStatus.PULL_REQUEST_AVAILABLE, timestamp: new Date(now + 3000).toISOString(), by: 'coderbot' }
      ]),
    ];

    const metrics = PipelineStatsView.calculateMetrics(tasks);
    expect(metrics.work.avg).toBe('3s');
    expect(metrics.work.median).toBe('3s');
    expect(metrics.work.total).toBe('3s');
  });

  it('includes every task that completed an IN_PROGRESS interval, regardless of current status', () => {
    // Regression: the previous implementation filtered on the current status
    // (IMPLEMENTED / PULL_REQUEST_AVAILABLE) and therefore silently dropped the
    // SUBMITTED, DISCARDED, FAILED and still-running tasks below. That produced
    // an average/median of 9s and a total of 9s instead of the correct
    // 5s/5s/25s, because only the IMPLEMENTED task was counted.
    const tasks = [
      // Still running, but a 1s interval was already completed before the open
      // trailing interval. Only the completed interval counts.
      makeTask(TaskStatus.INPROGRESS, [
        { to_status: TaskStatus.INPROGRESS, timestamp: new Date(now).toISOString(), by: 'mcp' },
        { to_status: TaskStatus.SCHEDULED, timestamp: new Date(now + 1000).toISOString(), by: 'user' },
        { to_status: TaskStatus.INPROGRESS, timestamp: new Date(now + 2000).toISOString(), by: 'mcp' }
      ]),
      makeTask(TaskStatus.FAILED, [
        { to_status: TaskStatus.INPROGRESS, timestamp: new Date(now).toISOString(), by: 'mcp' },
        { to_status: TaskStatus.FAILED, timestamp: new Date(now + 3000).toISOString(), by: 'mcp' }
      ]),
      makeTask(TaskStatus.SUBMITTED, [
        { to_status: TaskStatus.INPROGRESS, timestamp: new Date(now).toISOString(), by: 'mcp' },
        { to_status: TaskStatus.SUBMITTED, timestamp: new Date(now + 5000).toISOString(), by: 'user' }
      ]),
      makeTask(TaskStatus.DISCARDED, [
        { to_status: TaskStatus.INPROGRESS, timestamp: new Date(now).toISOString(), by: 'mcp' },
        { to_status: TaskStatus.DISCARDED, timestamp: new Date(now + 7000).toISOString(), by: 'user' }
      ]),
      makeTask(TaskStatus.IMPLEMENTED, [
        { to_status: TaskStatus.INPROGRESS, timestamp: new Date(now).toISOString(), by: 'mcp' },
        { to_status: TaskStatus.IMPLEMENTED, timestamp: new Date(now + 9000).toISOString(), by: 'mcp' }
      ]),
      // Never started: no completed IN_PROGRESS interval, so it must not affect
      // the work-time statistics.
      makeTask(TaskStatus.CREATED, []),
    ];

    const metrics = PipelineStatsView.calculateMetrics(tasks);
    // Considered work times (sorted): 1s, 3s, 5s, 7s, 9s
    expect(metrics.work.avg).toBe('5s');    // (1+3+5+7+9)/5 = 5s
    expect(metrics.work.median).toBe('5s'); // middle value = 5s
    expect(metrics.work.total).toBe('25s');
  });

  it('ignores tasks that never left IN_PROGRESS', () => {
    const tasks = [
      makeTask(TaskStatus.INPROGRESS, [
        { to_status: TaskStatus.INPROGRESS, timestamp: new Date(now).toISOString(), by: 'mcp' }
      ]),
    ];

    const metrics = PipelineStatsView.calculateMetrics(tasks);
    expect(metrics.work.avg).toBe('N/A');
    expect(metrics.work.median).toBe('N/A');
    expect(metrics.work.total).toBe('N/A');
  });
});
