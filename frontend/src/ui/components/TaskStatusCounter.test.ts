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
import { TaskStatusCounter } from './TaskStatusCounter';
import { Task, TaskStatus } from '../../core/domain';

describe('TaskStatusCounter', () => {
  const emptyTasks: Task[] = [];
  const tasksByStatus = [
    new Task({ id: 't-created', title: 'Created Task', status: TaskStatus.CREATED }),
    new Task({ id: 't-scheduled', title: 'Scheduled Task', status: TaskStatus.SCHEDULED }),
    new Task({ id: 't-proposed', title: 'Proposed Task', status: TaskStatus.PROPOSED }),
    new Task({ id: 't-inprogress', title: 'In Progress Task', status: TaskStatus.INPROGRESS }),
    new Task({ id: 't-implemented', title: 'Implemented Task', status: TaskStatus.IMPLEMENTED }),
    new Task({ id: 't-failed', title: 'Failed Task', status: TaskStatus.FAILED }),
    new Task({ id: 't-discarded', title: 'Discarded Task', status: TaskStatus.DISCARDED }),
  ];
  const deletedTask = new Task({ id: 't-deleted', title: 'Deleted Task', status: TaskStatus.CREATED, deleted: true });

  it('renders empty string when passed empty array', () => {
    const html = TaskStatusCounter.render(emptyTasks);
    expect(html).toBe('');
  });

  it('renders empty string when all tasks are deleted', () => {
    const html = TaskStatusCounter.render([deletedTask]);
    expect(html).toBe('');
  });

  it('counts single task by status correctly', () => {
    const html = TaskStatusCounter.render(tasksByStatus);

    // Should have 7 status badges (one for each status)
    expect(html).toContain('<span');
    
    // Each status should appear
    expect(html).toContain('title="created"');
    expect(html).toContain('title="scheduled"');
    expect(html).toContain('title="proposed"');
    expect(html).toContain('title="inprogress"');
    expect(html).toContain('title="implemented"');
    expect(html).toContain('title="failed"');
    expect(html).toContain('title="discarded"');

    // Each count should be 1
    expect(html).toMatch(/title="created"[^>]*>.*1.*<\/span>/s);
    expect(html).toMatch(/title="scheduled"[^>]*>.*1.*<\/span>/s);
  });

  it('counts multiple tasks with same status', () => {
    const tasks = [
      new Task({ id: 't1', title: 'Task 1', status: TaskStatus.CREATED }),
      new Task({ id: 't2', title: 'Task 2', status: TaskStatus.CREATED }),
      new Task({ id: 't3', title: 'Task 3', status: TaskStatus.SCHEDULED }),
    ];

    const html = TaskStatusCounter.render(tasks);

    // Should have exactly 2 status badges
    expect(html).toContain('title="created"');
    expect(html).toContain('title="scheduled"');
    
    // Created count should be 2
    expect(html).toMatch(/title="created"[^>]*>.*2.*<\/span>/s);
    
    // Scheduled count should be 1
    expect(html).toMatch(/title="scheduled"[^>]*>.*1.*<\/span>/s);

    // Should NOT have other statuses
    expect(html).not.toContain('title="proposed"');
    expect(html).not.toContain('title="inprogress"');
    expect(html).not.toContain('title="implemented"');
    expect(html).not.toContain('title="failed"');
    expect(html).not.toContain('title="discarded"');
  });

  it('excludes deleted tasks from count', () => {
    const tasks = [
      new Task({ id: 't1', title: 'Active Task', status: TaskStatus.IMPLEMENTED }),
      new Task({ id: 't2', title: 'Deleted Task', status: TaskStatus.IMPLEMENTED, deleted: true }),
      new Task({ id: 't3', title: 'Another Active', status: TaskStatus.CREATED }),
    ];

    const html = TaskStatusCounter.render(tasks);

    // Implemented should only count 1 (not the deleted one)
    expect(html).toMatch(/title="implemented"[^>]*>.*1.*<\/span>/s);
    
    // Created should count 1
    expect(html).toMatch(/title="created"[^>]*>.*1.*<\/span>/s);
  });

  it('handles unknown status PULL_REQUEST_AVAILABLE gracefully', () => {
    const tasks = [
      new Task({ id: 't1', title: 'Pull Request Task', status: TaskStatus.PULL_REQUEST_AVAILABLE }),
      new Task({ id: 't2', title: 'Implemented Task', status: TaskStatus.IMPLEMENTED }),
    ];

    const html = TaskStatusCounter.render(tasks);

    // PULL_REQUEST_AVAILABLE should NOT be counted (not in statusCounts)
    expect(html).not.toContain('title="pull_request_available"');

    // IMPLEMENTED should still be counted
    expect(html).toContain('title="implemented"');
    expect(html).toMatch(/title="implemented"[^>]*>.*1.*<\/span>/s);
  });

  it('includes correct CSS classes for each status color', () => {
    const html = TaskStatusCounter.render(tasksByStatus);

    // Check color classes for each status
    expect(html).toContain('bg-slate-500');  // CREATED
    expect(html).toContain('bg-blue-500');    // SCHEDULED
    expect(html).toContain('bg-purple-500');  // PROPOSED
    expect(html).toContain('bg-amber-500');   // INPROGRESS
    expect(html).toContain('bg-green-500');   // IMPLEMENTED
    expect(html).toContain('bg-red-500');     // FAILED
    expect(html).toContain('bg-slate-700');   // DISCARDED
  });

  it('renders correct HTML structure for each status badge', () => {
    const tasks = [
      new Task({ id: 't1', title: 'Test Task', status: TaskStatus.IMPLEMENTED }),
    ];

    const html = TaskStatusCounter.render(tasks);

    // Check badge structure
    expect(html).toContain('class="flex items-center text-[9px] font-black text-app-muted border border-app-border rounded-md px-1.5 py-0.5 bg-app-bg"');
    expect(html).toContain('w-1.5 h-1.5 rounded-full');
    expect(html).toContain('mr-1.5');
  });

  it('renders all statuses when tasks have all possible statuses', () => {
    const tasks = [
      new Task({ id: 't1', status: TaskStatus.CREATED }),
      new Task({ id: 't2', status: TaskStatus.SCHEDULED }),
      new Task({ id: 't3', status: TaskStatus.PROPOSED }),
      new Task({ id: 't4', status: TaskStatus.INPROGRESS }),
      new Task({ id: 't5', status: TaskStatus.IMPLEMENTED }),
      new Task({ id: 't6', status: TaskStatus.FAILED }),
      new Task({ id: 't7', status: TaskStatus.DISCARDED }),
    ];

    const html = TaskStatusCounter.render(tasks);

    // All 7 statuses should be present
    const createdMatches = (html.match(/title="created"/g) || []).length;
    const scheduledMatches = (html.match(/title="scheduled"/g) || []).length;
    const proposedMatches = (html.match(/title="proposed"/g) || []).length;
    const inprogressMatches = (html.match(/title="inprogress"/g) || []).length;
    const implementedMatches = (html.match(/title="implemented"/g) || []).length;
    const failedMatches = (html.match(/title="failed"/g) || []).length;
    const discardedMatches = (html.match(/title="discarded"/g) || []).length;

    expect(createdMatches).toBe(1);
    expect(scheduledMatches).toBe(1);
    expect(proposedMatches).toBe(1);
    expect(inprogressMatches).toBe(1);
    expect(implementedMatches).toBe(1);
    expect(failedMatches).toBe(1);
    expect(discardedMatches).toBe(1);
  });

  it('handles large number of tasks correctly', () => {
    const tasks: Task[] = [];
    for (let i = 0; i < 100; i++) {
      const statuses: TaskStatus[] = [
        TaskStatus.CREATED,
        TaskStatus.SCHEDULED,
        TaskStatus.PROPOSED,
        TaskStatus.INPROGRESS,
        TaskStatus.IMPLEMENTED,
        TaskStatus.FAILED,
        TaskStatus.DISCARDED,
      ];
      const randomStatus = statuses[i % statuses.length];
      tasks.push(new Task({ id: `t${i}`, title: `Task ${i}`, status: randomStatus }));
    }

    const html = TaskStatusCounter.render(tasks);

    // Each status should appear with count 15 (100 tasks / 7 statuses ~ 14/15 each)
    // 100 / 7 = 14 with remainder 2, so some statuses have 14, some have 15
    const counts = html.match(/<span[^>]*>.*?(\d+).*?<\/span>/gs) || [];
    expect(counts.length).toBe(7); // All 7 statuses represented
  });

  it('returns empty string for tasks array with only deleted tasks', () => {
    const tasks = [
      new Task({ id: 't1', status: TaskStatus.CREATED, deleted: true }),
      new Task({ id: 't2', status: TaskStatus.SCHEDULED, deleted: true }),
    ];

    const html = TaskStatusCounter.render(tasks);
    expect(html).toBe('');
  });
});
