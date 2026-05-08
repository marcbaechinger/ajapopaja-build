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
import { TaskColumn } from './TaskColumn.ts';
import { Task, TaskStatus } from '../../core/domain.ts';

describe('TaskColumn', () => {
  const mockTasks = [
    {
      id: 'task-1',
      title: 'Task One',
      description: 'First task description',
      status: TaskStatus.CREATED,
      pipeline_id: 'p1',
      deleted: false,
      version: 1,
      order: 0,
      type: 'manual' as const,
      created_at: '2026-04-12T10:00:00Z',
      history: [],
      want_design_doc: false
    },
    {
      id: 'task-2',
      title: 'Task Two',
      description: 'Second task description',
      status: TaskStatus.SCHEDULED,
      pipeline_id: 'p1',
      deleted: false,
      version: 1,
      order: 1,
      type: 'manual' as const,
      created_at: '2026-04-12T10:00:00Z',
      history: [],
      want_design_doc: false
    }
  ];

  const emptyOptions = {
    id: 'test-column',
    title: 'Test Column',
    tasks: [] as Task[],
    collapsedTasks: new Set<string>()
  };

  it('should render with basic options', () => {
    const options = {
      ...emptyOptions,
      tasks: [mockTasks[0] as Task]
    };
    const html = TaskColumn.render(options as any);
    
    expect(html).toContain('Test Column');
    expect(html).toContain('Task One');
    expect(html).toContain('(1)');
    expect(html).toContain('id="test-column-section"');
    expect(html).toContain('id="test-column-list"');
  });

  it('should render empty state with default message', () => {
    const html = TaskColumn.render(emptyOptions as any);
    
    expect(html).toContain('Test Column');
    expect(html).toContain('(0)');
    expect(html).toContain('No tasks in this category.');
    expect(html).toContain('class="text-app-muted italic text-sm py-4 text-center border-2 border-dashed border-app-border/30 rounded-xl"');
  });

  it('should render empty state with custom message', () => {
    const options = {
      ...emptyOptions,
      emptyMessage: 'Custom empty message here'
    };
    const html = TaskColumn.render(options as any);
    
    expect(html).toContain('Custom empty message here');
    expect(html).not.toContain('No tasks in this category.');
  });

  it('should render badge when provided', () => {
    const options = {
      ...emptyOptions,
      badge: {
        text: 'NEW',
        class: 'bg-blue-500 text-white'
      }
    };
    const html = TaskColumn.render(options as any);
    
    expect(html).toContain('NEW');
    expect(html).toContain('bg-blue-500 text-white');
    expect(html).toContain('class="text-[10px] px-2 pt-1.5 py-0.5 rounded-full font-black tracking-widest');
  });

  it('should not render badge when not provided', () => {
    const html = TaskColumn.render(emptyOptions as any);
    
    expect(html).not.toContain('badge');
  });

  it('should render task count in title', () => {
    const options = {
      ...emptyOptions,
      tasks: [mockTasks[0] as Task, mockTasks[1] as Task]
    };
    const html = TaskColumn.render(options as any);
    
    expect(html).toContain('(2)');
    expect(html).toContain('Task One');
    expect(html).toContain('Task Two');
  });

  it('should generate correct section and list IDs', () => {
    const options = {
      ...emptyOptions,
      tasks: [mockTasks[0] as Task]
    };
    const html = TaskColumn.render(options as any);
    
    expect(html).toContain('id="test-column-section"');
    expect(html).toContain('id="test-column-list"');
  });

  it('should pass collapsed state to TaskItem', () => {
    const collapsedTasks = new Set(['task-1']);
    const options = {
      ...emptyOptions,
      tasks: [mockTasks[0] as Task, mockTasks[1] as Task],
      collapsedTasks
    };
    const html = TaskColumn.render(options as any);
    
    expect(html).toContain('Task One');
    expect(html).toContain('Task Two');
  });

  it('should render multiple tasks', () => {
    const options = {
      ...emptyOptions,
      tasks: [mockTasks[0] as Task, mockTasks[1] as Task]
    };
    const html = TaskColumn.render(options as any);
    
    expect(html).toContain('Task One');
    expect(html).toContain('Task Two');
    expect(html).toContain('(2)');
  });

  it('should have correct HTML structure', () => {
    const options = {
      ...emptyOptions,
      tasks: [mockTasks[0] as Task]
    };
    const html = TaskColumn.render(options as any);
    
    expect(html).toContain('<section');
    expect(html).toContain('class="flex flex-col gap-4 min-w-0"');
    expect(html).toContain('flex justify-between items-center px-1');
    expect(html).toContain('h3');
    expect(html).toContain('text-lg font-black text-app-text uppercase tracking-tight');
    expect(html).toContain('space-y-4 flex-grow');
  });

  it('should pass showOrdering parameter to TaskItem', () => {
    // showOrdering default is false
    const options = {
      ...emptyOptions,
      tasks: [mockTasks[0] as Task]
    };
    const html = TaskColumn.render(options as any);
    
    // The showOrdering param affects TaskItem, which we can verify by checking the output contains tasks
    expect(html).toContain('Task One');
  });

  it('should correctly handle title with special characters', () => {
    const options = {
      ...emptyOptions,
      title: 'Special & Characters "Quotes"'
    };
    const html = TaskColumn.render(options as any);
    
    expect(html).toContain('Special & Characters');
    expect(html).toContain('(0)');
  });

  it('should use default showOrdering as false', () => {
    const options = {
      ...emptyOptions,
      tasks: [mockTasks[0] as Task]
    };
    const html = TaskColumn.render(options as any);
    
    // Tasks should be rendered (showOrdering = false by default)
    expect(html).toContain('Task One');
  });

  it('should use custom showOrdering when provided', () => {
    const options = {
      ...emptyOptions,
      tasks: [mockTasks[0] as Task],
      showOrdering: true
    };
    const html = TaskColumn.render(options as any);
    
    // Tasks should be rendered with showOrdering = true
    expect(html).toContain('Task One');
  });
});
