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

import { Icon } from './Icon.ts';
import { escapeHtml } from '../utils/html.ts';
import {
  THEME_SETS,
  getSupportedModes,
  themeManager,
  type PalettePrimitives,
  type ThemeMode,
  type ThemeSet,
} from '../../theme/themeSets.ts';

const MENU_ID = 'theme-set-picker-menu';
const MODES: readonly ThemeMode[] = ['light', 'dark'];

/**
 * Events the picker has already handled directly. The action handlers check
 * this marker so the same click is not applied twice when the app-wide
 * ActionRegistry also dispatches its `data-action-click` action.
 */
const handledEvents = new WeakSet<Event>();

export function wasThemeSetPickerEventHandled(event: Event): boolean {
  return handledEvents.has(event);
}

/**
 * Header control that selects one of the registered theme sets.
 *
 * The trigger uses the app-wide `data-action-click`/`ActionRegistry` pattern
 * (`toggle_theme_set_picker`), while each set row carries the existing
 * `set_theme_set` action plus its `data-theme-set-id`. The picker only owns
 * presentation and keyboard behaviour: opening/closing, roving focus and
 * Escape/outside-click dismissal. The selected set and the light/dark mode
 * continue to be owned by `ThemeManager`.
 *
 * Light/dark remains available as a secondary control inside the popover, so
 * the old single-purpose moon button is no longer needed (design §12.4).
 */
export class ThemeSetPicker {
  private container: HTMLElement | null = null;
  private root: HTMLElement | null = null;
  private trigger: HTMLButtonElement | null = null;
  private menu: HTMLElement | null = null;
  private open = false;
  private cleanup: Array<() => void> = [];
  private themeUnsub: (() => void) | null = null;

  /** Render the trigger + hidden popover. Safe to call before {@link mount}. */
  render(): string {
    const triggerLabel = this.activeSet().label;
    return `
      <div class="relative" data-theme-set-picker>
        <button type="button"
                data-action-click="toggle_theme_set_picker"
                data-theme-set-picker-trigger
                aria-haspopup="menu"
                aria-expanded="false"
                aria-controls="${MENU_ID}"
                title="Theme set"
                class="flex items-center gap-2 bg-app-bg hover:bg-app-surface px-3 py-2 rounded-xl border border-app-border text-app-muted hover:text-app-accent-2 transition-colors cursor-pointer group">
          ${this.renderTriggerContent(triggerLabel)}
        </button>
        <div id="${MENU_ID}"
             data-theme-set-menu
             role="menu"
             aria-label="Theme set"
             hidden
             class="absolute right-0 top-full mt-2 w-64 rounded-xl border border-app-border bg-app-surface shadow-2xl z-50 p-1.5">
          ${this.renderMenuContent()}
        </div>
      </div>
    `;
  }

  /** Bind the control to the container that holds the rendered markup. */
  mount(container: HTMLElement): void {
    this.container = container;
    this.resolveRoot();
    this.refresh();
  }

  /** Remove all listeners and reset transient UI state. */
  destroy(): void {
    this.detach();
    this.container = null;
  }

  /** Open when closed, close when open. Used by the trigger action. */
  toggle(): void {
    if (!this.resolveRoot()) return;
    if (this.open) this.close();
    else this.openPicker();
  }

  /** Exposed for tests and callers that need to dismiss the popover. */
  close(focusTrigger = false): void {
    if (!this.open) return;
    this.open = false;
    if (this.menu) this.menu.hidden = true;
    this.trigger?.setAttribute('aria-expanded', 'false');
    if (focusTrigger) this.trigger?.focus();
  }

  isOpen(): boolean {
    return this.open;
  }

  /** Re-render the trigger and menu after an external theme change. */
  refresh(): void {
    if (!this.resolveRoot()) return;
    const label = this.activeSet().label;
    if (this.trigger) {
      this.trigger.innerHTML = this.renderTriggerContent(label);
      this.trigger.title = `Theme set: ${label}`;
    }
    if (!this.menu) return;

    // Preserve keyboard focus across a refresh triggered by a mode/set change.
    const previous = document.activeElement as HTMLElement | null;
    const previousMode = previous
      ?.closest<HTMLElement>('[data-theme-mode]')
      ?.getAttribute('data-theme-mode');
    const previousSetId = previous
      ?.closest<HTMLElement>('[data-theme-set-row]')
      ?.getAttribute('data-theme-set-row');

    this.menu.innerHTML = this.renderMenuContent();
    this.menu.hidden = !this.open;
    this.trigger?.setAttribute('aria-expanded', String(this.open));

    if (!this.open) return;
    if (previousMode) {
      // A set switch may have made the previously focused mode unsupported;
      // fall back to the mode that is actually applied.
      const targetMode = getSupportedModes(this.activeSet()).includes(
        previousMode as ThemeMode
      )
        ? previousMode
        : this.activeMode();
      this.menu
        .querySelector<HTMLElement>(`[data-theme-mode="${targetMode}"]`)
        ?.focus();
    } else if (previousSetId) {
      this.menu
        .querySelector<HTMLElement>(`[data-theme-set-row="${previousSetId}"]`)
        ?.focus();
    }
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  private renderTriggerContent(label: string): string {
    return `
      ${this.renderSwatch(this.activeSet(), this.activeMode())}
      <span class="hidden sm:inline text-xs font-bold uppercase tracking-widest" data-theme-set-trigger-label>${escapeHtml(label)}</span>
      ${Icon.render('chevronDown', {
        size: 12,
        className: 'group-hover:rotate-180 transition-transform',
      })}
    `;
  }

  private renderMenuContent(): string {
    const activeSet = this.activeSet();
    const activeId = themeManager.getActiveSetId();
    const activeMode = this.activeMode();
    const supportedModes = getSupportedModes(activeSet);
    const rows = Object.values(THEME_SETS)
      .map((set) => this.renderSetRow(set, set.id === activeId, activeMode))
      .join('');

    return `
      <div class="px-2 pt-1 pb-1.5 text-[10px] font-black uppercase tracking-widest text-app-muted">Theme set</div>
      <div role="none" class="flex flex-col gap-0.5">${rows}</div>
      <div class="mt-1.5 border-t border-app-border pt-2">
        <div class="px-2 pb-1 text-[10px] font-black uppercase tracking-widest text-app-muted">Mode</div>
        <div class="grid grid-cols-2 gap-1" role="group" aria-label="Color mode">
          ${MODES.map((mode) =>
            this.renderModeButton(
              mode,
              mode === activeMode,
              supportedModes.includes(mode),
              activeSet
            )
          ).join('')}
        </div>
      </div>
    `;
  }

  private renderSetRow(set: ThemeSet, active: boolean, mode: ThemeMode): string {
    const rowClass = active
      ? 'border-app-accent-2/30 bg-app-accent-2/15 text-app-text'
      : 'border-transparent text-app-muted hover:bg-app-bg hover:text-app-text';
    const activeClass = active ? ' theme-set-option-active' : '';
    const check = active
      ? Icon.render('check', { size: 14, className: 'shrink-0 text-app-accent-2' })
      : '';

    return `
      <button type="button"
              role="menuitemradio"
              aria-checked="${active}"
              data-action-click="set_theme_set"
              data-theme-set-id="${escapeHtml(set.id)}"
              data-theme-set-row="${escapeHtml(set.id)}"
              data-theme-set-active="${active}"
              data-active="${active}"
              class="theme-set-option${activeClass} w-full flex items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors cursor-pointer ${rowClass}">
        ${this.renderSwatch(set, mode)}
        <span class="min-w-0 flex-1">
          <span class="block text-xs font-bold truncate">${escapeHtml(set.label)}</span>
          ${set.description ? `<span class="block text-[10px] text-app-muted truncate">${escapeHtml(set.description)}</span>` : ''}
        </span>
        <span class="shrink-0 w-3.5 h-3.5" data-theme-set-check aria-hidden="true">${check}</span>
      </button>
    `;
  }

  private renderModeButton(
    mode: ThemeMode,
    active: boolean,
    supported: boolean,
    set: ThemeSet
  ): string {
    const label = mode === 'dark' ? 'Dark' : 'Light';
    const buttonClass = !supported
      ? 'border-app-border text-app-muted opacity-40 cursor-not-allowed'
      : active
        ? 'border-app-accent-2/40 bg-app-accent-2/15 text-app-accent-2'
        : 'border-app-border text-app-muted hover:bg-app-bg hover:text-app-text';
    const title = supported
      ? `Use ${label.toLowerCase()} mode`
      : `${label} mode is not supported by the ${set.label} theme set`;
    const disabledAttrs = supported
      ? ''
      : 'disabled aria-disabled="true" data-theme-mode-supported="false"';
    const icon =
      mode === 'dark'
        ? `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"></path></svg>`
        : `<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707m12.728 0l-.707-.707M6.343 6.343l-.707-.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"></path></svg>`;

    return `
      <button type="button"
              data-theme-mode="${mode}"
              data-theme-mode-button
              data-theme-mode-active="${active}"
              data-theme-mode-supported="${supported}"
              aria-pressed="${active}"
              title="${escapeHtml(title)}"
              ${disabledAttrs}
              class="flex items-center justify-center gap-1.5 rounded-lg border px-2 py-1.5 text-[10px] font-bold uppercase tracking-widest transition-colors cursor-pointer ${buttonClass}">
        ${icon}
        <span>${label}</span>
      </button>
    `;
  }

  private renderSwatch(set: ThemeSet, mode: ThemeMode): string {
    const palette: Partial<PalettePrimitives> =
      set.palette[mode] ?? set.palette.dark ?? set.palette.light ?? {};
    const accent = palette['--palette-accent'] ?? 'currentColor';
    const accent2 = palette['--palette-accent-2'] ?? 'currentColor';
    const neutral = palette['--palette-muted'] ?? palette['--palette-text'] ?? 'currentColor';
    const dot = (role: string, color: string) =>
      `<span data-palette-role="${role}" class="inline-block w-2 h-2 rounded-full border border-black/20" style="background-color:${escapeHtml(color)}"></span>`;

    return `
      <span class="theme-set-swatch inline-flex items-center gap-0.5 shrink-0" data-theme-set-swatch aria-hidden="true">
        ${dot('accent', accent)}
        ${dot('accent-2', accent2)}
        ${dot('neutral', neutral)}
      </span>
    `;
  }

  private activeSet(): ThemeSet {
    return themeManager.getActiveSet();
  }

  private activeMode(): ThemeMode {
    return themeManager.getActiveMode();
  }

  // -------------------------------------------------------------------------
  // Wiring
  // -------------------------------------------------------------------------

  private resolveRoot(): boolean {
    const root = this.findRoot();
    if (!root) return false;
    if (this.root === root && this.trigger && this.menu) return true;

    this.detach();
    this.root = root;
    this.trigger = root.querySelector<HTMLButtonElement>('[data-theme-set-picker-trigger]');
    this.menu = root.querySelector<HTMLElement>('[data-theme-set-menu]');
    if (!this.trigger || !this.menu) {
      this.root = null;
      this.trigger = null;
      this.menu = null;
      return false;
    }

    this.bindDocumentEvents();
    this.bindElementEvents(this.trigger, this.menu);
    this.themeUnsub = themeManager.onSetChange(() => this.refresh());
    return true;
  }

  private findRoot(): HTMLElement | null {
    if (this.root?.isConnected) return this.root;
    const fromContainer =
      this.container?.querySelector<HTMLElement>('[data-theme-set-picker]') ?? null;
    if (fromContainer) return fromContainer;
    if (typeof document === 'undefined') return null;
    return document.querySelector<HTMLElement>('[data-theme-set-picker]');
  }

  private bindElementEvents(trigger: HTMLButtonElement, menu: HTMLElement): void {
    this.listen(trigger, 'click', (event) => {
      handledEvents.add(event);
      if (this.open) this.close();
      else this.openPicker();
    });

    this.listen(trigger, 'keydown', (event) => {
      const key = (event as KeyboardEvent).key;
      if (key !== 'ArrowDown' && key !== 'ArrowUp') return;
      event.preventDefault();
      if (!this.open) this.openPicker();
      const rows = this.rows();
      if (rows.length === 0) return;
      const index = key === 'ArrowUp' ? rows.length - 1 : 0;
      rows[index]?.focus();
    });

    this.listen(menu, 'keydown', (event) => this.onMenuKeydown(event as KeyboardEvent));
    this.listen(menu, 'click', (event) => this.onMenuClick(event as MouseEvent));
  }

  private bindDocumentEvents(): void {
    this.listen(document, 'click', (event) => {
      if (!this.open) return;
      if (this.root?.contains(event.target as Node)) return;
      this.close();
    }, true);

    this.listen(document, 'keydown', (event) => {
      if ((event as KeyboardEvent).key !== 'Escape' || !this.open) return;
      event.preventDefault();
      this.close(true);
    });
  }

  private onMenuClick(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    handledEvents.add(event);
    const modeButton = target.closest<HTMLElement>('[data-theme-mode]');
    if (modeButton) {
      if (
        modeButton.hasAttribute('disabled') ||
        modeButton.getAttribute('aria-disabled') === 'true'
      ) {
        return;
      }
      const mode = modeButton.getAttribute('data-theme-mode');
      if (mode === 'light' || mode === 'dark') {
        themeManager.setMode(mode);
        this.refresh();
      }
      return;
    }

    // Rows carry the global `set_theme_set` action. Apply the selection here
    // too so the control works even before the registry dispatches, then mark
    // the event so the action handler does not apply it a second time.
    const row = target.closest<HTMLElement>('[data-theme-set-row]');
    if (row) {
      // Close first so the synchronous refresh caused by setSet runs with the
      // popover already hidden and cannot move focus back onto a row.
      this.close(true);
      const setId = row.getAttribute('data-theme-set-row');
      if (setId) themeManager.setSet(setId);
    }
  }

  private onMenuKeydown(event: KeyboardEvent): void {
    const rows = this.rows();
    if (rows.length === 0) return;
    const active = document.activeElement as HTMLElement | null;
    const index = active ? rows.indexOf(active) : -1;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = index >= 0 ? (index + 1) % rows.length : 0;
      rows[next]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      const next = index >= 0 ? (index - 1 + rows.length) % rows.length : rows.length - 1;
      rows[next]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      rows[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      rows[rows.length - 1]?.focus();
    } else if ((event.key === 'Enter' || event.key === ' ') && index >= 0) {
      event.preventDefault();
      rows[index]?.click();
    }
  }

  private openPicker(): void {
    if (!this.resolveRoot() || !this.trigger || !this.menu) return;
    this.open = true;
    this.menu.hidden = false;
    this.trigger.setAttribute('aria-expanded', 'true');

    const rows = this.rows();
    if (rows.length === 0) return;
    const activeId = themeManager.getActiveSetId();
    const activeIndex = rows.findIndex(
      (row) => row.getAttribute('data-theme-set-row') === activeId
    );
    rows[activeIndex >= 0 ? activeIndex : 0]?.focus();
  }

  private rows(): HTMLElement[] {
    if (!this.menu) return [];
    return Array.from(this.menu.querySelectorAll<HTMLElement>('[data-theme-set-row]'));
  }

  private listen(
    target: EventTarget,
    type: string,
    handler: EventListener,
    options?: AddEventListenerOptions | boolean
  ): void {
    target.addEventListener(type, handler, options);
    this.cleanup.push(() => target.removeEventListener(type, handler, options));
  }

  private detach(): void {
    for (const remove of this.cleanup) remove();
    this.cleanup = [];
    this.themeUnsub?.();
    this.themeUnsub = null;
    this.open = false;
    this.root = null;
    this.trigger = null;
    this.menu = null;
  }
}
