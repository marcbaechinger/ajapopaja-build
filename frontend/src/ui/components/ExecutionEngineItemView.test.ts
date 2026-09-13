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
import { ExecutionEngineItemView } from './ExecutionEngineItemView.ts';
import { Task, TaskStatus } from '../../core/domain.ts';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Implement login flow',
    spec: 'Add a login form with validation.',
    status: TaskStatus.SCHEDULED,
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

describe('ExecutionEngineItemView', () => {
  it('should render the task title and spec excerpt', () => {
    const html = ExecutionEngineItemView.render(makeTask({ spec: 'Add a **login** form with [validation](https://x.dev).' }));
    expect(html).toContain('Implement login flow');
    expect(html).toContain('Add a login form with validation.');
    expect(html).not.toContain('**');
  });

  it('should be clickable to select the task', () => {
    const html = ExecutionEngineItemView.render(makeTask());
    expect(html).toContain('data-action-click="select_task"');
    expect(html).toContain('data-view-id="task-1"');
  });

  it('should show the Running badge for an IN_PROGRESS task', () => {
    const html = ExecutionEngineItemView.render(makeTask({ status: TaskStatus.INPROGRESS }));
    expect(html).toContain('Running');
  });

  it('should show the Queued badge for a SCHEDULED task', () => {
    const html = ExecutionEngineItemView.render(makeTask({ status: TaskStatus.SCHEDULED }));
    expect(html).toContain('Queued');
  });

  it('should not render any action buttons', () => {
    const html = ExecutionEngineItemView.render(makeTask());
    expect(html).not.toContain('trigger_archbot');
    expect(html).not.toContain('trigger_coderbot');
    expect(html).not.toContain('schedule_task');
    expect(html).not.toContain('accept_design');
    expect(html).not.toContain('reject_design');
  });

  it('should render the order control for a SCHEDULED (queued) task', () => {
    const html = ExecutionEngineItemView.render(makeTask({ status: TaskStatus.SCHEDULED, order: 3 }));
    expect(html).toContain('data-action-change="update_task_order"');
    expect(html).toContain('data-action-click="move_task_up"');
    expect(html).toContain('data-action-click="move_task_down"');
    expect(html).toContain('value="3"');
  });

  it('should not render the order control for non-SCHEDULED tasks', () => {
    const html = ExecutionEngineItemView.render(makeTask({ status: TaskStatus.INPROGRESS, order: 3 }));
    expect(html).not.toContain('update_task_order');
  });

  it('should escape HTML in the title', () => {
    const html = ExecutionEngineItemView.render(makeTask({ title: '<script>bad()</script>' }));
    expect(html).not.toContain('<script>bad()</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
