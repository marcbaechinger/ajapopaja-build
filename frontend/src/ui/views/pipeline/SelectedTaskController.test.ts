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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PipelineDetailView } from '../PipelineDetailView.ts';
import { SelectedTaskController } from './SelectedTaskController.ts';
import { createPipelineDetailCtx, type PipelineDetailCtx, type PipelineDetailRefreshHooks } from './PipelineDetailCtx.ts';
import { LocalStorageManager } from '../../../core/LocalStorageManager.ts';
import { TaskStatus, type Task } from '../../../core/domain.ts';
import { TaskItem } from '../../components/TaskItem.ts';
import type { AppContext } from '../../../core/AppContext.ts';

// Mock components to avoid deep rendering issues in the shell-backed integration
// tests below (this file also drives the controller directly in its own suite).
vi.mock('../../components/TaskColumn.ts', () => ({
  TaskColumn: { render: () => '<div class="mock-column">Column</div>' },
}));
vi.mock('../../components/TaskForm.ts', () => ({
  TaskForm: { render: () => '<div class="mock-form">Form</div>' },
}));
vi.mock('../../components/PipelineHeaderView.ts', () => ({
  PipelineHeaderView: { render: () => '<div class="mock-header">Header</div>' },
}));
vi.mock('../../components/PipelineHistoryView.ts', () => ({
  PipelineHistoryView: { render: () => '<div class="mock-history">History</div>' },
}));
vi.mock('../../components/PaginationControl.ts', () => ({
  PaginationControl: { render: () => '<div class="mock-pagination">Pagination</div>' },
}));
vi.mock('../../components/CoderBotDialog.ts', () => ({
  CoderBotDialog: vi.fn(function CoderBotDialog() {
    return { show: vi.fn() };
  }),
}));
vi.mock('../../components/DevServerDialog.ts', () => ({
  DevServerDialog: vi.fn(function DevServerDialog() {
    return { show: vi.fn() };
  }),
}));
vi.mock('../../components/DiffDialog.ts', () => ({
  DiffDialog: vi.fn(function DiffDialog() {
    return { show: vi.fn() };
  }),
}));
vi.mock('../../components/InteractiveCodingView.ts', () => ({
  InteractiveCodingView: vi.fn(function InteractiveCodingView() {
    return {
      render: vi.fn(),
      destroy: vi.fn(),
      sendMessage: vi.fn(),
      pauseSession: vi.fn(),
    };
  }),
}));

/**
 * The selection / version / spec-edit scenarios moved out of
 * `PipelineDetailView.test.ts`. They drive the extracted controller through the
 * shell's thin delegators, so they guard the DOM hand-off end to end.
 */
describe('SelectedTaskController (selection + spec edit, via PipelineDetailView)', () => {
  let mockContext: any;
  let container: HTMLElement;
  let storage: Record<string, string> = {};

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    storage = {};
    LocalStorageManager.resetInstances();

    mockContext = {
      actionRegistry: {
        register: vi.fn(),
      },
      wsClient: {
        on: vi.fn().mockReturnValue(() => {}),
      },
      dataManager: {
        on: vi.fn().mockReturnValue(() => {}),
        updateTask: vi.fn(),
        updatePipeline: vi.fn(),
      },
      authService: {
        getUser: vi.fn().mockReturnValue({ username: 'testuser' }),
        getAccessToken: vi.fn().mockReturnValue('token'),
      },
      pipelineClient: {
        get: vi.fn().mockResolvedValue({ id: 'p1', name: 'Pipe 1' }),
        getGitStatus: vi.fn().mockResolvedValue({ staged: 0, unstaged: 0, untracked: 0 }),
      },
      taskClient: {
        listByPipeline: vi.fn().mockResolvedValue([]),
        listCompletedByPipeline: vi.fn().mockResolvedValue({ tasks: [], total_count: 0 }),
        updateDetails: vi.fn().mockResolvedValue({ id: 't1' }),
      },
      pullRequestClient: {
        getPullRequestsByPipeline: vi.fn().mockResolvedValue([]),
      },
      systemClient: {
        isOllamaAvailable: vi.fn().mockResolvedValue(true),
      },
    };

    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key) => storage[key] || null),
      setItem: vi.fn((key, value) => { storage[key] = value; }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  it('should render the selected task in the TaskView under the Quick Add Task panel', async () => {
    mockContext.taskClient.listByPipeline.mockResolvedValue([
      { id: 'c1', title: 'Currently Worked On', status: TaskStatus.CREATED, deleted: false, version: 2, order: 0, type: 'manual', want_design_doc: false },
    ]);

    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    view.mount(container);
    container.innerHTML = view.render() as string;
    await view.refreshTasks();

    const selectedView = container.querySelector('#selected-task-view');
    expect(selectedView).not.toBeNull();
    // nothing selected yet -> empty hint
    expect(selectedView!.innerHTML).toContain('Select a task from the backlog');

    // find and invoke the select_task handler as if the user clicked a BacklogTaskView
    const selectAction = mockContext.actionRegistry.register.mock.calls.find((c: any) => c[0] === 'select_task')![1];
    const el = document.createElement('div');
    el.setAttribute('data-view-id', 'c1');
    selectAction(new Event('click'), el);

    // the TaskView now shows the selected task and the hint is gone
    expect(selectedView!.innerHTML).toContain('Currently Worked On');
    expect(selectedView!.innerHTML).not.toContain('Select a task from the backlog');
  });

  it('should render the Specification expanded by default, and keep a manual collapse on reselect', async () => {
    mockContext.taskClient.listByPipeline.mockResolvedValue([
      { id: 'c1', title: 'Spec Task', spec: 'some spec', status: TaskStatus.CREATED, deleted: false, version: 1, order: 0, type: 'manual', want_design_doc: false },
    ]);

    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    view.mount(container);
    container.innerHTML = view.render() as string;
    await view.refreshTasks();

    const selectAction = mockContext.actionRegistry.register.mock.calls.find((c: any) => c[0] === 'select_task')![1];
    const toggleAction = mockContext.actionRegistry.register.mock.calls.find((c: any) => c[0] === 'toggle_spec_expand')![1];
    const selectEl = () => {
      const el = document.createElement('div');
      el.setAttribute('data-view-id', 'c1');
      selectAction(new Event('click'), el);
      return container.querySelector('#selected-task-view') as HTMLElement;
    };

    const selectedView = selectEl();
    const display = selectedView.querySelector('.spec-display') as HTMLElement;
    // Expanded by default.
    expect(display.classList.contains('expanded')).toBe(true);

    // User collapses it -> re-rendering (reselect) keeps it collapsed.
    const toggleBtn = selectedView.querySelector('[data-action-click="toggle_spec_expand"]') as HTMLElement;
    toggleAction(new Event('click'), toggleBtn);
    const collapsedView = selectEl();
    expect(collapsedView.querySelector('.spec-display')!.classList.contains('expanded')).toBe(false);
  });

  it('should select a newly created task and enter Specification edit mode', async () => {
    const createdTask: any = { id: 'n1', title: 'New Task', spec: '', status: TaskStatus.CREATED, deleted: false, version: 1, order: 0, type: 'manual', want_design_doc: false };
    mockContext.taskClient.create = vi.fn().mockResolvedValue(createdTask);
    mockContext.taskClient.listByPipeline.mockResolvedValue([]);

    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    view.mount(container);
    container.innerHTML = view.render() as string;
    await view.refreshTasks();

    const createAction = mockContext.actionRegistry.register.mock.calls.find((c: any) => c[0] === 'create_task')![1];
    const form = document.createElement('form');
    form.innerHTML = '<input name="task_title" value="New Task">';
    await createAction(new Event('submit'), form);

    const selectedView = container.querySelector('#selected-task-view') as HTMLElement;
    // the new task is immediately the selected task shown in the main content area
    expect(selectedView.innerHTML).toContain('New Task');
    // Specification is in editing mode and the textarea has the cursor
    expect(selectedView.querySelector('.spec-edit')!.classList.contains('hidden')).toBe(false);
    expect(selectedView.querySelector('.spec-view')!.classList.contains('hidden')).toBe(true);
    const textarea = selectedView.querySelector('textarea') as HTMLTextAreaElement;
    expect(document.activeElement).toBe(textarea);

    // the input is cleared for the next entry
    expect(form.querySelector('input')!.value).toBe('');
  });

  it('should keep the new task Specification in edit mode across a WS re-render', async () => {
    let tasksHandler: ((payload: any) => void) | undefined;
    mockContext.dataManager.on = vi.fn((query: string, cb: any) => {
      if (query.startsWith('pipeline:tasks:')) tasksHandler = cb;
      return () => {};
    });
    const createdTask: any = { id: 'n1', title: 'New Task', spec: '', status: TaskStatus.CREATED, deleted: false, version: 1, order: 0, type: 'manual', want_design_doc: false };
    mockContext.taskClient.create = vi.fn().mockResolvedValue({ ...createdTask });
    mockContext.taskClient.listByPipeline.mockResolvedValue([]);

    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    view.mount(container);
    container.innerHTML = view.render() as string;
    await view.refreshTasks();

    const createAction = mockContext.actionRegistry.register.mock.calls.find((c: any) => c[0] === 'create_task')![1];
    const form = document.createElement('form');
    form.innerHTML = '<input name="task_title" value="New Task">';
    await createAction(new Event('submit'), form);

    let selectedView = container.querySelector('#selected-task-view') as HTMLElement;
    expect(selectedView.querySelector('.spec-edit')!.classList.contains('hidden')).toBe(false);

    // simulate the WS TASK_CREATED/TASK_UPDATED re-render arriving after creation
    tasksHandler!({ ...createdTask, spec: 'draft spec', version: 1 });

    selectedView = container.querySelector('#selected-task-view') as HTMLElement;
    // still selected, and Specification remains in edit mode
    expect(selectedView.innerHTML).toContain('New Task');
    expect(selectedView.querySelector('.spec-edit')!.classList.contains('hidden')).toBe(false);

    // selecting a different task clears the persisted edit flag
    const selectAction = mockContext.actionRegistry.register.mock.calls.find((c: any) => c[0] === 'select_task')![1];
    const el = document.createElement('div');
    el.setAttribute('data-view-id', 'other');
    selectAction(new Event('click'), el);
    expect((view as any).pendingSpecEditTaskId).toBeNull();
  });

  it('should refresh the selected TaskView (version) when the task updates over WS', async () => {
    let tasksHandler: ((payload: any) => void) | undefined;
    mockContext.dataManager.on = vi.fn((query: string, cb: any) => {
      if (query.startsWith('pipeline:tasks:')) tasksHandler = cb;
      return () => {};
    });
    mockContext.taskClient.listByPipeline.mockResolvedValue([
      { id: 'c1', title: 'Selected Task', spec: 'v1', status: TaskStatus.CREATED, deleted: false, version: 1, order: 0, type: 'manual', want_design_doc: false },
    ]);

    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    view.mount(container);
    container.innerHTML = view.render() as string;
    await view.refreshTasks();

    // select the task
    const selectAction = mockContext.actionRegistry.register.mock.calls.find((c: any) => c[0] === 'select_task')![1];
    const el = document.createElement('div');
    el.setAttribute('data-view-id', 'c1');
    selectAction(new Event('click'), el);

    const selectedView = container.querySelector('#selected-task-view') as HTMLElement;
    expect(selectedView.innerHTML).toContain('Selected Task');
    expect(selectedView.innerHTML).toContain('data-version="1"');

    // simulate the WS TASK_UPDATED carrying the bumped version
    tasksHandler!({ id: 'c1', title: 'Selected Task', spec: 'v2', status: TaskStatus.CREATED, deleted: false, version: 2, order: 0, type: 'manual', want_design_doc: false });

    expect(selectedView.innerHTML).toContain('data-version="2"');
  });
});

/**
 * The save_spec -> focus scenarios moved out of `PipelineDetailView.test.ts`.
 * They verify that the title/spec edit focus hand-off survives the WS-driven
 * re-render through the controller.
 */
describe('SelectedTaskController (save_spec focus, via PipelineDetailView)', () => {
  let mockContext: any;
  let container: HTMLElement;
  let tasksHandler: ((payload: any) => void) | undefined;
  let getClientRectsSpy: ReturnType<typeof vi.spyOn>;

  const getAction = (name: string) =>
    mockContext.actionRegistry.register.mock.calls.find((c: any) => c[0] === name)![1];

  const createdTask = () => ({
    id: 'c1',
    title: 'Spec Task',
    spec: 'old spec',
    status: TaskStatus.CREATED,
    deleted: false,
    version: 1,
    order: 0,
    type: 'manual',
    want_design_doc: false,
    pipeline_id: 'p1',
    created_at: '2026-01-01T00:00:00Z',
    history: [],
  });

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    LocalStorageManager.resetInstances();
    vi.clearAllMocks();
    tasksHandler = undefined;
    // jsdom has no layout engine, so every element reports zero client rects.
    // Stub the rects so the Schedule Execution button looks rendered/visible
    // (as it would in a real browser) and can receive focus.
    getClientRectsSpy = vi
      .spyOn(Element.prototype, 'getClientRects')
      .mockReturnValue([{}] as unknown as DOMRectList);

    mockContext = {
      actionRegistry: { register: vi.fn() },
      wsClient: { on: vi.fn().mockReturnValue(() => {}) },
      dataManager: {
        on: vi.fn((query: string, cb: any) => {
          if (query.startsWith('pipeline:tasks:')) tasksHandler = cb;
          return () => {};
        }),
        updateTask: vi.fn(),
        updatePipeline: vi.fn(),
      },
      authService: {
        getUser: vi.fn().mockReturnValue({ username: 'testuser' }),
        getAccessToken: vi.fn().mockReturnValue('token'),
      },
      pipelineClient: {
        get: vi.fn().mockResolvedValue({ id: 'p1', name: 'Pipe 1' }),
        getGitStatus: vi.fn().mockResolvedValue({ staged: 0, unstaged: 0, untracked: 0 }),
      },
      taskClient: {
        listByPipeline: vi.fn().mockResolvedValue([createdTask()]),
        listCompletedByPipeline: vi.fn().mockResolvedValue({ tasks: [], total_count: 0 }),
        updateDetails: vi.fn().mockResolvedValue({ ...createdTask(), spec: 'new spec', version: 2 }),
      },
      pullRequestClient: { getPullRequestsByPipeline: vi.fn().mockResolvedValue([]) },
      systemClient: { isOllamaAvailable: vi.fn().mockResolvedValue(true) },
    };

    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    });
  });

  afterEach(() => {
    getClientRectsSpy.mockRestore();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  const mountAndSelect = async () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    view.mount(container);
    container.innerHTML = view.render() as string;
    await view.refreshTasks();

    const selectAction = getAction('select_task');
    const el = document.createElement('div');
    el.setAttribute('data-view-id', 'c1');
    selectAction(new Event('click'), el);

    const selectedView = container.querySelector('#selected-task-view') as HTMLElement;
    return { view, selectedView };
  };

  it('focuses the Schedule Execution button after saving a specification', async () => {
    const { selectedView } = await mountAndSelect();

    const specContainer = selectedView.querySelector('.spec-container') as HTMLElement;
    expect(specContainer).not.toBeNull();
    const textarea = specContainer.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'new spec';
    const saveBtn = specContainer.querySelector('[data-action-click="save_spec"]') as HTMLElement;

    await getAction('save_spec')(new Event('click'), saveBtn);

    expect(mockContext.taskClient.updateDetails).toHaveBeenCalledWith('c1', 1, {
      spec: 'new spec',
      want_design_doc: false,
    });
    expect(document.activeElement).toBe(
      selectedView.querySelector('[data-action-click="schedule_task"]')
    );
  });

  it('re-applies focus when a WS re-render replaces the card after saving', async () => {
    const { view, selectedView } = await mountAndSelect();

    const specContainer = selectedView.querySelector('.spec-container') as HTMLElement;
    const textarea = specContainer.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'new spec';
    const saveBtn = specContainer.querySelector('[data-action-click="save_spec"]') as HTMLElement;

    await getAction('save_spec')(new Event('click'), saveBtn);

    // The WS-driven TASK_UPDATED arrives and re-renders the selected card.
    tasksHandler!({ ...createdTask(), spec: 'new spec', version: 2 });

    const scheduleBtn = container.querySelector(
      '#selected-task-view [data-action-click="schedule_task"]'
    );
    expect(scheduleBtn).not.toBeNull();
    expect(document.activeElement).toBe(scheduleBtn);
    // The pending marker is consumed once focus has been handed over.
    expect((view as any).pendingScheduleFocusTaskId).toBeNull();
  });

  it('does not leak the pending focus marker to a different task id', () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    (view as any).pendingScheduleFocusTaskId = 'c1';

    // Render a different task's card with its own Schedule Execution button.
    const otherCard = document.createElement('div');
    otherCard.setAttribute('data-view-id', 'c2');
    const otherButton = document.createElement('button');
    otherButton.setAttribute('data-action-click', 'schedule_task');
    otherCard.appendChild(otherButton);
    document.body.appendChild(otherCard);

    (view as any).applyPendingScheduleFocus(otherCard, 'c2');

    // Focus must not be handed to the unrelated card, and the marker must not
    // survive for a later render.
    expect(document.activeElement).not.toBe(otherButton);
    expect((view as any).pendingScheduleFocusTaskId).toBeNull();
  });
});

/**
 * Direct unit tests for the extracted controller (fake ctx + host element,
 * spying on the `ctx.refresh` hooks).
 */
describe('SelectedTaskController', () => {
  let ctx: PipelineDetailCtx;
  let host: HTMLElement;
  let controller: SelectedTaskController;
  let refresh: PipelineDetailRefreshHooks;
  let getClientRectsSpy: ReturnType<typeof vi.spyOn>;

  const makeTask = (overrides: Record<string, unknown> = {}): Task => ({
    id: 'c1',
    title: 'Task',
    spec: 'spec text',
    status: TaskStatus.CREATED,
    deleted: false,
    version: 1,
    order: 0,
    type: 'manual',
    want_design_doc: false,
    pipeline_id: 'p1',
    created_at: '2026-01-01T00:00:00Z',
    history: [],
    ...overrides,
  } as unknown as Task);

  beforeEach(() => {
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
    host.innerHTML = '<div id="selected-task-view"></div>';

    refresh = {
      header: vi.fn(),
      backlog: vi.fn(),
      selectedTask: vi.fn(),
      executionEngine: vi.fn(),
      sessionList: vi.fn(),
      specProposals: vi.fn(),
    };
    ctx = createPipelineDetailCtx({
      context: {} as unknown as AppContext,
      pipelineId: 'p1',
      refresh,
    });
    getClientRectsSpy = vi
      .spyOn(Element.prototype, 'getClientRects')
      .mockReturnValue([{}] as unknown as DOMRectList);
    controller = new SelectedTaskController({ ctx, getHost: () => host });
  });

  afterEach(() => {
    getClientRectsSpy.mockRestore();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('update()', () => {
    it('applies a title-only change in place without a full repaint', () => {
      ctx.state.selectedTask = makeTask({ title: 'Old' });
      ctx.state.allLoadedTasks = [makeTask({ title: 'Old', version: 1 })];
      const viewEl = host.querySelector('#selected-task-view') as HTMLElement;
      viewEl.innerHTML = TaskItem.render(makeTask({ title: 'Old', version: 1 }), false, false, false, false, true);

      const cardBefore = viewEl.querySelector('[data-view-id="c1"]');
      controller.update(makeTask({ title: 'New', version: 2 }));

      // header still refreshed (before the early return)
      expect(refresh.header).toHaveBeenCalledTimes(1);
      // no heavy refreshes / repaint of #selected-task-view
      expect(refresh.backlog).not.toHaveBeenCalled();
      expect(refresh.executionEngine).not.toHaveBeenCalled();
      expect(refresh.selectedTask).not.toHaveBeenCalled();
      // the very same card element is kept, with the title + version patched
      expect(host.querySelector('#selected-task-view')).toBe(viewEl);
      expect(viewEl.querySelector('[data-view-id="c1"]')).toBe(cardBefore);
      expect(cardBefore!.querySelector('.title-view span.font-medium')!.textContent).toBe('New');
      expect(cardBefore!.querySelector('.title-container')!.getAttribute('data-version')).toBe('2');
      expect(ctx.state.selectedTask!.title).toBe('New');
    });

    it('does a full repaint (backlog + selected view + engine) for a non-title change', () => {
      ctx.state.selectedTask = makeTask({ id: 'c1', spec: 'old' });
      ctx.state.allLoadedTasks = [makeTask({ id: 'c1', spec: 'old' })];

      controller.update(makeTask({ id: 'c1', spec: 'brand new spec' }));

      expect(refresh.backlog).toHaveBeenCalledTimes(1);
      expect(refresh.executionEngine).toHaveBeenCalledTimes(1);
      expect(host.querySelector('#selected-task-view')!.innerHTML).toContain('brand new spec');
    });

    it('pushes an unknown task into allLoadedTasks', () => {
      ctx.state.allLoadedTasks = [];

      controller.update(makeTask({ id: 'new1', title: 'Fresh' }));

      expect(ctx.state.allLoadedTasks).toHaveLength(1);
      expect(ctx.state.allLoadedTasks[0].id).toBe('new1');
    });
  });

  describe('refreshSelected()', () => {
    it('renders the hint when nothing is selected', () => {
      controller.refreshSelected();
      expect(host.querySelector('#selected-task-view')!.innerHTML).toContain(
        'Select a task from the backlog'
      );
    });

    it('renders the hint and clears the selection when the task is deleted', () => {
      ctx.state.selectedTask = makeTask({ id: 'c1' });
      ctx.state.allLoadedTasks = [makeTask({ id: 'c1', deleted: true })];

      controller.refreshSelected();

      expect(host.querySelector('#selected-task-view')!.innerHTML).toContain(
        'Select a task from the backlog'
      );
      expect(ctx.state.selectedTask).toBeNull();
    });

    it('passes the collapsedSpecs flag to TaskItem.render and re-injects proposals', () => {
      ctx.state.selectedTask = makeTask({ id: 'c1' });
      ctx.state.allLoadedTasks = [makeTask({ id: 'c1' })];
      ctx.state.collapsedSpecs = new Set(['c1']);
      const renderSpy = vi.spyOn(TaskItem, 'render');

      controller.refreshSelected();

      expect(renderSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'c1' }),
        false,
        false,
        false,
        false,
        false
      );
      expect(
        host.querySelector('#selected-task-view .spec-display')!.classList.contains('expanded')
      ).toBe(false);
      expect(refresh.specProposals).toHaveBeenCalledTimes(1);
    });
  });

  describe('pending markers', () => {
    it('enters spec edit mode after markSpecEditPending + refreshSelected', () => {
      ctx.state.selectedTask = makeTask({ id: 'c1' });
      ctx.state.allLoadedTasks = [makeTask({ id: 'c1' })];

      controller.markSpecEditPending('c1');
      controller.refreshSelected();

      const edit = host.querySelector('#selected-task-view .spec-edit') as HTMLElement;
      expect(edit).not.toBeNull();
      expect(edit.classList.contains('hidden')).toBe(false);
      expect(document.activeElement).toBe(host.querySelector('#selected-task-view textarea'));
    });

    it('focuses Schedule Execution after markScheduleFocusPending + refreshSelected and clears the marker', () => {
      ctx.state.selectedTask = makeTask({ id: 'c1' });
      ctx.state.allLoadedTasks = [makeTask({ id: 'c1' })];

      controller.markScheduleFocusPending('c1');
      controller.refreshSelected();

      const scheduleBtn = host.querySelector(
        '#selected-task-view [data-action-click="schedule_task"]'
      );
      expect(scheduleBtn).not.toBeNull();
      expect(document.activeElement).toBe(scheduleBtn);
      expect(ctx.state.pendingScheduleFocusTaskId).toBeNull();
    });

    it('applyPendingScheduleFocus does not steal focus for a different task id but clears the marker', () => {
      controller.markScheduleFocusPending('c1');

      const otherCard = document.createElement('div');
      otherCard.setAttribute('data-view-id', 'c2');
      otherCard.innerHTML = '<button data-action-click="schedule_task"></button>';
      document.body.appendChild(otherCard);
      const otherButton = otherCard.querySelector('button');

      controller.applyPendingScheduleFocus(otherCard, 'c2');

      expect(document.activeElement).not.toBe(otherButton);
      expect(ctx.state.pendingScheduleFocusTaskId).toBeNull();
    });
  });

  describe('focusSpecAfterTitleSave()', () => {
    it('closes the title editor and opens/focuses the spec textarea', () => {
      const card = document.createElement('div');
      card.setAttribute('data-view-id', 'c1');
      card.innerHTML = `
        <div class="title-container">
          <div class="title-view hidden"><span class="font-medium">T</span></div>
          <div class="title-edit"><input></div>
        </div>
        <div class="spec-container">
          <div class="spec-view"></div>
          <button data-action-click="toggle_spec_expand"></button>
          <div class="spec-edit hidden"><textarea></textarea></div>
        </div>
      `;
      host.appendChild(card);
      const titleContainer = card.querySelector('.title-container') as HTMLElement;

      controller.focusSpecAfterTitleSave(titleContainer);

      expect(card.querySelector('.title-edit')!.classList.contains('hidden')).toBe(true);
      expect(card.querySelector('.title-view')!.classList.contains('hidden')).toBe(false);
      expect(card.querySelector('.spec-view')!.classList.contains('hidden')).toBe(true);
      expect(card.querySelector('.spec-edit')!.classList.contains('hidden')).toBe(false);
      expect(document.activeElement).toBe(card.querySelector('textarea'));
    });

    it('is a no-op when the owning card is missing', () => {
      const orphan = document.createElement('div');
      orphan.className = 'title-container';
      orphan.innerHTML = '<div class="title-view"></div><div class="title-edit hidden"></div>';

      expect(() => controller.focusSpecAfterTitleSave(orphan)).not.toThrow();
      // The title edit/view swap still happens locally...
      expect(orphan.querySelector('.title-edit')!.classList.contains('hidden')).toBe(true);
      expect(orphan.querySelector('.title-view')!.classList.contains('hidden')).toBe(false);
    });
  });
});
