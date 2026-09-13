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
import { BacklogTaskView } from './BacklogTaskView.ts';
import { Task, TaskStatus } from '../../core/domain.ts';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Implement login flow',
    spec: 'Add a login form with validation.',
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

describe('BacklogTaskView', () => {
  it('should render the task title', () => {
    const html = BacklogTaskView.render(makeTask());
    expect(html).toContain('Implement login flow');
  });

  it('should render the spec as a compact excerpt', () => {
    const html = BacklogTaskView.render(makeTask({ spec: 'Add a **login** form with [validation](https://example.com).' }));
    expect(html).toContain('Add a login form with validation.');
    expect(html).not.toContain('**');
  });

  it('should show a fallback when there is no spec', () => {
    const html = BacklogTaskView.render(makeTask({ spec: undefined }));
    expect(html).toContain('No specification yet.');
  });

  it('should show a Design badge when a design doc is available', () => {
    const html = BacklogTaskView.render(makeTask({ design_doc: '# Design' }));
    expect(html).toContain('text-purple-400');
  });

  it('should not show a Design badge when no design doc is available', () => {
    const html = BacklogTaskView.render(makeTask({ design_doc: '' }));
    expect(html).not.toContain('text-purple-400');
  });

  it('should render ArchBot and CoderBot actions with the task id', () => {
    const html = BacklogTaskView.render(makeTask());
    expect(html).toContain('data-action-click="trigger_archbot" data-task-id="task-1"');
    expect(html).toContain('data-action-click="trigger_coderbot" data-task-id="task-1"');
  });

  it('should escape HTML in the title', () => {
    const html = BacklogTaskView.render(makeTask({ title: '<script>bad()</script>' }));
    expect(html).not.toContain('<script>bad()</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('should render the task order value', () => {
    const html = BacklogTaskView.render(makeTask({ order: -7 }));
    expect(html).toContain('title="Priority order"');
    expect(html).toContain('#-7');
  });

  describe('status workflow actions', () => {
    it('should render Approve and Reject for a PROPOSED task', () => {
      const html = BacklogTaskView.render(makeTask({ status: TaskStatus.PROPOSED, design_doc: '# d' }));
      expect(html).toContain('data-action-click="accept_design"');
      expect(html).toContain('data-action-click="reject_design"');
      expect(html).toContain('>Approve</span>');
      expect(html).toContain('>Reject</span>');
      expect(html).not.toContain('data-action-click="schedule_task"');
    });

    it('should render Schedule for a CREATED task', () => {
      const html = BacklogTaskView.render(makeTask({ status: TaskStatus.CREATED }));
      expect(html).toContain('data-action-click="schedule_task"');
      expect(html).toContain('>Schedule</span>');
      expect(html).not.toContain('data-action-click="accept_design"');
      expect(html).not.toContain('data-action-click="reject_design"');
    });

    it('should attach data-view-id and data-version so existing handlers resolve', () => {
      const html = BacklogTaskView.render(makeTask({ status: TaskStatus.CREATED, version: 3 }));
      expect(html).toContain('data-view-id="task-1"');
      // the schedule button carries data-version for the action handler
      expect(html).toContain('data-action-click="schedule_task" data-version="3"');
    });

    it('should render no status actions for other statuses', () => {
      const html = BacklogTaskView.render(makeTask({ status: TaskStatus.SCHEDULED }));
      expect(html).not.toContain('data-action-click="accept_design"');
      expect(html).not.toContain('data-action-click="reject_design"');
      expect(html).not.toContain('data-action-click="schedule_task"');
    });
  });
});
