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

import { Task, TaskStatus } from '../../../core/domain.ts';
import { ExecutionEngineItemView } from './ExecutionEngineItemView.ts';
import { HistoryItemView } from './HistoryItemView.ts';
import { PipelineHistoryView } from './PipelineHistoryView.ts';

export interface ExecutionEngineViewProps {
  tasks: Task[];
  historyTasks?: Task[];
  historyPage?: number;
  /**
   * When true, all three sidebar sections (In Progress, Queue and the History
   * Feed) are collapsed together. The sections are either all displayed or all
   * collapsed; the embedded CoderBot PiView then fills the freed vertical space.
   */
  collapsed?: boolean;
  /** Alias for {@link collapsed}. */
  sectionsCollapsed?: boolean;
}

/** The right-sidebar bucket a task is rendered in, based on its status. */
export type EngineBucket = 'inprogress' | 'queue' | 'history' | 'none';

/** Statuses that belong to the paged History Feed. */
const HISTORY_STATUSES: TaskStatus[] = [
  TaskStatus.IMPLEMENTED,
  TaskStatus.SUBMITTED,
  TaskStatus.DISCARDED,
];

/**
 * ExecutionEngineView renders the right side panel of the PipelineDetailView.
 *
 * It lists the tasks currently handled by the execution engine, grouped into
 * sections - In Progress (IN_PROGRESS), Queue (SCHEDULED) and the paged History
 * Feed - each with a header showing the section type and the total number of
 * tasks in it. Tasks within a section are ordered by their execution order.
 *
 * The three sections collapse together: the shell renders a single master
 * toggle that hides `#engine-sections` and lets the embedded CoderBot PiView
 * grow to fill the freed sidebar height.
 */
export class ExecutionEngineView {
  static render(props: ExecutionEngineViewProps): string {
    const collapsed = props.collapsed ?? props.sectionsCollapsed ?? false;
    return ExecutionEngineView.renderShell(
      ExecutionEngineView.renderSections(props),
      collapsed
    );
  }

  /**
   * The stable shell: a repaintable `#engine-sections` container plus the
   * `#engine-piview-section` that owns `#engine-piview-mount`. The shell (and
   * therefore the mounted PiView) is written once and survives full section
   * repaints, so the CoderBot activity log is never torn down unnecessarily.
   */
  static renderShell(sectionsHtml: string = '', collapsed: boolean = false): string {
    const sectionsClass = collapsed
      ? 'flex flex-col flex-1 min-h-0 hidden'
      : 'flex flex-col flex-1 min-h-0';
    return `
      <div class="flex flex-col min-h-0 h-full overflow-hidden pt-2">
        <!-- Master collapse toggle for the three sections below. It lives in the
             stable shell (outside #engine-sections) so it survives every section
             repaint and always stays reachable. -->
        <div class="flex items-center justify-end px-1 pb-0.5 shrink-0">
          <button id="engine-sections-toggle" data-engine-toggle="sections" type="button"
            aria-controls="engine-sections" aria-expanded="${!collapsed}"
            class="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-widest text-app-muted hover:text-app-text hover:bg-app-bg border border-transparent hover:border-app-border transition-colors cursor-pointer"
            title="${collapsed ? 'Expand sections' : 'Collapse sections'}">
            <span id="engine-sections-toggle-label">${collapsed ? 'Expand all' : 'Collapse all'}</span>
            <span id="engine-sections-toggle-icon">${ExecutionEngineView.sectionToggleIcon(collapsed)}</span>
          </button>
        </div>

        <div id="engine-sections" class="${sectionsClass}">
          ${sectionsHtml}
        </div>

        <div id="engine-piview-section" class="flex flex-col gap-1.5 mt-1">
          <div id="engine-piview-mount" class="min-h-0 flex flex-col">
            <p class="text-[10px] italic text-app-muted/50 text-center border border-dashed border-app-border/40 rounded-lg py-3">Start a CoderBot to see its output here.</p>
          </div>
        </div>
      </div>
    `;
  }

  /** Chevron for the sections toggle (points the way the sections will move). */
  static sectionToggleIcon(collapsed: boolean): string {
    const points = collapsed ? '6 9 12 15 18 9' : '18 15 12 9 6 15';
    return `<svg class="w-3 h-3" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="${points}"></polyline></svg>`;
  }

  /**
   * Applies the shared collapsed state to a mounted engine view. When collapsed,
   * all three section lists (`#engine-sections`) are hidden and the embedded
   * CoderBot `PiView` is allowed to grow to the full sidebar height; when
   * expanded, the PiView returns to its compact fixed height.
   *
   * Kept as a pure DOM helper (mirroring `PipelineDetailLayout.applySidebarState`)
   * so the controller only owns the boolean state, not the layout details.
   */
  static applySectionsCollapsed(root: ParentNode, collapsed: boolean): void {
    const sections = root.querySelector<HTMLElement>('#engine-sections');
    sections?.classList.toggle('hidden', collapsed);

    const piviewSection = root.querySelector<HTMLElement>('#engine-piview-section');
    piviewSection?.classList.toggle('flex-1', collapsed);
    piviewSection?.classList.toggle('min-h-0', collapsed);

    const mount = root.querySelector<HTMLElement>('#engine-piview-mount');
    mount?.classList.toggle('flex-1', collapsed);

    // Let the mounted PiView log fill the freed space instead of its compact
    // 38vh height. The inline height overrides the `h-[38vh]` utility class and
    // is cleared again on expand so the compact height is restored.
    const log = root.querySelector<HTMLElement>('#log-content-container');
    if (log) {
      log.classList.toggle('flex-1', collapsed);
      log.classList.toggle('min-h-0', collapsed);
      log.style.height = collapsed ? 'auto' : '';
    }

    const toggle = root.querySelector<HTMLElement>('#engine-sections-toggle');
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.setAttribute('title', collapsed ? 'Expand sections' : 'Collapse sections');
      const label = toggle.querySelector<HTMLElement>('#engine-sections-toggle-label');
      if (label) label.textContent = collapsed ? 'Expand all' : 'Collapse all';
      const icon = toggle.querySelector<HTMLElement>('#engine-sections-toggle-icon');
      if (icon) icon.innerHTML = ExecutionEngineView.sectionToggleIcon(collapsed);
    }
  }

  /** Alias for {@link applySectionsCollapsed}, matching `applySidebarState`. */
  static applySectionsState(root: ParentNode, collapsed: boolean): void {
    ExecutionEngineView.applySectionsCollapsed(root, collapsed);
  }

  /** Alias for {@link applySectionsCollapsed}. */
  static applyCollapsedState(root: ParentNode, collapsed: boolean): void {
    ExecutionEngineView.applySectionsCollapsed(root, collapsed);
  }

  /**
   * The repaintable section lists (In Progress, Queue and the History Feed).
   * This is the only markup replaced by a full engine refresh.
   */
  static renderSections(props: ExecutionEngineViewProps): string {
    const { tasks = [] } = props;
    const historyTasks = props.historyTasks ?? [];
    const historyPage = props.historyPage ?? 0;

    const inProgress = tasks
      .filter(t => !t.deleted && t.status === TaskStatus.INPROGRESS)
      .sort((a, b) => orderSort(a, b));
    const queue = tasks
      .filter(t => !t.deleted && t.status === TaskStatus.SCHEDULED)
      .sort((a, b) => orderSort(a, b));

    return `
      ${ExecutionEngineView.sectionHeader('In Progress', inProgress.length, 'text-amber-400', 'inprogress')}
      ${ExecutionEngineView.sectionBody(inProgress, 'No active work.', '', 'inprogress')}

      ${ExecutionEngineView.sectionHeader('Queue', queue.length, 'text-app-accent-1', 'queue')}
      ${ExecutionEngineView.sectionBody(queue, 'Nothing scheduled.', 'max-h-48 overflow-y-auto', 'queue')}

      <div id="sidebar-history" class="flex-1 min-h-0 mt-2 flex flex-col overflow-hidden">
        ${PipelineHistoryView.render(historyTasks, historyPage)}
      </div>
    `;
  }

  private static sectionHeader(title: string, count: number, accent: string, key?: string): string {
    const headerAttr = key ? ` data-engine-header="${key}"` : '';
    const countAttr = key ? ` data-engine-count="${key}"` : '';
    return `
      <div class="flex items-center justify-between px-1 pt-1"${headerAttr}>
        <span class="text-[10px] font-black uppercase tracking-widest ${accent}">${title}</span>
        <span${countAttr} class="text-[10px] font-bold text-app-muted bg-app-surface border border-app-border rounded-full px-1.5 py-0.5">${count}</span>
      </div>
    `;
  }

  private static sectionBody(tasks: Task[], emptyMessage: string, listClass: string = '', key?: string): string {
    const sectionAttr = key ? ` data-engine-section="${key}"` : '';
    if (tasks.length === 0) {
      return `
        <div class="px-1"${sectionAttr}>
          <p class="text-[10px] italic text-app-muted/50 text-center border border-dashed border-app-border/40 rounded-lg py-3">${emptyMessage}</p>
        </div>
      `;
    }
    return `
      <div class="flex flex-col gap-2 ${listClass}"${sectionAttr}>
        ${tasks.map(t => ExecutionEngineItemView.render(t)).join('')}
      </div>
    `;
  }

  /**
   * Classifies a status into the bucket the engine panel renders it in.
   * Anything the panel does not show maps to `none`.
   */
  static bucketFor(status: TaskStatus): EngineBucket {
    if (status === TaskStatus.INPROGRESS) return 'inprogress';
    if (status === TaskStatus.SCHEDULED) return 'queue';
    if (HISTORY_STATUSES.includes(status)) return 'history';
    return 'none';
  }

  /**
   * Moves a single task between engine buckets in place, touching only the
   * affected rows and section counts. The stable `#engine-piview-mount` and the
   * other sections (and their scroll state) are left untouched.
   *
   * Returns `false` whenever the current layout cannot be reconciled
   * confidently (missing node / unknown structure); the caller then falls back
   * to a full `ExecutionEngineView.render` repaint.
   */
  static reconcileTask(container: HTMLElement, task: Task, prevStatus: TaskStatus): boolean {
    const taskId = task.id;
    if (!taskId) return false;

    const prev = ExecutionEngineView.bucketFor(prevStatus);
    const next = ExecutionEngineView.bucketFor(task.status);
    if (prev === 'none') return false;

    const node = ExecutionEngineView.findItem(container, prev, taskId);
    if (!node) return false;

    if (prev === next) {
      // Same bucket: swap just this row with a freshly rendered one.
      node.outerHTML = ExecutionEngineView.renderItem(prev, task);
      return true;
    }

    // Validate the destination before mutating so a missing section cannot
    // silently drop the task. `none` only removes the old row.
    if (next !== 'none' && !ExecutionEngineView.sectionFor(container, next)) {
      return false;
    }

    if (!ExecutionEngineView.removeItem(container, prev, taskId)) return false;
    if (next === 'none') return true;
    return ExecutionEngineView.insertItem(container, next, task);
  }

  /**
   * Removes a single task from the rendered In Progress section in place,
   * keeping the rest of the ExecutionEngineView DOM (PiView mount, queue, history)
   * untouched. Used when a task transitions out of IN_PROGRESS (e.g. to
   * PULL_REQUEST_AVAILABLE) without a full task re-broadcast. Returns true when
   * the item was found and removed.
   */
  static removeInProgressItem(container: HTMLElement, taskId: string): boolean {
    return ExecutionEngineView.removeItem(container, 'inprogress', taskId);
  }

  /** Locates a task's rendered row in a bucket. */
  private static findItem(
    container: HTMLElement,
    bucket: EngineBucket,
    taskId: string
  ): Element | null {
    if (bucket === 'history') {
      const list = container.querySelector('#completed-task-list');
      return list?.querySelector(`[data-view-type="history"][data-task-id="${taskId}"]`) ?? null;
    }
    if (bucket === 'inprogress' || bucket === 'queue') {
      const list = container.querySelector(`[data-engine-section="${bucket}"]`);
      return list?.querySelector(`[data-view-id="${taskId}"]`) ?? null;
    }
    return null;
  }

  /** Returns the list element backing a bucket, or null when it is absent. */
  private static sectionFor(container: HTMLElement, bucket: EngineBucket): Element | null {
    if (bucket === 'history') return container.querySelector('#completed-task-list');
    if (bucket === 'inprogress' || bucket === 'queue') {
      return container.querySelector(`[data-engine-section="${bucket}"]`);
    }
    return null;
  }

  private static renderItem(bucket: EngineBucket, task: Task): string {
    return bucket === 'history'
      ? HistoryItemView.render(task)
      : ExecutionEngineItemView.render(task);
  }

  /** Removes a row, updates the section count and restores its empty state. */
  private static removeItem(
    container: HTMLElement,
    bucket: EngineBucket,
    taskId: string
  ): boolean {
    const node = ExecutionEngineView.findItem(container, bucket, taskId);
    if (!node) return false;

    const list = node.parentElement;
    node.remove();
    if (!list) return false;

    if (!ExecutionEngineView.syncSectionCount(container, bucket, list)) {
      list.innerHTML = ExecutionEngineView.emptyStateFor(bucket);
    }
    return true;
  }

  /** Inserts a row at its sort position and increments the section count. */
  private static insertItem(container: HTMLElement, bucket: EngineBucket, task: Task): boolean {
    const list = ExecutionEngineView.sectionFor(container, bucket);
    if (!list) return false;

    // Drop a rendered empty-state placeholder before adding the first row.
    if (!list.querySelector('[data-view-id]')) {
      list.innerHTML = '';
    }

    const wrapper = document.createElement('div');
    wrapper.innerHTML = ExecutionEngineView.renderItem(bucket, task);
    const node = wrapper.firstElementChild;
    if (!node) return false;

    const inserted = Array.from(list.children).some((child) => {
      if (!ExecutionEngineView.comesBefore(bucket, node, child)) return false;
      list.insertBefore(node, child);
      return true;
    });
    if (!inserted) list.appendChild(node);

    ExecutionEngineView.syncSectionCount(container, bucket, list);
    return true;
  }

  /**
   * Updates the section header count and returns whether any rows remain.
   * The History Feed has no count chip, so this only tracks emptiness there.
   */
  private static syncSectionCount(
    container: HTMLElement,
    bucket: EngineBucket,
    list: Element
  ): boolean {
    const remaining = list.querySelectorAll('[data-view-id]').length;
    const countEl = container.querySelector(`[data-engine-count="${bucket}"]`);
    if (countEl) countEl.textContent = String(remaining);
    return remaining > 0;
  }

  /** Ordering predicate: ascending `order` for the engine, newest-first history. */
  private static comesBefore(bucket: EngineBucket, node: Element, sibling: Element): boolean {
    if (bucket === 'history') {
      const nodeTime = new Date(node.getAttribute('data-updated-at') || 0).getTime();
      const siblingTime = new Date(sibling.getAttribute('data-updated-at') || 0).getTime();
      return nodeTime > siblingTime;
    }
    const nodeOrder = Number(node.getAttribute('data-order') ?? 0);
    const siblingOrder = Number(sibling.getAttribute('data-order') ?? 0);
    return nodeOrder < siblingOrder;
  }

  private static emptyStateFor(bucket: EngineBucket): string {
    if (bucket === 'history') {
      return `<p class="text-app-muted italic text-[10px] text-center py-3">No tasks completed yet.</p>`;
    }
    const message = bucket === 'queue' ? 'Nothing scheduled.' : 'No active work.';
    return `<div class="px-1"><p class="text-[10px] italic text-app-muted/50 text-center border border-dashed border-app-border/40 rounded-lg py-3">${message}</p></div>`;
  }
}

function orderSort(a: Task, b: Task): number {
  return (a.order || 0) - (b.order || 0);
}
