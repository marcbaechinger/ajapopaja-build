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
import { CompletedSection } from './CompletedSection.ts';
import { Task, TaskStatus } from '../../../core/domain.ts';

describe('CompletedSection', () => {
  const makeTask = (overrides: Partial<Task> = {}): Task => new Task({
    id: 't1',
    title: 'Completed Task',
    status: TaskStatus.IMPLEMENTED,
    pipeline_id: 'p1',
    deleted: false,
    version: 1,
    order: 0,
    type: 'manual',
    commit_hash: 'abcdef123456',
    history: [
      { from_status: TaskStatus.CREATED, to_status: TaskStatus.INPROGRESS, timestamp: '2026-04-12T10:00:00Z', by: 'user' },
      { from_status: TaskStatus.INPROGRESS, to_status: TaskStatus.IMPLEMENTED, timestamp: '2026-04-12T10:30:00Z', by: 'system' },
    ],
    created_at: '2026-04-12T10:00:00Z',
    updated_at: '2026-04-12T10:30:00Z',
    ...overrides,
  });

  it('renders the "Last Completed" section with a History Feed', () => {
    const html = CompletedSection.render({
      lastCompleted: makeTask(),
      totalCompletedCount: 1,
      collapsedTasks: new Set<string>(),
    });

    expect(html).toContain('id="completed-section"');
    expect(html).toContain('Last Completed');
    expect(html).toContain('History Feed');
    expect(html).toContain('id="last-completed-task"');
    expect(html).toContain('id="completed-pagination"');
    expect(html).toContain('id="completed-task-list"');
  });

  it('renders the total completed count badge when there is at least one completed task', () => {
    const html = CompletedSection.render({
      lastCompleted: makeTask(),
      totalCompletedCount: 7,
      collapsedTasks: new Set<string>(),
    });

    expect(html).toContain('7 total');
  });

  it('omits the total completed count badge when there are no completed tasks', () => {
    const html = CompletedSection.render({
      lastCompleted: null,
      totalCompletedCount: 0,
      collapsedTasks: new Set<string>(),
    });

    expect(html).not.toContain('0 total');
    expect(html).not.toContain('total</span>');
  });

  it('renders an empty-state message when there is no last completed task', () => {
    const html = CompletedSection.render({
      lastCompleted: null,
      totalCompletedCount: 0,
      collapsedTasks: new Set<string>(),
    });

    expect(html).toContain('No tasks completed yet.');
    expect(html).not.toContain('data-view-type="history"');
    expect(html).not.toContain('data-view-type="task"');
  });

  it('renders a history item for IMPLEMENTED tasks', () => {
    const html = CompletedSection.render({
      lastCompleted: makeTask({ status: TaskStatus.IMPLEMENTED }),
      totalCompletedCount: 1,
      collapsedTasks: new Set<string>(),
    });

    expect(html).toContain('data-view-type="history"');
    expect(html).toContain('data-view-id="t1"');
    expect(html).toContain('data-action-click="select_task"');
    expect(html).not.toContain('data-view-type="task"');
  });

  it('renders a history item for SUBMITTED tasks', () => {
    const html = CompletedSection.render({
      lastCompleted: makeTask({ status: TaskStatus.SUBMITTED }),
      totalCompletedCount: 1,
      collapsedTasks: new Set<string>(),
    });

    expect(html).toContain('data-view-type="history"');
    expect(html).toContain('data-action-click="select_task"');
    expect(html).not.toContain('data-view-type="task"');
  });

  it('renders a full task card for non-history (e.g. FAILED) tasks', () => {
    const html = CompletedSection.render({
      lastCompleted: makeTask({ status: TaskStatus.FAILED }),
      totalCompletedCount: 1,
      collapsedTasks: new Set<string>(),
    });

    expect(html).toContain('data-view-type="task"');
    expect(html).toContain('data-view-id="t1"');
    expect(html).toContain('toggle_task_collapse');
    expect(html).not.toContain('data-view-type="history"');
  });

  it('keeps a non-history task expanded when it is not in collapsedTasks', () => {
    const html = CompletedSection.render({
      lastCompleted: makeTask({ status: TaskStatus.FAILED }),
      totalCompletedCount: 1,
      collapsedTasks: new Set<string>(),
    });

    const body = html.match(/<div class="task-body[^"]*"/)?.[0] ?? '';
    expect(body).not.toContain('hidden');
  });

  it('collapses a non-history task when its id is in collapsedTasks', () => {
    const html = CompletedSection.render({
      lastCompleted: makeTask({ id: 't-collapsed', status: TaskStatus.FAILED }),
      totalCompletedCount: 1,
      collapsedTasks: new Set<string>(['t-collapsed']),
    });

    const body = html.match(/<div class="task-body[^"]*"/)?.[0] ?? '';
    expect(body).toContain('hidden');
  });

  it('shows a loading placeholder in the history feed until tasks are rendered', () => {
    const html = CompletedSection.render({
      lastCompleted: null,
      totalCompletedCount: 0,
      collapsedTasks: new Set<string>(),
    });

    expect(html).toContain('Loading history...');
  });

  it('does not leak unrelated task ids into the last completed slot', () => {
    const html = CompletedSection.render({
      lastCompleted: makeTask({ id: 't-last' }),
      totalCompletedCount: 2,
      collapsedTasks: new Set<string>(['other-id']),
    });

    expect(html).toContain('data-view-id="t-last"');
    expect(html).not.toContain('data-view-id="other-id"');
  });
});
