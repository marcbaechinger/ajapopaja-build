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
import { ExecutionEngineController } from './ExecutionEngineController.ts';
import { ExecutionEngineView } from '../../components/pipeline/ExecutionEngineView.ts';
import { PiView } from '../../components/session/PiView.ts';
import { createPipelineDetailCtx } from './PipelineDetailCtx.ts';
import { TaskStatus } from '../../../core/domain.ts';
import type { AppContext } from '../../../core/AppContext.ts';

/** Minimal fake satisfying the PiSessionService surface PiView consumes. */
function makeCoderBotService() {
  return {
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
  };
}

describe('ExecutionEngineController', () => {
  let host: HTMLElement;
  let coderBotService: any;
  let onOpenCoderBotDialog: () => void;
  let ctx: ReturnType<typeof createPipelineDetailCtx>;
  let controllers: ExecutionEngineController[];

  /** Renders the engine shell (with its #engine-piview-mount slot) into the host. */
  const mountEngineShell = () => {
    host.innerHTML = `<div id="execution-engine-view">${ExecutionEngineView.render({ tasks: [] })}</div>`;
  };

  const makeController = () => {
    const controller = new ExecutionEngineController({
      ctx,
      host,
      onOpenCoderBotDialog,
    });
    controllers.push(controller);
    return controller;
  };

  const engineMount = () => host.querySelector('#engine-piview-mount') as HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
    coderBotService = makeCoderBotService();
    onOpenCoderBotDialog = vi.fn();
    ctx = createPipelineDetailCtx({
      context: { coderBotService } as unknown as AppContext,
      pipelineId: 'p1',
      refresh: {
        header: vi.fn(),
        backlog: vi.fn(),
        selectedTask: vi.fn(),
        executionEngine: vi.fn(),
        sessionList: vi.fn(),
        specProposals: vi.fn(),
      },
    });
    controllers = [];
  });

  afterEach(() => {
    controllers.forEach((controller) => controller.teardown());
    controllers = [];
    vi.restoreAllMocks();
    document.body.innerHTML = '';
  });

  describe('refresh()', () => {
    it('renders history tasks (settled only) ordered by updated_at desc and forwards historyPage', () => {
      ctx.state.allLoadedTasks = [
        { id: 'old', status: TaskStatus.IMPLEMENTED, deleted: false, updated_at: '2026-01-01T00:00:00Z' },
        { id: 'new', status: TaskStatus.DISCARDED, deleted: false, updated_at: '2026-02-01T00:00:00Z' },
        { id: 'sub', status: TaskStatus.SUBMITTED, deleted: false, updated_at: '2026-01-15T00:00:00Z' },
        { id: 'active', status: TaskStatus.INPROGRESS, deleted: false, updated_at: '2026-03-01T00:00:00Z' },
        { id: 'deleted', status: TaskStatus.IMPLEMENTED, deleted: true, updated_at: '2026-04-01T00:00:00Z' },
      ] as any;
      ctx.state.historyPage = 3;
      host.innerHTML = '<div id="execution-engine-view"></div>';

      const renderSpy = vi.spyOn(ExecutionEngineView, 'renderSections');
      makeController().refresh();

      expect(renderSpy).toHaveBeenCalledTimes(1);
      const props = renderSpy.mock.calls[0][0];
      expect(props.tasks).toBe(ctx.state.allLoadedTasks);
      expect(props.historyPage).toBe(3);
      expect(props.historyTasks!.map((t) => t.id)).toEqual(['new', 'sub', 'old']);
    });

    it('is a no-op when the execution engine mount point is absent', () => {
      host.innerHTML = '<div></div>';
      const renderSpy = vi.spyOn(ExecutionEngineView, 'render');
      expect(() => makeController().refresh()).not.toThrow();
      expect(renderSpy).not.toHaveBeenCalled();
    });

    it('preserves the mounted PiView across a full sections repaint', () => {
      coderBotService.getCurrentSession.mockReturnValue({ pipelineId: 'p1', taskId: 't1', active: true });
      host.innerHTML = '<div id="execution-engine-view"></div>';
      const renderSpy = vi.spyOn(PiView.prototype, 'render');
      const destroySpy = vi.spyOn(PiView.prototype, 'destroy');
      const controller = makeController();

      controller.refresh();
      const mount = engineMount();
      expect(mount.querySelector('#log-content-container')).not.toBeNull();
      expect(renderSpy).toHaveBeenCalledTimes(1);
      expect(coderBotService.reconnect).toHaveBeenCalledTimes(1);

      // A full repaint only replaces #engine-sections; the stable PiView mount
      // survives, so the mounted view is neither destroyed nor re-rendered.
      controller.refresh();
      expect(engineMount()).toBe(mount);
      expect(engineMount().querySelector('#log-content-container')).not.toBeNull();
      expect(renderSpy).toHaveBeenCalledTimes(1);
      expect(destroySpy).not.toHaveBeenCalled();
      expect(coderBotService.reconnect).toHaveBeenCalledTimes(2);
    });

    it('re-mounts the PiView when a refresh rebuilds a wiped shell', () => {
      coderBotService.getCurrentSession.mockReturnValue({ pipelineId: 'p1', taskId: 't1', active: true });
      host.innerHTML = '<div id="execution-engine-view"></div>';
      const renderSpy = vi.spyOn(PiView.prototype, 'render');
      const controller = makeController();

      controller.refresh();
      expect(renderSpy).toHaveBeenCalledTimes(1);

      // Wipe the stable shell entirely; the next refresh must rebuild it and
      // mount a fresh PiView.
      host.querySelector('#execution-engine-view')!.innerHTML = '';
      controller.refresh();
      expect(engineMount().querySelector('#log-content-container')).not.toBeNull();
      expect(renderSpy).toHaveBeenCalledTimes(2);
    });

    it('re-mounts the PiView when the session changes across a refresh', () => {
      coderBotService.getCurrentSession.mockReturnValue({ pipelineId: 'p1', taskId: 't1', active: true });
      host.innerHTML = '<div id="execution-engine-view"></div>';
      const renderSpy = vi.spyOn(PiView.prototype, 'render');
      const controller = makeController();

      controller.refresh();
      expect(renderSpy).toHaveBeenCalledTimes(1);

      coderBotService.getCurrentSession.mockReturnValue({ pipelineId: 'p1', taskId: 't2', active: true });
      controller.refresh();

      expect(engineMount().querySelector('#log-content-container')).not.toBeNull();
      expect(renderSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('updateSlot()', () => {
    it('shows the placeholder and destroys any mounted view when there is no session', () => {
      coderBotService.getCurrentSession.mockReturnValue({ pipelineId: 'p1', taskId: 't1', active: true });
      mountEngineShell();
      const destroySpy = vi.spyOn(PiView.prototype, 'destroy');
      const controller = makeController();

      controller.updateSlot();
      expect(engineMount().querySelector('#log-content-container')).not.toBeNull();

      coderBotService.getCurrentSession.mockReturnValue(null);
      controller.updateSlot();

      expect(engineMount().textContent).toContain('Start a CoderBot to see its output here.');
      expect(engineMount().querySelector('#log-content-container')).toBeNull();
      expect(destroySpy).toHaveBeenCalledTimes(1);
    });

    it('shows the placeholder when the session has no taskId', () => {
      coderBotService.getCurrentSession.mockReturnValue({ pipelineId: 'p1', taskId: null, active: true });
      mountEngineShell();
      makeController().updateSlot();
      expect(engineMount().textContent).toContain('Start a CoderBot to see its output here.');
    });

    it('mounts the PiView once for a same-pipeline session and reuses it on later syncs', () => {
      coderBotService.getCurrentSession.mockReturnValue({ pipelineId: 'p1', taskId: 't1', active: true });
      mountEngineShell();
      const renderSpy = vi.spyOn(PiView.prototype, 'render');
      const destroySpy = vi.spyOn(PiView.prototype, 'destroy');
      const controller = makeController();

      controller.updateSlot();
      expect(engineMount().querySelector('#log-content-container')).not.toBeNull();
      expect(renderSpy).toHaveBeenCalledTimes(1);
      expect(coderBotService.reconnect).toHaveBeenCalledTimes(1);

      controller.updateSlot();
      expect(renderSpy).toHaveBeenCalledTimes(1);
      expect(destroySpy).not.toHaveBeenCalled();
      expect(coderBotService.reconnect).toHaveBeenCalledTimes(2);
    });

    it('re-mounts when the mounted session key changes', () => {
      coderBotService.getCurrentSession.mockReturnValue({ pipelineId: 'p1', taskId: 't1', active: true });
      mountEngineShell();
      const renderSpy = vi.spyOn(PiView.prototype, 'render');
      const controller = makeController();

      controller.updateSlot();
      coderBotService.getCurrentSession.mockReturnValue({ pipelineId: 'p1', taskId: 't2', active: true });
      controller.updateSlot();

      expect(renderSpy).toHaveBeenCalledTimes(2);
    });

    it('re-mounts when the PiView DOM was wiped by an engine re-render', () => {
      coderBotService.getCurrentSession.mockReturnValue({ pipelineId: 'p1', taskId: 't1', active: true });
      mountEngineShell();
      const renderSpy = vi.spyOn(PiView.prototype, 'render');
      const controller = makeController();

      controller.updateSlot();
      expect(renderSpy).toHaveBeenCalledTimes(1);

      engineMount().innerHTML = '<p>wiped</p>';
      controller.updateSlot();

      expect(engineMount().querySelector('#log-content-container')).not.toBeNull();
      expect(renderSpy).toHaveBeenCalledTimes(2);
    });

    it('renders the other-pipeline notice with a link while that session is active', () => {
      coderBotService.getCurrentSession.mockReturnValue({ pipelineId: 'p2', taskId: 't2', active: true });
      mountEngineShell();
      makeController().updateSlot();

      const link = engineMount().querySelector('a');
      expect(link?.getAttribute('href')).toBe('#/pipeline/p2');
      expect(engineMount().textContent).toContain('CoderBot is running for another pipeline.');
      expect(engineMount().querySelector('#log-content-container')).toBeNull();
    });

    it('renders the placeholder for an inactive session on another pipeline', () => {
      coderBotService.getCurrentSession.mockReturnValue({ pipelineId: 'p2', taskId: 't2', active: false });
      mountEngineShell();
      makeController().updateSlot();

      expect(engineMount().querySelector('a')).toBeNull();
      expect(engineMount().textContent).toContain('Start a CoderBot to see its output here.');
    });

    it('wires onOpenCoderBotDialog into the PiView open-dialog action', () => {
      coderBotService.getCurrentSession.mockReturnValue({ pipelineId: 'p1', taskId: 't1', active: true });
      mountEngineShell();
      makeController().updateSlot();

      const openBtn = engineMount().querySelector('#open-dialog-btn');
      expect(openBtn).not.toBeNull();
      openBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(onOpenCoderBotDialog).toHaveBeenCalledTimes(1);
    });
  });

  describe('refreshSlot()', () => {
    it('refreshes the session through the service and re-syncs the slot', async () => {
      coderBotService.getCurrentSession.mockReturnValue({ pipelineId: 'p1', taskId: 't1', active: true });
      mountEngineShell();
      const controller = makeController();

      await controller.refreshSlot();

      expect(coderBotService.refreshSession).toHaveBeenCalledTimes(1);
      expect(engineMount().querySelector('#log-content-container')).not.toBeNull();
    });
  });

  describe('teardown()', () => {
    it('destroys the mounted PiView and clears the mount key', () => {
      coderBotService.getCurrentSession.mockReturnValue({ pipelineId: 'p1', taskId: 't1', active: true });
      mountEngineShell();
      const renderSpy = vi.spyOn(PiView.prototype, 'render');
      const destroySpy = vi.spyOn(PiView.prototype, 'destroy');
      const controller = makeController();

      controller.updateSlot();
      expect(renderSpy).toHaveBeenCalledTimes(1);

      controller.teardown();
      expect(destroySpy).toHaveBeenCalledTimes(1);

      // With the view and key cleared, the next sync re-mounts rather than reusing.
      controller.updateSlot();
      expect(renderSpy).toHaveBeenCalledTimes(2);
    });

    it('is safe to call when no view is mounted', () => {
      expect(() => makeController().teardown()).not.toThrow();
    });
  });
});
