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
import { PipelineItemView } from './PipelineItemView';
import { Pipeline, PipelineStatus, Task, TaskStatus } from '../../../core/domain';

function makeContext(): any {
  return { taskClient: {} };
}

const pipeline = new Pipeline({
  id: 'p1',
  name: 'Test Pipe',
  status: PipelineStatus.ACTIVE,
  version: 2,
});

const statsTasks = [new Task({ id: 't1', title: 'Stats Task', status: TaskStatus.IMPLEMENTED })];

/// Builds a Task with an updated_at offset seconds from now.
function taskAt(secondsAgo: number, opts: Partial<{ id: string; title: string; status: TaskStatus; deleted: boolean }> = {}): Task {
  return new Task({
    id: opts.id || `t${secondsAgo}`,
    title: opts.title || `Task ${secondsAgo}`,
    status: opts.status || TaskStatus.IMPLEMENTED,
    deleted: opts.deleted || false,
    updated_at: new Date(Date.now() - secondsAgo * 1000).toISOString(),
  });
}

describe('PipelineItemView', () => {
  it('renders pipeline name, version, status pill, delete button and preserved data-attributes', () => {
    const item = new PipelineItemView({ pipeline, statsTasks, context: makeContext() });
    const html = item.render();

    expect(html).toContain('Test Pipe');
    expect(html).toContain('Version 2');
    expect(html).toMatch(/>\s*active\s*</);
    expect(html).toContain('data-action-click="delete_pipeline"');
    expect(html).toContain('data-view-type="pipeline"');
    expect(html).toContain('data-view-id="p1"');
    expect(html).toContain('data-action-click="view_pipeline"');
  });

  it('includes a compact stats section and a side-by-side Recently Implemented cell', () => {
    const item = new PipelineItemView({ pipeline, statsTasks, context: makeContext() });
    const html = item.render();

    expect(html).toContain('Recently Implemented');
    expect(html).toContain('id="recent-tasks-p1"');
    // The panel is a single row: general info/stats in the left cell, recent
    // tasks in the right cell on the same grid line.
    expect(html).toContain('grid-cols-1 lg:grid-cols-2');
    expect(html).toContain('Loading recent tasks...');
  });

  it('injects the most recent completed tasks into the placeholder, including the newest one', async () => {
    // Two completed tasks in the full task set: the newest must be shown too.
    const tasks = [
      taskAt(60, { id: 'old', title: 'Older task' }),
      taskAt(10, { id: 'new', title: 'Newest task' }),
      taskAt(5, { id: 'inprogress', title: 'In progress', status: TaskStatus.INPROGRESS }),
      taskAt(3, { id: 'deleted', title: 'Deleted task', deleted: true }),
    ];
    const item = new PipelineItemView({ pipeline, statsTasks: tasks, context: makeContext() });

    const host = document.createElement('div');
    host.innerHTML = item.render();
    const placeholder = host.querySelector('#recent-tasks-p1') as HTMLElement;
    item.bind(placeholder);

    await item.loadRecentTasks();

    // Newest task first; in-progress and deleted tasks are excluded.
    expect(placeholder.innerHTML).toContain('Newest task');
    expect(placeholder.innerHTML).toContain('Older task');
    expect(placeholder.innerHTML.indexOf('Newest task')).toBeLessThan(placeholder.innerHTML.indexOf('Older task'));
    expect(placeholder.innerHTML).not.toContain('In progress');
    expect(placeholder.innerHTML).not.toContain('Deleted task');
  });

  it('caps the recent list at 5 tasks', async () => {
    const tasks = Array.from({ length: 7 }, (_, i) => taskAt(i * 10, { title: `Task ${i}` }));
    const item = new PipelineItemView({ pipeline, statsTasks: tasks, context: makeContext() });

    const host = document.createElement('div');
    host.innerHTML = item.render();
    const placeholder = host.querySelector('#recent-tasks-p1') as HTMLElement;
    item.bind(placeholder);

    await item.loadRecentTasks();

    const rows = placeholder.querySelectorAll('li').length;
    expect(rows).toBe(5);
  });

  it('renders empty state when no tasks are completed yet', async () => {
    const tasks = [taskAt(5, { title: 'Not done', status: TaskStatus.INPROGRESS })];
    const item = new PipelineItemView({ pipeline, statsTasks: tasks, context: makeContext() });

    const host = document.createElement('div');
    host.innerHTML = item.render();
    const placeholder = host.querySelector('#recent-tasks-p1') as HTMLElement;
    item.bind(placeholder);

    await item.loadRecentTasks();
    expect(placeholder.innerHTML).toContain('No implemented tasks yet.');
  });

  it('no-ops gracefully when loadRecentTasks is called without a pipeline id', async () => {
    const noId = new Pipeline({ name: 'No id', status: PipelineStatus.ACTIVE, version: 1 });
    const item = new PipelineItemView({
      pipeline: noId,
      statsTasks: [taskAt(1, { title: 'Done', status: TaskStatus.IMPLEMENTED })],
      context: makeContext(),
    });

    const host = document.createElement('div');
    host.innerHTML = item.render();

    await expect(item.loadRecentTasks()).resolves.toBeUndefined();
    // No pipeline id -> recent tasks are not derived; the placeholder stays untouched.
    const placeholder = host.querySelector('#recent-tasks-unknown');
    expect(placeholder).not.toBeNull();
    expect(placeholder!.innerHTML).toContain('Loading recent tasks...');
    expect(placeholder!.innerHTML).not.toContain('Done');
  });
});
