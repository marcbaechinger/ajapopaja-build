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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PipelineDetailView } from './PipelineDetailView.ts';
import { LocalStorageManager } from '../../core/LocalStorageManager.ts';
import { TaskStatus } from '../../core/domain.ts';
import { CoderBotDialog } from '../components/CoderBotDialog.ts';
import { DiffDialog } from '../components/DiffDialog.ts';
import { ConfirmationDialog } from '../components/ConfirmationDialog.ts';
import { IteratePullRequestDialog } from '../components/IteratePullRequestDialog.ts';

vi.mock('../components/ConfirmationDialog.ts', () => ({
  ConfirmationDialog: vi.fn(function ConfirmationDialog() {
    return { show: vi.fn().mockResolvedValue(true) };
  }),
}));

// Mock components to avoid deep rendering issues in unit tests
vi.mock('../components/TaskColumn.ts', () => ({
  TaskColumn: { render: () => '<div class="mock-column">Column</div>' }
}));
vi.mock('../components/TaskForm.ts', () => ({
  TaskForm: { render: () => '<div class="mock-form">Form</div>' }
}));
vi.mock('../components/PipelineHeaderView.ts', () => ({
  PipelineHeaderView: { render: () => '<div class="mock-header">Header</div>' }
}));
vi.mock('../components/PipelineHistoryView.ts', () => ({
  PipelineHistoryView: { render: () => '<div class="mock-history">History</div>' }
}));
vi.mock('../components/PaginationControl.ts', () => ({
  PaginationControl: { render: () => '<div class="mock-pagination">Pagination</div>' }
}));
vi.mock('../components/CoderBotDialog.ts', () => ({
  CoderBotDialog: vi.fn(function CoderBotDialog() {
    return { show: vi.fn() };
  }),
}));

// Mock the iteration dialog so the view can register the iterate_pr action
// without requiring a real DOM dialog in unit tests.
vi.mock('../components/IteratePullRequestDialog.ts', () => ({
  IteratePullRequestDialog: vi.fn(function IteratePullRequestDialog() {
    return { show: vi.fn().mockResolvedValue('Review comments') };
  }),
}));

// Mock the diff dialog so triggering the action can be asserted without the
// dialog's async network load.
vi.mock('../components/DiffDialog.ts', () => ({
  DiffDialog: vi.fn(function DiffDialog() {
    return { show: vi.fn() };
  }),
}));

describe('PipelineDetailView Layout', () => {
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
      }
    };

    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key) => storage[key] || null),
      setItem: vi.fn((key, value) => { storage[key] = value; }),
    });
  });

  it('should lay out a single-column main area and put PipelineHistoryView in the right sidebar', async () => {
    mockContext.taskClient.listByPipeline.mockResolvedValue([
      { id: 'c1', title: 'Done', status: TaskStatus.IMPLEMENTED, deleted: false, version: 1, order: 0, type: 'manual', want_design_doc: false },
    ]);
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    view.mount(container);
    container.innerHTML = view.render() as string;
    await view.refreshTasks();

    expect(container.innerHTML).not.toContain('lg:grid-cols-2');
    // History no longer lives in the main content area.
    expect(container.querySelector('#col-history')).toBeNull();
    // PipelineHistoryView (mocked) renders inside the sidebar ExecutionEngineView.
    const engine = container.querySelector('#execution-engine-view');
    expect(engine).not.toBeNull();
    const historyArea = engine!.querySelector('#sidebar-history');
    expect(historyArea).not.toBeNull();
    expect(historyArea!.innerHTML).toContain('mock-history');
  });

  it('should keep PROPOSED/CREATED tasks only in the sidebar BacklogView, not the main prep column', async () => {
    mockContext.taskClient.listByPipeline.mockResolvedValue([
      { id: 'p1', title: 'Proposed Task', status: TaskStatus.PROPOSED, design_doc: '# d', deleted: false, version: 1, order: 0, type: 'manual', want_design_doc: true },
      { id: 'c1', title: 'Created Task', status: TaskStatus.CREATED, deleted: false, version: 1, order: 0, type: 'manual', want_design_doc: false },
    ]);

    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    view.mount(container);
    container.innerHTML = view.render() as string;
    await view.refreshTasks();

    // Main prep column no longer renders the old PROPOSED/BACKLOG task columns
    const colPrep = container.querySelector('#col-prep');
    expect(colPrep).not.toBeNull();
    expect(colPrep!.innerHTML).not.toContain('mock-column');

    // The sidebar BacklogView still lists both tasks
    const backlog = container.querySelector('#backlog-view');
    expect(backlog).not.toBeNull();
    expect(backlog!.innerHTML).toContain('Proposed Task');
    expect(backlog!.innerHTML).toContain('Created Task');
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

  it('should highlight the backlog row of a selected CREATED task', async () => {
    mockContext.taskClient.listByPipeline.mockResolvedValue([
      { id: 'c1', title: 'Selected Created', status: TaskStatus.CREATED, deleted: false, version: 1, order: 0, type: 'manual', want_design_doc: false },
      { id: 'c2', title: 'Other Created', status: TaskStatus.CREATED, deleted: false, version: 1, order: 10, type: 'manual', want_design_doc: false },
    ]);

    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    view.mount(container);
    container.innerHTML = view.render() as string;
    await view.refreshTasks();

    const selectAction = mockContext.actionRegistry.register.mock.calls.find((c: any) => c[0] === 'select_task')![1];
    const el = document.createElement('div');
    el.setAttribute('data-view-id', 'c1');
    selectAction(new Event('click'), el);

    const backlog = container.querySelector('#backlog-view') as HTMLElement;
    const rowRe = /<div class="([^"]*group rounded-lg[^"]*)"[^>]*data-view-id="([^"]*)"/g;
    const rows: { id: string, cls: string }[] = [];
    let m: RegExpExecArray | null;
    while ((m = rowRe.exec(backlog.innerHTML)) !== null) rows.push({ id: m[2], cls: m[1] });

    const c1 = rows.find(r => r.id === 'c1')!;
    const c2 = rows.find(r => r.id === 'c2')!;
    expect(c1.cls).toContain('border-app-accent-1/70');
    expect(c1.cls).toContain('bg-app-accent-1/10');
    expect(c1.cls).toContain('ring-app-accent-1/40');
    expect(c2.cls).not.toContain('border-app-accent-1/70');
    expect(c2.cls).not.toContain('bg-app-accent-1/10');
  });

  it('should not highlight a selected PROPOSED task in the backlog', async () => {
    mockContext.taskClient.listByPipeline.mockResolvedValue([
      { id: 'p1', title: 'Selected Proposed', design_doc: '# d', status: TaskStatus.PROPOSED, deleted: false, version: 1, order: 0, type: 'manual', want_design_doc: true },
    ]);

    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    view.mount(container);
    container.innerHTML = view.render() as string;
    await view.refreshTasks();

    const selectAction = mockContext.actionRegistry.register.mock.calls.find((c: any) => c[0] === 'select_task')![1];
    const el = document.createElement('div');
    el.setAttribute('data-view-id', 'p1');
    selectAction(new Event('click'), el);

    const backlog = container.querySelector('#backlog-view') as HTMLElement;
    expect(backlog.innerHTML).toContain('data-view-id="p1"');
    expect(backlog.innerHTML).not.toContain('border-app-accent-1/70');
    expect(backlog.innerHTML).not.toContain('bg-app-accent-1/10');
    expect(backlog.innerHTML).not.toContain('ring-app-accent-1/40');
  });

  it('should update a task order via the update_task_order action', async () => {
    mockContext.taskClient.listByPipeline.mockResolvedValue([]);
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    view.mount(container);
    await view.refreshTasks();

    const updateOrderAction = mockContext.actionRegistry.register.mock.calls.find((c: any) => c[0] === 'update_task_order')![1];
    const containerEl = document.createElement('div');
    containerEl.setAttribute('data-view-id', 't1');
    const input = document.createElement('input');
    input.type = 'number';
    input.value = '25';
    input.setAttribute('data-task-id', 't1');
    input.setAttribute('data-version', '3');
    containerEl.appendChild(input);

    await updateOrderAction(new Event('change'), input);

    expect(mockContext.taskClient.updateDetails).toHaveBeenCalledWith('t1', 3, { order: 25 });
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

  it('should render scheduled tasks in the right ExecutionEngineView and remove them when unscheduled', async () => {
    let tasksHandler: ((payload: any) => void) | undefined;
    mockContext.dataManager.on = vi.fn((query: string, cb: any) => {
      if (query.startsWith('pipeline:tasks:')) tasksHandler = cb;
      return () => {};
    });
    mockContext.taskClient.listByPipeline.mockResolvedValue([]);

    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    view.mount(container);
    container.innerHTML = view.render() as string;
    await view.refreshTasks();

    const engine = container.querySelector('#execution-engine-view');
    expect(engine).not.toBeNull();
    expect(engine!.querySelectorAll('[data-view-id="s1"]').length).toBe(0);

    const scheduledTask: any = { id: 's1', title: 'Sched', status: TaskStatus.SCHEDULED, deleted: false, version: 1, order: 0, type: 'manual', want_design_doc: false };

    // the scheduling operation can produce a duplicate WS notification
    tasksHandler!(scheduledTask);
    tasksHandler!(scheduledTask);
    expect(engine!.querySelectorAll('[data-view-id="s1"]').length).toBe(1);

    // moving back to CREATED must remove the task from the ExecutionEngineView
    tasksHandler!({ id: 's1', title: 'Sched', status: TaskStatus.CREATED, deleted: false, version: 2, order: 0, type: 'manual', want_design_doc: false });
    expect(engine!.querySelectorAll('[data-view-id="s1"]').length).toBe(0);
  });
});

describe('PipelineDetailView save_title no-op', () => {
  let mockContext: any;
  let container: HTMLElement;

  const getAction = (name: string) =>
    mockContext.actionRegistry.register.mock.calls.find((c: any) => c[0] === name)![1];

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    LocalStorageManager.resetInstances();
    vi.clearAllMocks();

    mockContext = {
      actionRegistry: { register: vi.fn() },
      wsClient: { on: vi.fn().mockReturnValue(() => {}) },
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
      pullRequestClient: { getPullRequestsByPipeline: vi.fn().mockResolvedValue([]) },
      systemClient: {
        isOllamaAvailable: vi.fn().mockResolvedValue(true),
      },
    };

    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    });
  });

  const makeTitleContainer = (taskId: string, title: string) => {
    const el = document.createElement('div');
    el.className = 'title-container';
    el.setAttribute('data-task-id', taskId);
    el.setAttribute('data-version', '1');
    el.innerHTML = `
      <div class="title-view"><span class="font-medium">${title}</span></div>
      <div class="title-edit"><input value="${title}"></div>
    `;
    return el;
  };

  it('should be a no-op (no updateDetails) and swallow the event when the title is unchanged', async () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    view.mount(container);

    const saveTitle = getAction('save_title');
    const titleContainer = makeTitleContainer('t1', 'Existing Title');
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };

    await saveTitle(event as any, titleContainer);

    expect(mockContext.taskClient.updateDetails).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
  });

  it('should still save when the title actually changes', async () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    view.mount(container);

    const saveTitle = getAction('save_title');
    const titleContainer = makeTitleContainer('t1', 'Existing Title');
    const input = titleContainer.querySelector('input') as HTMLInputElement;
    input.value = 'Brand New Title';
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() };

    await saveTitle(event as any, titleContainer);

    expect(mockContext.taskClient.updateDetails).toHaveBeenCalledTimes(1);
    expect(mockContext.taskClient.updateDetails).toHaveBeenCalledWith('t1', 1, { title: 'Brand New Title' });
  });
});

describe('PipelineDetailView Review Notifications', () => {
  let mockContext: any;
  let container: HTMLElement;
  let dataManagerHandlers: Record<string, Function> = {};

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    dataManagerHandlers = {};
    LocalStorageManager.resetInstances();

    mockContext = {
      actionRegistry: {
        register: vi.fn(),
      },
      wsClient: {
        on: vi.fn(),
      },
      dataManager: {
        on: vi.fn((event, handler) => {
          dataManagerHandlers[event] = handler;
          return () => {};
        }),
        updateTask: vi.fn(),
        updatePipeline: vi.fn(),
      },
      authService: {
        getUser: vi.fn(),
        getAccessToken: vi.fn(),
      },
      pipelineClient: {
        get: vi.fn().mockResolvedValue({ id: 'p1' }),
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
      }
    };
  });

  it('should track pending reviews from REVIEWBOT_REVIEW_READY events', async () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    view.mount(container);

    // Get the handler for ws events
    const wsHandler = dataManagerHandlers['ws:REVIEWBOT_REVIEW_READY:p1'];
    expect(wsHandler).toBeDefined();

    // Trigger two events
    wsHandler({ id: 't1', pipeline_id: 'p1' });
    wsHandler({ id: 't2', pipeline_id: 'p1' });

    // Internal state should have them
    expect((view as any).pendingReviews).toEqual(['t1', 't2']);
    expect(localStorage.setItem).toHaveBeenCalledWith('pipeline:pending_reviews:p1', JSON.stringify(['t1', 't2']));
  });

  it('should remove pending review and update localStorage when open_review_dialog is triggered', async () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    view.mount(container);

    // Mock loaded tasks so open dialog doesn't early return
    (view as any).allLoadedTasks = [{ id: 't1' }, { id: 't2' }];

    // Set internal state
    (view as any).pendingReviews = ['t1', 't2'];

    // Get the action
    const openReviewAction = mockContext.actionRegistry.register.mock.calls.find((c: any) => c[0] === 'open_review_dialog')[1];
    expect(openReviewAction).toBeDefined();

    // Create a mock element that has data-task-id
    const el = document.createElement('button');
    el.setAttribute('data-task-id', 't1');

    // Call action
    try {
        await openReviewAction(null, el);
    } catch (e) {}

    // Should be removed
    expect((view as any).pendingReviews).toEqual(['t2']);
    expect(localStorage.setItem).toHaveBeenCalledWith('pipeline:pending_reviews:p1', JSON.stringify(['t2']));
  });
});


describe('PipelineDetailView Pull Request Insert', () => {
  let mockContext: any;
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    LocalStorageManager.resetInstances();
    vi.clearAllMocks();

    mockContext = {
      actionRegistry: {
        register: vi.fn(),
      },
      wsClient: { on: vi.fn() },
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
      },
      pullRequestClient: {
        getPullRequestsByPipeline: vi.fn().mockResolvedValue([]),
      },
      systemClient: {
        isOllamaAvailable: vi.fn().mockResolvedValue(true),
      },
    };

    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    });
  });

  /**
   * Simulates the PULL_REQUEST_CREATED websocket message arriving while the
   * view is mounted, then waits for the (lightweight) async refresh to settle.
   */
  const handlePullRequestCreated = async (newPrs: any[]) => {
    const wsHandler = mockContext.dataManager.on.mock.calls.find((c: any) => c[0] === 'ws:PULL_REQUEST_CREATED:p1');
    expect(wsHandler).toBeDefined();
    const handler = wsHandler[1];
    mockContext.pullRequestClient.getPullRequestsByPipeline.mockResolvedValue(newPrs);
    // The handler is async but the DataManager listener wrapper calls it without
    // awaiting, so wait a tick for the fetch to resolve.
    handler({ task_id: 't1' });
    await new Promise(resolve => setTimeout(resolve, 0));
  };

  it('renders the pull request section inside a dedicated container', async () => {
    const pr: any = {
      id: 'pr1',
      _id: 'pr1',
      pipeline_id: 'p1',
      task_id: 't1',
      subject: 'My PR',
      branch_name: 'feature/x',
      status: 'open',
      created_at: '2026-04-12T10:00:00Z',
    };
    mockContext.pullRequestClient.getPullRequestsByPipeline.mockResolvedValue([pr]);

    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    container.innerHTML = view.render() as string;
    view.mount(container);

    // loadPipeline() (async) fetches the PRs and re-renders the prep column via
    // fetchPullRequests -> refreshTasks; wait for that to settle.
    await new Promise(resolve => setTimeout(resolve, 0));
    await new Promise(resolve => setTimeout(resolve, 0));

    const section = container.querySelector('#pull-request-section');
    expect(section).not.toBeNull();
    expect(section!.innerHTML).toContain('My PR');
  });

  it('inserts a PULL_REQUEST_CREATED update precisely without re-rendering the rest of the page', async () => {
    mockContext.pullRequestClient.getPullRequestsByPipeline.mockResolvedValue([]);
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await view.refreshTasks();

    const selectedView = container.querySelector('#selected-task-view') as HTMLElement;
    const engine = container.querySelector('#execution-engine-view') as HTMLElement;
    const backlog = container.querySelector('#backlog-view') as HTMLElement;
    const before = {
      selected: selectedView.innerHTML,
      engine: engine.innerHTML,
      backlog: backlog.innerHTML,
    };
    const listCallsBefore = mockContext.taskClient.listByPipeline.mock.calls.length;

    // A new PR arrives over the websocket.
    const newPr: any = {
      id: 'pr2',
      _id: 'pr2',
      pipeline_id: 'p1',
      task_id: 't2',
      subject: 'Freshly Created PR',
      branch_name: 'feature/y',
      status: 'open',
      created_at: '2026-04-12T11:00:00Z',
    };
    await handlePullRequestCreated([newPr]);

    // Only the pull request section was touched.
    const section = container.querySelector('#pull-request-section');
    expect(section!.innerHTML).toContain('Freshly Created PR');
    expect(selectedView.innerHTML).toBe(before.selected);
    expect(engine.innerHTML).toBe(before.engine);
    expect(backlog.innerHTML).toBe(before.backlog);

    // The lightweight insert never re-publishes tasks through the DataManager
    // (which would have cascaded into per-task page-wide re-renders).
    expect(mockContext.dataManager.updateTask).not.toHaveBeenCalled();
    // And it does not trigger a heavy full-task refresh (no extra listByPipeline).
    expect(mockContext.taskClient.listByPipeline.mock.calls.length).toBe(listCallsBefore);
  });
});


describe('PipelineDetailView CoderBot Dialog', () => {
  let mockContext: any;
  let container: HTMLElement;

  const getAction = (name: string) =>
    mockContext.actionRegistry.register.mock.calls.find((c: any) => c[0] === name)[1];

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    LocalStorageManager.resetInstances();
    vi.clearAllMocks();

    mockContext = {
      actionRegistry: {
        register: vi.fn(),
      },
      wsClient: { on: vi.fn() },
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
      },
      pullRequestClient: { getPullRequestsByPipeline: vi.fn().mockResolvedValue([]) },
      systemClient: {
        isOllamaAvailable: vi.fn().mockResolvedValue(true),
      },
      coderBotService: {
        getHistory: vi.fn(() => []),
        getCurrentTaskId: vi.fn(() => null),
        isActive: vi.fn(() => false),
        getSessionStartTime: vi.fn(() => null),
        onSessionStartTimeChange: vi.fn(() => () => {}),
        clearHistory: vi.fn(),
        stopSession: vi.fn().mockResolvedValue({}),
        onBlocks: vi.fn(() => () => {}),
        onMessage: vi.fn(() => () => {}),
        onSessionStateChange: vi.fn(() => () => {}),
        getCurrentSession: vi.fn(() => null),
        refreshSession: vi.fn().mockResolvedValue(null),
        reconnect: vi.fn().mockResolvedValue(undefined),
      },
      coderBotClient: { triggerCoderBot: vi.fn().mockResolvedValue({}) },
    };

    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    });
  });

  it('should mount the inline CoderBot PiView instead of opening the dialog after a successful trigger', async () => {
    mockContext.taskClient.listByPipeline.mockResolvedValue([
      { id: 't1', title: 'Task One', status: 'CREATED', deleted: false, version: 1, order: 0, type: 'manual', want_design_doc: false },
    ]);

    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    container.innerHTML = view.render() as string;
    view.mount(container);

    // a CoderBot session is now running for THIS pipeline
    mockContext.coderBotService.getCurrentSession.mockReturnValue({ pipelineId: 'p1', taskId: 't1', active: true });

    const triggerCoderbot = getAction('trigger_coderbot');
    const el = document.createElement('button');
    el.setAttribute('data-task-id', 't1');

    await triggerCoderbot(null, el);

    expect(mockContext.coderBotClient.triggerCoderBot).toHaveBeenCalledWith('t1');
    expect(CoderBotDialog).not.toHaveBeenCalled();
    expect((view as any).enginePiView).not.toBeNull();

    // Optimistic state updated alongside enabling the inline PiView
    expect((view as any).coderbotState).toEqual({ status: 'inProgress', taskId: 't1' });
    const task = (view as any).allLoadedTasks.find((t: any) => t.id === 't1');
    expect(task).toBeTruthy();
    expect(task.status).toEqual('inprogress');
    expect(mockContext.dataManager.updateTask).toHaveBeenCalledWith(task);
  });

  it('should not open CoderBotDialog when the trigger fails', async () => {
    mockContext.coderBotClient.triggerCoderBot = vi.fn().mockRejectedValue(new Error('boom'));
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {});

    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    view.mount(container);

    const triggerCoderbot = getAction('trigger_coderbot');
    const el = document.createElement('button');
    el.setAttribute('data-task-id', 't1');

    await triggerCoderbot(null, el);

    expect(CoderBotDialog).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledWith('Failed to trigger CoderBot');
    alertSpy.mockRestore();
  });

  it('should still open CoderBotDialog via the manual open_coderbot_dialog action', () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    view.mount(container);

    const openCoderBotDialog = getAction('open_coderbot_dialog');
    const e = { preventDefault: vi.fn() };
    openCoderBotDialog(e);

    expect(e.preventDefault).toHaveBeenCalled();
    expect(CoderBotDialog).toHaveBeenCalledTimes(1);
    expect(CoderBotDialog).toHaveBeenCalledWith(mockContext.coderBotService);
    const shownDialog = (CoderBotDialog as any).mock.results[0].value;
    expect(shownDialog.show).toHaveBeenCalled();
  });

  it('re-mounts the engine PiView after the engine view re-renders', async () => {
    mockContext.coderBotService.getCurrentSession.mockReturnValue({ pipelineId: 'p1', taskId: 't1', active: true });
    mockContext.taskClient.listByPipeline.mockResolvedValue([]);

    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await view.refreshTasks();

    const initial = container.querySelector('#engine-piview-mount');
    expect(initial?.querySelector('#log-content-container')).not.toBeNull();

    // A second refresh re-renders the engine view (wiping the PiView DOM). The
    // PiView must be re-mounted so the log reappears instead of the placeholder.
    await view.refreshTasks();
    const after = container.querySelector('#engine-piview-mount');
    expect(after?.querySelector('#log-content-container')).not.toBeNull();
    expect(after?.querySelector('#log-content-container')?.parentElement).toBe(after);
  });
});

describe('PipelineDetailView Accept Pull Request', () => {
  let mockContext: any;
  let container: HTMLElement;

  const getAction = (name: string) =>
    mockContext.actionRegistry.register.mock.calls.find((c: any) => c[0] === name)[1];

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    LocalStorageManager.resetInstances();
    vi.clearAllMocks();

    mockContext = {
      actionRegistry: {
        register: vi.fn(),
      },
      wsClient: { on: vi.fn() },
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
      },
      pullRequestClient: {
        getPullRequestsByPipeline: vi.fn().mockResolvedValue([]),
        acceptPullRequest: vi.fn().mockResolvedValue({}),
        iteratePullRequest: vi.fn().mockResolvedValue({}),
      },
      systemClient: {
        isOllamaAvailable: vi.fn().mockResolvedValue(true),
      },
    };

    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    });
  });

  it('should register the accept_pr action', () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    view.mount(container);

    const acceptAction = getAction('accept_pr');
    expect(acceptAction).toBeDefined();
  });

  it('should call acceptPullRequest and refresh after confirmation', async () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    view.mount(container);
    const fetchPullRequestsSpy = vi.spyOn(view as any, 'fetchPullRequests').mockResolvedValue(undefined);

    const acceptAction = getAction('accept_pr');
    const el = document.createElement('button');
    el.setAttribute('data-pr-id', 'pr1');

    await acceptAction(null, el);

    expect(mockContext.pullRequestClient.acceptPullRequest).toHaveBeenCalledWith('pr1');
    expect(fetchPullRequestsSpy).toHaveBeenCalled();
  });

  it('should not call acceptPullRequest when the confirmation is cancelled', async () => {
    (ConfirmationDialog as any).mockImplementationOnce(function CancelledDialog() {
      return { show: vi.fn().mockResolvedValue(false) };
    });

    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    view.mount(container);

    const acceptAction = getAction('accept_pr');
    const el = document.createElement('button');
    el.setAttribute('data-pr-id', 'pr1');

    await acceptAction(null, el);

    expect(mockContext.pullRequestClient.acceptPullRequest).not.toHaveBeenCalled();
  });

  it('should not call acceptPullRequest when data-pr-id is missing', async () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    view.mount(container);

    const acceptAction = getAction('accept_pr');
    const el = document.createElement('button');

    await acceptAction(null, el);

    expect(mockContext.pullRequestClient.acceptPullRequest).not.toHaveBeenCalled();
  });

  it('should register the iterate_pr action', () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    view.mount(container);

    const iterateAction = getAction('iterate_pr');
    expect(iterateAction).toBeDefined();
  });

  it('should open the dialog and call iteratePullRequest on confirm', async () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    view.mount(container);

    const iterateAction = getAction('iterate_pr');
    const el = document.createElement('button');
    el.setAttribute('data-pr-id', 'pr1');
    el.setAttribute('data-task-id', 't1');

    await iterateAction(null, el);

    expect(mockContext.pullRequestClient.iteratePullRequest).toHaveBeenCalledWith('pr1', 'Review comments');
  });

  it('should not call iteratePullRequest when the dialog is cancelled', async () => {
    (IteratePullRequestDialog as any).mockImplementationOnce(function CancelledDialog() {
      return { show: vi.fn().mockResolvedValue(null) };
    });

    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    view.mount(container);

    const iterateAction = getAction('iterate_pr');
    const el = document.createElement('button');
    el.setAttribute('data-pr-id', 'pr1');
    el.setAttribute('data-task-id', 't1');

    await iterateAction(null, el);

    expect(mockContext.pullRequestClient.iteratePullRequest).not.toHaveBeenCalled();
  });

  it('should not call iteratePullRequest when data-pr-id is missing', async () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    view.mount(container);

    const iterateAction = getAction('iterate_pr');
    const el = document.createElement('button');

    await iterateAction(null, el);

    expect(mockContext.pullRequestClient.iteratePullRequest).not.toHaveBeenCalled();
  });
});


describe('PipelineDetailView Commit Diff', () => {
  let mockContext: any;
  let container: HTMLElement;

  const getAction = (name: string) =>
    mockContext.actionRegistry.register.mock.calls.find((c: any) => c[0] === name)![1];

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    LocalStorageManager.resetInstances();
    vi.clearAllMocks();

    mockContext = {
      actionRegistry: { register: vi.fn() },
      wsClient: { on: vi.fn().mockReturnValue(() => {}) },
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
        getCommitDiff: vi.fn().mockResolvedValue({}),
      },
      taskClient: {
        listByPipeline: vi.fn().mockResolvedValue([]),
        listCompletedByPipeline: vi.fn().mockResolvedValue({ tasks: [], total_count: 0 }),
      },
      pullRequestClient: { getPullRequestsByPipeline: vi.fn().mockResolvedValue([]) },
      systemClient: {
        isOllamaAvailable: vi.fn().mockResolvedValue(true),
      },
      // The legacy Neovim client is still referenced by other actions; the diff
      // handler must no longer call it.
      editorClient: { diffViewOpen: vi.fn() },
    };

    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    });
  });

  it('opens a DiffDialog with the task commit hash instead of calling the editor client', async () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    view.mount(container);
    (view as any).allLoadedTasks = [
      { id: 't1', title: 'Task One', commit_hash: 'abcdef123456' },
    ];

    const action = getAction('open_diff_view');
    const el = document.createElement('button');
    el.setAttribute('data-commit-hash', 'abcdef123456');
    el.setAttribute('data-task-id', 't1');

    await action(null, el);

    expect(DiffDialog).toHaveBeenCalledTimes(1);
    expect(DiffDialog).toHaveBeenCalledWith(
      expect.objectContaining({
        pipelineId: 'p1',
        commitHash: 'abcdef123456',
        title: 'Task One',
      })
    );
    const dialog = (DiffDialog as any).mock.results[0].value;
    expect(dialog.show).toHaveBeenCalled();
    expect(mockContext.editorClient.diffViewOpen).not.toHaveBeenCalled();
  });

  it('does nothing when the element has no commit hash', async () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    view.mount(container);

    const action = getAction('open_diff_view');
    const el = document.createElement('button');

    await action(null, el);

    expect(DiffDialog).not.toHaveBeenCalled();
  });
});
