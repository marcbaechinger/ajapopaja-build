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
import { BacklogView } from './BacklogView.ts';
import { Task, TaskStatus } from '../../core/domain.ts';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: overrides.id || 'task-1',
    title: 'A task',
    spec: 'Spec',
    design_doc: '',
    status: TaskStatus.CREATED,
    type: 'manual',
    order: 0,
    version: 1,
    want_design_doc: false,
    created_at: '2026-04-12T10:00:00Z',
    updated_at: '2026-04-12T10:00:00Z',
    deleted: false,
    ...overrides,
  } as Task;
}

describe('BacklogView', () => {
  it('should render PROPOSED and CREATED sections', () => {
    const html = BacklogView.render({ tasks: [makeTask()] });
    expect(html).toContain('Proposed');
    expect(html).toContain('Backlog');
  });

  it('should place the PROPOSED section above the CREATED section', () => {
    const html = BacklogView.render({ tasks: [makeTask()] });
    const proposedIdx = html.indexOf('Proposed');
    const backlogIdx = html.indexOf('Backlog');
    expect(proposedIdx).toBeGreaterThan(-1);
    expect(backlogIdx).toBeGreaterThan(proposedIdx);
  });

  it('should show the task count in each section header', () => {
    const tasks = [
      makeTask({ id: 'p1', status: TaskStatus.PROPOSED, design_doc: '# d' }),
      makeTask({ id: 'c1', status: TaskStatus.CREATED }),
      makeTask({ id: 'c2', status: TaskStatus.CREATED }),
    ];
    const html = BacklogView.render({ tasks });
    expect(html).toContain('Proposed');
    expect(html).toContain('Backlog');
    // both sections render a count chip
    expect((html.match(/rounded-full px-1.5 py-0.5/g) || []).length).toBe(3); // 1 proposed + 2 created
  });

  it('should sort tasks within a section by most recently updated first', () => {
    const tasks = [
      makeTask({ id: 'old', status: TaskStatus.CREATED, updated_at: '2026-04-12T10:00:00Z' }),
      makeTask({ id: 'new', status: TaskStatus.CREATED, updated_at: '2026-04-13T10:00:00Z' }),
    ];
    const html = BacklogView.render({ tasks });
    expect(html.indexOf('A task')).toBeGreaterThan(-1);
    // the newer task's data-task-id appears before the older one
    expect(html.indexOf('data-task-id="new"')).toBeLessThan(html.indexOf('data-task-id="old"'));
  });

  it('should render empty states when no tasks exist', () => {
    const html = BacklogView.render({ tasks: [] });
    expect(html).toContain('No proposed designs.');
    expect(html).toContain('Backlog is empty.');
  });

  it('should ignore tasks that are not in the backlog', () => {
    const html = BacklogView.render({
      tasks: [
        makeTask({ id: 'sch', status: TaskStatus.SCHEDULED }),
        makeTask({ id: 'pro', status: TaskStatus.PROPOSED, design_doc: '# d' }),
      ],
    });
    expect(html).toContain('data-task-id="pro"');
    expect(html).not.toContain('data-task-id="sch"');
  });

  it('should ignore deleted tasks', () => {
    const html = BacklogView.render({ tasks: [makeTask({ deleted: true })] });
    expect(html).toContain('Backlog is empty.');
  });
});
