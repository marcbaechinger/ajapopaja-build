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

import { SessionListItemView } from '../../components/SessionListItemView.ts';
import { ConfirmationDialog } from '../../components/ConfirmationDialog.ts';
import type { PiSessionSummary } from '../../../core/InteractiveCodingService.ts';
import type { PipelineDetailCtx } from './PipelineDetailCtx.ts';

export interface PipelineSessionListControllerDeps {
  ctx: PipelineDetailCtx;
  /** The view root containing #pipeline-session-list. */
  host: HTMLElement;
  /** Switch to the Coding Agent tab and re-sync the interactive view. */
  onOpenCodingAgent: () => void;
  /** Re-sync the interactive view after a session was discarded. */
  onSessionsChanged: () => void;
}

/**
 * Owns the inline per-pipeline list of resumable interactive sessions.
 *
 * Repaints the `#pipeline-session-list` mount point from the interactive
 * coding service and dispatches the `data-session-action` row clicks
 * (switch / pause / open / discard). Shell concerns stay out of the
 * controller: switching to the Coding Agent tab and re-syncing the
 * interactive view are injected as callbacks.
 */
export class PipelineSessionListController {
  private readonly deps: PipelineSessionListControllerDeps;
  private clickHandler: ((e: Event) => void) | null = null;

  constructor(deps: PipelineSessionListControllerDeps) {
    this.deps = deps;
    this.clickHandler = (e) => this.handleClick(e);
    this.listHost()?.addEventListener('click', this.clickHandler);
  }

  /** Repaints the list from the current pipeline and session cache. */
  refresh(): void {
    if (!this.listHost()) return;
    const isRemote = !!this.deps.ctx.state.pipeline?.repo_uri;
    this.render(isRemote ? this.resumableSessions() : []);
  }

  /** Removes the row click listener. */
  teardown(): void {
    if (this.clickHandler) {
      this.listHost()?.removeEventListener('click', this.clickHandler);
      this.clickHandler = null;
    }
  }

  private listHost(): HTMLElement | null {
    return this.deps.host.querySelector('#pipeline-session-list') as HTMLElement | null;
  }

  /** Resumable (paused/completed/failed) sessions belonging to this pipeline. */
  private resumableSessions(): PiSessionSummary[] {
    const service = this.deps.ctx.context.interactiveCodingService;
    if (!service?.getSessions) return [];
    try {
      return service
        .getSessions()
        .filter(
          (s) =>
            s.pipeline_id === this.deps.ctx.pipelineId &&
            (s.status === 'paused' || s.status === 'completed' || s.status === 'failed')
        );
    } catch {
      return [];
    }
  }

  /** Render the inline list of resumable sessions for this pipeline. */
  private render(sessions: PiSessionSummary[]): void {
    const list = this.listHost();
    if (!list) return;
    if (sessions.length === 0) {
      list.innerHTML = '';
      list.classList.add('hidden');
      return;
    }
    list.classList.remove('hidden');
    list.innerHTML = sessions
      .map((session) =>
        SessionListItemView.render(session, {
          pipelineName: this.deps.ctx.state.pipeline?.name ?? null,
          showDiscard: true,
          showOpenPipeline: false,
          showGenerateTitle: false,
        })
      )
      .join('');
  }

  private handleClick(event: Event): void {
    const target = (event.target as HTMLElement)?.closest?.('[data-session-action]') as HTMLElement | null;
    if (!target) return;
    if (!this.listHost()?.contains(target)) return;
    const action = target.getAttribute('data-session-action');
    const uid = target.getAttribute('data-session-uid') ?? '';
    const service = this.deps.ctx.context.interactiveCodingService;
    if (!service) return;

    if (action === 'switch' && uid) {
      void this.switchToSession(uid);
    } else if (action === 'pause') {
      void service.pauseSession?.();
    } else if (action === 'open') {
      const session = service.getSession?.(uid);
      if (session?.pipeline_id) window.location.hash = `#/pipeline/${session.pipeline_id}`;
    } else if (action === 'discard' && uid) {
      void new ConfirmationDialog(
        'Discard session',
        'Discard this session? This deletes the retained workspace and Pi conversation.',
        'Discard'
      )
        .show()
        .then((confirmed) => {
          if (confirmed) service.discardSession?.(uid).then(() => this.deps.onSessionsChanged());
        });
    }
  }

  /** Switch to a session, confirming when the current agent is mid-turn. */
  async switchToSession(uid: string): Promise<void> {
    const service = this.deps.ctx.context.interactiveCodingService;
    if (!service?.switchSession) return;
    try {
      if (service.isBusy?.()) {
        const confirmed = await new ConfirmationDialog(
          'Switch session?',
          'The current session is still working. Switching will interrupt it and pause the session.',
          'Switch & interrupt'
        ).show();
        if (!confirmed) return;
      }
      await service.switchSession(uid);
      this.deps.onOpenCodingAgent();
    } catch (error) {
      console.error('Switch interactive session error:', error);
      alert('Failed to switch the interactive session');
    }
  }
}
