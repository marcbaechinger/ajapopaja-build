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
import { TaskItem } from './TaskItem.ts';
import { TaskStatus } from '../../core/domain.ts';

describe('TaskItem', () => {
  const mockTask = {
    id: '1',
    title: 'Test Task',
    description: 'This is a description',
    status: TaskStatus.CREATED,
    pipeline_id: 'p1',
    deleted: false,
    version: 1,
    order: 0,
    type: 'manual',
    created_at: '2026-04-12T10:00:00Z',
    history: []
  };

  it('should render expanded by default', () => {
    const html = TaskItem.render(mockTask as any);
    expect(html).toContain('Test Task');
    expect(html).toContain('This is a description');
    expect(html).toContain('task-body flex flex-col gap-3 ');
    expect(html).not.toContain('task-body flex flex-col gap-3 hidden');
    expect(html).toContain('rotate-90');
  });

  it('should hide body when collapsed', () => {
    const html = TaskItem.render(mockTask as any, true, false, true);
    expect(html).toContain('Test Task');
    expect(html).toContain('task-body flex flex-col gap-3 hidden');
    expect(html).not.toContain('rotate-90');
  });

  it('should render cancel schedule button for scheduled tasks', () => {
    const scheduledTask = { ...mockTask, status: TaskStatus.SCHEDULED };
    const html = TaskItem.render(scheduledTask as any);
    expect(html).toContain('Cancel Schedule');
    expect(html).toContain('data-action-click="unschedule_task"');
  });

  it('should render proposed task with expanded design doc and Show Less button', () => {
    const proposedTask = { 
      ...mockTask, 
      status: TaskStatus.PROPOSED,
      design_doc: '# Proposed Design'
    };
    const html = TaskItem.render(proposedTask as any);
    
    expect(html).toContain('Proposed Design');
    expect(html).toContain('design-doc-display');
    expect(html).toContain('expanded');
    expect(html).toContain('Show Less');
    expect(html).toContain('data-action-click="edit_design_doc"');
  });

  it('should render specification with Show More button by default', () => {
    const taskWithSpec = { 
      ...mockTask, 
      spec: 'My spec'
    };
    const html = TaskItem.render(taskWithSpec as any);
    
    expect(html).toContain('Specification');
    expect(html).toContain('spec-display');
    expect(html).not.toContain('spec-display expanded');
    expect(html).toContain('Show More');
    expect(html).toContain('data-action-click="toggle_spec_expand"');
  });
});
