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

import { SessionListItemView } from '../../components/session/SessionListItemView.ts';
import { ConfirmationDialog } from '../../components/dialogs/ConfirmationDialog.ts';
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
  private changeHandler: ((e: Event) => void) | null = null;
  /**
   * The pi coderbot model catalog offered for paused sessions. Kept as
   * controller state (rather than fetched inline) so the pure renderer stays
   * synchronous and testable; `PipelineDetailView` loads it once on mount.
   */
  private modelOptions: string[] = [];

  constructor(deps: PipelineSessionListControllerDeps) {
    this.deps = deps;
    this.clickHandler = (e) => this.handleClick(e);
    this.changeHandler = (e) => this.handleChange(e);
    this.listHost()?.addEventListener('click', this.clickHandler);
    this.listHost()?.addEventListener('change', this.changeHandler);
  }

  /** Sets the pi coderbot model catalog used by the paused-session selector. */
  setModelOptions(options: string[] | null | undefined): void {
    this.modelOptions = Array.isArray(options) ? [...options] : [];
    this.refresh();
  }

  /** Repaints the list from the current pipeline and session cache. */
  refresh(): void {
    if (!this.listHost()) return;
    const isRemote = !!this.deps.ctx.state.pipeline?.repo_uri;
    this.render(isRemote ? this.resumableSessions() : []);
  }

  /** Removes the row click/change listeners. */
  teardown(): void {
    if (this.clickHandler) {
      this.listHost()?.removeEventListener('click', this.clickHandler);
      this.clickHandler = null;
    }
    if (this.changeHandler) {
      this.listHost()?.removeEventListener('change', this.changeHandler);
      this.changeHandler = null;
    }
  }

  private listHost(): HTMLElement | null {
    return this.deps.host.querySelector('#pipeline-session-list') as HTMLElement | null;
  }

  /** Resumable (paused/completed/failed) interactive sessions for this pipeline. */
  private resumableSessions(): PiSessionSummary[] {
    const service = this.deps.ctx.context.interactiveCodingService;
    if (!service?.getSessions) return [];
    try {
      return service
        .getSessions()
        .filter(
          (s) =>
            s.pipeline_id === this.deps.ctx.pipelineId &&
            // Batch (`coderbot`) sessions are managed by the batch CoderBot
            // flow and must never be attached to the interactive PiView.
            s.kind !== 'coderbot' &&
            s.bot_type !== 'coderbot' &&
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
          modelOptions: this.modelOptions,
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

  /**
   * Handle a model-select change. The selected model is persisted for the
   * paused session (empty value clears the override) so the next resume uses
   * it.
   */
  private handleChange(event: Event): void {
    const target = (event.target as HTMLElement)?.closest?.(
      '[data-session-action="change-model"]'
    ) as HTMLSelectElement | null;
    if (!target) return;
    if (!this.listHost()?.contains(target)) return;
    const uid = target.getAttribute('data-session-uid') ?? '';
    if (!uid) return;
    const service = this.deps.ctx.context.interactiveCodingService;
    if (!service?.updateSessionModel) return;
    const value = target.value?.length ? target.value : null;
    void service.updateSessionModel(uid, value);
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
