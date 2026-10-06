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

  it('should render specification expanded by default', () => {
    const taskWithSpec = {
      ...mockTask,
      spec: 'My spec'
    };
    const html = TaskItem.render(taskWithSpec as any);

    expect(html).toContain('Specification');
    expect(html).toContain('spec-display');
    expect(html).toMatch(/spec-display[^>]*\bexpanded\b/);
    expect(html).toContain('Show Less');
    expect(html).toContain('data-action-click="toggle_spec_expand"');
  });

  it('should render editable title for CREATED tasks', () => {
    const html = TaskItem.render(mockTask as any);
    expect(html).toContain('title-view');
    expect(html).toContain('data-action-click="edit_title"');
    expect(html).toContain('title-edit');
    expect(html).toContain('data-action-click="save_title"');
  });

  it('should render editable title for PROPOSED tasks', () => {
    const proposedTask = { ...mockTask, status: TaskStatus.PROPOSED };
    const html = TaskItem.render(proposedTask as any);
    expect(html).toContain('title-view');
    expect(html).toContain('data-action-click="edit_title"');
    expect(html).toContain('title-edit');
  });

  it('should render History button when design doc is present', () => {
    const taskWithDesign = { 
      ...mockTask, 
      design_doc: '# Some Design'
    };
    const html = TaskItem.render(taskWithDesign as any);
    expect(html).toContain('History');
    expect(html).toContain('data-action-click="view_design_doc_history"');
  });

  it('should render static title for SCHEDULED tasks', () => {
    const scheduledTask = { ...mockTask, status: TaskStatus.SCHEDULED };
    const html = TaskItem.render(scheduledTask as any);
    expect(html).toContain('title-view');
    expect(html).not.toContain('data-action-click="edit_title"');
    expect(html).not.toContain('title-edit');
  });

  it('updateTitleInPlace preserves an unsaved Specification textarea', () => {
    const container = document.createElement('div');
    container.innerHTML = TaskItem.render({ ...mockTask, title: 'Old Title' } as any);

    // Enter title-edit mode and put "New Title" into the input.
    const titleView = container.querySelector<HTMLElement>('.title-view')!;
    const titleEdit = container.querySelector<HTMLElement>('.title-edit')!;
    titleView.classList.add('hidden');
    titleEdit.classList.remove('hidden');
    const titleInput = titleEdit.querySelector('input') as HTMLInputElement;
    titleInput.value = 'New Title';

    // Simulate an unsaved spec edit: open the spec edit form and type text.
    const specView = container.querySelector<HTMLElement>('.spec-view')!;
    const specEdit = container.querySelector<HTMLElement>('.spec-edit')!;
    specView.classList.add('hidden');
    specEdit.classList.remove('hidden');
    const specTextarea = specEdit.querySelector('textarea') as HTMLTextAreaElement;
    specTextarea.value = 'unsaved spec draft';

    // Saving the title must update only title-related DOM, not the spec.
    TaskItem.updateTitleInPlace(container, { ...mockTask, title: 'New Title', version: 2 } as any);

    expect(titleEdit.classList.contains('hidden')).toBe(true);
    expect(titleView.classList.contains('hidden')).toBe(false);
    expect(container.querySelector<HTMLElement>('.title-view span.font-medium')!.textContent).toBe('New Title');

    // The unsaved spec draft must be untouched.
    expect(specEdit.classList.contains('hidden')).toBe(false);
    expect(specTextarea.value).toBe('unsaved spec draft');

    // The optimistic-concurrency version must be refreshed everywhere (spec
    // container, status selector, etc.) so a later "Save Specification" submits
    // the current version rather than a stale one (which would 409-conflict).
    expect(container.querySelector<HTMLElement>('.spec-container')!.getAttribute('data-version')).toBe('2');
    expect(container.querySelectorAll<HTMLElement>('[data-version]').length).toBeGreaterThan(1);
  });

  it('should render quickfix button for implemented tasks with commit hash', () => {
    const implementedTask = { 
      ...mockTask, 
      status: TaskStatus.IMPLEMENTED,
      commit_hash: 'abcdef123'
    };
    const html = TaskItem.render(implementedTask as any);
    expect(html).toContain('Open Quickfix in Neovim');
    expect(html).toContain('data-action-click="open_quickfix"');
  });

  it('should render the commit hash with a View Commit Diff action', () => {
    const implementedTask = {
      ...mockTask,
      status: TaskStatus.IMPLEMENTED,
      commit_hash: 'abcdef123'
    };
    const html = TaskItem.render(implementedTask as any);
    expect(html).toContain('data-action-click="open_diff_view"');
    expect(html).toContain('data-commit-hash="abcdef123"');
    expect(html).toContain('title="View Commit Diff"');
  });

  it('should render the implementation duration for newer processed states', () => {
    const history = [
      { from_status: TaskStatus.CREATED, to_status: TaskStatus.INPROGRESS, timestamp: '2026-04-12T10:00:00Z', by: 'user' },
      { from_status: TaskStatus.INPROGRESS, to_status: TaskStatus.PULL_REQUEST_AVAILABLE, timestamp: '2026-04-12T10:05:30Z', by: 'system' },
    ];
    for (const status of [TaskStatus.PULL_REQUEST_AVAILABLE, TaskStatus.SUBMITTED]) {
      const task = { ...mockTask, status, commit_hash: 'abcdef123', history };
      const html = TaskItem.render(task as any);
      expect(html).toContain('title="Implementation Duration"');
      expect(html).toContain('Impl: 5m 30s');
    }
  });

  const BOT_TARGET_ACTIONS = ['trigger_docbot', 'trigger_reviewbot', 'open_review_dialog'];

  describe('bot-trigger gating', () => {
    it('should render DocBot and Review buttons for SUBMITTED tasks without review_md', () => {
      const submittedTask = { ...mockTask, status: TaskStatus.SUBMITTED };
      const html = TaskItem.render(submittedTask as any);
      expect(html).toContain('data-action-click="trigger_docbot"');
      expect(html).toContain('data-action-click="trigger_reviewbot"');
      expect(html).not.toContain('data-action-click="open_review_dialog"');
    });

    it('should render DocBot and View Review badge for SUBMITTED tasks with review_md', () => {
      const submittedTask = { ...mockTask, status: TaskStatus.SUBMITTED, review_md: '# Review' };
      const html = TaskItem.render(submittedTask as any);
      expect(html).toContain('data-action-click="trigger_docbot"');
      expect(html).toContain('data-action-click="open_review_dialog"');
      expect(html).not.toContain('data-action-click="trigger_reviewbot"');
    });

    it.each([
      TaskStatus.PULL_REQUEST_AVAILABLE,
      TaskStatus.CREATED,
    ])('should not render bot actions for non-target status %s', (status) => {
      const task = { ...mockTask, status };
      const html = TaskItem.render(task as any);
      for (const action of BOT_TARGET_ACTIONS) {
        expect(html).not.toContain(`data-action-click="${action}"`);
      }
    });

    it('should render DocBot and Review buttons for IMPLEMENTED tasks as before', () => {
      const implementedTask = { ...mockTask, status: TaskStatus.IMPLEMENTED };
      const html = TaskItem.render(implementedTask as any);
      expect(html).toContain('data-action-click="trigger_docbot"');
      expect(html).toContain('data-action-click="trigger_reviewbot"');
      expect(html).not.toContain('data-action-click="open_review_dialog"');
    });
  });

  describe('header layout', () => {
    const parse = (html: string) => {
      const container = document.createElement('div');
      container.innerHTML = html;
      return container;
    };

    it('renders the status badge to the left of the title', () => {
      const container = parse(TaskItem.render(mockTask as any));
      const titleView = container.querySelector('.title-container .title-view')!;
      const badge = titleView.querySelector('.status-badge')!;
      const title = titleView.querySelector('span.font-medium')!;

      // The status badge must come before the title in document order.
      expect(badge.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(badge.textContent).toContain(TaskStatus.CREATED);
    });

    it('moves Delete and Schedule Execution into the header action bar for CREATED tasks', () => {
      const container = parse(TaskItem.render(mockTask as any));
      const actions = container.querySelector('.task-header-actions')!;
      expect(actions).not.toBeNull();

      const deleteBtn = actions.querySelector('[data-action-click="delete_task"]')!;
      const scheduleBtn = actions.querySelector('[data-action-click="schedule_task"]')!;
      expect(deleteBtn).not.toBeNull();
      expect(deleteBtn.textContent).toContain('Delete');
      expect(scheduleBtn).not.toBeNull();
      expect(scheduleBtn.textContent).toContain('Schedule Execution');

      // They must not be rendered again in the body action row.
      const body = container.querySelector('.task-body')!;
      expect(body.querySelector('[data-action-click="delete_task"]')).toBeNull();
      expect(body.querySelector('[data-action-click="schedule_task"]')).toBeNull();
    });

    it('moves Delete and Cancel Schedule into the header action bar for SCHEDULED tasks', () => {
      const container = parse(TaskItem.render({ ...mockTask, status: TaskStatus.SCHEDULED } as any));
      const actions = container.querySelector('.task-header-actions')!;
      expect(actions).not.toBeNull();

      const deleteBtn = actions.querySelector('[data-action-click="delete_task"]')!;
      const unscheduleBtn = actions.querySelector('[data-action-click="unschedule_task"]')!;
      expect(deleteBtn).not.toBeNull();
      expect(deleteBtn.textContent).toContain('Delete');
      expect(unscheduleBtn).not.toBeNull();
      expect(unscheduleBtn.textContent).toContain('Cancel Schedule');

      // It must not be rendered again in the body action row.
      const body = container.querySelector('.task-body')!;
      expect(body.querySelector('[data-action-click="unschedule_task"]')).toBeNull();
    });

    it('renders Send to CoderBot with the lightning icon for CREATED and SCHEDULED tasks', () => {
      for (const status of [TaskStatus.CREATED, TaskStatus.SCHEDULED]) {
        const container = parse(TaskItem.render({ ...mockTask, status } as any));
        const actions = container.querySelector('.task-header-actions')!;
        const sendBtn = actions.querySelector('[data-action-click="trigger_coderbot"]')!;
        expect(sendBtn).not.toBeNull();
        expect(sendBtn.textContent).toContain('Send to CoderBot');
        expect(sendBtn.querySelector('svg')).not.toBeNull();

        // The icon trigger is no longer rendered in the metadata row.
        const metaRow = container.querySelector('.title-container [data-task-id]')!;
        expect(metaRow.querySelector('[data-action-click="trigger_coderbot"]')).toBeNull();
      }
    });

    it('does not render header actions for PROPOSED tasks', () => {
      const container = parse(TaskItem.render({ ...mockTask, status: TaskStatus.PROPOSED } as any));
      const actions = container.querySelector('.task-header-actions')!;
      expect(actions.querySelector('[data-action-click="delete_task"]')).toBeNull();
      expect(actions.querySelector('[data-action-click="schedule_task"]')).toBeNull();
      expect(actions.querySelector('[data-action-click="trigger_coderbot"]')).toBeNull();
    });

    it('renders the status selector in the header action bar when enabled', () => {
      const container = parse(TaskItem.render(mockTask as any, true, false, false, true));
      const actions = container.querySelector('.task-header-actions')!;
      expect(actions.querySelector('select[data-action-change="change_task_status"]')).not.toBeNull();
    });

    it('moves Mark as Failed and Cancel Progress into the header action bar for INPROGRESS tasks', () => {
      const container = parse(TaskItem.render({ ...mockTask, status: TaskStatus.INPROGRESS } as any));
      const actions = container.querySelector('.task-header-actions')!;

      const failBtn = actions.querySelector('[data-action-click="fail_task"]')!;
      const cancelBtn = actions.querySelector('[data-action-click="cancel_progress"]')!;
      expect(failBtn).not.toBeNull();
      expect(failBtn.textContent).toContain('Mark as Failed');
      expect(cancelBtn).not.toBeNull();
      expect(cancelBtn.textContent).toContain('Cancel Progress');

      // They must not be rendered again in the body action row.
      const body = container.querySelector('.task-body')!;
      expect(body.querySelector('[data-action-click="fail_task"]')).toBeNull();
      expect(body.querySelector('[data-action-click="cancel_progress"]')).toBeNull();
    });

    it('moves Mark as Failed (but not Cancel Progress) into the header action bar for IMPLEMENTED tasks', () => {
      const container = parse(TaskItem.render({ ...mockTask, status: TaskStatus.IMPLEMENTED } as any));
      const actions = container.querySelector('.task-header-actions')!;

      const failBtn = actions.querySelector('[data-action-click="fail_task"]')!;
      expect(failBtn).not.toBeNull();
      expect(failBtn.textContent).toContain('Mark as Failed');
      expect(actions.querySelector('[data-action-click="cancel_progress"]')).toBeNull();

      const body = container.querySelector('.task-body')!;
      expect(body.querySelector('[data-action-click="fail_task"]')).toBeNull();
    });

    it.each([
      [TaskStatus.CREATED, false, false],
      [TaskStatus.SCHEDULED, false, false],
      [TaskStatus.PROPOSED, false, false],
      [TaskStatus.INPROGRESS, true, true],
      [TaskStatus.IMPLEMENTED, true, false],
      [TaskStatus.SUBMITTED, false, false],
      [TaskStatus.PULL_REQUEST_AVAILABLE, false, false],
      [TaskStatus.FAILED, false, false],
      [TaskStatus.DISCARDED, false, false],
    ])('keeps fail/cancel-progress header buttons state-correct for %s', (status, hasFail, hasCancel) => {
      const container = parse(TaskItem.render({ ...mockTask, status } as any));
      const actions = container.querySelector('.task-header-actions')!;
      const body = container.querySelector('.task-body')!;

      expect(actions.querySelector('[data-action-click="fail_task"]') !== null).toBe(hasFail);
      expect(actions.querySelector('[data-action-click="cancel_progress"]') !== null).toBe(hasCancel);
      // These actions are only ever rendered in the header, never the body.
      expect(body.querySelector('[data-action-click="fail_task"]')).toBeNull();
      expect(body.querySelector('[data-action-click="cancel_progress"]')).toBeNull();
    });
  });
});
