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
import { DashboardView } from './DashboardView.ts';
import { PipelineStatus, TaskStatus } from '../../core/domain.ts';

// Mock components
const mockShow = vi.fn().mockResolvedValue(true);
vi.mock('../components/dialogs/ConfirmationDialog.ts', () => {
  return {
    ConfirmationDialog: class {
      show = mockShow;
    }
  };
});

vi.mock('../components/dialogs/PipelineEditDialog.ts', () => {
  return {
    PipelineEditDialog: vi.fn().mockImplementation(function (this: any) {
      this.show = mockShow;
    })
  };
});

vi.mock('../components/pipeline/PipelineStatsView.ts', () => ({
  PipelineStatsView: {
    render: vi.fn().mockReturnValue('<div class="mock-stats">Stats</div>'),
    renderCompact: vi.fn().mockReturnValue('<div class="mock-stats">Compact Stats</div>'),
    animateBars: vi.fn()
  }
}));

import { PipelineEditDialog } from '../components/dialogs/PipelineEditDialog.ts';

describe('DashboardView', () => {
  let mockContext: any;
  let container: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);

    mockContext = {
      actionRegistry: {
        register: vi.fn(),
      },
      wsClient: {
        on: vi.fn().mockReturnValue(() => {}),
      },
      authService: {
        getUser: vi.fn().mockReturnValue({ username: 'testuser' }),
      },
      pipelineClient: {
        list: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({}),
        delete: vi.fn().mockResolvedValue({}),
      },
      taskClient: {
        listByPipeline: vi.fn().mockResolvedValue([]),
        listCompletedByPipeline: vi.fn().mockResolvedValue({ tasks: [], total_count: 0 }),
      },
      systemClient: {
        getVersion: vi.fn().mockResolvedValue('1.0.0'),
        isOllamaAvailable: vi.fn().mockResolvedValue(true),
      }
    };

    vi.stubGlobal('location', { hash: '' });
    vi.stubGlobal('alert', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should register actions and websocket listeners on construction', () => {
    new DashboardView(mockContext);
    
    expect(mockContext.actionRegistry.register).toHaveBeenCalledWith('create_pipeline', expect.any(Function));
    expect(mockContext.actionRegistry.register).toHaveBeenCalledWith('delete_pipeline', expect.any(Function));
    expect(mockContext.actionRegistry.register).toHaveBeenCalledWith('view_pipeline', expect.any(Function));
    
    expect(mockContext.wsClient.on).toHaveBeenCalledWith('PIPELINE_CREATED', expect.any(Function));
    expect(mockContext.wsClient.on).toHaveBeenCalledWith('TASK_UPDATED', expect.any(Function));
  });

  it('should render the dashboard structure', () => {
    const view = new DashboardView(mockContext);
    container.innerHTML = view.render();

    expect(container.innerHTML).toContain('Ajapopaja');
    expect(container.innerHTML).toContain('Create Pipeline');
    expect(container.innerHTML).toContain('Active Pipelines');
    expect(container.querySelector('#pipeline-list')).toBeTruthy();
    // The pipeline list takes the entire width: no two-column grid layout.
    expect(container.innerHTML).not.toContain('md:grid-cols-2');
    // The inline creation form is gone.
    expect(container.querySelector('form[data-action-submit="create_pipeline"]')).toBeNull();
  });

  it('should refresh pipeline list and fetch tasks for each pipeline', async () => {
    const pipelines = [
      { id: 'p1', name: 'Pipe 1', status: PipelineStatus.ACTIVE, version: 1 },
      { id: 'p2', name: 'Pipe 2', status: PipelineStatus.PAUSED, version: 2 }
    ];
    mockContext.pipelineClient.list.mockResolvedValue(pipelines);
    mockContext.taskClient.listByPipeline.mockResolvedValue([
      { id: 't1', status: TaskStatus.IMPLEMENTED }
    ]);

    const view = new DashboardView(mockContext);
    container.innerHTML = view.render();
    view.mount(container);
    
    // Wait for async loads
    await new Promise(resolve => setTimeout(resolve, 0));

    const list = container.querySelector('#pipeline-list');
    expect(list).toBeTruthy();
    expect(list?.innerHTML).toContain('Pipe 1');
    expect(list?.innerHTML).toContain('Pipe 2');
    expect(mockContext.taskClient.listByPipeline).toHaveBeenCalledTimes(2);
    expect(list?.querySelectorAll('.mock-stats')).toHaveLength(2);
  });

  function renderedPipelineNames(): string[] {
    const items = Array.from(container.querySelectorAll('[data-view-type="pipeline"]'));
    return items.map(el => {
      const nameEl = el.querySelector('span.font-bold.text-app-text');
      return nameEl?.textContent ?? '';
    });
  }

  it('should group pipelines by status in active → paused → completed order', async () => {
    const pipelines = [
      { id: 'c1', name: 'Completed Pipe', status: PipelineStatus.COMPLETED, version: 1, created_at: '2024-01-01T00:00:00Z' },
      { id: 'a1', name: 'Active Pipe', status: PipelineStatus.ACTIVE, version: 1, created_at: '2024-01-02T00:00:00Z' },
      { id: 'p1', name: 'Paused Pipe', status: PipelineStatus.PAUSED, version: 1, created_at: '2024-01-03T00:00:00Z' }
    ];
    mockContext.pipelineClient.list.mockResolvedValue(pipelines);
    mockContext.taskClient.listByPipeline.mockResolvedValue([]);

    const view = new DashboardView(mockContext);
    container.innerHTML = view.render();
    view.mount(container);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(renderedPipelineNames()).toEqual(['Active Pipe', 'Paused Pipe', 'Completed Pipe']);
    // Group headers are rendered in priority order
    expect(container.querySelector('#pipeline-list')?.innerHTML).toContain('>Active<');
    expect(container.querySelector('#pipeline-list')?.innerHTML).toContain('>Paused<');
    expect(container.querySelector('#pipeline-list')?.innerHTML).toContain('>Completed<');
  });

  it('should order pipelines by created_at descending within the same status', async () => {
    const pipelines = [
      { id: 'a-old', name: 'Older Active', status: PipelineStatus.ACTIVE, version: 1, created_at: '2024-01-01T00:00:00Z' },
      { id: 'a-new', name: 'Newer Active', status: PipelineStatus.ACTIVE, version: 1, created_at: '2024-01-05T00:00:00Z' }
    ];
    mockContext.pipelineClient.list.mockResolvedValue(pipelines);
    mockContext.taskClient.listByPipeline.mockResolvedValue([]);

    const view = new DashboardView(mockContext);
    container.innerHTML = view.render();
    view.mount(container);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(renderedPipelineNames()).toEqual(['Newer Active', 'Older Active']);
  });

  it('should place unknown status pipelines after all known statuses', async () => {
    const pipelines = [
      { id: 'unk', name: 'Unknown Pipe', status: 'weird_status', version: 1, created_at: '2024-01-01T00:00:00Z' },
      { id: 'c1', name: 'Completed Pipe', status: PipelineStatus.COMPLETED, version: 1, created_at: '2024-01-02T00:00:00Z' },
      { id: 'a1', name: 'Active Pipe', status: PipelineStatus.ACTIVE, version: 1, created_at: '2024-01-03T00:00:00Z' }
    ];
    mockContext.pipelineClient.list.mockResolvedValue(pipelines);
    mockContext.taskClient.listByPipeline.mockResolvedValue([]);

    const view = new DashboardView(mockContext);
    container.innerHTML = view.render();
    view.mount(container);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(renderedPipelineNames()).toEqual(['Active Pipe', 'Completed Pipe', 'Unknown Pipe']);
  });

  it('should open the create pipeline dialog when the header button is clicked', async () => {
    const view = new DashboardView(mockContext);
    container.innerHTML = view.render();
    view.mount(container);

    const createAction = mockContext.actionRegistry.register.mock.calls.find((c: any) => c[0] === 'create_pipeline')[1];
    const buttonEl = container.querySelector('[data-action-click="create_pipeline"]') as HTMLElement;
    expect(buttonEl).toBeTruthy();

    await createAction(undefined, buttonEl);

    const mockDialog = (PipelineEditDialog as unknown as ReturnType<typeof vi.fn>);
    expect(mockDialog).toHaveBeenCalledWith(expect.objectContaining({ mode: 'create' }));
    expect(mockShow).toHaveBeenCalled();
  });

  it('should handle pipeline deletion with confirmation', async () => {
    await import('../components/dialogs/ConfirmationDialog.ts');
    const view = new DashboardView(mockContext);
    container.innerHTML = view.render();
    view.mount(container);
    
    const pipelines = [{ id: 'p1', name: 'P1', status: PipelineStatus.ACTIVE }];
    mockContext.pipelineClient.list.mockResolvedValue(pipelines);
    await view.refreshList();

    const deleteAction = mockContext.actionRegistry.register.mock.calls.find((c: any) => c[0] === 'delete_pipeline')[1];
    const deleteBtn = container.querySelector('[data-action-click="delete_pipeline"]') as HTMLElement;
    expect(deleteBtn).toBeTruthy();

    await deleteAction({ stopPropagation: vi.fn() } as any, deleteBtn);

    expect(mockShow).toHaveBeenCalled();
    expect(mockContext.pipelineClient.delete).toHaveBeenCalledWith('p1');
  });

  it('should navigate to pipeline detail view', async () => {
    const view = new DashboardView(mockContext);
    container.innerHTML = view.render();
    view.mount(container);
    
    const pipelines = [{ id: 'p1', name: 'P1', status: PipelineStatus.ACTIVE }];
    mockContext.pipelineClient.list.mockResolvedValue(pipelines);
    await view.refreshList();

    const viewAction = mockContext.actionRegistry.register.mock.calls.find((c: any) => c[0] === 'view_pipeline')[1];
    const item = container.querySelector('[data-view-id="p1"]') as HTMLElement;
    expect(item).toBeTruthy();

    await viewAction({ target: item } as any, item);

    expect(window.location.hash).toBe('#/pipeline/p1');
  });

  it('should hide assistant button if Ollama is not available', async () => {
    mockContext.systemClient.isOllamaAvailable.mockResolvedValue(false);
    const view = new DashboardView(mockContext);
    view.mount(container);
    container.innerHTML = view.render();
    
    await view['checkOllama']();

    const assistantBtn = container.querySelector('[data-action-click="toggle_assistant"]');
    expect(assistantBtn?.classList.contains('hidden')).toBe(true);
  });

  it('should display app version', async () => {
    const view = new DashboardView(mockContext);
    view.mount(container);
    container.innerHTML = view.render();
    
    await view['updateVersion']();

    const versionEl = container.querySelector('#app-version');
    expect(versionEl?.textContent).toBe('v1.0.0');
  });

  it('should render the getting-started guide when no pipelines exist', async () => {
    mockContext.pipelineClient.list.mockResolvedValue([]);
    const view = new DashboardView(mockContext);
    container.innerHTML = view.render();
    view.mount(container);
    await new Promise(resolve => setTimeout(resolve, 0));

    const list = container.querySelector('#pipeline-list');
    // Hero + Gitea walkthrough.
    expect(list?.innerHTML).toContain('Build your first pipeline');
    expect(list?.innerHTML).toContain('Create a Gitea repository');
    expect(list?.innerHTML).toContain('repository');
    expect(list?.innerHTML).toContain('issues');
    // Project blueprint prompts.
    expect(list?.innerHTML).toContain('React single-page app');
    expect(list?.innerHTML).toContain('React + Python API');
    expect(list?.innerHTML).toContain('Python CLI with Rich UI');
    // The regular header is hidden so the guide is the whole first page.
    expect(container.querySelector('#pipelines-header')?.classList.contains('hidden')).toBe(true);
  });

  it('should show the pipeline header and guide button once pipelines exist', async () => {
    mockContext.pipelineClient.list.mockResolvedValue([
      { id: 'p1', name: 'Pipe 1', status: PipelineStatus.ACTIVE, version: 1 },
    ]);
    mockContext.taskClient.listByPipeline.mockResolvedValue([]);
    const view = new DashboardView(mockContext);
    container.innerHTML = view.render();
    view.mount(container);
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(container.querySelector('#pipelines-header')?.classList.contains('hidden')).toBe(false);
    expect(container.querySelector('[data-action-click="open_getting_started"]')).toBeTruthy();
  });

  it('should copy a project blueprint prompt to the clipboard', async () => {
    const clipboardWrite = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText: clipboardWrite } });
    mockContext.pipelineClient.list.mockResolvedValue([]);

    const view = new DashboardView(mockContext);
    container.innerHTML = view.render();
    view.mount(container);
    await new Promise(resolve => setTimeout(resolve, 0));

    const copyAction = mockContext.actionRegistry.register.mock.calls.find((c: any) => c[0] === 'copy_project_prompt')[1];
    const button = container.querySelector('[data-action-click="copy_project_prompt"]') as HTMLElement;
    expect(button).toBeTruthy();

    await copyAction(undefined, button);

    expect(clipboardWrite).toHaveBeenCalledTimes(1);
    const copied = clipboardWrite.mock.calls[0][0] as string;
    expect(copied).toContain('Vite');
    expect(copied).toContain('TypeScript');
    expect(button.querySelector('.copy-label')?.textContent).toBe('Copied!');
  });

  it('should open the getting-started overlay from the guide action', () => {
    // JSDOM does not implement the native dialog methods.
    HTMLDialogElement.prototype.showModal = vi.fn(function (this: HTMLDialogElement) {
      this.open = true;
    });
    HTMLDialogElement.prototype.close = vi.fn(function (this: HTMLDialogElement) {
      this.open = false;
    });

    new DashboardView(mockContext);
    const openAction = mockContext.actionRegistry.register.mock.calls.find((c: any) => c[0] === 'open_getting_started')[1];
    openAction(undefined, document.body);

    const dialogs = Array.from(document.querySelectorAll('dialog'));
    expect(dialogs.length).toBeGreaterThan(0);
    expect(document.body.textContent).toContain('Getting Started');
    expect(document.body.textContent).toContain('Build your first pipeline');
    // The overlay routes its primary button through a dedicated action.
    expect(document.querySelector('[data-action-click="create_pipeline_from_guide"]')).toBeTruthy();
  });

  it('should cleanup subscriptions on unmount', () => {
    const view = new DashboardView(mockContext);
    const unsubMock = vi.fn();
    view['unsubs'] = [unsubMock];
    
    view.unmount();
    expect(unsubMock).toHaveBeenCalled();
    expect(view['unsubs']).toHaveLength(0);
  });
});
