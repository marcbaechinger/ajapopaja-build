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

import { describe, it, expect, afterEach } from 'vitest';
import { ExecutionEngineView } from './ExecutionEngineView.ts';
import { Task, TaskStatus } from '../../../core/domain.ts';

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
    expect(html).not.toContain('CoderBot Activity');
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

  describe('bucketFor()', () => {
    it('maps each status to its sidebar bucket', () => {
      expect(ExecutionEngineView.bucketFor(TaskStatus.INPROGRESS)).toBe('inprogress');
      expect(ExecutionEngineView.bucketFor(TaskStatus.SCHEDULED)).toBe('queue');
      expect(ExecutionEngineView.bucketFor(TaskStatus.IMPLEMENTED)).toBe('history');
      expect(ExecutionEngineView.bucketFor(TaskStatus.SUBMITTED)).toBe('history');
      expect(ExecutionEngineView.bucketFor(TaskStatus.DISCARDED)).toBe('history');
      expect(ExecutionEngineView.bucketFor(TaskStatus.CREATED)).toBe('none');
      expect(ExecutionEngineView.bucketFor(TaskStatus.PULL_REQUEST_AVAILABLE)).toBe('none');
    });
  });

  describe('reconcileTask()', () => {
    const mount = (tasks: Task[], historyTasks: Task[] = []) => {
      const container = document.createElement('div');
      container.id = 'execution-engine-view';
      container.innerHTML = ExecutionEngineView.render({ tasks, historyTasks, historyPage: 0 });
      document.body.appendChild(container);
      return container;
    };

    const idsIn = (container: Element, selector: string) =>
      Array.from(container.querySelectorAll(selector)).map((el) => el.getAttribute('data-view-id'));

    afterEach(() => {
      document.body.innerHTML = '';
    });

    it('replaces just the row in place for a same-bucket status change', () => {
      const task = makeTask({ id: 'p1', status: TaskStatus.INPROGRESS, title: 'Old title' });
      const container = mount([task, makeTask({ id: 'p2', status: TaskStatus.INPROGRESS })]);
      const mountEl = container.querySelector('#engine-piview-mount');
      const otherRow = container.querySelector('[data-view-id="p2"]');

      const updated = { ...task, title: 'New title' };
      const ok = ExecutionEngineView.reconcileTask(container, updated, TaskStatus.INPROGRESS);

      expect(ok).toBe(true);
      // The other row, the header count and the PiView mount survive.
      expect(container.querySelector('[data-view-id="p2"]')).toBe(otherRow);
      expect(container.querySelector('#engine-piview-mount')).toBe(mountEl);
      expect(container.querySelector('[data-engine-count="inprogress"]')!.textContent).toBe('2');
      expect(container.textContent).toContain('New title');
      expect(container.textContent).not.toContain('Old title');
    });

    it('updates a history row for a history->history accept (SUBMITTED -> IMPLEMENTED)', () => {
      const task = makeTask({ id: 'h1', status: TaskStatus.SUBMITTED, updated_at: '2026-02-01T00:00:00Z' });
      const container = mount([], [task]);
      const mountEl = container.querySelector('#engine-piview-mount');

      const updated = { ...task, status: TaskStatus.IMPLEMENTED };
      const ok = ExecutionEngineView.reconcileTask(container, updated, TaskStatus.SUBMITTED);

      expect(ok).toBe(true);
      expect(container.querySelector('#engine-piview-mount')).toBe(mountEl);
      expect(container.querySelectorAll('#completed-task-list [data-view-type="history"]').length).toBe(1);
      expect(container.querySelector('#completed-task-list [data-task-id="h1"]')!.textContent).toContain('implemented');
    });

    it('moves a queue task into in-progress in order and updates both counts', () => {
      const queued = makeTask({ id: 'q1', status: TaskStatus.SCHEDULED, order: 3 });
      const container = mount([
        makeTask({ id: 'p1', status: TaskStatus.INPROGRESS, order: 10 }),
        queued,
      ]);
      const mountEl = container.querySelector('#engine-piview-mount');

      const ok = ExecutionEngineView.reconcileTask(
        container,
        { ...queued, status: TaskStatus.INPROGRESS },
        TaskStatus.SCHEDULED
      );

      expect(ok).toBe(true);
      expect(idsIn(container, '[data-engine-section="inprogress"] [data-view-id]')).toEqual(['q1', 'p1']);
      expect(container.querySelector('[data-engine-count="inprogress"]')!.textContent).toBe('2');
      expect(container.querySelectorAll('[data-engine-section="queue"] [data-view-id]').length).toBe(0);
      expect(container.querySelector('[data-engine-count="queue"]')!.textContent).toBe('0');
      expect(container.querySelector('[data-engine-section="queue"]')!.textContent).toContain('Nothing scheduled.');
      expect(container.querySelector('#engine-piview-mount')).toBe(mountEl);
    });

    it('removes an in-progress task that moves to none and restores the empty state', () => {
      const container = mount([
        makeTask({ id: 'p1', status: TaskStatus.INPROGRESS }),
        makeTask({ id: 'p2', status: TaskStatus.INPROGRESS }),
      ]);
      const mountEl = container.querySelector('#engine-piview-mount');

      const ok = ExecutionEngineView.reconcileTask(
        container,
        makeTask({ id: 'p1', status: TaskStatus.PULL_REQUEST_AVAILABLE }),
        TaskStatus.INPROGRESS
      );

      expect(ok).toBe(true);
      expect(idsIn(container, '[data-engine-section="inprogress"] [data-view-id]')).toEqual(['p2']);
      expect(container.querySelector('[data-engine-count="inprogress"]')!.textContent).toBe('1');
      expect(container.querySelector('#engine-piview-mount')).toBe(mountEl);

      const ok2 = ExecutionEngineView.reconcileTask(
        container,
        makeTask({ id: 'p2', status: TaskStatus.PULL_REQUEST_AVAILABLE }),
        TaskStatus.INPROGRESS
      );
      expect(ok2).toBe(true);
      expect(container.querySelector('[data-engine-count="inprogress"]')!.textContent).toBe('0');
      expect(container.querySelector('[data-engine-section="inprogress"]')!.textContent).toContain('No active work.');
    });

    it('removes a history row on reject (history -> none)', () => {
      const task = makeTask({ id: 'h1', status: TaskStatus.SUBMITTED });
      const container = mount([], [task]);
      const mountEl = container.querySelector('#engine-piview-mount');

      const ok = ExecutionEngineView.reconcileTask(
        container,
        { ...task, status: TaskStatus.CREATED },
        TaskStatus.SUBMITTED
      );

      expect(ok).toBe(true);
      expect(container.querySelectorAll('#completed-task-list [data-view-type="history"]').length).toBe(0);
      expect(container.querySelector('#completed-task-list')!.textContent).toContain('No tasks completed yet.');
      expect(container.querySelector('#engine-piview-mount')).toBe(mountEl);
    });

    it('inserts a task into history by updated_at desc', () => {
      const container = mount([
        makeTask({ id: 'p1', status: TaskStatus.INPROGRESS, updated_at: '2026-04-01T00:00:00Z' }),
      ], [
        makeTask({ id: 'h2', status: TaskStatus.IMPLEMENTED, updated_at: '2026-03-01T00:00:00Z' }),
        makeTask({ id: 'h1', status: TaskStatus.IMPLEMENTED, updated_at: '2026-01-01T00:00:00Z' }),
      ]);

      const ok = ExecutionEngineView.reconcileTask(
        container,
        makeTask({ id: 'p1', status: TaskStatus.DISCARDED, updated_at: '2026-04-01T00:00:00Z' }),
        TaskStatus.INPROGRESS
      );

      expect(ok).toBe(true);
      expect(idsIn(container, '#completed-task-list [data-view-type="history"]')).toEqual(['p1', 'h2', 'h1']);
    });

    it('returns false (fallback) when the source row is missing', () => {
      const container = mount([makeTask({ id: 'p1', status: TaskStatus.INPROGRESS })]);

      const ok = ExecutionEngineView.reconcileTask(
        container,
        makeTask({ id: 'missing', status: TaskStatus.PULL_REQUEST_AVAILABLE }),
        TaskStatus.INPROGRESS
      );

      expect(ok).toBe(false);
    });

    it('returns false (fallback) when the layout is unknown', () => {
      const container = document.createElement('div');
      container.id = 'execution-engine-view';
      document.body.appendChild(container);

      const ok = ExecutionEngineView.reconcileTask(
        container,
        makeTask({ id: 'p1', status: TaskStatus.PULL_REQUEST_AVAILABLE }),
        TaskStatus.INPROGRESS
      );

      expect(ok).toBe(false);
    });

    it('returns false when the source bucket itself is none', () => {
      const container = mount([]);

      const ok = ExecutionEngineView.reconcileTask(
        container,
        makeTask({ id: 'p1', status: TaskStatus.SCHEDULED }),
        TaskStatus.CREATED
      );

      expect(ok).toBe(false);
    });
  });
});
