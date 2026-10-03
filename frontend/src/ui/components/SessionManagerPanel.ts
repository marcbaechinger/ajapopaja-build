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

import type { AppContext } from '../../core/AppContext.ts';
import type { PiSessionSummary } from '../../core/InteractiveCodingService.ts';
import { SessionListItemView, sessionDisplayLabel } from './SessionListItemView.ts';
import { ConfirmationDialog } from './ConfirmationDialog.ts';
import { escapeHtml } from './utils/html.ts';
import { formatRelativeTime, sessionTimestamp } from './utils/relativeTime.ts';

export type SessionFilter = 'all' | 'paused' | 'completed' | 'failed';

interface SessionGroup {
  key: string;
  label: string;
  color: string;
  statuses: string[];
}

const GROUPS: SessionGroup[] = [
  { key: 'active', label: 'Active', color: 'text-green-400', statuses: ['running', 'starting'] },
  { key: 'paused', label: 'Paused', color: 'text-amber-400', statuses: ['paused'] },
  { key: 'completed', label: 'Completed', color: 'text-blue-400', statuses: ['completed'] },
  { key: 'failed', label: 'Failed', color: 'text-red-400', statuses: ['failed'] },
  { key: 'discarded', label: 'Discarded', color: 'text-app-muted', statuses: ['discarded'] },
];

/**
 * Right-hand drawer listing every durable Pi session. It is the global entry
 * point for resuming/switching sessions and is mounted once by the
 * {@link AppContext} so it survives view navigation.
 *
 * The panel is a thin shell: all state lives in
 * {@link InteractiveCodingService} and the panel re-renders on
 * `onSessionsChange`/`onSessionChange`.
 */
export class SessionManagerPanel {
  private context: AppContext;
  private container: HTMLElement;
  private isOpen = false;
  private search = '';
  private filter: SessionFilter = 'all';
  private showDiscarded = false;
  private showBatch = false;
  private pipelineId: string | null = null;
  private statusMessage = '';
  private errorMessage = '';
  private unsubs: (() => void)[] = [];
  private keydownHandler: ((e: KeyboardEvent) => void) | null = null;

  constructor(context: AppContext) {
    this.context = context;
    this.container = this.createContainer();
    document.body.appendChild(this.container);
    this.bindDelegatedEvents();
    this.subscribe();
    this.render();

    this.keydownHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && this.isOpen) {
        e.preventDefault();
        this.close();
      }
    };
    document.addEventListener('keydown', this.keydownHandler);
  }

  // ---------------------------------------------------------------------------
  // Visibility
  // ---------------------------------------------------------------------------

  public open(pipelineId: string | null = null): void {
    this.pipelineId = pipelineId;
    this.isOpen = true;
    this.applyVisibility();
    void this.refresh();
    this.container.querySelector('input')?.focus();
  }

  public close(): void {
    this.isOpen = false;
    this.pipelineId = null;
    this.applyVisibility();
  }

  public toggle(pipelineId: string | null = null): void {
    if (this.isOpen) this.close();
    else this.open(pipelineId);
  }

  /** Alias for {@link open}; kept for dialog-style call sites. */
  public show(pipelineId: string | null = null): void {
    this.open(pipelineId);
  }

  public hide(): void {
    this.close();
  }

  public isVisible(): boolean {
    return this.isOpen;
  }

  public destroy(): void {
    this.unsubs.forEach((unsub) => {
      try {
        unsub();
      } catch {
        /* ignore */
      }
    });
    this.unsubs = [];
    if (this.keydownHandler) {
      document.removeEventListener('keydown', this.keydownHandler);
      this.keydownHandler = null;
    }
    this.container.remove();
  }

  private applyVisibility(): void {
    this.container.classList.toggle('hidden', !this.isOpen);
    const backdrop = this.container.querySelector('#session-manager-backdrop');
    backdrop?.classList.toggle('opacity-0', !this.isOpen);
    backdrop?.classList.toggle('pointer-events-none', !this.isOpen);
    const drawer = this.container.querySelector('#session-manager-drawer');
    drawer?.classList.toggle('translate-x-full', !this.isOpen);
  }

  private async refresh(): Promise<void> {
    const service = this.context.interactiveCodingService;
    if (!service?.refreshSessions) return;
    await service.refreshSessions(
      this.showBatch ? {} : { kind: 'interactive' }
    );
  }

  private subscribe(): void {
    const service = this.context.interactiveCodingService;
    if (!service) return;
    if (service.onSessionsChange) {
      this.unsubs.push(service.onSessionsChange(() => this.renderBody()));
    }
    if (service.onSessionChange) {
      this.unsubs.push(service.onSessionChange(() => this.renderBody()));
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  private createContainer(): HTMLElement {
    const el = document.createElement('div');
    el.id = 'session-manager-panel';
    el.className = 'fixed inset-0 z-[60] hidden';
    el.innerHTML = `
      <div id="session-manager-backdrop"
           class="absolute inset-0 bg-black/40 opacity-0 pointer-events-none transition-opacity duration-200"></div>
      <aside id="session-manager-drawer" role="dialog" aria-modal="true" aria-label="Interactive sessions"
             class="absolute top-0 right-0 h-full w-full sm:w-[420px] max-w-full bg-app-surface border-l border-app-border shadow-2xl flex flex-col translate-x-full transition-transform duration-200">
        <header class="flex items-center justify-between gap-3 px-4 py-3 border-b border-app-border bg-app-bg shrink-0">
          <div class="flex items-center gap-2 min-w-0">
            <h2 class="text-sm font-black uppercase tracking-widest text-app-text">Sessions</h2>
            <span class="text-[10px] text-app-muted font-mono border border-app-border rounded px-1.5 py-0.5">Ctrl/Cmd+J</span>
          </div>
          <button id="session-manager-close" type="button"
                  class="p-1.5 hover:bg-app-surface rounded-lg text-app-muted hover:text-app-text transition-colors cursor-pointer"
                  aria-label="Close session manager">✕</button>
        </header>
        <div class="p-3 border-b border-app-border/60 bg-app-bg/50 shrink-0 flex flex-col gap-2">
          <input id="session-manager-search" type="search" placeholder="Search sessions…"
                 class="w-full bg-app-bg border border-app-border rounded-lg px-3 py-1.5 text-xs text-app-text outline-none focus:ring-2 focus:ring-app-accent-2"
                 aria-label="Search sessions" />
          <div class="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter sessions">
            ${(['all', 'paused', 'completed', 'failed'] as SessionFilter[])
              .map(
                (f) =>
                  `<button type="button" data-session-filter="${f}" class="text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded border transition-colors cursor-pointer border-app-border text-app-muted hover:text-app-text">${f === 'all' ? 'All' : f}</button>`
              )
              .join('')}
            <label class="ml-auto flex items-center gap-1 text-[10px] text-app-muted cursor-pointer select-none">
              <input id="session-manager-show-discarded" type="checkbox" class="accent-app-accent-2" /> Discarded
            </label>
            <label class="flex items-center gap-1 text-[10px] text-app-muted cursor-pointer select-none">
              <input id="session-manager-show-batch" type="checkbox" class="accent-app-accent-2" /> Batch
            </label>
          </div>
          <div id="session-manager-status" class="text-[11px] text-app-accent-2 min-h-[1rem]" aria-live="polite"></div>
          <div id="session-manager-error" class="hidden text-[11px] text-red-400"></div>
        </div>
        <div id="session-manager-resume-hint"></div>
        <div id="session-manager-body" class="flex-1 overflow-y-auto p-3 flex flex-col gap-3"></div>
        <footer class="px-4 py-3 border-t border-app-border bg-app-bg text-[10px] text-app-muted shrink-0">
          Switching pauses the current session and keeps it safe.
        </footer>
      </aside>
    `;
    return el;
  }

  private bindDelegatedEvents(): void {
    this.container.querySelector('#session-manager-close')?.addEventListener('click', () => this.close());
    this.container.querySelector('#session-manager-backdrop')?.addEventListener('click', () => this.close());

    const search = this.container.querySelector('#session-manager-search') as HTMLInputElement | null;
    search?.addEventListener('input', () => {
      this.search = search.value;
      this.renderBody();
    });

    this.container.querySelectorAll<HTMLElement>('[data-session-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.filter = (btn.dataset.sessionFilter as SessionFilter) ?? 'all';
        this.renderBody();
      });
    });

    const showDiscarded = this.container.querySelector(
      '#session-manager-show-discarded'
    ) as HTMLInputElement | null;
    showDiscarded?.addEventListener('change', () => {
      this.showDiscarded = !!showDiscarded.checked;
      this.renderBody();
    });

    const showBatch = this.container.querySelector(
      '#session-manager-show-batch'
    ) as HTMLInputElement | null;
    showBatch?.addEventListener('change', () => {
      this.showBatch = !!showBatch.checked;
      void this.refresh();
      this.renderBody();
    });

    this.container.addEventListener('click', (event) => {
      const target = (event.target as HTMLElement).closest('[data-session-action]') as HTMLElement | null;
      if (!target || !this.container.contains(target)) return;
      const action = target.dataset.sessionAction;
      const uid = target.dataset.sessionUid ?? '';
      void this.handleAction(action, uid);
    });

    this.container.addEventListener('keydown', (event) => this.handleBodyKeydown(event));
  }

  /** Arrow/Home/End navigation across session rows; Enter switches. */
  private handleBodyKeydown(event: KeyboardEvent): void {
    if (!this.isOpen) return;
    const rows = Array.from(
      this.container.querySelectorAll<HTMLElement>('[data-session-row]')
    );
    if (rows.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const index = active ? rows.indexOf(active) : -1;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      (rows[index + 1] ?? rows[0]).focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      (rows[index - 1] ?? rows[rows.length - 1]).focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      rows[0].focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      rows[rows.length - 1].focus();
    } else if (event.key === 'Enter' && active && rows.includes(active)) {
      event.preventDefault();
      const uid = active.dataset.sessionUid ?? '';
      const status = active.dataset.status;
      void this.handleAction(status === 'running' ? 'pause' : 'switch', uid);
    } else if ((event.key === 'Delete' || event.key === 'Backspace') && active && rows.includes(active)) {
      event.preventDefault();
      void this.handleAction('discard', active.dataset.sessionUid ?? '');
    }
  }

  private async handleAction(action: string | undefined, uid: string): Promise<void> {
    const service = this.context.interactiveCodingService;
    if (!service) return;
    try {
      if (action === 'switch') {
        if (service.isBusy?.()) {
          const confirmed = await new ConfirmationDialog(
            'Switch session?',
            'The current session is still working. Switching will interrupt it and pause the session.',
            'Switch & interrupt'
          ).show();
          if (!confirmed) return;
        }
        this.setStatus('Switching…');
        await service.switchSession(uid);
        this.setStatus('');
      } else if (action === 'pause') {
        this.setStatus('Pausing…');
        await service.pauseSession();
        this.setStatus('');
      } else if (action === 'discard') {
        const session = service.getSession?.(uid);
        const label = session?.label || uid;
        const confirmed = await new ConfirmationDialog(
          'Discard session',
          `Discard “${label}”? This deletes the retained workspace and Pi conversation.`,
          'Discard'
        ).show();
        if (!confirmed) return;
        this.setStatus('Discarding…');
        await service.discardSession(uid);
        this.setStatus('');
      } else if (action === 'open') {
        const session = service.getSession?.(uid);
        const pipelineId = session?.pipeline_id;
        if (pipelineId) {
          window.location.hash = `#/pipeline/${pipelineId}`;
          this.close();
        }
      }
      this.renderBody();
    } catch (e) {
      this.setError(e instanceof Error ? e.message : String(e));
      this.renderBody();
    }
  }

  private setStatus(message: string): void {
    this.statusMessage = message;
    const status = this.container.querySelector('#session-manager-status');
    if (status) status.textContent = message;
  }

  private setError(message: string): void {
    this.errorMessage = message;
    const el = this.container.querySelector('#session-manager-error') as HTMLElement | null;
    if (el) {
      el.textContent = message ? `⚠ ${message}` : '';
      el.classList.toggle('hidden', !message);
    }
  }

  /** Re-render the whole panel (header/badges + body). */
  public render(): void {
    this.renderFilters();
    this.renderResumeHint();
    this.renderBody();
    this.applyVisibility();
  }

  private renderFilters(): void {
    this.container.querySelectorAll<HTMLElement>('[data-session-filter]').forEach((btn) => {
      const active = btn.dataset.sessionFilter === this.filter;
      btn.classList.toggle('bg-app-accent-2', active);
      btn.classList.toggle('text-white', active);
      btn.classList.toggle('border-app-accent-2', active);
      btn.classList.toggle('text-app-muted', !active);
    });
    const search = this.container.querySelector('#session-manager-search') as HTMLInputElement | null;
    if (search && search.value !== this.search) search.value = this.search;
    const showDiscarded = this.container.querySelector(
      '#session-manager-show-discarded'
    ) as HTMLInputElement | null;
    if (showDiscarded) showDiscarded.checked = this.showDiscarded;
    const showBatch = this.container.querySelector(
      '#session-manager-show-batch'
    ) as HTMLInputElement | null;
    if (showBatch) showBatch.checked = this.showBatch;
  }

  private renderResumeHint(): void {
    const el = this.container.querySelector('#session-manager-resume-hint') as HTMLElement | null;
    if (!el) return;
    const service = this.context.interactiveCodingService;
    const hint = service?.getResumeHint?.() ?? null;
    const active = service?.getCurrentSession?.()?.active;
    if (!hint || active) {
      el.innerHTML = '';
      return;
    }
    el.innerHTML = `
      <div class="mx-3 mt-3 flex items-center gap-2 rounded-lg border border-app-accent-2/40 bg-app-accent-2/10 px-3 py-2">
        <span class="text-[11px] text-app-text min-w-0 truncate">Resume your last session: <strong>${escapeHtml(sessionDisplayLabel(hint))}</strong></span>
        <button type="button" data-session-action="switch" data-session-uid="${escapeHtml(hint.uid)}"
                class="ml-auto text-[11px] px-2 py-1 rounded bg-app-accent-2 text-white hover:brightness-110 cursor-pointer shrink-0">Resume</button>
        <button type="button" data-session-hint-dismiss class="text-app-muted hover:text-app-text cursor-pointer shrink-0" aria-label="Dismiss">✕</button>
      </div>
    `;
    el.querySelector('[data-session-hint-dismiss]')?.addEventListener('click', () => {
      service?.dismissResumeHint?.();
      this.renderResumeHint();
    });
  }

  private matchesSearch(session: PiSessionSummary): boolean {
    const q = this.search.trim().toLowerCase();
    if (!q) return true;
    const pipeline = session.pipeline_id
      ? this.context.dataManager?.getPipeline?.(session.pipeline_id)?.name ?? ''
      : '';
    const parts = [
      session.label ?? '',
      pipeline,
      session.pipeline_id ?? '',
      session.task_id ?? '',
      ...(session.pull_request_ids ?? []).map((id) => String(id)),
    ];
    return parts.some((part) => String(part).toLowerCase().includes(q));
  }

  private matchesFilter(session: PiSessionSummary): boolean {
    if (this.filter === 'all') return true;
    return session.status === this.filter;
  }

  private renderBody(): void {
    const body = this.container.querySelector('#session-manager-body') as HTMLElement | null;
    if (!body) return;
    const service = this.context.interactiveCodingService;

    if (!service) {
      body.innerHTML = '<p class="text-xs text-app-muted italic text-center py-6">Session service unavailable.</p>';
      return;
    }

    if (service.isSessionsLoading?.()) {
      body.innerHTML = '<p class="text-xs text-app-muted animate-pulse text-center py-6">Loading sessions…</p>';
      return;
    }

    const error = service.getSessionsError?.();
    if (error) {
      body.innerHTML = `
        <p class="text-xs text-red-400 text-center py-6">Failed to load sessions: ${escapeHtml(error)}</p>
        <button type="button" data-session-refresh class="self-center text-[11px] px-3 py-1 rounded border border-app-border text-app-muted hover:text-app-text cursor-pointer">Retry</button>
      `;
      body.querySelector('[data-session-refresh]')?.addEventListener('click', () => void this.refresh());
      return;
    }

    const all = (service.getSessions?.() ?? []).filter(
      (s) => this.showDiscarded || s.status !== 'discarded'
    );
    const scoped = this.pipelineId
      ? all.filter((s) => s.pipeline_id === this.pipelineId)
      : all;
    const filtered = scoped.filter((s) => this.matchesSearch(s) && this.matchesFilter(s));

    if (filtered.length === 0) {
      body.innerHTML = `
        <div class="text-center py-8 px-4">
          <p class="text-xs text-app-muted italic">${this.search ? 'No sessions match your search.' : 'No sessions yet. Start an interactive session from any pipeline.'}</p>
          <button type="button" data-session-open-dashboard class="mt-3 text-[11px] px-3 py-1 rounded border border-app-border text-app-muted hover:text-app-text cursor-pointer">Open dashboard</button>
        </div>
      `;
      body.querySelector('[data-session-open-dashboard]')?.addEventListener('click', () => {
        window.location.hash = '#/';
        this.close();
      });
      return;
    }

    const currentUid = service.getCurrentSession?.()?.uid ?? null;
    const switchingUid = service.isSwitching?.() ?? null;

    const groupsHtml = GROUPS.filter((group) => group.key !== 'discarded' || this.showDiscarded)
      .map((group) => {
        const sessions = filtered.filter((s) => group.statuses.includes(s.status ?? ''));
        if (sessions.length === 0) return '';
        const items = sessions
          .map((session) =>
            SessionListItemView.render(session, {
              isActive: session.uid === currentUid,
              busy: session.uid === currentUid && !!service.isBusy?.(),
              switchingUid,
              pipelineName: this.resolvePipelineName(session.pipeline_id),
              showDiscard: session.uid !== currentUid,
              showOpenPipeline: true,
            })
          )
          .join('');
        return `
          <section data-session-group="${group.key}">
            <h3 class="text-[10px] font-black uppercase tracking-widest ${group.color} mb-1.5">
              ${group.label} <span class="text-app-muted">(${sessions.length})</span>
            </h3>
            <div class="flex flex-col gap-2">${items}</div>
          </section>
        `;
      })
      .join('');

    body.innerHTML = groupsHtml || '<p class="text-xs text-app-muted italic text-center py-6">No sessions to show.</p>';
    this.setStatus(this.statusMessage);
    this.setError(this.errorMessage);
  }

  private resolvePipelineName(pipelineId?: string | null): string | null {
    if (!pipelineId) return null;
    return this.context.dataManager?.getPipeline?.(pipelineId)?.name ?? null;
  }
}

/** Convenience helper used by tests/UI to render a session's relative time. */
export function sessionRelativeTime(session: PiSessionSummary): string {
  return formatRelativeTime(sessionTimestamp(session));
}
