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

import type { PiSessionSummary } from '../../../core/InteractiveCodingService.ts';
import { escapeHtml } from '../utils/html.ts';
import { formatAbsoluteTime, formatRelativeTime, sessionTimestamp } from '../utils/relativeTime.ts';

export interface SessionStatusMeta {
  label: string;
  /** Tailwind text colour class for the status. */
  color: string;
  /** Background/border classes for the status pill. */
  badge: string;
  /** Name of the sprite icon used for the status. */
  icon: string;
  /** Whether the status is resumable (Switch offered). */
  resumable: boolean;
}

/** Colour-coded metadata for every session status. */
export function sessionStatusMeta(status: string | null | undefined): SessionStatusMeta {
  switch (status) {
    case 'running':
      return {
        label: 'Active',
        color: 'text-green-400',
        badge: 'bg-green-500/10 border-green-500/30 text-green-400',
        icon: 'lightning',
        resumable: false,
      };
    case 'starting':
      return {
        label: 'Starting…',
        color: 'text-app-muted',
        badge: 'bg-app-surface border-app-border text-app-muted',
        icon: 'refresh',
        resumable: false,
      };
    case 'paused':
      return {
        label: 'Paused',
        color: 'text-amber-400',
        badge: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
        icon: 'clock',
        resumable: true,
      };
    case 'completed':
      return {
        label: 'Completed',
        color: 'text-blue-400',
        badge: 'bg-blue-500/10 border-blue-500/30 text-blue-400',
        icon: 'check',
        resumable: true,
      };
    case 'failed':
      return {
        label: 'Failed',
        color: 'text-red-400',
        badge: 'bg-red-500/10 border-red-500/30 text-red-400',
        icon: 'alert',
        resumable: true,
      };
    case 'discarded':
      return {
        label: 'Discarded',
        color: 'text-app-muted',
        badge: 'bg-app-surface border-app-border text-app-muted line-through',
        icon: 'trash',
        resumable: false,
      };
    default:
      return {
        label: status ? status : 'Unknown',
        color: 'text-app-muted',
        badge: 'bg-app-surface border-app-border text-app-muted',
        icon: 'clock',
        resumable: false,
      };
  }
}

/** The human readable label for a session, falling back to `(untitled)`. */
export function sessionDisplayLabel(session: PiSessionSummary): string {
  const label = session.label?.trim();
  if (label) return label;
  if (session.task_id) return session.task_id;
  return '(untitled)';
}

export interface SessionListItemOptions {
  /** True when this row is the active/running session for the current tab. */
  isActive?: boolean;
  /** True when the agent is currently processing a turn. */
  busy?: boolean;
  /** The uid currently being switched to (shows a spinner on that row). */
  switchingUid?: string | null;
  /** Resolved pipeline name for the session's `pipeline_id`. */
  pipelineName?: string | null;
  /** Render a compact, single-line variant used inline in the pipeline view. */
  compact?: boolean;
  /** Show the destructive discard affordance. */
  showDiscard?: boolean;
  /** Show the “open pipeline” affordance. */
  showOpenPipeline?: boolean;
  /**
   * Show the “generate title with AI” affordance and mark the row as an
   * one-shot result target. The inline per-pipeline list opts out so only the
   * global session manager exposes title generation.
   */
  showGenerateTitle?: boolean;
  /**
   * Fixed “now” (epoch ms) used when formatting the relative timestamp. Kept
   * injectable so the rendered row is deterministically testable.
   */
  now?: number;
  /**
   * The pi coderbot model catalog used to populate the paused-session model
   * selector. When omitted (or empty) the selector only offers “Use default”
   * plus the session's current model, which keeps the row renderable before the
   * catalog has loaded.
   */
  modelOptions?: string[];
  /**
   * Explicitly force the model selector on/off. When omitted it is shown for
   * every non-batch paused session so the inline per-pipeline list (which does
   * not set this flag) automatically gets it.
   */
  showModelSelect?: boolean;
}

/**
 * Pure renderer for a single session row. Reused by the {@link SessionManagerPanel}
 * drawer and the inline per-pipeline list.
 *
 * All interactions are delegated through `data-session-action` attributes so the
 * host only needs one click listener:
 *  - `data-session-action="switch"` → resume/switch to `data-session-uid`
 *  - `data-session-action="pause"`  → pause the active session
 *  - `data-session-action="discard"`→ discard `data-session-uid`
 *  - `data-session-action="change-model"` → persist a new model for the paused
 *    session (`data-session-uid`, select value)
 *  - `data-session-action="open"`   → navigate to the session's pipeline
 */
export class SessionListItemView {
  static render(session: PiSessionSummary, options: SessionListItemOptions = {}): string {
    const uid = session.uid;
    const meta = sessionStatusMeta(session.status);
    const isRunning = session.status === 'running';
    const isSwitching = options.switchingUid === uid;
    const isActive = options.isActive ?? isRunning;
    const label = escapeHtml(sessionDisplayLabel(session));
    const pipelineName = escapeHtml(options.pipelineName || session.pipeline_id || 'Unknown pipeline');
    const timestamp = sessionTimestamp(session);
    const relative = formatRelativeTime(timestamp, options.now);
    const absolute = formatAbsoluteTime(timestamp);
    const turns = session.resume_count ?? 0;
    const turnLabel = turns === 1 ? '1 turn' : `${turns} turns`;
    const kind = session.kind ? escapeHtml(session.kind) : 'interactive';
    // Batch (`coderbot`) sessions are managed by the batch CoderBot flow. The
    // interactive session manager only surfaces them read-only, so they never
    // offer the Switch/Pause actions that would attach them to the interactive
    // PiView.
    const isBatch = session.kind === 'coderbot' || session.bot_type === 'coderbot';
    const model = session.model ? escapeHtml(session.model) : '';

    // A paused session's model may be changed before it is resumed. The
    // selector reuses the same coderbot model catalog the task model dialog
    // exposes, so a session can be resumed with any model the pipeline allows.
    const canChangeModel = !isBatch && session.status === 'paused';
    const showModelSelect =
      canChangeModel && (options.showModelSelect ?? true);
    const modelSelect = showModelSelect
      ? renderModelSelect(uid, session.model ?? null, options.modelOptions ?? [])
      : '';

    const error = session.last_error
      ? `<div class="text-[11px] text-red-400 truncate" title="${escapeHtml(session.last_error)}">${escapeHtml(session.last_error)}</div>`
      : '';

    const links: string[] = [];
    if (session.task_id) {
      links.push(
        `<span class="text-[10px] font-mono px-1.5 py-0.5 rounded border border-app-border text-app-muted" title="Task">${escapeHtml(session.task_id)}</span>`
      );
    }
    for (const prId of session.pull_request_ids ?? []) {
      links.push(
        `<span class="text-[10px] font-mono px-1.5 py-0.5 rounded border border-app-border text-app-muted" title="Pull request">PR ${escapeHtml(String(prId))}</span>`
      );
    }

    const openAction =
      options.showOpenPipeline !== false && session.pipeline_id
        ? `<button type="button" data-session-action="open" data-session-uid="${escapeHtml(uid)}"
             class="text-[11px] px-2 py-1 rounded border border-app-border text-app-muted hover:text-app-text hover:bg-app-surface transition-colors cursor-pointer">Open pipeline</button>`
        : '';

    const discardAction = options.showDiscard
      ? `<button type="button" data-session-action="discard" data-session-uid="${escapeHtml(uid)}"
           class="text-[11px] px-2 py-1 rounded border border-app-border text-app-muted hover:text-red-400 hover:border-red-500/40 transition-colors cursor-pointer" title="Discard this session">Discard</button>`
      : '';

    let primaryAction = '';
    if (isBatch) {
      // Read-only: no Switch / Pause / Cancel for batch sessions.
      primaryAction = '';
    } else if (session.status === 'starting') {
      primaryAction = `<button type="button" data-session-action="pause" data-session-uid="${escapeHtml(uid)}"
        class="text-[11px] px-3 py-1 rounded bg-amber-600 text-white hover:bg-amber-700 transition-colors cursor-pointer font-medium">Cancel</button>`;
    } else if (isActive && isRunning) {
      primaryAction = `<button type="button" data-session-action="pause" data-session-uid="${escapeHtml(uid)}"
        class="text-[11px] px-3 py-1 rounded bg-amber-600 text-white hover:bg-amber-700 transition-colors cursor-pointer font-medium">Pause</button>`;
    } else if (meta.resumable) {
      primaryAction = `<button type="button" data-session-action="switch" data-session-uid="${escapeHtml(uid)}"
        class="text-[11px] px-3 py-1 rounded bg-app-accent-2 text-app-accent-fg hover:brightness-110 transition-colors cursor-pointer font-medium flex items-center gap-1 ${isSwitching ? 'opacity-60 cursor-wait' : ''}"
        ${isSwitching ? 'disabled' : ''}>${isSwitching ? 'Switching…' : 'Switch ▸'}</button>`;
    }

    const statusLabel = meta.label.replace('…', '');
    const busyDot = options.busy
      ? `<span class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" title="Working…" aria-label="Working"></span>`
      : session.status === 'starting'
        ? `<span class="w-3 h-3 rounded-full border-2 border-app-muted border-t-transparent animate-spin" aria-label="Starting"></span>`
        : '';
    const statusIcon = meta.icon
      ? `<span class="${meta.color}" aria-hidden="true">${iconSvg(meta.icon)}</span>`
      : '';

    // The title generator is offered for every session that still owns a stored
    // conversation (i.e. everything except discarded rows), and can be turned
    // off entirely for the compact inline variant.
    const showGenerateTitle =
      options.showGenerateTitle !== false && session.status !== 'discarded';
    const generateTitleButton = showGenerateTitle
      ? `<button type="button" data-session-action="generate-title" data-session-uid="${escapeHtml(uid)}"
           class="shrink-0 w-5 h-5 inline-flex items-center justify-center rounded border border-app-border text-app-muted hover:text-app-accent-2 hover:border-app-accent-2/50 transition-colors cursor-pointer"
           title="Generate a title from the first message" aria-label="Generate title">⌁</button>`
      : '';
    const onepromptTarget = showGenerateTitle ? ' data-oneprompt-target' : '';

    return `
      <div class="rounded-xl border border-app-border/50 bg-app-surface/40 px-3 py-2.5 flex flex-col gap-1.5 transition-all hover:border-app-accent-2/40 focus:outline-none focus:ring-2 focus:ring-app-accent-2"
           data-session-row data-session-uid="${escapeHtml(uid)}" data-status="${escapeHtml(session.status ?? '')}"${onepromptTarget}
           tabindex="-1" role="button" aria-label="Session ${label}"
           aria-current="${isActive ? 'true' : 'false'}">
        <div class="flex items-center gap-2 min-w-0">
          ${statusIcon}
          ${busyDot}
          <span class="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border ${meta.badge}" data-session-status>${escapeHtml(statusLabel)}</span>
          <span class="text-xs font-semibold text-app-text truncate" title="${label}">${label}</span>
          ${generateTitleButton}
          <span class="ml-auto text-[10px] text-app-muted shrink-0" title="${escapeHtml(absolute)}" data-session-relative>${escapeHtml(relative)}</span>
        </div>
        <div class="flex items-center gap-2 min-w-0 text-[11px] text-app-muted">
          <span class="truncate" title="${pipelineName}">${pipelineName}</span>
          <span class="opacity-40">·</span>
          <span class="shrink-0">${escapeHtml(kind)}</span>
          <span class="opacity-40">·</span>
          <span class="shrink-0" data-session-turns>${escapeHtml(turnLabel)}</span>
          ${model ? `<span class="opacity-40">·</span><span class="font-mono truncate" title="${model}">${model}</span>` : ''}
        </div>
        ${error}
        ${links.length ? `<div class="flex flex-wrap gap-1">${links.join('')}</div>` : ''}
        ${modelSelect}
        <div class="flex items-center gap-2 mt-0.5">
          ${primaryAction}
          ${openAction}
          ${discardAction}
        </div>
      </div>
    `;
  }
}

/** Render the paused-session model `<select>` from the coderbot catalog. */
function renderModelSelect(
  uid: string,
  currentModel: string | null,
  modelOptions: string[]
): string {
  const current = currentModel ?? '';
  // Preserve the session's current model even when it is missing from the
  // fetched catalog (e.g. a custom model removed from models.json).
  const values = [...modelOptions];
  if (current && !values.includes(current)) values.unshift(current);
  const options = values
    .map(
      (value) =>
        `<option value="${escapeHtml(value)}"${value === current ? ' selected' : ''}>${escapeHtml(value)}</option>`
    )
    .join('');
  return `
    <label class="flex items-center gap-2 text-[10px] text-app-muted min-w-0">
      <span class="uppercase font-bold tracking-widest shrink-0">Model</span>
      <select data-session-model data-session-action="change-model" data-session-uid="${escapeHtml(uid)}"
              class="session-model-select min-w-0 max-w-full bg-app-bg border border-app-border rounded px-1.5 py-1 text-[10px] text-app-text outline-none focus:ring-1 focus:ring-app-accent-2 cursor-pointer"
              title="Change the model used when this session is resumed"
              aria-label="Session model">
        <option value=""${current ? '' : ' selected'}>Use default</option>
        ${options}
      </select>
    </label>
  `;
}

/** Minimal inline SVG set so the row renderer has no component dependency. */
function iconSvg(name: string): string {
  const paths: Record<string, string> = {
    lightning: '<path d="M13 10V3L4 14h7v7l9-11h-7z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    check: '<path d="M20 6L9 17l-5-5"/>',
    alert: '<path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>',
    trash: '<path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m2 0v14a1 1 0 01-1 1H7a1 1 0 01-1-1V6h12z"/>',
    refresh: '<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>',
  };
  const path = paths[name] ?? paths.clock;
  return `<svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
}
