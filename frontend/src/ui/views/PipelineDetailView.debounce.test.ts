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

describe('PipelineDetailView Git Status Debounce', () => {
  let mockContext: any;
  let container: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
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
      systemClient: {
        isOllamaAvailable: vi.fn().mockResolvedValue(true),
      }
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should debounce multiple refresh calls', async () => {
    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    view.mount(container);

    // Wait for initial load to settle
    await vi.runAllTimersAsync();

    // Initial load should have triggered one refresh
    expect(mockContext.pipelineClient.getGitStatus).toHaveBeenCalledTimes(1);

    // Trigger multiple schedule calls rapidly (e.g. multiple task completions)
    const scheduleRefresh = () => (view as any).scheduleRefreshGitStatus();
    scheduleRefresh();
    scheduleRefresh();
    scheduleRefresh();

    // Advance 500ms for the debounce timer
    vi.advanceTimersByTime(500);

    // Should result in exactly ONE more call to getGitStatus
    expect(mockContext.pipelineClient.getGitStatus).toHaveBeenCalledTimes(2);

    // Wait for the async part of the 2nd call to finish
    await vi.runAllTimersAsync();

    // Trigger again after first one finished
    scheduleRefresh();
    vi.advanceTimersByTime(500);
    await vi.runAllTimersAsync();

    expect(mockContext.pipelineClient.getGitStatus).toHaveBeenCalledTimes(3);
  });

  it('should schedule a trailing refresh if one is already in progress', async () => {
    // Delay the git status response
    let resolveGitStatus: (val: any) => void;
    mockContext.pipelineClient.getGitStatus.mockReturnValue(new Promise(resolve => {
      resolveGitStatus = resolve;
    }));

    const view = new PipelineDetailView(mockContext, { id: 'p1' });
    view.mount(container);

    // loadPipeline has async calls before scheduling refresh.
    // Wait for them.
    await vi.runAllTimersAsync();

    // Now advance 500ms for the timer that was scheduled at the end of loadPipeline
    vi.advanceTimersByTime(500);
    // getGitStatus is now "in progress"
    expect(mockContext.pipelineClient.getGitStatus).toHaveBeenCalledTimes(1);

    // Call while in progress
    (view as any).scheduleRefreshGitStatus();

    // Resolve the first call
    resolveGitStatus!({});
    await vi.runAllTimersAsync();

    // After the first one finishes, it should have seen the pending flag and scheduled another one.
    // The scheduler starts another 500ms timer.
    vi.advanceTimersByTime(500);

    // Should now be called twice
    expect(mockContext.pipelineClient.getGitStatus).toHaveBeenCalledTimes(2);
  });
});
