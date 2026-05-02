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
import { PipelineHeaderView } from './PipelineHeaderView';
import type { PipelineHeaderViewProps } from './PipelineHeaderView';
import { Pipeline, Task, TaskStatus, PipelineStatus } from '../../core/domain';

describe('PipelineHeaderView', () => {
  const mockPipeline: Pipeline = {
    id: 'p1',
    name: 'Test Pipeline',
    status: PipelineStatus.ACTIVE,
    workspace_path: '/tmp/test',
    version: 1
  } as Pipeline;

  const mockProps: PipelineHeaderViewProps = {
    pipeline: mockPipeline,
    pipelineId: 'p1',
    geminiStatus: { running: false, log_file: null, available: true },
    vibeStatus: { running: false, log_file: null, available: true },
    docbotState: { status: 'none', taskId: null },
    reviewbotState: { status: 'none', taskId: null },
    user: { username: 'testuser' },
    allTasks: []
  };

  it('renders pipeline name and status', () => {
    const html = PipelineHeaderView.render(mockProps);
    expect(html).toContain('Test Pipeline');
    expect(html).toContain('active');
    expect(html).toContain('ID: p1');
    expect(html).toContain('Workspace: /tmp/test');
    expect(html).toContain('Stats');
    expect(html).toContain('testuser');
    expect(html).toContain('Logged In');
  });

  it('contains tool actions', () => {
    const html = PipelineHeaderView.render(mockProps);
    expect(html).toContain("data-action-click=\"open_search\"")
    expect(html).toContain("data-action-click=\"open_stats\"")
    expect(html).toContain("data-action-click=\"toggle_assistant\"")
    expect(html).toContain("data-action-click=\"perform_logout\"")
    expect(html).toContain("data-action-click=\"open_health_check\"")
  });

  it('renders Gemini status when running', () => {
    const props = { ...mockProps, geminiStatus: { running: true, log_file: 'log.txt', available: true } };
    const html = PipelineHeaderView.render(props);
    expect(html).toContain('Gemini Running');
    expect(html).toContain('animate-ping');
  });

  it('renders Vibe status when running', () => {
    const props = { ...mockProps, vibeStatus: { running: true, log_file: 'log.txt', available: true } };
    const html = PipelineHeaderView.render(props);
    expect(html).toContain('Vibe Running');
    expect(html).toContain('animate-ping');
  });

  it('renders DocBot banner when ready', () => {
    const props = { ...mockProps, docbotState: { status: 'ready', taskId: 't1' } as any };
    const html = PipelineHeaderView.render(props);
    expect(html).toContain('Doc Ready');
    expect(html).toContain('Review');
  });

  it('renders header stats for created', () => {
    const tasks: Task[] = [
      { id: '1', status: TaskStatus.CREATED, deleted: false } as Task,
      { id: '11', status: TaskStatus.CREATED, deleted: false } as Task,
    ];
    const props = { ...mockProps, allTasks: tasks };
    PipelineHeaderView.render(props);

    const statsHtml = PipelineHeaderView.renderHeaderStats(tasks);
    expect(statsHtml).toContain('title="created"');
    expect(statsHtml).not.toContain('title="inprogress"');
    expect(statsHtml).not.toContain('title="scheduled"');
    expect(statsHtml).not.toContain('title="proposed"');
    expect(statsHtml).not.toContain('title="implemented"');
    expect(statsHtml).not.toContain('title="discarded"');
    expect(statsHtml).toContain('2'); // Count 
  });

  it('renders header stats for scheduled', () => {
    const tasks: Task[] = [
      { id: '1', status: TaskStatus.SCHEDULED, deleted: false } as Task,
      { id: '11', status: TaskStatus.SCHEDULED, deleted: false } as Task,
      { id: '111', status: TaskStatus.SCHEDULED, deleted: false } as Task,
    ];
    const props = { ...mockProps, allTasks: tasks };
    PipelineHeaderView.render(props);

    const statsHtml = PipelineHeaderView.renderHeaderStats(tasks);
    expect(statsHtml).not.toContain('title="created"');
    expect(statsHtml).not.toContain('title="inprogress"');
    expect(statsHtml).toContain('title="scheduled"');
    expect(statsHtml).not.toContain('title="proposed"');
    expect(statsHtml).not.toContain('title="implemented"');
    expect(statsHtml).not.toContain('title="discarded"');
    expect(statsHtml).toContain('3'); // Count 
  });

  it('renders header stats for inprogress', () => {
    const tasks: Task[] = [
      { id: '1', status: TaskStatus.INPROGRESS, deleted: false } as Task,
      { id: '11', status: TaskStatus.INPROGRESS, deleted: false } as Task,
      { id: '111', status: TaskStatus.INPROGRESS, deleted: false } as Task,
    ];
    const props = { ...mockProps, allTasks: tasks };
    PipelineHeaderView.render(props);

    const statsHtml = PipelineHeaderView.renderHeaderStats(tasks);
    expect(statsHtml).not.toContain('title="created"');
    expect(statsHtml).toContain('title="inprogress"');
    expect(statsHtml).not.toContain('title="scheduled"');
    expect(statsHtml).not.toContain('title="proposed"');
    expect(statsHtml).not.toContain('title="implemented"');
    expect(statsHtml).not.toContain('title="discarded"');
    expect(statsHtml).toContain('3'); // Count 
  });

  it('renders header stats for proposed and implemented', () => {
    const tasks: Task[] = [
      { id: '1', status: TaskStatus.PROPOSED, deleted: false } as Task,
      { id: '11', status: TaskStatus.PROPOSED, deleted: false } as Task,
      { id: '111', status: TaskStatus.PROPOSED, deleted: false } as Task,
      { id: '21', status: TaskStatus.IMPLEMENTED, deleted: false } as Task,
      { id: '221', status: TaskStatus.IMPLEMENTED, deleted: false } as Task,
      { id: '222', status: TaskStatus.IMPLEMENTED, deleted: false } as Task,
      { id: '2222', status: TaskStatus.IMPLEMENTED, deleted: false } as Task,
    ];
    const props = { ...mockProps, allTasks: tasks };
    PipelineHeaderView.render(props);

    const statsHtml = PipelineHeaderView.renderHeaderStats(tasks);
    expect(statsHtml).not.toContain('title="created"');
    expect(statsHtml).not.toContain('title="inprogress"');
    expect(statsHtml).not.toContain('title="scheduled"');
    expect(statsHtml).toContain('title="proposed"');
    expect(statsHtml).toContain('title="implemented"');
    expect(statsHtml).not.toContain('title="discarded"');
    expect(statsHtml).toContain('3'); // Count 
    expect(statsHtml).toContain('4'); // Count 
  });
});
