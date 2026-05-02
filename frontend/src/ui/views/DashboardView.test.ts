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
import { DashboardView } from './DashboardView.ts';
import { PipelineStatus, TaskStatus } from '../../core/domain.ts';

// Mock components
const mockShow = vi.fn().mockResolvedValue(true);
vi.mock('../components/ConfirmationDialog.ts', () => {
  return {
    ConfirmationDialog: class {
      show = mockShow;
    }
  };
});

vi.mock('../components/PipelineStatsView.ts', () => ({
  PipelineStatsView: {
    render: vi.fn().mockReturnValue('<div class="mock-stats">Stats</div>'),
    animateBars: vi.fn()
  }
}));

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
      },
      systemClient: {
        getVersion: vi.fn().mockResolvedValue('1.0.0'),
        isOllamaAvailable: vi.fn().mockResolvedValue(true),
      }
    };

    vi.stubGlobal('location', { hash: '' });
    vi.stubGlobal('alert', vi.fn());
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

  it('should handle pipeline creation', async () => {
    const view = new DashboardView(mockContext);
    container.innerHTML = view.render();
    view.mount(container);

    const createAction = mockContext.actionRegistry.register.mock.calls.find(c => c[0] === 'create_pipeline')[1];
    
    const form = container.querySelector('form') as HTMLFormElement;
    const nameInput = form.querySelector('input[name="pipeline_name"]') as HTMLInputElement;
    const wsInput = form.querySelector('input[name="workspace_path"]') as HTMLInputElement;
    nameInput.value = 'New Pipe';
    wsInput.value = '/tmp/path';

    await createAction(new Event('submit'), form);

    expect(mockContext.pipelineClient.create).toHaveBeenCalledWith('New Pipe', '/tmp/path');
    expect(nameInput.value).toBe('');
    expect(wsInput.value).toBe('');
  });

  it('should handle pipeline deletion with confirmation', async () => {
    const { ConfirmationDialog } = await import('../components/ConfirmationDialog.ts');
    const view = new DashboardView(mockContext);
    container.innerHTML = view.render();
    view.mount(container);
    
    const pipelines = [{ id: 'p1', name: 'P1', status: PipelineStatus.ACTIVE }];
    mockContext.pipelineClient.list.mockResolvedValue(pipelines);
    await view.refreshList();

    const deleteAction = mockContext.actionRegistry.register.mock.calls.find(c => c[0] === 'delete_pipeline')[1];
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

    const viewAction = mockContext.actionRegistry.register.mock.calls.find(c => c[0] === 'view_pipeline')[1];
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

  it('should cleanup subscriptions on unmount', () => {
    const view = new DashboardView(mockContext);
    const unsubMock = vi.fn();
    view['unsubs'] = [unsubMock];
    
    view.unmount();
    expect(unsubMock).toHaveBeenCalled();
    expect(view['unsubs']).toHaveLength(0);
  });
});
