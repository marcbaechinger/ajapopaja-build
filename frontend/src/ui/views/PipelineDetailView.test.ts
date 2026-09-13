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
import { ConfirmationDialog } from '../components/ConfirmationDialog.ts';

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
vi.mock('../components/PipelineStatsView.ts', () => ({
  PipelineStatsView: { render: () => '<div class="mock-stats">Stats</div>', animateBars: vi.fn() }
}));
vi.mock('../components/CompletedSection.ts', () => ({
  CompletedSection: { render: () => '<div class="mock-completed">Completed</div>' }
}));
vi.mock('../components/PaginationControl.ts', () => ({
  PaginationControl: { render: () => '<div class="mock-pagination">Pagination</div>' }
}));
vi.mock('../components/CoderBotDialog.ts', () => ({
  CoderBotDialog: vi.fn(function CoderBotDialog() {
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
      },
      taskClient: {
        listByPipeline: vi.fn().mockResolvedValue([]),
        listCompletedByPipeline: vi.fn().mockResolvedValue({ tasks: [], total_count: 0 }),
      },
      pullRequestClient: {
        getPullRequestsByPipeline: vi.fn().mockResolvedValue([]),
      },
      systemClient: {
        getGitStatus: vi.fn().mockResolvedValue({}),
        isOllamaAvailable: vi.fn().mockResolvedValue(true),
      }
    };

    vi.stubGlobal('localStorage', {
      getItem: vi.fn((key) => storage[key] || null),
      setItem: vi.fn((key, value) => { storage[key] = value; }),
    });
  });

  it('should initialize with default 3-column layout', () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    container.innerHTML = view.render() as string;

    expect(container.innerHTML).toContain('lg:grid-cols-3');
    expect(container.innerHTML).not.toContain('lg:grid-cols-2');
  });

  it('should initialize with 2-column layout if saved in localStorage', () => {
    storage['pipeline:layout'] = JSON.stringify('2-col');
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    container.innerHTML = view.render() as string;

    expect(container.innerHTML).toContain('lg:grid-cols-2');
    expect(container.innerHTML).not.toContain('lg:grid-cols-3');
  });

  it('should toggle layout and update localStorage', async () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    view.mount(container);

    const toggleAction = mockContext.actionRegistry.register.mock.calls.find((c: any) => c[0] === 'toggle_layout')[1];
    
    // Switch to 2 cols
    toggleAction();
    expect(localStorage.setItem).toHaveBeenCalledWith('pipeline:layout', JSON.stringify('2-col'));
    expect(container.innerHTML).toContain('lg:grid-cols-2');

    // Switch back to 3 cols
    toggleAction();
    expect(localStorage.setItem).toHaveBeenCalledWith('pipeline:layout', JSON.stringify('3-col'));
    expect(container.innerHTML).toContain('lg:grid-cols-3');
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

  it('should not duplicate a task in the Queue and should remove it when unscheduled', async () => {
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

    // TaskColumn is mocked in this suite, so mount a real queue list container.
    const queueList = document.createElement('div');
    queueList.id = 'scheduled-list';
    (container.querySelector('#col-active') as HTMLElement).appendChild(queueList);

    const scheduledTask: any = { id: 's1', title: 'Sched', status: TaskStatus.SCHEDULED, deleted: false, version: 1, order: 0, type: 'manual', want_design_doc: false };

    // the scheduling operation can produce a duplicate WS notification
    tasksHandler!(scheduledTask);
    tasksHandler!(scheduledTask);
    expect(queueList.querySelectorAll('[data-view-id="s1"]').length).toBe(1);

    // moving back to CREATED must remove the task from the Queue
    tasksHandler!({ id: 's1', title: 'Sched', status: TaskStatus.CREATED, deleted: false, version: 2, order: 0, type: 'manual', want_design_doc: false });
    expect(queueList.querySelectorAll('[data-view-id="s1"]').length).toBe(0);
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
      },
      taskClient: {
        listByPipeline: vi.fn().mockResolvedValue([]),
        listCompletedByPipeline: vi.fn().mockResolvedValue({ tasks: [], total_count: 0 }),
      },
      pullRequestClient: {
        getPullRequestsByPipeline: vi.fn().mockResolvedValue([]),
      },
      systemClient: {
        getGitStatus: vi.fn().mockResolvedValue({}),
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
      pipelineClient: { get: vi.fn().mockResolvedValue({ id: 'p1', name: 'Pipe 1' }) },
      taskClient: {
        listByPipeline: vi.fn().mockResolvedValue([]),
        listCompletedByPipeline: vi.fn().mockResolvedValue({ tasks: [], total_count: 0 }),
      },
      pullRequestClient: { getPullRequestsByPipeline: vi.fn().mockResolvedValue([]) },
      systemClient: {
        getGitStatus: vi.fn().mockResolvedValue({}),
        isOllamaAvailable: vi.fn().mockResolvedValue(true),
      },
      coderBotService: { coderBotService: 'instance' },
      coderBotClient: { triggerCoderBot: vi.fn().mockResolvedValue({}) },
    };

    vi.stubGlobal('localStorage', {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    });
  });

  it('should open CoderBotDialog automatically after a successful trigger', async () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    view.mount(container);

    (view as any).allLoadedTasks = [{ id: 't1', status: 'CREATED' }];

    const triggerCoderbot = getAction('trigger_coderbot');
    const el = document.createElement('button');
    el.setAttribute('data-task-id', 't1');

    await triggerCoderbot(null, el);

    expect(mockContext.coderBotClient.triggerCoderBot).toHaveBeenCalledWith('t1');
    expect(CoderBotDialog).toHaveBeenCalledTimes(1);
    expect(CoderBotDialog).toHaveBeenCalledWith(mockContext.coderBotService);
    const shownDialog = (CoderBotDialog as any).mock.results[0].value;
    expect(shownDialog.show).toHaveBeenCalled();

    // Optimistic state still updated alongside dialog opening
    expect((view as any).coderbotState).toEqual({ status: 'inProgress', taskId: 't1' });
    const task = (view as any).allLoadedTasks.find((t: any) => t.id === 't1');
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
      pipelineClient: { get: vi.fn().mockResolvedValue({ id: 'p1', name: 'Pipe 1' }) },
      taskClient: {
        listByPipeline: vi.fn().mockResolvedValue([]),
        listCompletedByPipeline: vi.fn().mockResolvedValue({ tasks: [], total_count: 0 }),
      },
      pullRequestClient: {
        getPullRequestsByPipeline: vi.fn().mockResolvedValue([]),
        acceptPullRequest: vi.fn().mockResolvedValue({}),
      },
      systemClient: {
        getGitStatus: vi.fn().mockResolvedValue({}),
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
});
