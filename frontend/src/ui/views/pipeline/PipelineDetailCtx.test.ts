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

import { describe, it, expect, vi } from 'vitest';
import {
  createPipelineDetailCtx,
  createPipelineDetailState,
  PIPELINE_DOM_IDS,
  type PipelineDetailRefreshHooks,
} from './PipelineDetailCtx.ts';
import type { AppContext } from '../../../core/AppContext.ts';
import { TaskStatus } from '../../../core/domain.ts';

function makeRefresh(): PipelineDetailRefreshHooks {
  return {
    header: vi.fn(),
    backlog: vi.fn(),
    selectedTask: vi.fn(),
    executionEngine: vi.fn(),
    sessionList: vi.fn(),
    specProposals: vi.fn(),
  };
}

describe('createPipelineDetailState', () => {
  it('returns exactly the documented defaults', () => {
    const state = createPipelineDetailState();

    expect(state.pipeline).toBeNull();

    expect(state.allLoadedTasks).toEqual([]);
    expect(state.selectedTask).toBeNull();
    expect(state.collapsedTasks).toBeInstanceOf(Set);
    expect(state.collapsedTasks.size).toBe(0);
    expect(state.collapsedSpecs).toBeInstanceOf(Set);
    expect(state.collapsedSpecs.size).toBe(0);
    expect(state.activeEditors).toBeInstanceOf(Map);
    expect(state.activeEditors.size).toBe(0);
    expect(state.pendingSpecEditTaskId).toBeNull();
    expect(state.pendingScheduleFocusTaskId).toBeNull();
    expect(state.historyPage).toBe(0);

    expect(state.contentTab).toBe('task-editor');
    expect(state.pendingFbPath).toBeNull();
    expect(state.pendingTaskId).toBeNull();
    expect(state.sidebarCollapsed).toBe(false);

    expect(state.docbotState).toEqual({ status: 'none', taskId: null });
    expect(state.reviewbotState).toEqual({ status: 'none', taskId: null });
    expect(state.archbotState).toEqual({ status: 'none', taskId: null });
    expect(state.specagentState).toEqual({ status: 'none', taskId: null });
    expect(state.devProcessState).toBeUndefined();
    expect(state.pendingReviews).toEqual([]);
    expect(state.pendingSpecProposals).toEqual([]);
    expect(state.pullRequests).toEqual([]);
    expect(state.docbotPreviewData).toBeNull();

    expect(state.gitStatus).toBeUndefined();
  });

  it('returns a fresh, independent state on every call', () => {
    const a = createPipelineDetailState();
    const b = createPipelineDetailState();

    expect(a).not.toBe(b);
    expect(a.collapsedTasks).not.toBe(b.collapsedTasks);
    expect(a.activeEditors).not.toBe(b.activeEditors);
    expect(a.allLoadedTasks).not.toBe(b.allLoadedTasks);
  });
});

describe('createPipelineDetailCtx', () => {
  it('preserves the passed context, pipelineId, state references and refresh hooks', () => {
    const context = {} as AppContext;
    const state = createPipelineDetailState();
    const refresh = makeRefresh();

    const ctx = createPipelineDetailCtx({
      context,
      pipelineId: 'p1',
      state,
      refresh,
    });

    expect(ctx.context).toBe(context);
    expect(ctx.pipelineId).toBe('p1');
    expect(ctx.state).toBe(state);
    // Reference identity matters: every extracted controller must share the
    // exact same mutable Set/Map/array instances as the shell.
    expect(ctx.state.collapsedTasks).toBe(state.collapsedTasks);
    expect(ctx.state.collapsedSpecs).toBe(state.collapsedSpecs);
    expect(ctx.state.activeEditors).toBe(state.activeEditors);
    expect(ctx.refresh).toBe(refresh);
  });

  it('creates a fresh state when none is supplied', () => {
    const ctx = createPipelineDetailCtx({
      context: {} as AppContext,
      pipelineId: 'p2',
      refresh: makeRefresh(),
    });

    expect(ctx.state).toBeInstanceOf(Object);
    expect(ctx.state.contentTab).toBe('task-editor');
    expect(ctx.state.pipeline).toBeNull();
  });

  it('exposes the pipeline through a read-only getter backed by state', () => {
    const ctx = createPipelineDetailCtx({
      context: {} as AppContext,
      pipelineId: 'p3',
      refresh: makeRefresh(),
    });

    expect(ctx.pipeline).toBeNull();

    const pipeline: any = { id: 'p3', name: 'demo' };
    ctx.state.pipeline = pipeline;
    expect(ctx.pipeline).toBe(pipeline);
    expect(ctx.state.pipeline).toBe(pipeline);
  });

  it('keeps the refresh hooks callable in place', () => {
    const refresh = makeRefresh();
    const ctx = createPipelineDetailCtx({
      context: {} as AppContext,
      pipelineId: 'p4',
      refresh,
    });

    ctx.refresh.header();
    ctx.refresh.backlog();
    ctx.refresh.selectedTask();
    ctx.refresh.executionEngine();
    ctx.refresh.sessionList();
    ctx.refresh.specProposals();

    expect(refresh.header).toHaveBeenCalledTimes(1);
    expect(refresh.backlog).toHaveBeenCalledTimes(1);
    expect(refresh.selectedTask).toHaveBeenCalledTimes(1);
    expect(refresh.executionEngine).toHaveBeenCalledTimes(1);
    expect(refresh.sessionList).toHaveBeenCalledTimes(1);
    expect(refresh.specProposals).toHaveBeenCalledTimes(1);
  });

  it('mutates the shared state in place rather than replacing it', () => {
    const state = createPipelineDetailState();
    const ctx = createPipelineDetailCtx({
      context: {} as AppContext,
      pipelineId: 'p5',
      state,
      refresh: makeRefresh(),
    });

    state.allLoadedTasks.push({ id: 't1', status: TaskStatus.CREATED } as any);
    state.collapsedTasks.add('t1');
    expect(ctx.state.allLoadedTasks).toHaveLength(1);
    expect(ctx.state.collapsedTasks.has('t1')).toBe(true);
    expect(ctx.state).toBe(state);
  });
});

describe('PIPELINE_DOM_IDS', () => {
  it('pins the stable mount-point ids', () => {
    expect(PIPELINE_DOM_IDS).toEqual({
      headerContainer: 'pipeline-header-container',
      backlogSidebar: 'backlog-sidebar',
      backlogView: 'backlog-view',
      contentTablist: 'content-tablist',
      selectedTaskView: 'selected-task-view',
      interactiveCodingViewMount: 'interactive-coding-view-mount',
      fileBrowserViewMount: 'file-browser-view-mount',
      historyViewMount: 'history-view-mount',
      executionEngineView: 'execution-engine-view',
      enginePiViewMount: 'engine-piview-mount',
      pipelineSessionList: 'pipeline-session-list',
      pullRequestSection: 'pull-request-section',
      docbotDialogContainer: 'docbot-dialog-container',
    });
  });
});
