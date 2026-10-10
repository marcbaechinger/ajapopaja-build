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
import { ContentTabsController } from './ContentTabsController.ts';
import { PipelineSubRoute } from './PipelineSubRoute.ts';
import {
  createPipelineDetailCtx,
  type PipelineDetailCtx,
  type PipelineDetailRefreshHooks,
} from './PipelineDetailCtx.ts';
import { LocalStorageManager } from '../../../core/LocalStorageManager.ts';
import { TaskStatus } from '../../../core/domain.ts';
import { InteractiveCodingView } from '../../components/session/InteractiveCodingView.ts';
import type { AppContext } from '../../../core/AppContext.ts';

// Mock components to avoid deep rendering issues in unit tests.
vi.mock('../../components/pipeline/TaskColumn.ts', () => ({
  TaskColumn: { render: () => '<div class="mock-column">Column</div>' },
}));
vi.mock('../../components/pipeline/TaskForm.ts', () => ({
  TaskForm: { render: () => '<div class="mock-form">Form</div>' },
}));
vi.mock('../../components/pipeline/PipelineHeaderView.ts', () => ({
  PipelineHeaderView: { render: () => '<div class="mock-header">Header</div>' },
}));
vi.mock('../../components/pipeline/PipelineHistoryView.ts', () => ({
  PipelineHistoryView: { render: () => '<div class="mock-history">History</div>' },
}));
vi.mock('../../components/common/PaginationControl.ts', () => ({
  PaginationControl: { render: () => '<div class="mock-pagination">Pagination</div>' },
}));
vi.mock('../../components/dialogs/CoderBotDialog.ts', () => ({
  CoderBotDialog: vi.fn(function CoderBotDialog() {
    return { show: vi.fn() };
  }),
}));
vi.mock('../../components/dialogs/DevServerDialog.ts', () => ({
  DevServerDialog: vi.fn(function DevServerDialog() {
    return { show: vi.fn() };
  }),
}));
vi.mock('../../components/dialogs/DiffDialog.ts', () => ({
  DiffDialog: vi.fn(function DiffDialog() {
    return { show: vi.fn() };
  }),
}));
// Mock the interactive coding view so its inner PiView is not mounted in unit
// tests; the host slot/toggle behaviour is what is under test here.
vi.mock('../../components/session/InteractiveCodingView.ts', () => ({
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
 * The tab/route/lazy-mount scenarios moved out of
 * `PipelineDetailView.test.ts`. They drive the extracted controller through the
 * shell's thin delegators, so they guard the DOM hand-off end to end.
 */
describe('ContentTabsController (tabs + lazy mounts + sub-route, via PipelineDetailView)', () => {
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

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));


  it('shows the Coding Agent tab without a session and passes a Start action for remote pipelines', async () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await view.loadPipeline();
    await new Promise((resolve) => setTimeout(resolve, 0));

    // The tab is always available; the default tab remains the Task editor.
    const codingTab = container.querySelector('#tab-coding-agent') as HTMLElement;
    expect(codingTab.classList.contains('hidden')).toBe(false);
    expect(codingTab.getAttribute('aria-selected')).toBe('false');

    // The empty-state Start action starts the session for this pipeline.
    const options = (InteractiveCodingView as any).mock.calls.at(-1)[2];
    expect(options.emptyStateAction.label).toBe('Start Interactive Session');
    await options.emptyStateAction.onClick();
    expect(mockContext.interactiveCodingService.startSession).toHaveBeenCalledWith('p1');
  });

  it('omits the empty-state Start action for local pipelines', async () => {
    mockContext.pipelineClient.get.mockResolvedValue({ id: 'p1', name: 'Pipe 1' });
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await view.loadPipeline();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const codingTab = container.querySelector('#tab-coding-agent') as HTMLElement;
    expect(codingTab.classList.contains('hidden')).toBe(false);
    const options = (InteractiveCodingView as any).mock.calls.at(-1)[2];
    expect(options.emptyStateAction).toBeUndefined();
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

  it('keeps the InteractiveCodingView mounted and switches on start/stop', async () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await view.loadPipeline();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const selected = container.querySelector('#selected-task-view') as HTMLElement;
    const mount = container.querySelector('#interactive-coding-view-mount') as HTMLElement;
    const gettingStarted = container.querySelector('#getting-started-view-mount') as HTMLElement;
    // With no tasks the Getting Started tab is the landing panel; the Coding
    // Agent view is still mounted so its tab is usable without a session.
    expect(gettingStarted.classList.contains('hidden')).toBe(false);
    expect((view as any).contentTab).toBe('getting-started');
    expect(selected.classList.contains('hidden')).toBe(true);
    expect(mount.classList.contains('hidden')).toBe(true);
    // The Coding Agent view is always mounted so the tab is usable without a
    // session (the embedded PiView shows its empty state).
    expect((view as any).contentTabs?.interactiveCodingView).not.toBeNull();

    // The session starts (e.g. from another tab): the handler switches into
    // the Coding Agent tab.
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
    expect((view as any).contentTabs?.interactiveCodingView).not.toBeNull();

    // Stopping keeps the view mounted (the ended log stays visible on the
    // Coding Agent tab); it does not tear the view down.
    mockContext.interactiveCodingService.getCurrentSession.mockReturnValue({
      pipelineId: 'p1',
      active: false,
      busy: false,
    });
    dataManagerHandlers['ws:INTERACTIVE_STOPPED:p1']({ pipeline_id: 'p1' });
    expect((view as any).contentTabs?.interactiveCodingView).not.toBeNull();
  });

  it('keeps the user on the Coding Agent tab when the session stops', async () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await view.loadPipeline();
    await new Promise((resolve) => setTimeout(resolve, 0));

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
    expect((view as any).contentTab).toBe('coding-agent');

    mockContext.interactiveCodingService.getCurrentSession.mockReturnValue({
      pipelineId: 'p1',
      active: false,
      busy: false,
    });
    dataManagerHandlers['ws:INTERACTIVE_STOPPED:p1']({ pipeline_id: 'p1' });

    expect((view as any).contentTab).toBe('coding-agent');
    const mount = container.querySelector('#interactive-coding-view-mount') as HTMLElement;
    expect(mount.classList.contains('hidden')).toBe(false);
  });

  it('shows Task editor / Coding Agent tabs and switches between the two DOM fragments without re-rendering', async () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await view.loadPipeline();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const tablist = container.querySelector('#content-tablist') as HTMLElement;
    expect(tablist).not.toBeNull();
    // The tab list is always visible and the Coding Agent tab is available
    // without a session. The removed redundant buttons are gone from the DOM.
    expect(tablist.classList.contains('hidden')).toBe(false);
    const initialCodingTab = container.querySelector('#tab-coding-agent') as HTMLElement;
    expect(initialCodingTab.classList.contains('hidden')).toBe(false);
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
    // No session: the Coding Agent tab is still selectable; the File Browser
    // remains usable too.
    expect(codingTab.classList.contains('hidden')).toBe(false);

    getAction('select_content_tab')(null, fileTab);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const fileMount = container.querySelector('#file-browser-view-mount') as HTMLElement;
    const selected = container.querySelector('#selected-task-view') as HTMLElement;
    expect((view as any).contentTab).toBe('file-browser');
    expect(fileMount.classList.contains('hidden')).toBe(false);
    expect(selected.classList.contains('hidden')).toBe(true);
    expect(fileTab.getAttribute('aria-selected')).toBe('true');
    expect(mockContext.fileBrowserClient.listDirectory).toHaveBeenCalledWith('p1', '');
    // The file browser's main panel is vertically resizable in the detail view.
    const mainPanel = container.querySelector('#file-browser-main') as HTMLElement;
    expect(mainPanel).not.toBeNull();
    expect(mainPanel.className).toContain('resize-y');
    expect(mainPanel.className).toContain('h-[70vh]');

    // Switching away and back reuses the same mounted fragment (no remount).
    getAction('select_content_tab')(null, taskTab);
    expect(fileMount.classList.contains('hidden')).toBe(true);
    expect(selected.classList.contains('hidden')).toBe(false);

    getAction('select_content_tab')(null, fileTab);
    expect(container.querySelector('#file-browser-view-mount')).toBe(fileMount);
    expect(fileMount.classList.contains('hidden')).toBe(false);
    expect(mockContext.fileBrowserClient.listDirectory).toHaveBeenCalledTimes(1);
  });




  it('deep-links the File Browser tab and resolves the path with getMeta', async () => {
    mockContext.fileBrowserClient.getMeta.mockResolvedValue({ isDir: true });
    const view = new PipelineDetailView(mockContext, { id: 'p1', rest: 'tab/fb/src' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await flush();
    await flush();

    expect((view as any).contentTab).toBe('file-browser');
    const fileMount = container.querySelector('#file-browser-view-mount') as HTMLElement;
    expect(fileMount.classList.contains('hidden')).toBe(false);
    expect(mockContext.fileBrowserClient.getMeta).toHaveBeenCalledWith('p1', 'src');
  });

  it('writes the canonical hash when a content tab is selected', async () => {
    window.location.hash = '';
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await flush();

    const fileTab = container.querySelector('#tab-file-browser') as HTMLElement;
    getAction('select_content_tab')(null, fileTab);
    expect(window.location.hash).toBe('#/pipeline/p1/tab/fb');

    const taskTab = container.querySelector('#tab-task-editor') as HTMLElement;
    getAction('select_content_tab')(null, taskTab);
    expect(window.location.hash).toBe('#/pipeline/p1/tab/task');

    // The Coding Agent tab is only selectable while a session is attached.
    mockContext.interactiveCodingService.getCurrentSession.mockReturnValue({
      pipelineId: 'p1',
      active: true,
      busy: false,
    });
    const codingTab = container.querySelector('#tab-coding-agent') as HTMLElement;
    getAction('select_content_tab')(null, codingTab);
    expect(window.location.hash).toBe('#/pipeline/p1/tab/agent');
  });

  it('applies a Back/Forward sub-route in place without remounting fragments', async () => {
    mockContext.fileBrowserClient.getMeta.mockResolvedValue({ isDir: true });
    const view = new PipelineDetailView(mockContext, { id: 'p1', rest: 'tab/fb/src' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await flush();
    await flush();

    const selected = container.querySelector('#selected-task-view') as HTMLElement;
    const fileMount = container.querySelector('#file-browser-view-mount') as HTMLElement;
    const listDirCalls = mockContext.fileBrowserClient.listDirectory.mock.calls.length;
    const interactiveCalls = (InteractiveCodingView as any).mock.calls.length;

    expect(view.update({ id: 'p1', rest: 'tab/task' })).toBe(true);

    expect((view as any).contentTab).toBe('task-editor');
    // The very same DOM nodes are reused (no unmount/re-render).
    expect(container.querySelector('#selected-task-view')).toBe(selected);
    expect(container.querySelector('#file-browser-view-mount')).toBe(fileMount);
    expect(selected.classList.contains('hidden')).toBe(false);
    expect(fileMount.classList.contains('hidden')).toBe(true);
    expect(mockContext.fileBrowserClient.listDirectory.mock.calls.length).toBe(listDirCalls);
    expect((InteractiveCodingView as any).mock.calls.length).toBe(interactiveCalls);
  });


  it('deep-links the Coding Agent tab without a session and keeps the hash', async () => {
    window.location.hash = '#/pipeline/p1/tab/agent';
    const view = new PipelineDetailView(mockContext, { id: 'p1', rest: 'tab/agent' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await flush();

    expect((view as any).contentTab).toBe('coding-agent');
    expect(window.location.hash).toBe('#/pipeline/p1/tab/agent');
    const mount = container.querySelector('#interactive-coding-view-mount') as HTMLElement;
    expect(mount.classList.contains('hidden')).toBe(false);
  });

  it('pushes a history entry when the file browser reports user navigation', async () => {
    window.location.hash = '';
    const view = new PipelineDetailView(mockContext, { id: 'p1', rest: 'tab/fb' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await flush();
    await flush();

    const crumb = document.createElement('button');
    crumb.setAttribute('data-path', '');
    getAction('file_browser_breadcrumb')(new Event('click'), crumb);
    await flush();

    expect(window.location.hash).toBe('#/pipeline/p1/tab/fb/');
  });

  it('deep-links a task uid into the Task editor', async () => {
    window.location.hash = '';
    mockContext.taskClient.listByPipeline.mockResolvedValue([
      { id: 'n1', title: 'Deep Linked', status: TaskStatus.CREATED, deleted: false, version: 1, order: 0, type: 'manual', want_design_doc: false },
    ]);
    const view = new PipelineDetailView(mockContext, { id: 'p1', rest: 'tab/task/n1' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await flush();
    await flush();

    expect((view as any).contentTab).toBe('task-editor');
    const selected = container.querySelector('#selected-task-view') as HTMLElement;
    expect(selected.innerHTML).toContain('Deep Linked');
    // The deep link survives canonicalisation before the tasks load.
    expect(window.location.hash).toBe('#/pipeline/p1/tab/task/n1');
  });

  it('writes the task uid to the hash when a task is selected', async () => {
    window.location.hash = '';
    mockContext.taskClient.listByPipeline.mockResolvedValue([
      { id: 't1', title: 'Task 1', status: TaskStatus.CREATED, deleted: false, version: 1, order: 0, type: 'manual', want_design_doc: false },
    ]);
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await flush();

    const el = document.createElement('div');
    el.setAttribute('data-view-id', 't1');
    getAction('select_task')(new Event('click'), el);

    expect(window.location.hash).toBe('#/pipeline/p1/tab/task/t1');
  });

  it('does not re-render the selected task when the route uid is unchanged', async () => {
    mockContext.taskClient.listByPipeline.mockResolvedValue([
      { id: 't1', title: 'Task 1', status: TaskStatus.CREATED, deleted: false, version: 1, order: 0, type: 'manual', want_design_doc: false },
    ]);
    const view = new PipelineDetailView(mockContext, { id: 'p1', rest: 'tab/task/t1' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await flush();
    await flush();

    const selected = container.querySelector('#selected-task-view') as HTMLElement;
    expect(selected.innerHTML).toContain('Task 1');

    // Re-applying the identical route must not replace the DOM node.
    expect(view.update({ id: 'p1', rest: 'tab/task/t1' })).toBe(true);
    expect(container.querySelector('#selected-task-view')).toBe(selected);
  });

  it('clears the selection back to the hint when the route drops the uid', async () => {
    mockContext.taskClient.listByPipeline.mockResolvedValue([
      { id: 't1', title: 'Task 1', status: TaskStatus.CREATED, deleted: false, version: 1, order: 0, type: 'manual', want_design_doc: false },
    ]);
    const view = new PipelineDetailView(mockContext, { id: 'p1', rest: 'tab/task/t1' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await flush();
    await flush();

    expect(view.update({ id: 'p1', rest: 'tab/task' })).toBe(true);
    const selected = container.querySelector('#selected-task-view') as HTMLElement;
    expect(selected.innerHTML).toContain('Select a task from the backlog');
  });

  it('preserves the selected uid in the hash when switching tabs away and back', async () => {
    window.location.hash = '';
    mockContext.taskClient.listByPipeline.mockResolvedValue([
      { id: 't1', title: 'Task 1', status: TaskStatus.CREATED, deleted: false, version: 1, order: 0, type: 'manual', want_design_doc: false },
    ]);
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await flush();

    const el = document.createElement('div');
    el.setAttribute('data-view-id', 't1');
    getAction('select_task')(new Event('click'), el);
    expect(window.location.hash).toBe('#/pipeline/p1/tab/task/t1');

    const fileTab = container.querySelector('#tab-file-browser') as HTMLElement;
    getAction('select_content_tab')(null, fileTab);
    expect(window.location.hash).toBe('#/pipeline/p1/tab/fb');

    const taskTab = container.querySelector('#tab-task-editor') as HTMLElement;
    getAction('select_content_tab')(null, taskTab);
    expect(window.location.hash).toBe('#/pipeline/p1/tab/task/t1');
  });

  it('leaves the empty hint when a deep-linked uid resolves to no task', async () => {
    mockContext.taskClient.listByPipeline.mockResolvedValue([]);
    const view = new PipelineDetailView(mockContext, { id: 'p1', rest: 'tab/task/missing' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await flush();
    await flush();

    const selected = container.querySelector('#selected-task-view') as HTMLElement;
    expect(selected.innerHTML).toContain('Select a task from the backlog');
  });

  it('shows the History tab and lazily mounts it while keeping it across switches', async () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await view.loadPipeline();
    await flush();

    const tablist = container.querySelector('#content-tablist') as HTMLElement;
    const historyTab = container.querySelector('#tab-history') as HTMLElement;
    expect(tablist.classList.contains('hidden')).toBe(false);
    expect(historyTab.textContent).toContain('Commits');
    expect((view as any).contentTabs?.historyView).toBeNull();

    getAction('select_content_tab')(null, historyTab);
    await flush();

    expect((view as any).contentTab).toBe('history');
    const historyMount = container.querySelector('#history-view-mount') as HTMLElement;
    expect(historyMount.classList.contains('hidden')).toBe(false);
    expect((view as any).contentTabs?.historyView).not.toBeNull();
    expect(mockContext.pipelineClient.getGitStatus).toHaveBeenCalledWith('p1');
    expect(mockContext.pipelineClient.getGitLog).toHaveBeenCalledWith('p1', 25, 0);
    const selected = container.querySelector('#selected-task-view') as HTMLElement;
    expect(selected.classList.contains('hidden')).toBe(true);
    expect(historyTab.getAttribute('aria-selected')).toBe('true');

    const historyView = (view as any).contentTabs?.historyView;

    // Switching away and back reuses the same mounted fragment (no remount).
    const taskTab = container.querySelector('#tab-task-editor') as HTMLElement;
    getAction('select_content_tab')(null, taskTab);
    expect(historyMount.classList.contains('hidden')).toBe(true);

    getAction('select_content_tab')(null, historyTab);
    expect(container.querySelector('#history-view-mount')).toBe(historyMount);
    expect((view as any).contentTabs?.historyView).toBe(historyView);
    expect(historyMount.classList.contains('hidden')).toBe(false);
  });

  it('the h shortcut activates the History tab', async () => {
    window.location.hash = '';
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await flush();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'h' }));

    expect((view as any).contentTab).toBe('history');
    expect(window.location.hash).toBe('#/pipeline/p1/tab/history');
  });

  it('deep-links the History tab from the sub-route', async () => {
    window.location.hash = '';
    const view = new PipelineDetailView(mockContext, { id: 'p1', rest: 'tab/history' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await flush();

    expect((view as any).contentTab).toBe('history');
    const historyMount = container.querySelector('#history-view-mount') as HTMLElement;
    expect(historyMount.classList.contains('hidden')).toBe(false);
    expect(window.location.hash).toBe('#/pipeline/p1/tab/history');
  });

  it('unmount destroys the mounted HistoryView', async () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    container.innerHTML = view.render() as string;
    view.mount(container);
    await flush();

    getAction('select_content_tab')(null, container.querySelector('#tab-history') as HTMLElement);
    await flush();
    const historyView = (view as any).contentTabs?.historyView;
    expect(historyView).not.toBeNull();
    const destroySpy = vi.spyOn(historyView, 'destroy');

    view.unmount();

    expect(destroySpy).toHaveBeenCalled();
    expect((view as any).contentTabs).toBeNull();
  });
});

/**
 * Unit tests for the extracted controller itself: a minimal host with the
 * four mount points + tab buttons, fake clients and a real `PipelineSubRoute`.
 */
describe('ContentTabsController', () => {
  let ctx: PipelineDetailCtx;
  let host: HTMLElement;
  let controller: ContentTabsController;
  let refresh: PipelineDetailRefreshHooks;
  let appContext: any;
  let subRoute: PipelineSubRoute;

  const tab = (id: string) => host.querySelector(`#${id}`) as HTMLElement;
  const mountEl = (id: string) => host.querySelector(`#${id}`) as HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    window.location.hash = '';
    LocalStorageManager.resetInstances();
    vi.clearAllMocks();

    host = document.createElement('div');
    document.body.appendChild(host);
    host.innerHTML = `
      <div id="selected-task-view"></div>
      <div id="interactive-coding-view-mount" class="hidden"></div>
      <div id="file-browser-view-mount" class="hidden"></div>
      <div id="history-view-mount" class="hidden"></div>
      <div id="getting-started-view-mount" class="hidden"></div>
      <button id="tab-task-editor" role="tab" aria-selected="true"
        class="border-app-accent-1 text-app-accent-1"></button>
      <button id="tab-coding-agent" role="tab" aria-selected="false"
        class="border-transparent text-app-muted"></button>
      <button id="tab-file-browser" role="tab" aria-selected="false"
        class="border-transparent text-app-muted"></button>
      <button id="tab-history" role="tab" aria-selected="false"
        class="border-transparent text-app-muted"></button>
      <button id="tab-getting-started" role="tab" aria-selected="false"
        class="border-transparent text-app-muted"></button>
    `;

    refresh = {
      header: vi.fn(),
      backlog: vi.fn(),
      selectedTask: vi.fn(),
      executionEngine: vi.fn(),
      sessionList: vi.fn(),
      specProposals: vi.fn(),
    };
    appContext = {
      actionRegistry: { register: vi.fn() },
      pipelineClient: {
        getGitStatus: vi.fn().mockResolvedValue({ staged: 0, unstaged: 0, untracked: 0 }),
        getGitLog: vi.fn().mockResolvedValue({ commits: [], total: 0 }),
        getCommitDiff: vi.fn().mockResolvedValue({ patch: '' }),
        pull: vi.fn().mockResolvedValue({ status: 'ok', message: 'ok' }),
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
        getMeta: vi.fn().mockResolvedValue({ isDir: true }),
      },
      sessionManagerPanel: { open: vi.fn() },
    };
    vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn() });

    ctx = createPipelineDetailCtx({
      context: appContext as unknown as AppContext,
      pipelineId: 'p1',
      refresh,
    });
    subRoute = new PipelineSubRoute('p1');
    controller = new ContentTabsController({ ctx, getHost: () => host, subRoute });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it("setTab('coding-agent', {hash:'push'}) writes the canonical hash exactly once and toggles the right fragment", () => {
    const writeSpy = vi.spyOn(subRoute, 'write');

    controller.setTab('coding-agent', { hash: 'push' });

    expect(ctx.state.contentTab).toBe('coding-agent');
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(writeSpy).toHaveBeenCalledWith('push', '#/pipeline/p1/tab/agent');
    expect(mountEl('interactive-coding-view-mount').classList.contains('hidden')).toBe(false);
    expect(mountEl('selected-task-view').classList.contains('hidden')).toBe(true);
    expect(tab('tab-coding-agent').getAttribute('aria-selected')).toBe('true');
    expect(tab('tab-task-editor').getAttribute('aria-selected')).toBe('false');
    expect(refresh.sessionList).toHaveBeenCalledTimes(1);
  });

  it("setTab('getting-started') shows the guide panel and writes the canonical hash", () => {
    controller.setTab('getting-started', { hash: 'push' });

    expect(ctx.state.contentTab).toBe('getting-started');
    expect(mountEl('getting-started-view-mount').classList.contains('hidden')).toBe(false);
    expect(mountEl('selected-task-view').classList.contains('hidden')).toBe(true);
    expect(mountEl('interactive-coding-view-mount').classList.contains('hidden')).toBe(true);
    expect(tab('tab-getting-started').getAttribute('aria-selected')).toBe('true');
    expect(tab('tab-task-editor').getAttribute('aria-selected')).toBe('false');
    // The guide markup is mounted lazily and contains its own jump-start section.
    expect(mountEl('getting-started-view-mount').textContent).toContain('Jump-start a new project');
  });

  it('activateForTask is a no-op when the id already matches (including both null)', () => {
    controller.activateForTask(null);
    expect(refresh.backlog).not.toHaveBeenCalled();
    expect(refresh.selectedTask).not.toHaveBeenCalled();

    ctx.state.selectedTask = { id: 't1' } as any;
    controller.activateForTask('t1');
    expect(refresh.backlog).not.toHaveBeenCalled();
    expect(refresh.selectedTask).not.toHaveBeenCalled();
  });

  it('activateForTask selects + refreshes backlog/selected on a change', () => {
    ctx.state.allLoadedTasks = [{ id: 't1' } as any];

    controller.activateForTask('t1');

    expect(ctx.state.selectedTask?.id).toBe('t1');
    expect(ctx.state.pendingSpecEditTaskId).toBeNull();
    expect(refresh.backlog).toHaveBeenCalledTimes(1);
    expect(refresh.selectedTask).toHaveBeenCalledTimes(1);

    controller.activateForTask(null);
    expect(ctx.state.selectedTask).toBeNull();
    expect(refresh.backlog).toHaveBeenCalledTimes(2);
    expect(refresh.selectedTask).toHaveBeenCalledTimes(2);
  });

  it('canonicaliseRoute falls back to ctx.state.pendingTaskId while tasks are not yet loaded', () => {
    ctx.state.contentTab = 'task-editor';
    ctx.state.selectedTask = null;
    ctx.state.pendingTaskId = 'deep';
    const spy = vi.spyOn(subRoute, 'canonicalise');

    controller.canonicaliseRoute();

    expect(spy).toHaveBeenCalledWith('#/pipeline/p1/tab/task/deep');
  });

  it('startInteractiveSession is a no-op for a local pipeline', async () => {
    ctx.state.pipeline = { id: 'p1', name: 'local' } as any;

    await controller.startInteractiveSession();

    expect(appContext.interactiveCodingService.startSession).not.toHaveBeenCalled();
    expect(ctx.state.contentTab).toBe('task-editor');
  });

  it('startInteractiveSession keeps the tab unchanged and alerts on failure', async () => {
    const alertSpy = vi.fn();
    vi.stubGlobal('alert', alertSpy);
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    ctx.state.pipeline = { id: 'p1', name: 'remote', repo_uri: 'git@example.com:x.git' } as any;
    appContext.interactiveCodingService.startSession.mockRejectedValue(new Error('boom'));

    await controller.startInteractiveSession();

    expect(ctx.state.contentTab).toBe('task-editor');
    expect(alertSpy).toHaveBeenCalledWith('Failed to start interactive session');
    expect(consoleSpy).toHaveBeenCalled();
  });

  it('openSessionManager calls sessionManagerPanel.open(pipelineId)', () => {
    controller.openSessionManager();

    expect(appContext.sessionManagerPanel.open).toHaveBeenCalledWith('p1');
  });

  it('teardown destroys each mounted fragment and keeps the shell-owned pending state clear', () => {
    ctx.state.pipeline = { id: 'p1', name: 'remote', repo_uri: 'git@example.com:x.git' } as any;

    controller.setTab('coding-agent', { hash: 'none' });
    const interactiveInstance = (InteractiveCodingView as any).mock.results.at(-1).value;
    const interactiveDestroy = vi.spyOn(interactiveInstance, 'destroy');

    controller.setTab('file-browser', { hash: 'none' });
    const fileView = (controller as any).fileBrowseView;
    const fileDestroy = vi.spyOn(fileView, 'destroy');

    controller.setTab('history', { hash: 'none' });
    const historyView = (controller as any).historyView;
    const historyDestroy = vi.spyOn(historyView, 'destroy');

    ctx.state.pendingFbPath = 'src';
    controller.teardown();

    expect(interactiveDestroy).toHaveBeenCalledTimes(1);
    expect(fileDestroy).toHaveBeenCalledTimes(1);
    expect(historyDestroy).toHaveBeenCalledTimes(1);
    expect((controller as any).fileBrowseView).toBeNull();
    expect((controller as any).historyView).toBeNull();
    expect((controller as any).interactiveCodingView).toBeNull();
    expect(ctx.state.pendingFbPath).toBeNull();
  });

  it('applyRoute deep-links the File Browser path via pendingFbPath and resolves it with getMeta', async () => {
    controller.applyRoute({ rest: 'tab/fb/src' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(ctx.state.contentTab).toBe('file-browser');
    expect(appContext.fileBrowserClient.getMeta).toHaveBeenCalledWith('p1', 'src');
    expect(ctx.state.pendingFbPath).toBeNull();
  });

  it('makes a route re-entry for an in-flight file open a no-op', async () => {
    controller.setTab('file-browser', { hash: 'none' });
    const fileView = (controller as any).fileBrowseView;
    expect(fileView).not.toBeNull();

    let resolveRead: (value: any) => void = () => {};
    appContext.fileBrowserClient.readFile.mockImplementation(
      () => new Promise((resolve) => { resolveRead = resolve; })
    );
    appContext.fileBrowserClient.getMeta.mockClear();

    void fileView.openFile('src/App.ts', { silent: true });
    expect(appContext.fileBrowserClient.readFile).toHaveBeenCalledTimes(1);

    // The push wrote the sub-route; the resulting hashchange applies it. The
    // view reports the in-flight file, so the guard skips navigateTo().
    controller.applyRoute({ rest: 'tab/fb/src/App.ts' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(appContext.fileBrowserClient.getMeta).not.toHaveBeenCalled();
    expect(appContext.fileBrowserClient.readFile).toHaveBeenCalledTimes(1);

    resolveRead({ path: 'src/App.ts', name: 'App.ts', content: 'app\n' });
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
});
