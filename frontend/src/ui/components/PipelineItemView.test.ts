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

import { describe, it, expect, vi } from 'vitest';
import { PipelineItemView } from './PipelineItemView';
import { Pipeline, PipelineStatus, Task, TaskStatus } from '../../core/domain';

function makeContext(listCompletedByPipeline = vi.fn()): any {
  return { taskClient: { listCompletedByPipeline } };
}

const pipeline = new Pipeline({
  id: 'p1',
  name: 'Test Pipe',
  status: PipelineStatus.ACTIVE,
  version: 2,
});

const statsTasks = [new Task({ id: 't1', title: 'Stats Task', status: TaskStatus.IMPLEMENTED })];

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

  it('includes a compact stats section and a Recently Implemented collapsible placeholder', () => {
    const item = new PipelineItemView({ pipeline, statsTasks, context: makeContext() });
    const html = item.render();

    expect(html).toContain('Recently Implemented');
    expect(html).toContain('id="recent-tasks-p1"');
    expect(html).toContain('<details');
    expect(html).toContain('Loading recent tasks...');
  });

  it('loadRecentTasks calls taskClient.listCompletedByPipeline with id, page 0 and limit 5', async () => {
    const listCompleted = vi.fn().mockResolvedValue({ tasks: [], total_count: 0 });
    const item = new PipelineItemView({ pipeline, statsTasks: [], context: makeContext(listCompleted) });
    await item.loadRecentTasks();

    expect(listCompleted).toHaveBeenCalledWith('p1', 0, 5);
  });

  it('injects task summaries into the placeholder container on success', async () => {
    const tasks = [
      new Task({ id: 't1', title: 'Fix bug', status: TaskStatus.IMPLEMENTED, updated_at: new Date().toISOString() }),
      new Task({ id: 't2', title: 'Add tests', status: TaskStatus.IMPLEMENTED, updated_at: new Date().toISOString() }),
    ];
    const listCompleted = vi.fn().mockResolvedValue({ tasks, total_count: tasks.length });
    const item = new PipelineItemView({ pipeline, statsTasks: [], context: makeContext(listCompleted) });

    const host = document.createElement('div');
    host.innerHTML = item.render();
    const placeholder = host.querySelector('#recent-tasks-p1') as HTMLElement;
    item.bind(placeholder);

    await item.loadRecentTasks();

    expect(placeholder.innerHTML).toContain('Fix bug');
    expect(placeholder.innerHTML).toContain('Add tests');
    expect(placeholder.innerHTML).toContain('implemented');
  });

  it('renders an unavailable fallback without throwing on fetch error', async () => {
    const listCompleted = vi.fn().mockRejectedValue(new Error('boom'));
    const item = new PipelineItemView({ pipeline, statsTasks: [], context: makeContext(listCompleted) });

    const host = document.createElement('div');
    host.innerHTML = item.render();
    const placeholder = host.querySelector('#recent-tasks-p1') as HTMLElement;
    item.bind(placeholder);

    await expect(item.loadRecentTasks()).resolves.toBeUndefined();
    expect(placeholder.innerHTML).toContain('unavailable');
  });

  it('renders empty state when no tasks are completed yet', async () => {
    const listCompleted = vi.fn().mockResolvedValue({ tasks: [], total_count: 0 });
    const item = new PipelineItemView({ pipeline, statsTasks: [], context: makeContext(listCompleted) });

    const host = document.createElement('div');
    host.innerHTML = item.render();
    const placeholder = host.querySelector('#recent-tasks-p1') as HTMLElement;
    item.bind(placeholder);

    await item.loadRecentTasks();
    expect(placeholder.innerHTML).toContain('No implemented tasks yet.');
  });

  it('no-ops gracefully when loadRecentTasks is called without a pipeline id', async () => {
    const listCompleted = vi.fn();
    const noId = new Pipeline({ name: 'No id', status: PipelineStatus.ACTIVE, version: 1 });
    const item = new PipelineItemView({ pipeline: noId, statsTasks: [], context: makeContext(listCompleted) });

    await item.loadRecentTasks();
    expect(listCompleted).not.toHaveBeenCalled();
  });
});
