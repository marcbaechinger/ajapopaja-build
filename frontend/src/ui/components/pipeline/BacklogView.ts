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
import { BacklogTaskView } from './BacklogTaskView.ts';
import { ExecutionEngineItemView } from './ExecutionEngineItemView.ts';

/** The three collapsible sections rendered by {@link BacklogView}. */
export const BACKLOG_SECTION_KEYS = ['proposed', 'backlog', 'queue'] as const;
export type BacklogSectionKey = (typeof BACKLOG_SECTION_KEYS)[number];

/**
 * A set/array of section keys, or a map of section key to collapsed boolean.
 * `true` collapses every section and `false` expands every section.
 */
export type BacklogCollapsedSections =
  | boolean
  | string
  | Iterable<string>
  | Partial<Record<BacklogSectionKey, boolean>>;

export interface BacklogViewProps {
  tasks: Task[];
  /** Id of the currently selected backlog/queue task (CREATED and SCHEDULED are highlighted). */
  selectedTaskId?: string;
  /**
   * Sections that should start collapsed. Accepts a `Set`, an array, a
   * comma/space separated string, or an object such as
   * `{ proposed: true, queue: true }`.
   */
  collapsedSections?: BacklogCollapsedSections;
  /** Alias for {@link collapsedSections}. */
  sectionsCollapsed?: BacklogCollapsedSections;
  /** Alias for {@link collapsedSections}. */
  collapsed?: BacklogCollapsedSections;
  /** Convenience flags for collapsing individual sections. */
  proposedCollapsed?: boolean;
  backlogCollapsed?: boolean;
  queueCollapsed?: boolean;
  /** Convenience flags for collapsing individual sections (alias order). */
  collapsedProposed?: boolean;
  collapsedBacklog?: boolean;
  collapsedQueue?: boolean;
}

/**
 * BacklogView renders the left sidebar of the PipelineDetailView.
 *
 * It lists the tasks that are still in the "backlog", i.e. those with state
 * PROPOSED (design doc submitted) and CREATED (awaiting design), plus the
 * execution Queue (SCHEDULED). They are grouped into three vertical sections -
 * PROPOSED on top, CREATED below it and the Queue at the bottom - each with a
 * header showing the section type and the number of tasks in it.
 *
 * Every section is independently collapsible. The section header is a native
 * `<summary>`, so clicking it expands/collapses the section even before the
 * global action registry is involved; `toggle_backlog_section` additionally
 * keeps `collapsedBacklogSections` in the pipeline state in sync so the choice
 * survives a later backlog repaint.
 *
 * Tasks inside a section are sorted by their ``order`` value ascending (lower
 * values first) so the user can prioritise work regardless of when it was
 * created or updated.
 */
export class BacklogView {
  static render(
    props: BacklogViewProps,
    collapsedSectionsOverride?: BacklogCollapsedSections
  ): string {
    const { tasks, selectedTaskId } = props;

    const proposed = tasks
      .filter(t => !t.deleted && t.status === TaskStatus.PROPOSED)
      .sort((a, b) => taskSort(a, b));
    const created = tasks
      .filter(t => !t.deleted && t.status === TaskStatus.CREATED)
      .sort((a, b) => taskSort(a, b));
    const queue = tasks
      .filter(t => !t.deleted && t.status === TaskStatus.SCHEDULED)
      .sort((a, b) => taskSort(a, b));

    const collapsed = BacklogView.resolveCollapsedSections({
      ...props,
      collapsedSections: collapsedSectionsOverride ?? props.collapsedSections,
    });

    return `
      <div class="flex flex-col gap-3 p-2 min-h-0">
        ${BacklogView.renderSection({
          key: 'proposed',
          title: 'Proposed',
          count: proposed.length,
          accent: 'text-purple-400',
          tasks: proposed,
          emptyMessage: 'No proposed designs.',
          renderItem: (t) => BacklogTaskView.render(t, t.id === selectedTaskId),
          collapsed: collapsed.has('proposed'),
        })}

        ${BacklogView.renderSection({
          key: 'backlog',
          title: 'Backlog',
          count: created.length,
          accent: 'text-app-muted',
          tasks: created,
          emptyMessage: 'Backlog is empty.',
          renderItem: (t) => BacklogTaskView.render(t, t.id === selectedTaskId),
          collapsed: collapsed.has('backlog'),
        })}

        ${BacklogView.renderSection({
          key: 'queue',
          title: 'Queue',
          count: queue.length,
          accent: 'text-app-accent-1',
          tasks: queue,
          emptyMessage: 'Nothing scheduled.',
          renderItem: (t) => ExecutionEngineItemView.render(t, t.id === selectedTaskId),
          collapsed: collapsed.has('queue'),
        })}
      </div>
    `;
  }

  /**
   * Renders one independently collapsible section. The body keeps the existing
   * `data-backlog-section` marker (and the queue's `data-engine-section` alias)
   * so in-place task reconciliation keeps working.
   */
  private static renderSection(opts: {
    key: BacklogSectionKey;
    title: string;
    count: number;
    accent: string;
    tasks: Task[];
    emptyMessage: string;
    renderItem: (task: Task) => string;
    collapsed: boolean;
  }): string {
    const { key, title, count, accent, collapsed } = opts;
    const headerAttr = BacklogView.sectionHeaderAttr(key);
    const countAttr = BacklogView.sectionCountAttr(key);
    const openAttr = collapsed ? '' : ' open';
    const titleAction = collapsed ? 'Expand' : 'Collapse';
    const bodyId = `backlog-section-body-${key}`;

    return `
      <details class="group/backlog-section flex flex-col gap-1 min-h-0"
        data-backlog-collapsible="${key}" data-backlog-section-key="${key}"
        data-backlog-collapsed="${collapsed}"${openAttr}>
        <summary class="flex items-center justify-between gap-2 px-1 pt-1 cursor-pointer select-none list-none text-app-muted hover:text-app-text transition-colors"
          ${headerAttr} data-action-click="toggle_backlog_section" data-backlog-toggle="${key}"
          aria-expanded="${!collapsed}" aria-controls="${bodyId}"
          title="${titleAction} ${title}">
          <span class="flex items-center gap-1 min-w-0">
            <span class="transition-transform group-open/backlog-section:rotate-90"
              data-backlog-toggle-icon="${key}">${BacklogView.sectionToggleIcon()}</span>
            <span class="text-[10px] font-black uppercase tracking-widest ${accent}">${title}</span>
          </span>
          <span${countAttr} class="text-[10px] font-bold text-app-muted bg-app-surface border border-app-border rounded-full px-1.5 py-0.5">${count}</span>
        </summary>
        ${BacklogView.sectionBody(opts.tasks, opts.emptyMessage, opts.renderItem, key, collapsed, bodyId)}
      </details>
    `;
  }

  private static sectionHeaderAttr(key: BacklogSectionKey): string {
    return ` data-backlog-header="${key}"${key === 'queue' ? ' data-engine-header="queue"' : ''}`;
  }

  private static sectionCountAttr(key: BacklogSectionKey): string {
    return ` data-backlog-count="${key}"${key === 'queue' ? ' data-engine-count="queue"' : ''}`;
  }

  private static sectionBody(
    tasks: Task[],
    emptyMessage: string,
    renderItem: (task: Task) => string,
    key: BacklogSectionKey,
    collapsed: boolean,
    bodyId: string
  ): string {
    const sectionAttr = `data-backlog-section="${key}"${key === 'queue' ? ' data-engine-section="queue"' : ''}`;
    const hiddenClass = collapsed ? ' hidden group-open/backlog-section:block' : '';
    if (tasks.length === 0) {
      return `
        <div id="${bodyId}" class="px-1${hiddenClass}" ${sectionAttr}
          data-backlog-collapsed="${collapsed}">
          <p class="text-[10px] italic text-app-muted/50 text-center border border-dashed border-app-border/40 rounded-lg py-3">${emptyMessage}</p>
        </div>
      `;
    }
    const listClass = collapsed
      ? 'flex flex-col gap-2 hidden group-open/backlog-section:flex'
      : 'flex flex-col gap-2';
    return `
      <div id="${bodyId}" class="${listClass}" ${sectionAttr} data-backlog-collapsed="${collapsed}">
        ${tasks.map(renderItem).join('')}
      </div>
    `;
  }

  /** Chevron used by each section header (rotates when the section is open). */
  static sectionToggleIcon(): string {
    return `<svg class="w-3 h-3" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>`;
  }

  /** Returns the set of sections that should be rendered collapsed. */
  static resolveCollapsedSections(props: BacklogViewProps): Set<BacklogSectionKey> {
    const collapsed = new Set<BacklogSectionKey>();
    BacklogView.addCollapsedSections(props.collapsedSections, collapsed);
    BacklogView.addCollapsedSections(props.sectionsCollapsed, collapsed);
    BacklogView.addCollapsedSections(props.collapsed, collapsed);

    for (const key of BACKLOG_SECTION_KEYS) {
      if (
        props[`${key}Collapsed` as keyof BacklogViewProps] === true ||
        props[`collapsed${key[0].toUpperCase()}${key.slice(1)}` as keyof BacklogViewProps] === true
      ) {
        collapsed.add(key);
      }
    }
    return collapsed;
  }

  private static addCollapsedSections(
    value: BacklogCollapsedSections | undefined,
    collapsed: Set<BacklogSectionKey>
  ): void {
    if (value === undefined || value === null) return;
    if (value === true) {
      BACKLOG_SECTION_KEYS.forEach(key => collapsed.add(key));
      return;
    }
    if (value === false) {
      collapsed.clear();
      return;
    }
    if (typeof value === 'string') {
      value
        .split(/[\s,]+/)
        .filter(Boolean)
        .forEach(part => {
          const key = part.toLowerCase();
          if (BacklogView.isSectionKey(key)) collapsed.add(key);
        });
      return;
    }
    if (typeof value === 'object' && Symbol.iterator in value) {
      for (const part of value as Iterable<unknown>) {
        if (typeof part === 'string') {
          const key = part.toLowerCase();
          if (BacklogView.isSectionKey(key)) collapsed.add(key);
        }
      }
      return;
    }
    if (typeof value === 'object') {
      const record = value as Partial<Record<BacklogSectionKey, boolean>>;
      for (const key of BACKLOG_SECTION_KEYS) {
        if (record[key] === true) collapsed.add(key);
      }
    }
  }

  private static isSectionKey(value: string): value is BacklogSectionKey {
    return (BACKLOG_SECTION_KEYS as readonly string[]).includes(value);
  }

  /**
   * Applies the collapsed state to a single mounted section. Kept as a pure DOM
   * helper so the pipeline action only owns the persisted state.
   */
  static applySectionCollapsed(
    root: ParentNode,
    section: BacklogSectionKey,
    collapsed: boolean
  ): void {
    const details = BacklogView.findSection(root, section);
    if (details) {
      details.open = !collapsed;
      details.setAttribute('data-backlog-collapsed', String(collapsed));
    }

    const header = details?.querySelector<HTMLElement>(`[data-backlog-header="${section}"]`)
      ?? root.querySelector<HTMLElement>(`[data-backlog-header="${section}"]`);
    if (header) {
      header.setAttribute('aria-expanded', String(!collapsed));
      header.setAttribute('data-backlog-collapsed', String(collapsed));
      const title = section === 'backlog'
        ? 'Backlog'
        : `${section[0].toUpperCase()}${section.slice(1)}`;
      header.setAttribute('title', `${collapsed ? 'Expand' : 'Collapse'} ${title}`);
    }

    const icon = details?.querySelector<HTMLElement>(`[data-backlog-toggle-icon="${section}"]`)
      ?? root.querySelector<HTMLElement>(`[data-backlog-toggle-icon="${section}"]`);
    icon?.classList.toggle('rotate-90', !collapsed);

    const body = details?.querySelector<HTMLElement>(`[data-backlog-section="${section}"]`)
      ?? root.querySelector<HTMLElement>(`[data-backlog-section="${section}"]`);
    if (body) {
      body.classList.toggle('hidden', collapsed);
      body.setAttribute('data-backlog-collapsed', String(collapsed));
    }
  }

  /** Alias for {@link applySectionCollapsed}. */
  static applySectionState(
    root: ParentNode,
    section: BacklogSectionKey,
    collapsed: boolean
  ): void {
    BacklogView.applySectionCollapsed(root, section, collapsed);
  }

  /** Alias for {@link applySectionCollapsed}. */
  static setSectionCollapsed(
    root: ParentNode,
    section: BacklogSectionKey,
    collapsed: boolean
  ): void {
    BacklogView.applySectionCollapsed(root, section, collapsed);
  }

  /**
   * Applies a complete collapsed-section state to a mounted backlog view. A
   * boolean collapses/expands every section; otherwise sections not present in
   * the supplied collection/map are expanded.
   */
  static applySectionsCollapsed(
    root: ParentNode,
    value: BacklogCollapsedSections
  ): void {
    if (typeof value === 'boolean') {
      BACKLOG_SECTION_KEYS.forEach(key => {
        BacklogView.applySectionCollapsed(root, key, value);
      });
      return;
    }

    const collapsed = BacklogView.resolveCollapsedSections({ tasks: [], collapsedSections: value });
    BACKLOG_SECTION_KEYS.forEach(key => {
      BacklogView.applySectionCollapsed(root, key, collapsed.has(key));
    });
  }

  /** Alias for {@link applySectionsCollapsed}. */
  static applySectionsState(root: ParentNode, value: BacklogCollapsedSections): void {
    BacklogView.applySectionsCollapsed(root, value);
  }

  /** Alias for {@link applySectionsCollapsed}. */
  static applyCollapsedState(root: ParentNode, value: BacklogCollapsedSections): void {
    BacklogView.applySectionsCollapsed(root, value);
  }

  /** Alias for {@link applySectionsCollapsed}. */
  static applyCollapsedSections(root: ParentNode, value: BacklogCollapsedSections): void {
    BacklogView.applySectionsCollapsed(root, value);
  }

  /**
   * Toggles one mounted section and returns whether it is collapsed afterwards.
   */
  static toggleSection(root: ParentNode, section: BacklogSectionKey): boolean {
    const details = BacklogView.findSection(root, section);
    const body = details?.querySelector<HTMLElement>(`[data-backlog-section="${section}"]`)
      ?? root.querySelector<HTMLElement>(`[data-backlog-section="${section}"]`);
    const currentlyCollapsed = details
      ? !details.open
      : !!body?.classList.contains('hidden');
    const collapsed = !currentlyCollapsed;
    BacklogView.applySectionCollapsed(root, section, collapsed);
    return collapsed;
  }

  private static findSection(
    root: ParentNode,
    section: BacklogSectionKey
  ): HTMLDetailsElement | null {
    const selector = `[data-backlog-collapsible="${section}"]`;
    const own = (root as ParentNode & { matches?: (selector: string) => boolean }).matches;
    if (typeof own === 'function' && own.call(root, selector)) {
      return root as unknown as HTMLDetailsElement;
    }
    return root.querySelector<HTMLDetailsElement>(selector);
  }
}

/**
 * Sort tasks by their ``order`` value ascending (lower order first). The order
 * can be negative; default tasks use 100 so they naturally sort below anything
 * explicitly prioritised.
 */
function taskSort(a: Task, b: Task): number {
  return (a.order || 0) - (b.order || 0);
}
