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
