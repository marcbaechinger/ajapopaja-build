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
import { BacklogView } from './BacklogView.ts';
import { Task, TaskStatus } from '../../../core/domain.ts';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: overrides.id || 'task-1',
    title: 'A task',
    spec: 'Spec',
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

describe('BacklogView', () => {
  it('should render PROPOSED, CREATED and Queue sections', () => {
    const html = BacklogView.render({ tasks: [makeTask()] });
    expect(html).toContain('Proposed');
    expect(html).toContain('Backlog');
    expect(html).toContain('Queue');
  });

  it('should place the PROPOSED section above the CREATED and Queue sections', () => {
    const html = BacklogView.render({ tasks: [makeTask()] });
    const proposedIdx = html.indexOf('Proposed');
    const backlogIdx = html.indexOf('Backlog');
    const queueIdx = html.indexOf('>Queue<');
    expect(proposedIdx).toBeGreaterThan(-1);
    expect(backlogIdx).toBeGreaterThan(proposedIdx);
    expect(queueIdx).toBeGreaterThan(backlogIdx);
  });

  it('should show the task count in each section header', () => {
    const tasks = [
      makeTask({ id: 'p1', status: TaskStatus.PROPOSED, design_doc: '# d' }),
      makeTask({ id: 'c1', status: TaskStatus.CREATED }),
      makeTask({ id: 'c2', status: TaskStatus.CREATED }),
      makeTask({ id: 'q1', status: TaskStatus.SCHEDULED }),
    ];
    const html = BacklogView.render({ tasks });
    expect(html).toContain('Proposed');
    expect(html).toContain('Backlog');
    expect(html).toContain('Queue');
    // each of the three sections renders its own count chip
    const container = document.createElement('div');
    container.innerHTML = html;
    expect(container.querySelector('[data-backlog-count="proposed"]')!.textContent).toBe('1');
    expect(container.querySelector('[data-backlog-count="backlog"]')!.textContent).toBe('2');
    expect(container.querySelector('[data-backlog-count="queue"]')!.textContent).toBe('1');
  });

  it('should sort tasks within a section by order ascending (lower first)', () => {
    const tasks = [
      makeTask({ id: 'high', status: TaskStatus.CREATED, order: 10 }),
      makeTask({ id: 'low', status: TaskStatus.CREATED, order: -5 }),
    ];
    const html = BacklogView.render({ tasks });
    expect(html.indexOf('A task')).toBeGreaterThan(-1);
    // the lower-order task appears before the higher-order one
    expect(html.indexOf('data-task-id="low"')).toBeLessThan(html.indexOf('data-task-id="high"'));
  });

  it('should sort queue tasks by order ascending and render queued list items', () => {
    const tasks = [
      makeTask({ id: 'q-high', title: 'Later', status: TaskStatus.SCHEDULED, order: 10 }),
      makeTask({ id: 'q-low', title: 'Sooner', status: TaskStatus.SCHEDULED, order: -5 }),
    ];
    const html = BacklogView.render({ tasks });
    expect(html.indexOf('data-view-id="q-low"')).toBeLessThan(html.indexOf('data-view-id="q-high"'));
    expect(html).toContain('Queued');
    expect(html).toContain('data-action-change="update_task_order"');
  });

  it('should render empty states when no tasks exist', () => {
    const html = BacklogView.render({ tasks: [] });
    expect(html).toContain('No proposed designs.');
    expect(html).toContain('Backlog is empty.');
    expect(html).toContain('Nothing scheduled.');
  });

  it('should include scheduled queue tasks alongside the backlog', () => {
    const html = BacklogView.render({
      tasks: [
        makeTask({ id: 'sch', status: TaskStatus.SCHEDULED }),
        makeTask({ id: 'pro', status: TaskStatus.PROPOSED, design_doc: '# d' }),
      ],
    });
    expect(html).toContain('data-task-id="pro"');
    expect(html).toContain('data-task-id="sch"');
  });

  it('should ignore tasks that are not in the backlog or queue', () => {
    const html = BacklogView.render({
      tasks: [
        makeTask({ id: 'running', status: TaskStatus.INPROGRESS }),
        makeTask({ id: 'pro', status: TaskStatus.PROPOSED, design_doc: '# d' }),
      ],
    });
    expect(html).toContain('data-task-id="pro"');
    expect(html).not.toContain('data-task-id="running"');
  });

  it('should ignore deleted tasks', () => {
    const html = BacklogView.render({ tasks: [makeTask({ deleted: true })] });
    expect(html).toContain('Backlog is empty.');
  });

  it('should highlight only the row matching selectedTaskId', () => {
    const tasks = [
      makeTask({ id: 'p1', status: TaskStatus.PROPOSED, design_doc: '# d' }),
      makeTask({ id: 'c1', status: TaskStatus.CREATED }),
      makeTask({ id: 'c2', status: TaskStatus.CREATED }),
    ];
    const html = BacklogView.render({ tasks, selectedTaskId: 'c1' });

    // Match each backlog row: its opening div class and its data-view-id.
    const rowRe = /<div class="([^"]*group rounded-lg[^"]*)"[^>]*data-view-id="([^"]*)"/g;
    const rows: { id: string, cls: string }[] = [];
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(html)) !== null) {
      rows.push({ id: m[2], cls: m[1] });
    }

    expect(rows.map(r => r.id)).toEqual(['p1', 'c1', 'c2']);

    const c1 = rows.find(r => r.id === 'c1')!;
    const c2 = rows.find(r => r.id === 'c2')!;
    // The selected row carries the selected classes.
    expect(c1.cls).toContain('border-app-accent-1/70');
    expect(c1.cls).toContain('bg-app-accent-1/10');
    expect(c1.cls).toContain('ring-app-accent-1/40');
    // A sibling non-selected row does not.
    expect(c2.cls).not.toContain('border-app-accent-1/70');
    expect(c2.cls).not.toContain('bg-app-accent-1/10');
    expect(c2.cls).not.toContain('ring-app-accent-1/40');
  });

  it('should highlight the queue row matching selectedTaskId', () => {
    const tasks = [
      makeTask({ id: 'q1', status: TaskStatus.SCHEDULED }),
      makeTask({ id: 'q2', status: TaskStatus.SCHEDULED }),
    ];
    const html = BacklogView.render({ tasks, selectedTaskId: 'q1' });
    const container = document.createElement('div');
    container.innerHTML = html;
    const q1 = container.querySelector('[data-backlog-section="queue"] [data-view-id="q1"]')!;
    const q2 = container.querySelector('[data-backlog-section="queue"] [data-view-id="q2"]')!;
    expect(q1.className).toContain('border-app-accent-1/70');
    expect(q1.className).toContain('bg-app-accent-1/10');
    expect(q2.className).not.toContain('border-app-accent-1/70');
  });

  it('should not apply selected styling when selectedTaskId is omitted', () => {
    const html = BacklogView.render({ tasks: [makeTask({ id: 'c1', status: TaskStatus.CREATED })] });
    expect(html).not.toContain('border-app-accent-1/70');
    expect(html).not.toContain('bg-app-accent-1/10');
    expect(html).not.toContain('ring-app-accent-1/40');
  });

  describe('sidebar toggle', () => {
    it('renders the collapse handle at the very top of the backlog content', () => {
      const container = document.createElement('div');
      container.innerHTML = BacklogView.render({ tasks: [] });
      const toggle = container.querySelector('#backlog-sidebar-toggle') as HTMLElement;
      expect(toggle).not.toBeNull();
      expect(toggle.getAttribute('data-action-click')).toBe('toggle_backlog_sidebar');
      expect(toggle.getAttribute('aria-pressed')).toBe('false');
      expect(toggle.getAttribute('title')).toBe('Collapse backlog sidebar');
      expect(container.firstElementChild?.firstElementChild).toBe(toggle);
    });

    it('reflects the collapsed state and can be omitted when the shell owns it', () => {
      const collapsed = document.createElement('div');
      collapsed.innerHTML = BacklogView.render({ tasks: [], sidebarCollapsed: true });
      const toggle = collapsed.querySelector('#backlog-sidebar-toggle') as HTMLElement;
      expect(toggle.getAttribute('aria-pressed')).toBe('true');
      expect(toggle.getAttribute('title')).toBe('Expand backlog sidebar');
      expect(toggle.innerHTML).toContain('points="9 18 15 12 9 6"');

      const shellOwned = document.createElement('div');
      shellOwned.innerHTML = BacklogView.render({ tasks: [], showSidebarToggle: false });
      expect(shellOwned.querySelector('#backlog-sidebar-toggle')).toBeNull();
    });
  });

  describe('collapsible sections', () => {
    const mount = (html: string): HTMLElement => {
      const container = document.createElement('div');
      container.innerHTML = html;
      return container;
    };

    it('renders all three sections expanded by default', () => {
      const container = mount(BacklogView.render({ tasks: [] }));
      const sections = container.querySelectorAll<HTMLDetailsElement>('[data-backlog-collapsible]');
      expect(sections).toHaveLength(3);
      sections.forEach(section => expect(section.open).toBe(true));
      expect(
        container.querySelector('[data-backlog-header="proposed"]')!.getAttribute('aria-expanded')
      ).toBe('true');
    });

    it('renders only the requested sections collapsed', () => {
      const tasks = [
        makeTask({ id: 'p1', status: TaskStatus.PROPOSED, design_doc: '# d' }),
        makeTask({ id: 'c1', status: TaskStatus.CREATED }),
        makeTask({ id: 'q1', status: TaskStatus.SCHEDULED }),
      ];
      const container = mount(
        BacklogView.render({ tasks, collapsedSections: new Set(['proposed', 'queue']) })
      );

      expect(container.querySelector<HTMLDetailsElement>('[data-backlog-collapsible="proposed"]')!.open).toBe(false);
      expect(container.querySelector<HTMLDetailsElement>('[data-backlog-collapsible="backlog"]')!.open).toBe(true);
      expect(container.querySelector<HTMLDetailsElement>('[data-backlog-collapsible="queue"]')!.open).toBe(false);
      expect(container.querySelector('[data-backlog-section="proposed"]')!.classList.contains('hidden')).toBe(true);
      expect(container.querySelector('[data-backlog-section="backlog"]')!.classList.contains('hidden')).toBe(false);

      // Counts stay visible in the collapsed header.
      expect(container.querySelector('[data-backlog-count="proposed"]')!.textContent).toBe('1');
      expect(container.querySelector('[data-backlog-count="queue"]')!.textContent).toBe('1');
    });

    it('supports collapsed section aliases and individual flags', () => {
      const byAlias = mount(BacklogView.render({ tasks: [], sectionsCollapsed: ['backlog'] }));
      expect(byAlias.querySelector<HTMLDetailsElement>('[data-backlog-collapsible="backlog"]')!.open).toBe(false);

      const byFlag = mount(BacklogView.render({ tasks: [], collapsedQueue: true }));
      expect(byFlag.querySelector<HTMLDetailsElement>('[data-backlog-collapsible="queue"]')!.open).toBe(false);
      expect(byFlag.querySelector<HTMLDetailsElement>('[data-backlog-collapsible="proposed"]')!.open).toBe(true);
    });

    it('applies collapsed state to an already mounted view', () => {
      const container = mount(BacklogView.render({ tasks: [] }));

      BacklogView.applySectionCollapsed(container, 'backlog', true);
      const details = container.querySelector<HTMLDetailsElement>('[data-backlog-collapsible="backlog"]')!;
      const body = container.querySelector<HTMLElement>('[data-backlog-section="backlog"]')!;
      const header = container.querySelector<HTMLElement>('[data-backlog-header="backlog"]')!;
      expect(details.open).toBe(false);
      expect(body.classList.contains('hidden')).toBe(true);
      expect(header.getAttribute('aria-expanded')).toBe('false');

      expect(BacklogView.toggleSection(container, 'backlog')).toBe(false);
      expect(details.open).toBe(true);
      expect(body.classList.contains('hidden')).toBe(false);
      expect(header.getAttribute('aria-expanded')).toBe('true');
    });

    it('applies a complete collapsed-section state', () => {
      const container = mount(BacklogView.render({ tasks: [] }));

      BacklogView.applySectionsCollapsed(container, { proposed: true, queue: true });
      expect(container.querySelector<HTMLDetailsElement>('[data-backlog-collapsible="proposed"]')!.open).toBe(false);
      expect(container.querySelector<HTMLDetailsElement>('[data-backlog-collapsible="backlog"]')!.open).toBe(true);
      expect(container.querySelector<HTMLDetailsElement>('[data-backlog-collapsible="queue"]')!.open).toBe(false);

      BacklogView.applySectionsCollapsed(container, false);
      container.querySelectorAll<HTMLDetailsElement>('[data-backlog-collapsible]').forEach(section => {
        expect(section.open).toBe(true);
      });
    });
  });
});
