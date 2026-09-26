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
 * work-time statistics. A task's IN_PROGRESS duration is final once it has
 * left IN_PROGRESS for a done state. Both IMPLEMENTED and
 * PULL_REQUEST_AVAILABLE end an IN_PROGRESS interval.
 */
describe('PipelineStatsView done-state metrics', () => {
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

  it('excludes tasks that have not reached a done state', () => {
    const tasks = [
      makeTask(TaskStatus.INPROGRESS, [
        { to_status: TaskStatus.INPROGRESS, timestamp: new Date(now).toISOString(), by: 'mcp' },
        { to_status: TaskStatus.SCHEDULED, timestamp: new Date(now + 1000).toISOString(), by: 'user' },
        { to_status: TaskStatus.INPROGRESS, timestamp: new Date(now + 2000).toISOString(), by: 'mcp' }
      ]),
      makeTask(TaskStatus.FAILED, [
        { to_status: TaskStatus.INPROGRESS, timestamp: new Date(now).toISOString(), by: 'mcp' },
        { to_status: TaskStatus.FAILED, timestamp: new Date(now + 3000).toISOString(), by: 'mcp' }
      ]),
      makeTask(TaskStatus.IMPLEMENTED, [
        { to_status: TaskStatus.INPROGRESS, timestamp: new Date(now).toISOString(), by: 'mcp' },
        { to_status: TaskStatus.IMPLEMENTED, timestamp: new Date(now + 2000).toISOString(), by: 'mcp' }
      ]),
    ];

    const metrics = PipelineStatsView.calculateMetrics(tasks);
    expect(metrics.work.avg).toBe('2s');
    expect(metrics.work.median).toBe('2s');
    expect(metrics.work.total).toBe('2s');
  });
});
