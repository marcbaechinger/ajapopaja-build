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
import { PipelineDetailView } from './PipelineDetailView.ts';
import { LocalStorageManager } from '../../core/LocalStorageManager.ts';
import { TaskStatus } from '../../core/domain.ts';
import { CoderBotDialog } from '../components/CoderBotDialog.ts';
import { DevServerDialog } from '../components/DevServerDialog.ts';
import { DiffDialog } from '../components/DiffDialog.ts';
import { ConfirmationDialog } from '../components/ConfirmationDialog.ts';
import { IteratePullRequestDialog } from '../components/IteratePullRequestDialog.ts';
import { InteractiveCodingView } from '../components/InteractiveCodingView.ts';
import { setTaskSpecProposalUpdater } from '../components/SpecSection.ts';

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

vi.mock('../components/DevServerDialog.ts', () => ({
  DevServerDialog: vi.fn(function DevServerDialog() {
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

// Mock the interactive coding view so its inner PiView is not mounted in unit
// tests; the host slot/toggle behaviour is what is under test here.
vi.mock('../components/InteractiveCodingView.ts', () => ({
  InteractiveCodingView: vi.fn(function InteractiveCodingView() {
    return {
      render: vi.fn(),
      destroy: vi.fn(),
      sendMessage: vi.fn(),
      pauseSession: vi.fn(),
    };
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

  it('should collapse and expand the backlog sidebar and persist the state', async () => {
    mockContext.taskClient.listByPipeline.mockResolvedValue([]);
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await view.refreshTasks();

    const sidebar = container.querySelector('#backlog-sidebar') as HTMLElement;
    expect(sidebar).not.toBeNull();
    expect(sidebar.classList.contains('hidden')).toBe(false);

    const toggle = mockContext.actionRegistry.register.mock.calls.find((c: any) => c[0] === 'toggle_backlog_sidebar')![1];
    expect(toggle).toBeDefined();

    toggle(new Event('click'), container.querySelector('#backlog-sidebar-toggle') as HTMLElement);
    expect(sidebar.classList.contains('hidden')).toBe(true);
    expect(storage['pipeline:sidebar_collapsed:p1']).toBe('true');

    toggle(new Event('click'), container.querySelector('#backlog-sidebar-toggle') as HTMLElement);
    expect(sidebar.classList.contains('hidden')).toBe(false);
    expect(storage['pipeline:sidebar_collapsed:p1']).toBe('false');
  });

  it('should restore a collapsed backlog sidebar from persisted state', () => {
    storage['pipeline:sidebar_collapsed:p1'] = 'true';
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    container.innerHTML = view.render() as string;
    view.mount(container);

    const sidebar = container.querySelector('#backlog-sidebar') as HTMLElement;
    expect(sidebar.classList.contains('hidden')).toBe(true);
    // The toggle remains reachable so the sidebar can be expanded again.
    expect(container.querySelector('#backlog-sidebar-toggle')).not.toBeNull();
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

describe('PipelineDetailView Dev Server', () => {
  let mockContext: any;
  let container: HTMLElement;
  let dataManagerHandlers: Record<string, Function> = {};

  const getAction = (name: string) =>
    mockContext.actionRegistry.register.mock.calls.find((c: any) => c[0] === name)![1];

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    dataManagerHandlers = {};
    LocalStorageManager.resetInstances();
    vi.clearAllMocks();

    mockContext = {
      actionRegistry: { register: vi.fn() },
      wsClient: { on: vi.fn() },
      dataManager: {
        on: vi.fn((event: string, handler: Function) => {
          dataManagerHandlers[event] = handler;
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
        getDevServerStatus: vi.fn().mockResolvedValue({
          running: true,
          pid: 5,
          port: 1224,
          status: 'running',
          exit_code: null,
          run_id: 'r1',
        }),
      },
      taskClient: {
        listByPipeline: vi.fn().mockResolvedValue([]),
        listCompletedByPipeline: vi.fn().mockResolvedValue({ tasks: [], total_count: 0 }),
      },
      pullRequestClient: { getPullRequestsByPipeline: vi.fn().mockResolvedValue([]) },
      systemClient: { isOllamaAvailable: vi.fn().mockResolvedValue(true) },
    };

    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    });
  });

  it('loads the dev server status and sets the running indicator', async () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    view.mount(container);
    await view.loadPipeline();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockContext.pipelineClient.getDevServerStatus).toHaveBeenCalledWith('p1');
    expect((view as any).devProcessState).toEqual({ running: true, pid: 5, port: 1224 });
  });

  it('updates the indicator from DEV_PROCESS_STARTED/EXITED events', () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    view.mount(container);

    expect(dataManagerHandlers['ws:DEV_PROCESS_STARTED:p1']).toBeDefined();
    dataManagerHandlers['ws:DEV_PROCESS_STARTED:p1']({
      pid: 9,
      port: 1224,
      pipeline_id: 'p1',
    });
    expect((view as any).devProcessState).toEqual({ running: true, pid: 9, port: 1224 });

    dataManagerHandlers['ws:DEV_PROCESS_EXITED:p1']({ pipeline_id: 'p1', exit_code: 0 });
    expect((view as any).devProcessState).toEqual({ running: false, pid: null, port: null });
  });

  it('opens the DevServerDialog from the open_dev_server_dialog action', () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    view.mount(container);

    const action = getAction('open_dev_server_dialog');
    action(null, document.createElement('button'));

    expect(DevServerDialog).toHaveBeenCalledTimes(1);
    expect(DevServerDialog).toHaveBeenCalledWith(mockContext, 'p1');
  });
});

describe('PipelineDetailView Interactive Session', () => {
  let mockContext: any;
  let container: HTMLElement;
  let dataManagerHandlers: Record<string, Function> = {};
  let sessionsListener: ((sessions: any[]) => void) | null = null;

  const getAction = (name: string) =>
    mockContext.actionRegistry.register.mock.calls.find((c: any) => c[0] === name)![1];

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    dataManagerHandlers = {};
    sessionsListener = null;
    LocalStorageManager.resetInstances();
    vi.clearAllMocks();

    mockContext = {
      actionRegistry: { register: vi.fn(), execute: vi.fn() },
      wsClient: { on: vi.fn() },
      dataManager: {
        on: vi.fn((event: string, handler: Function) => {
          dataManagerHandlers[event] = handler;
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
        get: vi.fn().mockResolvedValue({
          id: 'p1',
          name: 'Pipe 1',
          repo_uri: 'https://github.com/example/repo.git',
        }),
        getGitStatus: vi.fn().mockResolvedValue({ staged: 0, unstaged: 0, untracked: 0 }),
      },
      taskClient: {
        listByPipeline: vi.fn().mockResolvedValue([]),
        listCompletedByPipeline: vi.fn().mockResolvedValue({ tasks: [], total_count: 0 }),
      },
      pullRequestClient: { getPullRequestsByPipeline: vi.fn().mockResolvedValue([]) },
      systemClient: { isOllamaAvailable: vi.fn().mockResolvedValue(true) },
      coderBotService: {
        getCurrentSession: vi.fn(() => null),
        refreshSession: vi.fn().mockResolvedValue(null),
        onSessionChange: vi.fn(() => () => {}),
        reconnect: vi.fn().mockResolvedValue(undefined),
      },
      interactiveCodingService: {
        getCurrentSession: vi.fn(() => null),
        refreshSession: vi.fn().mockResolvedValue(null),
        onSessionChange: vi.fn(() => () => {}),
        startSession: vi.fn().mockResolvedValue(undefined),
        stopSession: vi.fn().mockResolvedValue(undefined),
        pauseSession: vi.fn().mockResolvedValue(undefined),
        getSessions: vi.fn().mockReturnValue([]),
        onSessionsChange: vi.fn((listener: (sessions: any[]) => void) => {
          sessionsListener = listener;
          return () => {
            sessionsListener = null;
          };
        }),
      },
      fileBrowserClient: {
        listDirectory: vi.fn().mockResolvedValue({ path: '', parent: null, entries: [] }),
        readFile: vi.fn().mockResolvedValue({ path: 'a.txt', name: 'a.txt', content: '' }),
        getMeta: vi.fn(),
      },
    };

    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    });
  });

  it('shows the start button for remote pipelines', async () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await view.loadPipeline();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const startBtn = container.querySelector('#start-interactive-btn') as HTMLElement;
    expect(startBtn).not.toBeNull();
    expect(startBtn.classList.contains('hidden')).toBe(false);
  });

  it('hides the start button for local pipelines', async () => {
    mockContext.pipelineClient.get.mockResolvedValue({ id: 'p1', name: 'Pipe 1' });
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await view.loadPipeline();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const startBtn = container.querySelector('#start-interactive-btn') as HTMLElement;
    expect(startBtn.classList.contains('hidden')).toBe(true);
  });

  it('collapses the interactive session bar and list when there are no session controls', async () => {
    mockContext.pipelineClient.get.mockResolvedValue({ id: 'p1', name: 'Pipe 1' });
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await view.loadPipeline();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const bar = container.querySelector('#interactive-session-bar') as HTMLElement;
    const sessionList = container.querySelector('#pipeline-session-list') as HTMLElement;
    expect(bar).not.toBeNull();
    expect(bar.classList.contains('hidden')).toBe(true);
    expect(sessionList.classList.contains('hidden')).toBe(true);
  });

  it('keeps the interactive session bar visible for the start control but hides the empty session list', async () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await view.loadPipeline();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const bar = container.querySelector('#interactive-session-bar') as HTMLElement;
    const sessionList = container.querySelector('#pipeline-session-list') as HTMLElement;
    expect(bar.classList.contains('hidden')).toBe(false);
    expect(sessionList.classList.contains('hidden')).toBe(true);
  });

  it('shows the session bar and list when a paused session can be resumed', async () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await view.loadPipeline();

    mockContext.interactiveCodingService.getSessions.mockReturnValue([
      { uid: 's1', pipeline_id: 'p1', status: 'paused', label: 'Paused session' },
    ]);
    (view as any).updateContentTabs();

    const bar = container.querySelector('#interactive-session-bar') as HTMLElement;
    const sessionList = container.querySelector('#pipeline-session-list') as HTMLElement;
    expect(bar.classList.contains('hidden')).toBe(false);
    expect(sessionList.classList.contains('hidden')).toBe(false);
    expect(sessionList.querySelector('[data-session-uid="s1"]')).not.toBeNull();
  });

  it('start_interactive_session calls the service for remote pipelines', async () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await view.loadPipeline();

    const action = getAction('start_interactive_session');
    await action(null, document.createElement('button'));

    expect(mockContext.interactiveCodingService.startSession).toHaveBeenCalledWith('p1');
  });

  it('start_interactive_session is a no-op for local pipelines', async () => {
    mockContext.pipelineClient.get.mockResolvedValue({ id: 'p1', name: 'Pipe 1' });
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await view.loadPipeline();

    const action = getAction('start_interactive_session');
    await action(null, document.createElement('button'));

    expect(mockContext.interactiveCodingService.startSession).not.toHaveBeenCalled();
  });

  it('shows the InteractiveCodingView XOR the TaskItem and switches on start/stop', async () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await view.loadPipeline();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const selected = container.querySelector('#selected-task-view') as HTMLElement;
    const mount = container.querySelector('#interactive-coding-view-mount') as HTMLElement;
    expect(selected.classList.contains('hidden')).toBe(false);
    expect(mount.classList.contains('hidden')).toBe(true);

    // The session starts (e.g. from another tab): the handler re-attaches and
    // switches into interactive mode.
    mockContext.interactiveCodingService.getCurrentSession.mockReturnValue({
      pipelineId: 'p1',
      active: true,
      busy: false,
    });
    mockContext.interactiveCodingService.refreshSession.mockResolvedValue({
      pipelineId: 'p1',
      active: true,
      busy: false,
    });

    dataManagerHandlers['ws:INTERACTIVE_STARTED:p1']({ pipeline_id: 'p1' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(InteractiveCodingView).toHaveBeenCalled();
    expect((view as any).contentTab).toBe('coding-agent');
    expect(selected.classList.contains('hidden')).toBe(true);
    expect(mount.classList.contains('hidden')).toBe(false);

    // Toggling back shows the TaskItem while keeping the session mounted.
    getAction('toggle_interactive_view')(null, document.createElement('button'));
    expect(selected.classList.contains('hidden')).toBe(false);
    expect(mount.classList.contains('hidden')).toBe(true);

    // Stopping switches back to the TaskItem and tears the view down.
    mockContext.interactiveCodingService.getCurrentSession.mockReturnValue({
      pipelineId: 'p1',
      active: false,
      busy: false,
    });
    dataManagerHandlers['ws:INTERACTIVE_STOPPED:p1']({ pipeline_id: 'p1' });
    expect((view as any).contentTab).toBe('task-editor');
    expect(selected.classList.contains('hidden')).toBe(false);
    expect(mount.classList.contains('hidden')).toBe(true);
    expect((view as any).interactiveCodingView).toBeNull();
  });

  it('shows Task editor / Coding Agent tabs and switches between the two DOM fragments without re-rendering', async () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await view.loadPipeline();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const tablist = container.querySelector('#content-tablist') as HTMLElement;
    expect(tablist).not.toBeNull();
    // The tab list is always visible; without a session the Coding Agent tab is
    // hidden. The removed redundant buttons are gone from the DOM.
    expect(tablist.classList.contains('hidden')).toBe(false);
    const initialCodingTab = container.querySelector('#tab-coding-agent') as HTMLElement;
    expect(initialCodingTab.classList.contains('hidden')).toBe(true);
    expect(container.querySelector('#toggle-interactive-btn')).toBeNull();
    expect(container.querySelector('#stop-interactive-btn')).toBeNull();
    expect(container.querySelector('#manage-sessions-btn')).toBeNull();

    // A session starts: the tabs appear and the Coding Agent tab becomes active.
    mockContext.interactiveCodingService.getCurrentSession.mockReturnValue({
      pipelineId: 'p1',
      active: true,
      busy: false,
    });
    mockContext.interactiveCodingService.refreshSession.mockResolvedValue({
      pipelineId: 'p1',
      active: true,
      busy: false,
    });
    dataManagerHandlers['ws:INTERACTIVE_STARTED:p1']({ pipeline_id: 'p1' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const selected = container.querySelector('#selected-task-view') as HTMLElement;
    const mount = container.querySelector('#interactive-coding-view-mount') as HTMLElement;
    const taskTab = container.querySelector('#tab-task-editor') as HTMLElement;
    const codingTab = container.querySelector('#tab-coding-agent') as HTMLElement;
    expect(tablist.classList.contains('hidden')).toBe(false);
    expect(taskTab.textContent).toContain('Task editor');
    expect(codingTab.textContent).toContain('Coding Agent');
    expect(codingTab.getAttribute('aria-selected')).toBe('true');
    expect(taskTab.getAttribute('aria-selected')).toBe('false');
    expect(selected.classList.contains('hidden')).toBe(true);
    expect(mount.classList.contains('hidden')).toBe(false);

    const mountCountBefore = (InteractiveCodingView as any).mock.calls.length;
    const selectedNode = selected;
    const mountNode = mount;

    // Switching back to the Task editor only toggles visibility: the TaskItem and
    // the InteractiveCodingView DOM fragments are the exact same in-memory nodes.
    getAction('select_content_tab')(null, taskTab);
    expect(selected.classList.contains('hidden')).toBe(false);
    expect(mount.classList.contains('hidden')).toBe(true);
    expect(taskTab.getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('#selected-task-view')).toBe(selectedNode);
    expect(container.querySelector('#interactive-coding-view-mount')).toBe(mountNode);
    expect((InteractiveCodingView as any).mock.calls.length).toBe(mountCountBefore);

    // Switching back to the Coding Agent reuses the already-mounted view.
    getAction('select_content_tab')(null, codingTab);
    expect(selected.classList.contains('hidden')).toBe(true);
    expect(mount.classList.contains('hidden')).toBe(false);
    expect((InteractiveCodingView as any).mock.calls.length).toBe(mountCountBefore);
  });

  it('shows the File Browser tab without a session and keeps it mounted across tab switches', async () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await view.loadPipeline();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const tablist = container.querySelector('#content-tablist') as HTMLElement;
    const taskTab = container.querySelector('#tab-task-editor') as HTMLElement;
    const codingTab = container.querySelector('#tab-coding-agent') as HTMLElement;
    const fileTab = container.querySelector('#tab-file-browser') as HTMLElement;
    expect(tablist.classList.contains('hidden')).toBe(false);
    expect(fileTab.textContent).toContain('File Browser');
    // No session: the Coding Agent tab is hidden but the File Browser is usable.
    expect(codingTab.classList.contains('hidden')).toBe(true);

    getAction('select_content_tab')(null, fileTab);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const fileMount = container.querySelector('#file-browser-view-mount') as HTMLElement;
    const selected = container.querySelector('#selected-task-view') as HTMLElement;
    expect((view as any).contentTab).toBe('file-browser');
    expect(fileMount.classList.contains('hidden')).toBe(false);
    expect(selected.classList.contains('hidden')).toBe(true);
    expect(fileTab.getAttribute('aria-selected')).toBe('true');
    expect(mockContext.fileBrowserClient.listDirectory).toHaveBeenCalledWith('p1', '');

    // Switching away and back reuses the same mounted fragment (no remount).
    getAction('select_content_tab')(null, taskTab);
    expect(fileMount.classList.contains('hidden')).toBe(true);
    expect(selected.classList.contains('hidden')).toBe(false);

    getAction('select_content_tab')(null, fileTab);
    expect(container.querySelector('#file-browser-view-mount')).toBe(fileMount);
    expect(fileMount.classList.contains('hidden')).toBe(false);
    expect(mockContext.fileBrowserClient.listDirectory).toHaveBeenCalledTimes(1);
  });

  it('live-updates the inline session list when the service notifies a completion', async () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await view.loadPipeline();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const sessionList = container.querySelector('#pipeline-session-list') as HTMLElement;
    expect(sessionList.classList.contains('hidden')).toBe(true);

    // A batch CoderBot session for this pipeline completes after mount.
    mockContext.interactiveCodingService.getSessions.mockReturnValue([
      {
        uid: 'b1',
        kind: 'coderbot',
        pipeline_id: 'p1',
        task_id: 't1',
        status: 'completed',
        label: 'Batch run',
      },
    ]);
    expect(sessionsListener).not.toBeNull();
    sessionsListener!([{ uid: 'b1' }]);

    expect(sessionList.classList.contains('hidden')).toBe(false);
    const row = sessionList.querySelector('[data-session-uid="b1"]') as HTMLElement;
    expect(row).not.toBeNull();
    expect(row.textContent).toContain('Discard');
  });

  it('ignores a session belonging to another pipeline when live-updating', async () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await view.loadPipeline();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const sessionList = container.querySelector('#pipeline-session-list') as HTMLElement;
    mockContext.interactiveCodingService.getSessions.mockReturnValue([
      { uid: 'other', kind: 'coderbot', pipeline_id: 'p2', status: 'completed' },
    ]);
    sessionsListener!([{ uid: 'other' }]);

    expect(sessionList.querySelector('[data-session-uid="other"]')).toBeNull();
    expect(sessionList.classList.contains('hidden')).toBe(true);
  });

  it('repaints only the list without disturbing the active tab or DOM fragments', async () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await view.loadPipeline();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const selected = container.querySelector('#selected-task-view') as HTMLElement;
    const mount = container.querySelector('#interactive-coding-view-mount') as HTMLElement;
    const contentTabBefore = (view as any).contentTab;
    const selectedHiddenBefore = selected.classList.contains('hidden');
    const mountHiddenBefore = mount.classList.contains('hidden');

    mockContext.interactiveCodingService.getSessions.mockReturnValue([
      { uid: 'b1', kind: 'coderbot', pipeline_id: 'p1', status: 'completed' },
    ]);
    sessionsListener!([{ uid: 'b1' }]);

    expect((view as any).contentTab).toBe(contentTabBefore);
    expect(selected.classList.contains('hidden')).toBe(selectedHiddenBefore);
    expect(mount.classList.contains('hidden')).toBe(mountHiddenBefore);
    // The DOM fragments keep their identity (no re-render).
    expect(container.querySelector('#selected-task-view')).toBe(selected);
    expect(container.querySelector('#interactive-coding-view-mount')).toBe(mount);
  });

  it('keeps the live session list hidden for local pipelines', async () => {
    mockContext.pipelineClient.get.mockResolvedValue({ id: 'p1', name: 'Pipe 1' });
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await view.loadPipeline();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const sessionList = container.querySelector('#pipeline-session-list') as HTMLElement;
    mockContext.interactiveCodingService.getSessions.mockReturnValue([
      { uid: 'b1', kind: 'coderbot', pipeline_id: 'p1', status: 'completed' },
    ]);
    sessionsListener!([{ uid: 'b1' }]);

    expect(sessionList.classList.contains('hidden')).toBe(true);
  });

  it('unmount removes the onSessionsChange subscription', async () => {
    const unsub = vi.fn();
    mockContext.interactiveCodingService.onSessionsChange.mockReturnValue(unsub);
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await view.loadPipeline();

    view.unmount();

    expect(unsub).toHaveBeenCalled();
  });
});

describe('PipelineDetailView SpecAgent', () => {
  let mockContext: any;
  let container: HTMLElement;
  let dataManagerHandlers: Record<string, Function> = {};

  const getAction = (name: string) =>
    mockContext.actionRegistry.register.mock.calls.find((c: any) => c[0] === name)![1];

  const TASK = {
    id: 't1',
    title: 'Task 1',
    spec: 'Spec',
    status: TaskStatus.CREATED,
    deleted: false,
    version: 1,
    order: 0,
    type: 'manual',
    want_design_doc: false,
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    dataManagerHandlers = {};

    mockContext = {
      actionRegistry: { register: vi.fn() },
      wsClient: { on: vi.fn().mockReturnValue(() => {}) },
      dataManager: {
        on: vi.fn((event: string, handler: Function) => {
          dataManagerHandlers[event] = handler;
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
        listByPipeline: vi.fn().mockResolvedValue([]),
        listCompletedByPipeline: vi.fn().mockResolvedValue({ tasks: [], total_count: 0 }),
        updateDetails: vi.fn().mockResolvedValue({ id: 't1' }),
      },
      specBotClient: {
        trigger: vi.fn().mockResolvedValue(undefined),
        getProposal: vi.fn().mockResolvedValue({
          task_id: 't1',
          pipeline_id: 'p1',
          spec_md: '# Elaborated\n\nBody',
          rationale: 'because',
        }),
        getProposals: vi.fn().mockResolvedValue([]),
        rejectProposal: vi.fn().mockResolvedValue(undefined),
        clearProposal: vi.fn().mockResolvedValue(undefined),
      },
      notifications: { onActionResult: vi.fn(() => () => {}) },
      pullRequestClient: { getPullRequestsByPipeline: vi.fn().mockResolvedValue([]) },
      systemClient: { isOllamaAvailable: vi.fn().mockResolvedValue(true) },
    };

    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    });
  });

  afterEach(() => {
    setTaskSpecProposalUpdater(null);
  });

  const setupView = async () => {
    mockContext.taskClient.listByPipeline.mockResolvedValue([{ ...TASK }]);
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await view.refreshTasks();
    // Let the fire-and-forget loadPipeline -> fetchPullRequests -> refreshTasks
    // chain settle so the assertions are deterministic.
    await new Promise((resolve) => setTimeout(resolve, 0));
    return view;
  };

  const selectTask = (taskId: string) => {
    const selectAction = getAction('select_task');
    const el = document.createElement('div');
    el.setAttribute('data-view-id', taskId);
    selectAction(new Event('click'), el);
  };

  it('registers a trigger_specagent action that calls the client', async () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    view.mount(container);

    const action = getAction('trigger_specagent');
    const el = document.createElement('button');
    el.setAttribute('data-task-id', 't1');

    await action(null, el);

    expect(mockContext.specBotClient.trigger).toHaveBeenCalledWith('p1', 't1');
    expect((view as any).specagentState).toEqual({ status: 'inProgress', taskId: 't1' });
  });

  it('renders the proposal inline on SPECAGENT_SPEC_READY', async () => {
    await setupView();
    selectTask('t1');

    dataManagerHandlers['ws:SPECAGENT_SPEC_READY:p1']({
      task_id: 't1',
      pipeline_id: 'p1',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockContext.specBotClient.getProposal).toHaveBeenCalledWith('p1', 't1');
    const specContainer = container.querySelector(
      '#selected-task-view [data-view-id="t1"] .spec-container'
    )!;
    expect(specContainer).toBeTruthy();
    expect(specContainer.querySelector('.spec-proposal-result')).toBeTruthy();
    expect(specContainer.textContent).toContain('Suggested Specification');
    expect(specContainer.querySelector('[data-spec-proposal-action="accept"]')).toBeTruthy();
    expect(specContainer.querySelector('[data-spec-proposal-action="reject"]')).toBeTruthy();
  });

  it('ignores a SPECAGENT_SPEC_READY event for another pipeline', () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    view.mount(container);

    dataManagerHandlers['ws:SPECAGENT_SPEC_READY:p1']({
      task_id: 't1',
      pipeline_id: 'other',
    });

    expect(mockContext.specBotClient.getProposal).not.toHaveBeenCalled();
  });

  it('toggles the in-progress state on SPECAGENT_STARTED/COMPLETED', () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    view.mount(container);

    dataManagerHandlers['ws:SPECAGENT_STARTED:p1']({ task_id: 't1' });
    expect((view as any).specagentState).toEqual({ status: 'inProgress', taskId: 't1' });

    dataManagerHandlers['ws:SPECAGENT_COMPLETED:p1']({ id: 't1' });
    expect((view as any).specagentState).toEqual({ status: 'none', taskId: null });
  });

  it('accept writes the spec back through the registered updater and clears the proposal', async () => {
    await setupView();
    selectTask('t1');

    const updater = vi.fn().mockResolvedValue(undefined);
    setTaskSpecProposalUpdater(updater);

    dataManagerHandlers['ws:SPECAGENT_SPEC_READY:p1']({
      task_id: 't1',
      pipeline_id: 'p1',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const specContainer = container.querySelector(
      '#selected-task-view [data-view-id="t1"] .spec-container'
    )!;
    specContainer
      .querySelector<HTMLButtonElement>('[data-spec-proposal-action="accept"]')!
      .click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(updater).toHaveBeenCalledWith('t1', expect.stringContaining('# Elaborated'));
    expect(mockContext.specBotClient.clearProposal).toHaveBeenCalledWith('p1', 't1');
    expect(specContainer.querySelector('.spec-proposal-result')).toBeFalsy();
  });

  it('reject clears the proposal and calls SpecBotClient.rejectProposal', async () => {
    await setupView();
    selectTask('t1');

    dataManagerHandlers['ws:SPECAGENT_SPEC_READY:p1']({
      task_id: 't1',
      pipeline_id: 'p1',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const specContainer = container.querySelector(
      '#selected-task-view [data-view-id="t1"] .spec-container'
    )!;
    specContainer
      .querySelector<HTMLButtonElement>('[data-spec-proposal-action="reject"]')!
      .click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockContext.specBotClient.rejectProposal).toHaveBeenCalledWith('p1', 't1');
    expect(specContainer.querySelector('.spec-proposal-result')).toBeFalsy();
  });

  it('reconciles outstanding proposals even when no task card is mounted', async () => {
    mockContext.specBotClient.getProposals.mockResolvedValue([
      { task_id: 't9', pipeline_id: 'p1', spec_md: '# late', rationale: '' },
    ]);
    const view = await setupView();

    // The proposal's task is not rendered in the selected task view ...
    expect(container.querySelector('#selected-task-view [data-view-id="t9"]')).toBeNull();
    // ... but the proposal is tracked and surfaced by the header badge.
    expect((view as any).pendingSpecProposals).toHaveLength(1);
    expect((view as any).pendingSpecProposals[0].task_id).toBe('t9');
  });

  it('never injects an inline proposal into sidebar backlog cards', () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    view.mount(container);
    container.innerHTML = `
      <div id="selected-task-view"></div>
      <div id="backlog-view">
        <div data-view-id="t1"><div class="spec-container"></div></div>
      </div>
    `;

    (view as any).renderSpecProposal({
      task_id: 't1',
      pipeline_id: 'p1',
      spec_md: '# x',
    });

    expect(container.querySelector('#backlog-view .spec-proposal-result')).toBeNull();
  });
});
