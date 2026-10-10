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
import { PipelineSessionListController } from './PipelineSessionListController.ts';
import { SessionListItemView } from '../../components/session/SessionListItemView.ts';
import { ConfirmationDialog } from '../../components/dialogs/ConfirmationDialog.ts';
import { createPipelineDetailCtx } from './PipelineDetailCtx.ts';
import type { PiSessionSummary } from '../../../core/InteractiveCodingService.ts';
import type { AppContext } from '../../../core/AppContext.ts';

vi.mock('../../components/dialogs/ConfirmationDialog.ts', () => ({
  ConfirmationDialog: vi.fn(function ConfirmationDialog() {
    return { show: vi.fn().mockResolvedValue(true) };
  }),
}));

/** Minimal InteractiveCodingService surface consumed by the controller. */
function makeInteractiveCodingService() {
  return {
    getSessions: vi.fn((): PiSessionSummary[] => []),
    getSession: vi.fn((_uid: string): PiSessionSummary | undefined => undefined),
    pauseSession: vi.fn().mockResolvedValue(undefined),
    switchSession: vi.fn().mockResolvedValue(undefined),
    discardSession: vi.fn().mockResolvedValue(undefined),
    isBusy: vi.fn(() => false),
  };
}

/** Configures the mocked ConfirmationDialog to resolve to `confirmed`. */
function confirmNext(confirmed: boolean) {
  (ConfirmationDialog as any).mockImplementationOnce(function ConfirmationDialog() {
    return { show: vi.fn().mockResolvedValue(confirmed) };
  });
}

describe('PipelineSessionListController', () => {
  let host: HTMLElement;
  let service: ReturnType<typeof makeInteractiveCodingService>;
  let onOpenCodingAgent: () => void;
  let onSessionsChanged: () => void;
  let ctx: ReturnType<typeof createPipelineDetailCtx>;
  let controllers: PipelineSessionListController[];

  const mountList = () => {
    host.innerHTML = '<div id="pipeline-session-list" class="hidden"></div>';
  };

  const listHost = () => host.querySelector('#pipeline-session-list') as HTMLElement;

  const makeController = () => {
    const controller = new PipelineSessionListController({
      ctx,
      host,
      onOpenCodingAgent,
      onSessionsChanged,
    });
    controllers.push(controller);
    return controller;
  };

  const row = (action: string, uid = 's1') =>
    `<button data-session-action="${action}" data-session-uid="${uid}">go</button>`;

  const click = (action: string, uid = 's1') => {
    const target = listHost().querySelector(
      `[data-session-action="${action}"][data-session-uid="${uid}"]`
    ) as HTMLElement;
    target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  };

  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    vi.clearAllMocks();
    (ConfirmationDialog as any).mockReset();
    (ConfirmationDialog as any).mockImplementation(function ConfirmationDialog() {
      return { show: vi.fn().mockResolvedValue(true) };
    });
    document.body.innerHTML = '';
    host = document.createElement('div');
    document.body.appendChild(host);
    mountList();
    window.location.hash = '';

    service = makeInteractiveCodingService();
    onOpenCodingAgent = vi.fn();
    onSessionsChanged = vi.fn();
    ctx = createPipelineDetailCtx({
      context: { interactiveCodingService: service } as unknown as AppContext,
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
    ctx.state.pipeline = {
      id: 'p1',
      name: 'Pipe 1',
      repo_uri: 'https://github.com/example/repo.git',
    } as any;

    controllers = [];
  });

  afterEach(() => {
    controllers.forEach((controller) => controller.teardown());
    controllers = [];
    vi.restoreAllMocks();
    window.location.hash = '';
    document.body.innerHTML = '';
  });

  describe('refresh()', () => {
    it('hides the host when empty', () => {
      makeController().refresh();
      expect(listHost().classList.contains('hidden')).toBe(true);
      expect(listHost().innerHTML).toBe('');
    });

    it('renders SessionListItemView rows for resumable sessions with the inline options', () => {
      service.getSessions.mockReturnValue([
        { uid: 's1', kind: 'interactive', pipeline_id: 'p1', status: 'paused', label: 'Paused session' },
      ]);
      const renderSpy = vi.spyOn(SessionListItemView, 'render');

      makeController().refresh();

      expect(renderSpy).toHaveBeenCalledTimes(1);
      expect(renderSpy.mock.calls[0][1]).toMatchObject({
        pipelineName: 'Pipe 1',
        showDiscard: true,
        showOpenPipeline: false,
        showGenerateTitle: false,
      });
      expect(listHost().classList.contains('hidden')).toBe(false);
      expect(listHost().querySelector('[data-session-uid="s1"]')).not.toBeNull();
    });

    it('filters out sessions from other pipelines and non-resumable statuses', () => {
      service.getSessions.mockReturnValue([
        { uid: 'mine', kind: 'interactive', pipeline_id: 'p1', status: 'completed' },
        { uid: 'other', kind: 'interactive', pipeline_id: 'p2', status: 'completed' },
        { uid: 'running', kind: 'interactive', pipeline_id: 'p1', status: 'running' },
      ]);

      makeController().refresh();

      expect(listHost().querySelector('[data-session-uid="mine"]')).not.toBeNull();
      expect(listHost().querySelector('[data-session-uid="other"]')).toBeNull();
      expect(listHost().querySelector('[data-session-uid="running"]')).toBeNull();
    });

    it('excludes batch (coderbot) sessions from the interactive resume list', () => {
      service.getSessions.mockReturnValue([
        { uid: 'interactive', kind: 'interactive', pipeline_id: 'p1', status: 'paused' },
        { uid: 'batch', kind: 'coderbot', pipeline_id: 'p1', status: 'completed' },
      ]);

      makeController().refresh();

      expect(listHost().querySelector('[data-session-uid="interactive"]')).not.toBeNull();
      expect(listHost().querySelector('[data-session-uid="batch"]')).toBeNull();
    });

    it('always renders an empty list for a non-remote pipeline', () => {
      ctx.state.pipeline = { id: 'p1', name: 'Local' } as any;
      service.getSessions.mockReturnValue([
        { uid: 's1', kind: 'interactive', pipeline_id: 'p1', status: 'paused' },
      ]);

      makeController().refresh();

      expect(listHost().classList.contains('hidden')).toBe(true);
      expect(listHost().innerHTML).toBe('');
    });

    it('swallows a getSessions() error and renders an empty list', () => {
      service.getSessions.mockImplementation(() => {
        throw new Error('boom');
      });

      expect(() => makeController().refresh()).not.toThrow();
      expect(listHost().classList.contains('hidden')).toBe(true);
      expect(listHost().innerHTML).toBe('');
    });

    it('repaints only the list without disturbing sibling DOM', () => {
      const sibling = document.createElement('div');
      sibling.id = 'sibling';
      host.appendChild(sibling);
      service.getSessions.mockReturnValue([
        { uid: 's1', kind: 'interactive', pipeline_id: 'p1', status: 'completed' },
      ]);

      makeController().refresh();

      expect(host.querySelector('#sibling')).toBe(sibling);
      expect(listHost().querySelector('[data-session-uid="s1"]')).not.toBeNull();
    });

    it('is a no-op when the list mount point is absent', () => {
      host.innerHTML = '<div></div>';
      const renderSpy = vi.spyOn(SessionListItemView, 'render');

      expect(() => makeController().refresh()).not.toThrow();
      expect(renderSpy).not.toHaveBeenCalled();
    });
  });

  describe('click dispatch', () => {
    it('switch resumes the session then opens the Coding Agent tab', async () => {
      makeController();
      listHost().innerHTML = row('switch');

      click('switch');

      await flush();
      expect(service.switchSession).toHaveBeenCalledWith('s1');
      expect(onOpenCodingAgent).toHaveBeenCalledTimes(1);
    });

    it('switch while busy is skipped when the confirmation is dismissed', async () => {
      service.isBusy.mockReturnValue(true);
      confirmNext(false);
      makeController();
      listHost().innerHTML = row('switch');

      click('switch');
      await flush();

      expect(ConfirmationDialog).toHaveBeenCalled();
      expect(service.switchSession).not.toHaveBeenCalled();
      expect(onOpenCodingAgent).not.toHaveBeenCalled();
    });

    it('switch while busy proceeds when the confirmation is accepted', async () => {
      service.isBusy.mockReturnValue(true);
      confirmNext(true);
      makeController();
      listHost().innerHTML = row('switch');

      click('switch');
      await flush();

      expect(service.switchSession).toHaveBeenCalledWith('s1');
      expect(onOpenCodingAgent).toHaveBeenCalledTimes(1);
    });

    it('pause pauses the active session', async () => {
      makeController();
      listHost().innerHTML = row('pause');

      click('pause');
      await flush();

      expect(service.pauseSession).toHaveBeenCalledTimes(1);
    });

    it('open navigates to the session pipeline', async () => {
      service.getSession.mockReturnValue({ uid: 's1', kind: 'interactive', status: 'paused', pipeline_id: 'p2' });
      makeController();
      listHost().innerHTML = row('open');

      click('open');
      await flush();

      expect(service.getSession).toHaveBeenCalledWith('s1');
      expect(window.location.hash).toBe('#/pipeline/p2');
    });

    it('discard is skipped when the confirmation is dismissed', async () => {
      confirmNext(false);
      makeController();
      listHost().innerHTML = row('discard');

      click('discard');
      await flush();

      expect(service.discardSession).not.toHaveBeenCalled();
      expect(onSessionsChanged).not.toHaveBeenCalled();
    });

    it('discard deletes the session and re-syncs the interactive view when confirmed', async () => {
      confirmNext(true);
      makeController();
      listHost().innerHTML = row('discard');

      click('discard');
      await flush();

      expect(service.discardSession).toHaveBeenCalledWith('s1');
      expect(onSessionsChanged).toHaveBeenCalledTimes(1);
    });

    it('ignores clicks that are not session actions', () => {
      makeController();
      listHost().innerHTML = '<button>plain</button>';

      (listHost().querySelector('button') as HTMLElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true })
      );

      expect(service.switchSession).not.toHaveBeenCalled();
      expect(service.pauseSession).not.toHaveBeenCalled();
    });
  });

  describe('teardown()', () => {
    it('removes the click listener so later clicks are ignored', async () => {
      const controller = makeController();
      listHost().innerHTML = row('pause');

      controller.teardown();
      click('pause');
      await flush();

      expect(service.pauseSession).not.toHaveBeenCalled();
    });

    it('is safe to call twice', () => {
      const controller = makeController();
      controller.teardown();
      expect(() => controller.teardown()).not.toThrow();
    });
  });
});
