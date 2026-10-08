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

import { Icon } from '../common/Icon.ts';

export interface SessionManagerButtonOptions {
  /** Number of paused/resumable sessions to surface in the badge. */
  pausedCount?: number;
  /** Whether any session is currently busy (shows a pulsing dot). */
  busy?: boolean;
  /** Compact icon-only variant used in the pipeline header. */
  compact?: boolean;
  /** Override the accessible/visible label. */
  label?: string;
}

/**
 * Header entry point for the session manager. Rendered as static HTML and
 * updated in place by {@link SessionManagerButton.updateAll} so both the
 * dashboard and pipeline headers stay in sync without per-view subscriptions.
 *
 * Clicks are routed through the global `toggle_session_manager` action.
 */
export class SessionManagerButton {
  static render(options: SessionManagerButtonOptions = {}): string {
    const pausedCount = options.pausedCount ?? 0;
    const label = options.label ?? 'Sessions';
    const compact = options.compact ?? false;
    const badge = pausedCount > 0
      ? `<span data-session-badge
              class="text-[10px] font-bold bg-app-accent-2 text-white px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center"
              aria-label="Paused session count">${pausedCount}</span>`
      : `<span data-session-badge
              class="hidden text-[10px] font-bold bg-app-accent-2 text-white px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center"
              aria-label="Paused session count"></span>`;

    return `
      <button type="button" data-action-click="toggle_session_manager" data-session-manager-button
              class="relative flex items-center gap-2 bg-app-bg hover:bg-app-surface px-4 py-2 rounded-xl border border-app-border text-app-muted hover:text-app-accent-2 transition-all cursor-pointer group"
              title="Interactive Sessions (Ctrl/Cmd+J)" aria-label="Open session manager">
        <span class="relative">
          ${Icon.render('clock', { size: 16, className: 'group-hover:scale-110 transition-transform' })}
          <span data-session-busy
                class="hidden absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-amber-400 animate-pulse"
                aria-label="A session is working"></span>
        </span>
        ${compact ? '' : `<span class="text-xs font-bold uppercase tracking-widest">${label}</span>`}
        ${badge}
        ${compact ? '' : '<span class="text-[10px] bg-app-surface px-1.5 py-0.5 rounded border border-app-border text-app-muted group-hover:text-app-accent-2 group-hover:border-app-accent-2/30 transition-colors ml-1">J</span>'}
      </button>
    `;
  }

  /**
   * Update every rendered session button under `root` with the given counts.
   * No-op when no button exists.
   */
  static updateAll(root: ParentNode, options: SessionManagerButtonOptions = {}): void {
    const pausedCount = options.pausedCount ?? 0;
    const busy = !!options.busy;
    root.querySelectorAll<HTMLElement>('[data-session-manager-button]').forEach((button) => {
      const badge = button.querySelector<HTMLElement>('[data-session-badge]');
      if (badge) {
        if (pausedCount > 0) {
          badge.textContent = String(pausedCount);
          badge.classList.remove('hidden');
        } else {
          badge.textContent = '';
          badge.classList.add('hidden');
        }
      }
      const dot = button.querySelector<HTMLElement>('[data-session-busy]');
      if (dot) {
        dot.classList.toggle('hidden', !busy);
      }
    });
  }
}
