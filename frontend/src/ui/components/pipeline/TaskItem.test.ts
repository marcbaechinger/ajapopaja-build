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
import { TaskItem } from './TaskItem.ts';
import { TaskStatus } from '../../../core/domain.ts';

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

  it('updateTitleInPlace preserves an unsaved Design Doc editor and syncs the title input', () => {
    const container = document.createElement('div');
    container.innerHTML = TaskItem.render({ ...mockTask, title: 'Old Title', design_doc: '# Design' } as any);

    // Open the design doc editor and type an unsaved draft.
    const designView = container.querySelector<HTMLElement>('.design-doc-view')!;
    const designEdit = container.querySelector<HTMLElement>('.design-doc-edit')!;
    designView.classList.add('hidden');
    designEdit.classList.remove('hidden');
    const designTextarea = designEdit.querySelector('textarea') as HTMLTextAreaElement;
    designTextarea.value = 'unsaved design draft';

    // Enter title edit mode; the input still holds the old title.
    const titleInput = container.querySelector<HTMLInputElement>('.title-edit input')!;
    titleInput.value = 'Old Title';

    TaskItem.updateTitleInPlace(container, { ...mockTask, title: 'New Title', version: 2 } as any);

    // The header reflects the saved title, and the hidden edit input is kept in
    // sync so re-entering edit mode cannot accidentally re-save a stale title.
    expect(container.querySelector<HTMLElement>('.title-view span.font-medium')!.textContent).toBe('New Title');
    expect(titleInput.value).toBe('New Title');

    // The open Design Doc editor and its unsaved draft are untouched.
    expect(designEdit.classList.contains('hidden')).toBe(false);
    expect(designTextarea.value).toBe('unsaved design draft');
  });

  it('updateHeaderInPlace patches only the header and preserves an open Specification editor', () => {
    const container = document.createElement('div');
    container.innerHTML = TaskItem.render({ ...mockTask, status: TaskStatus.INPROGRESS, version: 1 } as any);

    // Open the spec editor and type an unsaved draft.
    const specView = container.querySelector<HTMLElement>('.spec-view')!;
    const specEdit = container.querySelector<HTMLElement>('.spec-edit')!;
    specView.classList.add('hidden');
    specEdit.classList.remove('hidden');
    const specTextarea = specEdit.querySelector('textarea') as HTMLTextAreaElement;
    specTextarea.value = 'unsaved spec draft';

    const card = container.querySelector('[data-view-id="1"]')!;
    const bodyBefore = card.querySelector('.task-body');
    const headerBefore = card.querySelector('.task-header');

    TaskItem.updateHeaderInPlace(container, {
      ...mockTask,
      status: TaskStatus.PULL_REQUEST_AVAILABLE,
      version: 3,
    } as any);

    // The card and its body are kept (only the header node is replaced), so the
    // unsaved Specification editor survives the status change.
    expect(container.querySelector('[data-view-id="1"]')).toBe(card);
    expect(card.querySelector('.task-body')).toBe(bodyBefore);
    expect(card.querySelector('.task-header')).not.toBe(headerBefore);
    expect(specEdit.classList.contains('hidden')).toBe(false);
    expect(specTextarea.value).toBe('unsaved spec draft');

    // The header reflects the new state...
    expect(card.querySelector('.status-badge')!.textContent).toContain(
      TaskStatus.PULL_REQUEST_AVAILABLE
    );
    expect(card.querySelector('[data-action-click="open_pr_dialog"]')).not.toBeNull();
    // ...and the optimistic-concurrency version is refreshed everywhere.
    expect(card.querySelector('.title-container')!.getAttribute('data-version')).toBe('3');
    expect(card.querySelector('.spec-container')!.getAttribute('data-version')).toBe('3');
  });

  it('updateHeaderInPlace preserves the collapsed state and status selector', () => {
    const container = document.createElement('div');
    container.innerHTML = TaskItem.render(mockTask as any, true, false, true, true);

    TaskItem.updateHeaderInPlace(container, {
      ...mockTask,
      status: TaskStatus.SCHEDULED,
      version: 2,
    } as any);

    // Collapsed body stays collapsed and the chevron is not rotated.
    expect(container.querySelector('.task-body')!.classList.contains('hidden')).toBe(true);
    expect(container.querySelector('.task-header .transform')!.className).not.toContain('rotate-90');
    // The status selector is re-rendered and reflects the new value.
    const select = container.querySelector('select[data-action-change="change_task_status"]') as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.value).toBe(TaskStatus.SCHEDULED);
  });

  it('updateHeaderInPlace is a no-op for an element without a task header', () => {
    const el = document.createElement('div');
    expect(() => TaskItem.updateHeaderInPlace(el, mockTask as any)).not.toThrow();
    expect(el.innerHTML).toBe('');
  });

  describe('focusScheduleExecution', () => {
    const mount = (html: string) => {
      const el = document.createElement('div');
      el.innerHTML = html;
      document.body.appendChild(el);
      return el;
    };

    // jsdom performs no layout, so getClientRects() always returns an empty
    // list. Stub it to make a button look rendered/visible in these tests.
    const makeVisible = (el: HTMLElement) => {
      el.getClientRects = () => [{}] as unknown as DOMRectList;
    };

    afterEach(() => {
      document.body.innerHTML = '';
    });

    it('focuses the Schedule Execution button for a CREATED task', () => {
      const el = mount(TaskItem.render(mockTask as any));
      const scheduleBtn = el.querySelector<HTMLElement>('[data-action-click="schedule_task"]')!;
      makeVisible(scheduleBtn);

      expect(TaskItem.focusScheduleExecution(el)).toBe(true);
      expect(document.activeElement).toBe(scheduleBtn);
    });

    it('highlights the Schedule Execution button on programmatic focus and clears it on blur', () => {
      const el = mount(TaskItem.render(mockTask as any));
      const scheduleBtn = el.querySelector<HTMLElement>('[data-action-click="schedule_task"]')!;
      makeVisible(scheduleBtn);

      expect(TaskItem.focusScheduleExecution(el)).toBe(true);
      // A programmatic .focus() may not paint a :focus-visible ring, so the
      // button gets an explicit highlight class instead.
      for (const cls of TaskItem.PROGRAMMATIC_FOCUS_CLASSES) {
        expect(scheduleBtn.classList.contains(cls)).toBe(true);
      }

      // The highlight is short-lived: it goes away as soon as focus leaves.
      scheduleBtn.blur();
      for (const cls of TaskItem.PROGRAMMATIC_FOCUS_CLASSES) {
        expect(scheduleBtn.classList.contains(cls)).toBe(false);
      }
    });

    it('does not highlight a disabled Schedule Execution button', () => {
      const el = mount(TaskItem.render(mockTask as any));
      const scheduleBtn = el.querySelector<HTMLElement>('[data-action-click="schedule_task"]')!;
      makeVisible(scheduleBtn);
      scheduleBtn.setAttribute('disabled', '');

      expect(TaskItem.focusScheduleExecution(el)).toBe(false);
      for (const cls of TaskItem.PROGRAMMATIC_FOCUS_CLASSES) {
        expect(scheduleBtn.classList.contains(cls)).toBe(false);
      }
    });

    it('returns false and does not focus a disabled Schedule Execution button', () => {
      const el = mount(TaskItem.render(mockTask as any));
      const scheduleBtn = el.querySelector<HTMLButtonElement>('[data-action-click="schedule_task"]')!;
      makeVisible(scheduleBtn);
      scheduleBtn.disabled = true;
      const other = document.createElement('input');
      document.body.appendChild(other);
      other.focus();

      expect(TaskItem.focusScheduleExecution(el)).toBe(false);
      expect(document.activeElement).toBe(other);
      expect(document.activeElement).not.toBe(scheduleBtn);
    });

    it('returns false for a hidden Schedule Execution button (no client rects)', () => {
      const el = mount(TaskItem.render(mockTask as any));
      const scheduleBtn = el.querySelector<HTMLElement>('[data-action-click="schedule_task"]')!;
      scheduleBtn.getClientRects = () => [] as unknown as DOMRectList;
      const other = document.createElement('input');
      document.body.appendChild(other);
      other.focus();

      expect(TaskItem.focusScheduleExecution(el)).toBe(false);
      expect(document.activeElement).toBe(other);
    });

    it('returns false for a Schedule Execution button hidden via aria-hidden', () => {
      const el = mount(TaskItem.render(mockTask as any));
      const scheduleBtn = el.querySelector<HTMLElement>('[data-action-click="schedule_task"]')!;
      makeVisible(scheduleBtn);
      scheduleBtn.setAttribute('aria-hidden', 'true');
      const other = document.createElement('input');
      document.body.appendChild(other);
      other.focus();

      expect(TaskItem.focusScheduleExecution(el)).toBe(false);
      expect(document.activeElement).toBe(other);
    });

    it('is a no-op when the card has no Schedule Execution button', () => {
      const el = mount(TaskItem.render({ ...mockTask, status: TaskStatus.SCHEDULED } as any));
      const other = document.createElement('input');
      document.body.appendChild(other);
      other.focus();

      expect(TaskItem.focusScheduleExecution(el)).toBe(false);
      expect(document.activeElement).toBe(other);
    });

    it('is a no-op for a null element', () => {
      expect(TaskItem.focusScheduleExecution(null)).toBe(false);
    });
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

  it('should render a Copy Commit Hash button next to the commit hash', () => {
    const implementedTask = {
      ...mockTask,
      status: TaskStatus.IMPLEMENTED,
      commit_hash: 'abcdef123'
    };
    const html = TaskItem.render(implementedTask as any);
    expect(html).toContain('data-action-click="copy_commit_hash"');
    expect(html).toContain('data-commit-hash="abcdef123"');
    expect(html).toContain('title="Copy Commit Hash"');
  });

  it('should not render a Copy Commit Hash button without a commit hash', () => {
    const html = TaskItem.render(mockTask as any);
    expect(html).not.toContain('data-action-click="copy_commit_hash"');
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

  it('should render status history entries on a single line with a left margin', () => {
    const history = [
      { from_status: TaskStatus.CREATED, to_status: TaskStatus.INPROGRESS, timestamp: '2026-04-12T10:00:00Z', by: 'user' },
    ];
    const task = { ...mockTask, history };
    const html = TaskItem.render(task as any, true, true);

    // The list is inset from the left so it aligns with the "Status History" label.
    expect(html).toContain('space-y-2 mt-2 ml-6');
    // Each transition is forced onto a single line (no break before AM/PM).
    expect(html).toContain('text-[10px] whitespace-nowrap');
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
      // The delete button is icon-only (no "Delete" text label).
      expect(deleteBtn.querySelector('svg')).not.toBeNull();
      expect(deleteBtn.textContent?.trim()).toBe('');
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
      // The delete button is icon-only (no "Delete" text label).
      expect(deleteBtn.querySelector('svg')).not.toBeNull();
      expect(deleteBtn.textContent?.trim()).toBe('');
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

  describe('design document table of contents', () => {
    afterEach(() => {
      TaskItem.closeDesignDocToc();
      document.body.innerHTML = '';
    });

    it('renders a TOC button next to the design-document label', () => {
      const html = TaskItem.render({ ...mockTask, design_doc: '# Design' } as any);
      expect(html).toContain('data-action-click="toggle_design_doc_toc"');
      expect(html).toContain('data-task-id="1"');
      expect(html).toContain('TOC');
    });

    it('extends the design-document actions with a TOC action on every task', () => {
      const container = document.createElement('div');
      container.innerHTML = TaskItem.render({ ...mockTask } as any);
      expect(
        container.querySelector('[data-action-click="toggle_design_doc_toc"]')
      ).not.toBeNull();
    });

    describe('extractDesignDocHeadings', () => {
      it('extracts ATX headings h1..h6 in document order', () => {
        const markdown = [
          '# One',
          '## Two',
          '### Three',
          '#### Four',
          '##### Five',
          '###### Six',
        ].join('\n');
        expect(TaskItem.extractDesignDocHeadings(markdown)).toEqual([
          { level: 1, text: 'One' },
          { level: 2, text: 'Two' },
          { level: 3, text: 'Three' },
          { level: 4, text: 'Four' },
          { level: 5, text: 'Five' },
          { level: 6, text: 'Six' },
        ]);
      });

      it('strips trailing closing hashes and ignores non-headings', () => {
        const markdown = '## Heading ##\nNot a heading\n####### Too many\n# C#';
        expect(TaskItem.extractDesignDocHeadings(markdown)).toEqual([
          { level: 2, text: 'Heading' },
          { level: 1, text: 'C#' },
        ]);
      });

      it('ignores headings inside fenced code blocks', () => {
        const markdown = ['# Real', '```md', '# Not real', '```', '## Also real'].join('\n');
        expect(TaskItem.extractDesignDocHeadings(markdown)).toEqual([
          { level: 1, text: 'Real' },
          { level: 2, text: 'Also real' },
        ]);
      });

      it('returns an empty list for an empty document', () => {
        expect(TaskItem.extractDesignDocHeadings('')).toEqual([]);
      });
    });

    describe('toggleDesignDocToc', () => {
      const mount = (markdown: string) => {
        const container = document.createElement('div');
        container.className = 'design-doc-container';
        container.innerHTML = TaskItem.render({
          ...mockTask,
          design_doc: markdown,
        } as any);
        document.body.appendChild(container);
        const button = container.querySelector<HTMLElement>(
          '[data-action-click="toggle_design_doc_toc"]'
        )!;
        return { container, button };
      };

      it('opens an overlay with all headings rendered as text', () => {
        const { container, button } = mount('# Alpha\n## Beta');
        const overlay = TaskItem.toggleDesignDocToc(button, '# Alpha\n## Beta');

        expect(overlay).not.toBeNull();
        expect(container.querySelector('.design-doc-toc-overlay')).toBe(overlay);
        expect(overlay!.textContent).toContain('Table of Contents');
        expect(overlay!.textContent).toContain('Alpha');
        expect(overlay!.textContent).toContain('Beta');
      });

      it('shows an empty state when there are no headings', () => {
        const { button } = mount('plain text');
        const overlay = TaskItem.toggleDesignDocToc(button, 'plain text');
        expect(overlay!.textContent).toContain('No headings found.');
      });

      it('toggles the overlay closed when the same button is clicked again', () => {
        const markdown = '# Alpha';
        const { button } = mount(markdown);

        TaskItem.toggleDesignDocToc(button, markdown);
        expect(document.getElementById('design-doc-toc-overlay')).not.toBeNull();

        expect(TaskItem.toggleDesignDocToc(button, markdown)).toBeNull();
        expect(document.getElementById('design-doc-toc-overlay')).toBeNull();
      });

      it('stays open when the overlay itself is clicked', () => {
        const markdown = '# Alpha';
        const { button } = mount(markdown);
        const overlay = TaskItem.toggleDesignDocToc(button, markdown)!;

        overlay.querySelector('li')!.dispatchEvent(
          new MouseEvent('click', { bubbles: true })
        );

        expect(document.getElementById('design-doc-toc-overlay')).toBe(overlay);
      });

      it('closes when a click lands outside the overlay', () => {
        const markdown = '# Alpha';
        const { button } = mount(markdown);
        TaskItem.toggleDesignDocToc(button, markdown);

        document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(document.getElementById('design-doc-toc-overlay')).toBeNull();
      });

      it('closes when the close icon is clicked', () => {
        const markdown = '# Alpha';
        const { button } = mount(markdown);
        const overlay = TaskItem.toggleDesignDocToc(button, markdown)!;

        overlay
          .querySelector<HTMLElement>('[data-toc-close]')!
          .dispatchEvent(new MouseEvent('click', { bubbles: true }));

        expect(document.getElementById('design-doc-toc-overlay')).toBeNull();
      });

      it('replaces a previously opened overlay', () => {
        const first = mount('# Alpha');
        const second = mount('# Beta');

        TaskItem.toggleDesignDocToc(first.button, '# Alpha');
        const overlay = TaskItem.toggleDesignDocToc(second.button, '# Beta');

        expect(document.querySelectorAll('.design-doc-toc-overlay').length).toBe(1);
        expect(overlay!.textContent).toContain('Beta');
        expect(overlay!.textContent).not.toContain('Alpha');
      });
    });
  });
});
