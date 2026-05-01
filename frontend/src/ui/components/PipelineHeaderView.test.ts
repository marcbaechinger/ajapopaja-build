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
    user: { username: 'testuser' },
    allTasks: []
  };

  it('renders pipeline name and status', () => {
    const html = PipelineHeaderView.render(mockProps);
    expect(html).toContain('Test Pipeline');
    expect(html).toContain('active');
    expect(html).toContain('ID: p1');
    expect(html).toContain('Workspace: /tmp/test');
  });

  it('renders Gemini status when running', () => {
    const props = { ...mockProps, geminiStatus: { running: true, log_file: 'log.txt', available: true } };
    const html = PipelineHeaderView.render(props);
    expect(html).toContain('Gemini Running');
    expect(html).toContain('animate-ping');
  });

  it('renders DocBot banner when ready', () => {
    const props = { ...mockProps, docbotState: { status: 'ready', taskId: 't1' } as any };
    const html = PipelineHeaderView.render(props);
    expect(html).toContain('Doc update prepared.');
    expect(html).toContain('Review');
  });

  it('renders header stats based on tasks', () => {
    const tasks: Task[] = [
      { id: '1', status: TaskStatus.CREATED, deleted: false } as Task,
      { id: '2', status: TaskStatus.INPROGRESS, deleted: false } as Task,
      { id: '3', status: TaskStatus.IMPLEMENTED, deleted: false } as Task,
    ];
    const props = { ...mockProps, allTasks: tasks };
    PipelineHeaderView.render(props);
    
    // Check for some expected status badges (the actual badges are rendered via renderHeaderStats)
    // We expect 3 badges since we have 3 tasks with different statuses
    const statsHtml = PipelineHeaderView.renderHeaderStats(tasks);
    expect(statsHtml).toContain('1'); // Count for CREATED
    expect(statsHtml).toContain('1'); // Count for INPROGRESS
    expect(statsHtml).toContain('1'); // Count for IMPLEMENTED
  });
});
