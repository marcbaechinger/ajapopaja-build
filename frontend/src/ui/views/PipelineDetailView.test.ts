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
import { ActionRegistry } from '../../core/ActionRegistry.ts';
import { TaskStatus } from '../../core/domain.ts';
import { setTaskSpecProposalUpdater } from '../components/pipeline/SpecSection.ts';
import { PipelineEditDialog } from '../components/dialogs/PipelineEditDialog.ts';

// Mock components to avoid deep rendering issues in unit tests
vi.mock('../components/pipeline/TaskColumn.ts', () => ({
  TaskColumn: { render: () => '<div class="mock-column">Column</div>' }
}));
vi.mock('../components/pipeline/TaskForm.ts', () => ({
  TaskForm: { render: () => '<div class="mock-form">Form</div>' }
}));
vi.mock('../components/pipeline/PipelineHeaderView.ts', () => ({
  PipelineHeaderView: { render: () => '<div class="mock-header">Header</div>' }
}));
vi.mock('../components/pipeline/PipelineHistoryView.ts', () => ({
  PipelineHistoryView: { render: () => '<div class="mock-history">History</div>' }
}));
vi.mock('../components/common/PaginationControl.ts', () => ({
  PaginationControl: { render: () => '<div class="mock-pagination">Pagination</div>' }
}));
vi.mock('../components/dialogs/CoderBotDialog.ts', () => ({
  CoderBotDialog: vi.fn(function CoderBotDialog() {
    return { show: vi.fn() };
  }),
}));

vi.mock('../components/dialogs/DevServerDialog.ts', () => ({
  DevServerDialog: vi.fn(function DevServerDialog() {
    return { show: vi.fn() };
  }),
}));

// Mock the diff dialog so triggering the action can be asserted without the
// dialog's async network load.
vi.mock('../components/dialogs/DiffDialog.ts', () => ({
  DiffDialog: vi.fn(function DiffDialog() {
    return { show: vi.fn() };
  }),
}));

// Mock the interactive coding view so its inner PiView is not mounted in unit
// tests; the host slot/toggle behaviour is what is under test here.
vi.mock('../components/session/InteractiveCodingView.ts', () => ({
  InteractiveCodingView: vi.fn(function InteractiveCodingView() {
    return {
      render: vi.fn(),
      destroy: vi.fn(),
      sendMessage: vi.fn(),
      pauseSession: vi.fn(),
    };
  }),
}));

// The inline accept action confirms before calling the client. Keep the dialog
// out of the way so the test can drive the action deterministically.
vi.mock('../components/dialogs/ConfirmationDialog.ts', () => ({
  ConfirmationDialog: vi.fn(function ConfirmationDialog() {
    return { show: vi.fn().mockResolvedValue(true) };
  }),
}));

// The edit shortcut dispatches `edit_pipeline`, which constructs this dialog.
// Mock it so the shortcut test can assert the dialog without any network I/O.
vi.mock('../components/dialogs/PipelineEditDialog.ts', () => ({
  PipelineEditDialog: vi.fn(function PipelineEditDialog() {
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
        acceptPullRequest: vi.fn().mockResolvedValue({}),
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

  it('accepting a pull request repaints only the PR section, preserving the selected TaskItem', async () => {
    const selectedTask: any = {
      id: 't1',
      title: 'Selected Task',
      spec: 'a spec being edited',
      status: TaskStatus.PULL_REQUEST_AVAILABLE,
      deleted: false,
      version: 1,
      order: 0,
      type: 'manual',
      want_design_doc: false,
      history: [],
    };
    mockContext.taskClient.listByPipeline.mockResolvedValue([selectedTask]);

    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    view.mount(container);
    container.innerHTML = view.render() as string;
    await view.refreshTasks();
    // Let the fire-and-forget loadPipeline -> fetchPullRequests chain settle.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Select the task so it is rendered in #selected-task-view.
    const selectAction = mockContext.actionRegistry.register.mock.calls.find((c: any) => c[0] === 'select_task')![1];
    const selectEl = document.createElement('div');
    selectEl.setAttribute('data-view-id', 't1');
    selectAction(new Event('click'), selectEl);

    const selectedView = container.querySelector('#selected-task-view') as HTMLElement;
    const before = selectedView.innerHTML;
    expect(before).toContain('Selected Task');

    const listCallsBefore = mockContext.taskClient.listByPipeline.mock.calls.length;
    const prCallsBefore = mockContext.pullRequestClient.getPullRequestsByPipeline.mock.calls.length;

    const acceptAction = mockContext.actionRegistry.register.mock.calls.find((c: any) => c[0] === 'accept_pr')![1];
    const button = document.createElement('button');
    button.setAttribute('data-pr-id', 'pr1');
    button.setAttribute('data-task-id', 't1');
    await acceptAction(new Event('click'), button);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The PR was accepted and the section was refreshed in place...
    expect(mockContext.pullRequestClient.acceptPullRequest).toHaveBeenCalledWith('pr1');
    expect(mockContext.pullRequestClient.getPullRequestsByPipeline.mock.calls.length).toBe(prCallsBefore + 1);
    // ...without a full task refresh re-rendering the selected TaskItem (which
    // would discard any open Specification/Design-Doc editor).
    expect(mockContext.taskClient.listByPipeline.mock.calls.length).toBe(listCallsBefore);
    expect(selectedView.innerHTML).toBe(before);
  });
});

describe('PipelineDetailView Dev Server', () => {
  let mockContext: any;
  let container: HTMLElement;
  let dataManagerHandlers: Record<string, Function> = {};

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
});

describe('PipelineDetailView Interactive Session', () => {
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
        getGitLog: vi.fn().mockResolvedValue({ commits: [], total: 0 }),
        getCommitDiff: vi.fn().mockResolvedValue({ patch: '' }),
        pull: vi.fn().mockResolvedValue({ status: 'ok', message: 'ok' }),
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
        onSessionsChange: vi.fn(() => () => {}),
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

  it('removes the detached interactive session bar and its start button', async () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await view.loadPipeline();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(container.querySelector('#interactive-session-bar')).toBeNull();
    expect(container.querySelector('#start-interactive-btn')).toBeNull();
    expect(container.querySelector('#resume-interactive-btn')).toBeNull();
    expect(container.querySelector('#start-new-interactive-btn')).toBeNull();
  });


  it('switches back to the Task editor tab when a task is selected', async () => {
    mockContext.taskClient.listByPipeline.mockResolvedValue([
      { id: 't1', title: 'Task 1', status: TaskStatus.CREATED, deleted: false, version: 1, order: 0, type: 'manual', want_design_doc: false },
    ]);
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await view.refreshTasks();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const taskTab = container.querySelector('#tab-task-editor') as HTMLElement;
    const fileTab = container.querySelector('#tab-file-browser') as HTMLElement;
    const selected = container.querySelector('#selected-task-view') as HTMLElement;
    const fileMount = container.querySelector('#file-browser-view-mount') as HTMLElement;

    // Switch to the File Browser first so the Task editor is no longer active.
    getAction('select_content_tab')(null, fileTab);
    expect((view as any).contentTab).toBe('file-browser');
    expect(selected.classList.contains('hidden')).toBe(true);

    // Selecting a task must reveal it by activating the Task editor tab.
    const el = document.createElement('div');
    el.setAttribute('data-view-id', 't1');
    getAction('select_task')(new Event('click'), el);

    expect((view as any).contentTab).toBe('task-editor');
    expect(taskTab.getAttribute('aria-selected')).toBe('true');
    expect(selected.classList.contains('hidden')).toBe(false);
    expect(fileMount.classList.contains('hidden')).toBe(true);
    expect(selected.innerHTML).toContain('Task 1');
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


  it('returns false from update() for a different pipeline', () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    container.innerHTML = view.render() as string;
    view.mount(container);

    expect(view.update({ id: 'p2', rest: '' })).toBe(false);
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

describe('PipelineDetailView Keyboard Shortcuts', () => {
  let mockContext: any;

  beforeEach(() => {
    document.body.innerHTML = '';
    LocalStorageManager.resetInstances();
    vi.clearAllMocks();

    mockContext = {
      // Real registry so the `edit_pipeline` handler registered by
      // registerMiscActions is actually invoked by the shortcut.
      actionRegistry: new ActionRegistry(),
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
    vi.unstubAllGlobals();
  });

  // Invoke the view's own keydown handler directly instead of dispatching on
  // `document`: earlier tests leave their (never unmounted) document listeners
  // behind, and dispatching globally would execute those stale handlers too.
  const keydown = (
    view: PipelineDetailView,
    init: KeyboardEventInit,
    target: EventTarget = document,
  ) => {
    const event = {
      altKey: false,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
      type: 'keydown',
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
      target,
      ...init,
    } as unknown as KeyboardEvent;
    (view as any).keydownHandler(event);
  };

  it('opens the pipeline edit dialog on Ctrl+Shift+P', async () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    (view as any).pipeline = { id: 'p1', name: 'Pipe 1' };

    keydown(view, { key: 'p', ctrlKey: true, shiftKey: true });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(PipelineEditDialog).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'edit', pipelineId: 'p1' }),
    );
    expect((PipelineEditDialog as any).mock.results[0].value.show).toHaveBeenCalled();
    view.unmount();
  });

  it('opens the pipeline edit dialog on Cmd+Shift+P', async () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    (view as any).pipeline = { id: 'p1', name: 'Pipe 1' };

    keydown(view, { key: 'P', metaKey: true, shiftKey: true });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(PipelineEditDialog).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'edit', pipelineId: 'p1' }),
    );
    view.unmount();
  });

  it('does not open the dialog while the user is typing in an input', async () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    (view as any).pipeline = { id: 'p1', name: 'Pipe 1' };

    const input = document.createElement('input');
    document.body.appendChild(input);
    keydown(view, { key: 'p', ctrlKey: true, shiftKey: true }, input);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(PipelineEditDialog).not.toHaveBeenCalled();
    view.unmount();
  });
});

describe('PipelineDetailView Getting Started', () => {
  let mockContext: any;
  let container: HTMLElement;

  const getAction = (name: string) =>
    mockContext.actionRegistry.register.mock.calls.find((c: any) => c[0] === name)![1];

  const TASK = {
    id: 't1',
    title: 'Task 1',
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
    LocalStorageManager.resetInstances();
    vi.clearAllMocks();

    mockContext = {
      actionRegistry: { register: vi.fn(), execute: vi.fn() },
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
        getDevServerStatus: vi.fn().mockResolvedValue({ running: false, pid: null, port: null }),
        getGitLog: vi.fn().mockResolvedValue({ commits: [], total: 0 }),
        getCommitDiff: vi.fn().mockResolvedValue({ patch: '' }),
        pull: vi.fn().mockResolvedValue({ status: 'ok', message: 'ok' }),
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
      },
      interactiveCodingService: {
        getCurrentSession: vi.fn(() => null),
        refreshSession: vi.fn().mockResolvedValue(null),
        onSessionChange: vi.fn(() => () => {}),
        onSessionsChange: vi.fn(() => () => {}),
        getSessions: vi.fn().mockReturnValue([]),
        startSession: vi.fn().mockResolvedValue(undefined),
      },
      fileBrowserClient: {
        listDirectory: vi.fn().mockResolvedValue({ path: '', parent: null, entries: [] }),
        readFile: vi.fn().mockResolvedValue({ path: 'a.txt', name: 'a.txt', content: '' }),
        getMeta: vi.fn().mockResolvedValue({ isDir: true }),
      },
    };

    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('lands on the Getting Started tab and renders the guide when no tasks exist', async () => {
    mockContext.taskClient.listByPipeline.mockResolvedValue([]);
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await view.refreshTasks();

    expect((view as any).contentTab).toBe('getting-started');
    const guide = container.querySelector('#getting-started-view-mount') as HTMLElement;
    expect(guide.classList.contains('hidden')).toBe(false);
    expect(guide.innerHTML).toContain('Turn an idea into a reviewed pull request');
    expect(guide.innerHTML).toContain('Jump-start a new project');
    expect(
      container.querySelector('#tab-getting-started')!.getAttribute('aria-selected')
    ).toBe('true');
  });

  it('lands on the Getting Started tab when tasks exist but none is selected', async () => {
    mockContext.taskClient.listByPipeline.mockResolvedValue([{ ...TASK }]);
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await view.refreshTasks();

    expect((view as any).contentTab).toBe('getting-started');
  });

  it('respects an explicit deep link instead of auto-selecting the guide', async () => {
    mockContext.taskClient.listByPipeline.mockResolvedValue([]);
    const view = new PipelineDetailView(mockContext, { id: 'p1', rest: 'tab/history' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await view.refreshTasks();

    expect((view as any).contentTab).toBe('history');
  });

  it('falls back to the guide when the selected task disappears', async () => {
    mockContext.taskClient.listByPipeline.mockResolvedValue([{ ...TASK }]);
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await view.refreshTasks();

    const selectAction = getAction('select_task');
    const el = document.createElement('div');
    el.setAttribute('data-view-id', 't1');
    selectAction(new Event('click'), el);
    expect((view as any).contentTab).toBe('task-editor');

    // The task is deleted: the local cache empties and the selection clears.
    mockContext.taskClient.listByPipeline.mockResolvedValue([]);
    await view.refreshTasks();

    expect((view as any).selectedTask).toBeNull();
    expect((view as any).contentTab).toBe('getting-started');
  });

  it('opens the pipeline guide dialog from the open_pipeline_guide action', () => {
    // JSDOM does not implement the native dialog methods.
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.open = true;
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.open = false;
    });

    new PipelineDetailView(mockContext, { id: 'p1' });
    getAction('open_pipeline_guide')();

    const dialog = document.querySelector('dialog');
    expect(dialog).not.toBeNull();
    expect(dialog!.textContent).toContain('Pipeline Getting Started');
    expect(dialog!.textContent).toContain('Jump-start a new project');
    // Close it so the shared BaseDialog singleton does not leak into other tests.
    (dialog!.querySelector('#dialog-close-btn') as HTMLElement).click();
  });
});
