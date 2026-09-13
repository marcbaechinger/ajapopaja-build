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
import { PipelineHistoryView } from './PipelineHistoryView.ts';
import { TaskStatus } from '../../core/domain.ts';

const DATA_ACTION_SELECT_TASK = 'data-action-click="select_task"';

describe('PipelineHistoryView', () => {
  const makeTask = (id: string, title: string, status: TaskStatus, updatedAt: string) => ({
    id,
    title,
    status,
    pipeline_id: 'p1',
    deleted: false,
    version: 1,
    order: 0,
    type: 'manual' as const,
    commit_hash: 'abcdef123456',
    want_design_doc: false,
    history: [],
    created_at: '2026-04-12T10:00:00Z',
    updated_at: updatedAt,
  });

  it('should render a single flat history feed list under a "History Feed" heading', () => {
    const html = PipelineHistoryView.render([
      makeTask('t1', 'Task One', TaskStatus.IMPLEMENTED, '2026-04-12T11:00:00Z'),
    ]);

    expect(html).toContain('History Feed');
    expect(html).not.toContain('Last Completed');
    expect(html).not.toContain('last-completed-task');
    expect(html).toContain('data-view-id="t1"');
    expect(html).toContain(DATA_ACTION_SELECT_TASK);
  });

  it('should render a HistoryItemView for every task without a separate "last completed" section', () => {
    const tasks = [
      makeTask('t1', 'Task One', TaskStatus.IMPLEMENTED, '2026-04-12T11:00:00Z'),
      makeTask('t2', 'Task Two', TaskStatus.SUBMITTED, '2026-04-12T12:00:00Z'),
      makeTask('t3', 'Task Three', TaskStatus.DISCARDED, '2026-04-12T13:00:00Z'),
    ];
    const html = PipelineHistoryView.render(tasks);

    expect(html).toContain('Task One');
    expect(html).toContain('Task Two');
    expect(html).toContain('Task Three');
    // Each task is rendered the same way (all in the same list)
    const matches = html.match(/data-view-id="t\d"/g);
    expect(matches?.length).toBe(3);
  });

  it('should show an empty message when no tasks are provided', () => {
    const html = PipelineHistoryView.render([]);
    expect(html).toContain('No tasks completed yet.');
    expect(html).not.toContain('data-view-id=');
  });
});
