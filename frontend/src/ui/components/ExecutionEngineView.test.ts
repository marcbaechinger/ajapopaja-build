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
import { ExecutionEngineView } from './ExecutionEngineView.ts';
import { Task, TaskStatus } from '../../core/domain.ts';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: overrides.id || 'task-1',
    title: 'A task',
    spec: 'Spec',
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

describe('ExecutionEngineView', () => {
  it('should render the In Progress and Queue sections (no Failed section)', () => {
    const html = ExecutionEngineView.render({ tasks: [
      makeTask({ id: 'p', status: TaskStatus.INPROGRESS }),
      makeTask({ id: 'q', status: TaskStatus.SCHEDULED }),
      makeTask({ id: 'f', status: TaskStatus.FAILED }),
    ] });
    expect(html).toContain('In Progress');
    expect(html).toContain('Queue');
    expect(html).not.toContain('Failed');
    expect(html).toContain('data-view-id="p"');
    expect(html).toContain('data-view-id="q"');
    expect(html).not.toContain('data-view-id="f"');
  });

  it('should sort tasks within a section by execution order', () => {
    const html = ExecutionEngineView.render({ tasks: [
      makeTask({ id: 'b', status: TaskStatus.SCHEDULED, order: 10 }),
      makeTask({ id: 'a', status: TaskStatus.SCHEDULED, order: 1 }),
    ] });
    expect(html.indexOf('data-view-id="a"')).toBeLessThan(html.indexOf('data-view-id="b"'));
  });

  it('should ignore tasks that are not engine states', () => {
    const html = ExecutionEngineView.render({ tasks: [
      makeTask({ id: 'c', status: TaskStatus.CREATED }),
      makeTask({ id: 'q', status: TaskStatus.SCHEDULED }),
    ] });
    expect(html).toContain('data-view-id="q"');
    expect(html).not.toContain('data-view-id="c"');
  });

  it('should render empty states when no tasks exist', () => {
    const html = ExecutionEngineView.render({ tasks: [] });
    expect(html).toContain('No active work.');
    expect(html).toContain('Nothing scheduled.');
    expect(html).not.toContain('No failed tasks.');
  });

  it('should show the task count in each section header', () => {
    const html = ExecutionEngineView.render({ tasks: [
      makeTask({ id: 'p1', status: TaskStatus.INPROGRESS }),
      makeTask({ id: 'p2', status: TaskStatus.INPROGRESS }),
      makeTask({ id: 'q1', status: TaskStatus.SCHEDULED }),
    ] });
    // one count chip per section (section chips use a distinct muted style)
    expect((html.match(/bg-app-surface border border-app-border rounded-full/g) || []).length).toBe(2);
  });

  it('should include a CoderBot PiView mount between In Progress and Queue', () => {
    const html = ExecutionEngineView.render({ tasks: [
      makeTask({ id: 'p', status: TaskStatus.INPROGRESS }),
      makeTask({ id: 'q', status: TaskStatus.SCHEDULED }),
    ] });
    const inProgIdx = html.indexOf('In Progress');
    const mountIdx = html.indexOf('engine-piview-mount');
    const queueIdx = html.indexOf('>Queue<');
    expect(mountIdx).toBeGreaterThan(-1);
    expect(mountIdx).toBeGreaterThan(inProgIdx);
    expect(mountIdx).toBeLessThan(queueIdx);
    expect(html).toContain('CoderBot Activity');
    expect(html).toContain('Start a CoderBot to see its output here.');
  });

  it('should ignore deleted tasks', () => {
    const html = ExecutionEngineView.render({ tasks: [makeTask({ status: TaskStatus.SCHEDULED, deleted: true })] });
    expect(html).toContain('Nothing scheduled.');
  });

  it('should render the PipelineHistoryView at the bottom when history tasks are provided', () => {
    const html = ExecutionEngineView.render({
      tasks: [makeTask({ id: 'q', status: TaskStatus.SCHEDULED })],
      historyTasks: [makeTask({ id: 'h1', status: TaskStatus.IMPLEMENTED, title: 'Done Task' })],
      historyPage: 0,
    });
    expect(html).toContain('History Feed');
    expect(html).toContain('Done Task');
    expect(html).toContain('sidebar-history');
    // History comes after the engine sections (Queue) at the bottom.
    expect(html.indexOf('sidebar-history')).toBeGreaterThan(html.indexOf('>Queue<'));
    expect(html).toContain('overflow-hidden');
    // Failed section has been removed, so history comes after Queue.
    expect(html).not.toContain('Failed');
  });

  it('should scroll the queue list within a bounded max-height container', () => {
    const html = ExecutionEngineView.render({ tasks: [
      makeTask({ id: 'q1', status: TaskStatus.SCHEDULED }),
      makeTask({ id: 'q2', status: TaskStatus.SCHEDULED }),
      makeTask({ id: 'q3', status: TaskStatus.SCHEDULED }),
    ] });
    expect(html).toContain('max-h-48');
    expect(html).toContain('overflow-y-auto');
    expect(html).toContain('data-view-id="q1"');
    expect(html).toContain('data-view-id="q2"');
    expect(html).toContain('data-view-id="q3"');
  });
});
